/* ═══════════════════════════════════════════════════════════
   Supabase Sync — Auth, Cloud Sync, Sharing
   Local-first: localStorage is always the source of truth.
   When logged in, changes are mirrored to Supabase in background.

   Sharing modes:
   - readonly: view another user's decks/cards (no edits)
   - sync: one-time copy of another user's data into your account
   - coown: both users share the same data (full read/write)
   ═══════════════════════════════════════════════════════════ */

const SupabaseSync = (() => {
  const SUPABASE_URL = 'https://cuzipcfnvtndaxzedtsk.supabase.co';
  const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImN1emlwY2ZudnRuZGF4emVkdHNrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQyMDkxODMsImV4cCI6MjA4OTc4NTE4M30.w2y8Yv4WTFhnSJ84SHy3D93HtSXgoLV3LEMWWWhhKcQ';

  let sb = null;
  let currentUser = null;
  let _syncing = false;
  let _syncDebounce = null;
  let _coownPartnerId = null;
  let _suppressHook = false; // Prevent write hooks during sync // If co-owning, this is the host's user_id

  // ── Init ──────────────────────────────────────────────
  async function init() {
    if (typeof supabase === 'undefined') { console.warn('Supabase SDK not loaded'); return; }
    sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { storageKey: 'mtg-auth', lock: false, flowType: 'implicit' }
    });

    // Single handler for all auth events — only source of truth
    let _initSyncDone = false;
    sb.auth.onAuthStateChange(async (event, session) => {
      console.log('[Auth]', event, session?.user?.email || 'no user');
      currentUser = session?.user || null;
      updateAuthUI();

      if (event === 'SIGNED_OUT') {
        currentUser = null;
        _coownPartnerId = null;
        _initSyncDone = false;
        updateAuthUI();
        return;
      }

      // Sync on any event that gives us a valid session (SIGNED_IN, TOKEN_REFRESHED, INITIAL_SESSION)
      if (currentUser && !_syncing && !_initSyncDone) {
        _initSyncDone = true;
        try {
          setSyncStatus('syncing');
          console.log('[Auth] Waking database...');
          // Wake up the database with a tiny query before doing anything else
          await sb.from('profiles').select('id').eq('id', currentUser.id).limit(1);
          console.log('[Auth] Database awake');

          try { await loadCoownState(); } catch (e) { console.warn('[Auth] coown check failed:', e); }
          console.log('[Auth] Co-own state:', _coownPartnerId ? 'guest of ' + _coownPartnerId : 'independent');
          await fullSync();
          console.log('[Auth] Sync complete');
          if (typeof navigate === 'function') navigate(currentPage);
        } catch (e) {
          console.error('[Auth] Sync error:', e);
          _initSyncDone = false;
        }
      }
    });

    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && currentUser) {
        debouncedSync();
        // Refresh shares if account modal is open
        if (document.getElementById('auth-modal')?.style.display === 'flex') {
          loadSharesAsync();
        }
      }
    });

    // Poll for new invitations every 60 seconds (only after first sync completes)
    setInterval(() => {
      if (!currentUser || document.hidden || _syncing || !_initSyncDone) return;
      checkForNewInvitations();
    }, 60000);
  }

  // The user_id to sync with — own ID or co-owner host's ID
  let _activeSyncUid = null;
  function syncUserId() {
    return _activeSyncUid || _coownPartnerId || currentUser?.id;
  }

  // Check if we're co-owning with someone
  async function loadCoownState() {
    if (!sb || !currentUser) return;
    try {
      const { data: asGuest, error } = await sb.from('shares').select('owner_id,mode')
        .eq('shared_with_id', currentUser.id).eq('accepted', true).limit(10);
      if (error) { console.error('loadCoownState error:', error); _coownPartnerId = null; return; }
      const coownGuest = (asGuest || []).find(s => s.mode === 'coown');
      if (coownGuest) { _coownPartnerId = coownGuest.owner_id; return; }
      _coownPartnerId = null;
    } catch (e) {
      console.error('loadCoownState failed:', e);
      _coownPartnerId = null;
    }
  }

  function isCoowning() { return !!_coownPartnerId; }
  function getCoownLabel() {
    if (_coownPartnerId) return 'Co-owning (guest)';
    return '';
  }

  // ── Auth UI ───────────────────────────────────────────
  function updateAuthUI() {
    const area = document.getElementById('auth-user-area');
    if (!area) return;
    if (currentUser) {
      const name = currentUser.user_metadata?.display_name || currentUser.email?.split('@')[0] || 'User';
      area.innerHTML = `
        <div class="admin__user-info" style="cursor:pointer" onclick="SupabaseSync.showAccountModal()">
          <span class="admin__user-name">${name}</span>
          <span class="admin__user-role">${currentUser.email}</span>
        </div>
        <button class="admin__theme-btn" onclick="SupabaseSync.signOut()" title="Sign Out" style="margin-top:4px">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
          <span>Sign Out</span>
        </button>
      `;
    } else {
      area.innerHTML = `
        <button class="admin__theme-btn" onclick="SupabaseSync.showAuthModal()" style="width:100%">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
          <span>Sign In / Sign Up</span>
        </button>
      `;
    }
    const syncEl = document.getElementById('sync-status');
    if (syncEl) { syncEl.style.display = currentUser ? '' : 'none'; }
  }

  // ── Auth Methods ──────────────────────────────────────
  async function signUp(email, password) {
    if (!sb) return { error: 'Not initialized' };
    return await sb.auth.signUp({ email, password, options: { emailRedirectTo: window.location.origin + window.location.pathname } });
  }
  async function signIn(email, password) {
    if (!sb) return { error: 'Not initialized' };
    return await sb.auth.signInWithPassword({ email, password });
  }
  function signOut() {
    // Clear ALL Supabase auth state from localStorage immediately
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith('mtg-auth') || key.startsWith('sb-')) localStorage.removeItem(key);
    }
    currentUser = null;
    _coownPartnerId = null;
    // Fire and forget — don't await, just reload
    if (sb) sb.auth.signOut().catch(() => {});
    location.reload();
  }
  function isLoggedIn() { return !!currentUser; }
  function getUser() { return currentUser; }

  // ── Auth Modal ────────────────────────────────────────
  function showAuthModal() { document.getElementById('auth-modal').style.display = 'flex'; renderAuthForm('login'); }
  function closeAuthModal() { document.getElementById('auth-modal').style.display = 'none'; }

  function renderAuthForm(mode) {
    const body = document.getElementById('auth-modal-body');
    const isLogin = mode === 'login';
    body.innerHTML = `
      <div class="auth-form">
        <h2 style="color:var(--color-heading);margin-bottom:4px">${isLogin ? 'Welcome Back' : 'Create Account'}</h2>
        <p style="color:var(--color-text-muted);font-size:.85rem;margin-bottom:20px">${isLogin ? 'Sign in to sync your collection across devices.' : 'Sign up to save your collection to the cloud.'}</p>
        <div class="auth-form__field"><label>Email</label><input type="email" id="auth-email" class="auth-form__input" placeholder="you@example.com" autocomplete="email"></div>
        <div class="auth-form__field"><label>Password</label><input type="password" id="auth-password" class="auth-form__input" placeholder="${isLogin ? 'Your password' : 'Min 6 characters'}" autocomplete="${isLogin ? 'current-password' : 'new-password'}"></div>
        <div id="auth-error" style="color:#cf6b6b;font-size:.82rem;min-height:20px;margin:4px 0"></div>
        <button class="btn btn--primary btn--full" onclick="SupabaseSync.handleAuth('${mode}')" id="auth-submit-btn">${isLogin ? 'Sign In' : 'Sign Up'}</button>
        <p style="text-align:center;margin-top:16px;font-size:.85rem;color:var(--color-text-muted)">
          ${isLogin ? `Don't have an account? <a href="#" onclick="event.preventDefault(); SupabaseSync.renderAuthForm('signup')">Sign Up</a>` : `Already have an account? <a href="#" onclick="event.preventDefault(); SupabaseSync.renderAuthForm('login')">Sign In</a>`}
        </p>
      </div>
    `;
    setTimeout(() => document.getElementById('auth-email')?.focus(), 100);
    const handler = (e) => { if (e.key === 'Enter') document.getElementById('auth-submit-btn')?.click(); };
    document.getElementById('auth-email')?.addEventListener('keydown', handler);
    document.getElementById('auth-password')?.addEventListener('keydown', handler);
  }

  async function handleAuth(mode) {
    const email = document.getElementById('auth-email')?.value?.trim();
    const password = document.getElementById('auth-password')?.value;
    const errorEl = document.getElementById('auth-error');
    const btn = document.getElementById('auth-submit-btn');
    if (!email || !password) { errorEl.textContent = 'Please enter email and password.'; return; }
    if (mode === 'signup' && password.length < 6) { errorEl.textContent = 'Password must be at least 6 characters.'; return; }
    btn.disabled = true; btn.textContent = mode === 'login' ? 'Signing in...' : 'Signing up...'; errorEl.textContent = '';
    const { data, error } = mode === 'login' ? await signIn(email, password) : await signUp(email, password);
    btn.disabled = false; btn.textContent = mode === 'login' ? 'Sign In' : 'Sign Up';
    if (error) { errorEl.textContent = error.message || 'An error occurred.'; return; }
    if (mode === 'signup' && data?.user && !data.user.confirmed_at && !data.session) {
      document.getElementById('auth-modal-body').innerHTML = `
        <div style="text-align:center;padding:20px">
          <div style="font-size:2.5rem;margin-bottom:12px">&#x2709;</div>
          <h2 style="color:var(--color-heading);margin-bottom:8px">Check Your Email</h2>
          <p style="color:var(--color-text-muted);font-size:.9rem;line-height:1.6">We sent a confirmation link to <strong style="color:var(--color-heading)">${email}</strong>.<br>Click the link to activate your account, then come back and sign in.</p>
          <button class="btn btn--outline" style="margin-top:20px" onclick="SupabaseSync.renderAuthForm('login')">Back to Sign In</button>
        </div>
      `;
      return;
    }
    closeAuthModal();
    showToast(`Signed in as ${email}`, 'success');
  }

  // ═══════════════════════════════════════════════════════
  //  ACCOUNT MODAL — Sharing Hub
  // ═══════════════════════════════════════════════════════
  function showAccountModal() { document.getElementById('auth-modal').style.display = 'flex'; renderAccountView(); }

  async function renderAccountView() {
    const body = document.getElementById('auth-modal-body');
    if (!currentUser) { renderAuthForm('login'); return; }

    body.innerHTML = `
      <h2 style="color:var(--color-heading);margin-bottom:16px">Account</h2>
      <div style="margin-bottom:20px;padding:12px;background:var(--color-bg-card);border-radius:var(--radius-md);border:1px solid var(--color-border)">
        <div style="color:var(--color-heading);font-weight:600">${currentUser.email}</div>
        <div style="color:var(--color-text-muted);font-size:.82rem;margin-top:2px">Joined ${new Date(currentUser.created_at).toLocaleDateString()}</div>
        ${_coownPartnerId ? '<div style="color:#6cabcf;font-size:.78rem;font-weight:600;margin-top:4px">Co-owning (guest)</div>' : ''}
      </div>

      <h3 style="color:var(--color-heading);font-size:.95rem;margin-bottom:8px">Share My Collection</h3>
      <p style="color:var(--color-text-muted);font-size:.82rem;margin-bottom:12px">Share your decks and owned cards with another player.</p>
      <div style="display:flex;gap:8px;margin-bottom:8px;flex-wrap:wrap">
        <input type="email" id="share-email-input" class="auth-form__input" placeholder="Their email address..." style="flex:1;min-width:180px">
        <select id="share-mode-select" class="auth-form__input" style="width:auto;min-width:120px">
          <option value="readonly">Read Only</option>
          <option value="coown">Co-Own</option>
        </select>
        <button class="btn btn--primary btn--sm" onclick="SupabaseSync.handleShare()">Share</button>
      </div>
      <div style="color:var(--color-text-muted);font-size:.72rem;margin-bottom:12px">
        <strong>Read Only:</strong> They can view your data. <strong>Co-Own:</strong> Both of you share the same cards & decks with full edit access.
      </div>
      <div id="share-error" style="color:#cf6b6b;font-size:.82rem;min-height:18px;margin-bottom:12px"></div>

      <div id="shares-list" style="margin-bottom:16px"></div>
      <div id="pending-invitations" style="margin-bottom:16px"></div>
      <div id="shared-with-me" style="margin-bottom:16px"></div>

      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px">
        <button class="btn btn--outline btn--sm" onclick="SupabaseSync.fullSync().then(() => { showToast('Synced!', 'success'); if(typeof navigate==='function') navigate(currentPage); })">Sync Now</button>
        <button class="btn btn--outline btn--sm" onclick="SupabaseSync.closeAuthModal()">Close</button>
      </div>
    `;

    // Load shares in background — don't block the modal
    loadSharesAsync();
  }

  let _lastInvitationCount = -1;
  async function checkForNewInvitations() {
    if (!sb || !currentUser) return;
    try {
      const { data } = await sb.from('shares').select('id')
        .or(`shared_with_id.eq.${currentUser.id},shared_with_email.eq.${currentUser.email.toLowerCase()}`)
        .eq('accepted', false);
      const count = data?.length || 0;
      if (_lastInvitationCount >= 0 && count > _lastInvitationCount) {
        showToast('You have a new sharing invitation!', 'info', 5000);
      }
      _lastInvitationCount = count;
    } catch (e) { /* ignore polling errors */ }
  }

  async function loadSharesAsync() {
    const sl = document.getElementById('shares-list');

    // Wait for any active sync to finish first (wakes the database)
    if (_syncing) {
      if (sl) sl.innerHTML = '<div style="color:var(--color-text-muted);font-size:.82rem">Waiting for sync...</div>';
      while (_syncing) await new Promise(r => setTimeout(r, 500));
    }

    if (sl) sl.innerHTML = '';
    try { await loadSharesUI(); } catch (e) { console.error('loadSharesUI:', e); if (sl) sl.innerHTML = ''; }
    try { await loadPendingInvitations(); } catch (e) { console.error('loadPending:', e); }
    try { await loadSharedWithMe(); } catch (e) { console.error('loadSharedWithMe:', e); }
  }

  // ── My Outgoing Shares ────────────────────────────────
  async function loadSharesUI() {
    const container = document.getElementById('shares-list');
    if (!container || !sb) return;
    const { data: shares, error } = await sb.from('shares').select('*').eq('owner_id', currentUser.id).order('created_at', { ascending: false });
    if (error) { console.error('Shares query error:', error); container.innerHTML = ''; return; }
    if (!shares || shares.length === 0) { container.innerHTML = '<div style="color:var(--color-text-muted);font-size:.82rem">No active shares.</div>'; return; }

    const modeLabels = { readonly: 'Read Only', coown: 'Co-Own' };
    const modeColors = { readonly: '#6bcf8e', coown: '#6cabcf' };
    container.innerHTML = `
      <div style="color:var(--color-text-muted);font-size:.72rem;font-weight:600;text-transform:uppercase;letter-spacing:.04em;margin-bottom:6px">Shared With</div>
      ${shares.map(s => `
        <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 10px;background:var(--color-bg-card);border:1px solid var(--color-border);border-left:3px solid ${modeColors[s.mode] || modeColors.readonly};border-radius:var(--radius-sm);margin-bottom:4px">
          <div>
            <div style="color:var(--color-heading);font-size:.85rem;font-weight:600">${s.shared_with_email}</div>
            <div style="font-size:.72rem"><span style="color:${modeColors[s.mode] || modeColors.readonly};font-weight:600">${modeLabels[s.mode] || 'Read Only'}</span> · <span style="color:var(--color-text-muted)">${s.accepted ? 'Active' : 'Pending'}</span></div>
          </div>
          <button class="btn btn--sm" style="color:#cf6b6b;border:1px solid #cf6b6b33;background:transparent;padding:4px 12px;font-size:.75rem" onclick="SupabaseSync.revokeShare('${s.id}')">Revoke</button>
        </div>
      `).join('')}
    `;
  }

  // ── Pending Invitations ───────────────────────────────
  async function loadPendingInvitations() {
    const container = document.getElementById('pending-invitations');
    if (!container || !sb) return;
    const { data: invitations, error } = await sb.from('shares')
      .select('*')
      .or(`shared_with_id.eq.${currentUser.id},shared_with_email.eq.${currentUser.email.toLowerCase()}`)
      .eq('accepted', false);
    if (error) { console.error('Pending invitations error:', error); container.innerHTML = ''; return; }
    if (!invitations || invitations.length === 0) { container.innerHTML = ''; return; }

    const modeLabels = { readonly: 'Read Only', coown: 'Co-Own' };
    // Look up owner emails
    const ownerIds = [...new Set(invitations.map(i => i.owner_id))];
    const { data: owners } = await sb.from('profiles').select('id, email, display_name').in('id', ownerIds);
    const ownerMap = {};
    (owners || []).forEach(o => { ownerMap[o.id] = o; });

    let html = '<div style="color:var(--color-text-muted);font-size:.72rem;font-weight:600;text-transform:uppercase;letter-spacing:.04em;margin-bottom:6px">Pending Invitations</div>';
    for (const inv of invitations) {
      const owner = ownerMap[inv.owner_id] || {};
      const fromName = owner.display_name || owner.email || 'Unknown';
      const fromEmail = owner.email || '';
      html += `
        <div style="display:flex;justify-content:space-between;align-items:center;padding:10px;background:rgba(224,192,96,.06);border:1px solid rgba(224,192,96,.2);border-radius:var(--radius-sm);margin-bottom:4px;flex-wrap:wrap;gap:8px">
          <div>
            <div style="color:var(--color-heading);font-size:.85rem;font-weight:600">${fromName}</div>
            ${fromEmail ? '<div style="color:var(--color-text-muted);font-size:.72rem">' + fromEmail + '</div>' : ''}
            <div style="color:var(--color-text-muted);font-size:.72rem">Wants to share · <strong style="color:var(--color-accent)">${modeLabels[inv.mode] || 'Read Only'}</strong></div>
          </div>
          <div style="display:flex;gap:6px">
            <button class="btn btn--primary btn--sm" style="padding:4px 14px;font-size:.75rem" onclick="SupabaseSync.acceptShare('${inv.id}', '${inv.mode}')">Accept</button>
            <button class="btn btn--sm" style="color:#cf6b6b;border:1px solid #cf6b6b33;background:transparent;padding:4px 10px;font-size:.75rem" onclick="SupabaseSync.declineShare('${inv.id}')">Decline</button>
          </div>
        </div>`;
    }
    container.innerHTML = html;
  }

  // ── Shared With Me (accepted shares where I'm the guest) ──
  async function loadSharedWithMe() {
    const container = document.getElementById('shared-with-me');
    if (!container || !sb) return;
    const { data: shares, error } = await sb.from('shares')
      .select('*')
      .eq('shared_with_id', currentUser.id).eq('accepted', true);
    if (error) { console.error('Shared with me error:', error); container.innerHTML = ''; return; }
    if (!shares || shares.length === 0) { container.innerHTML = ''; return; }

    const modeLabels = { readonly: 'Read Only', coown: 'Co-Own' };
    const modeColors = { readonly: '#6bcf8e', coown: '#6cabcf' };
    // Look up owner emails
    const ownerIds = [...new Set(shares.map(s => s.owner_id))];
    const { data: owners } = await sb.from('profiles').select('id, email, display_name').in('id', ownerIds);
    const ownerMap = {};
    (owners || []).forEach(o => { ownerMap[o.id] = o; });

    let html = '<div style="color:var(--color-text-muted);font-size:.72rem;font-weight:600;text-transform:uppercase;letter-spacing:.04em;margin-bottom:6px">Shared With Me</div>';
    for (const s of shares) {
      const owner = ownerMap[s.owner_id] || {};
      const fromName = owner.display_name || owner.email || 'Unknown';
      const fromEmail = owner.email || '';
      html += `
        <div style="padding:10px;background:var(--color-bg-card);border:1px solid var(--color-border);border-left:3px solid ${modeColors[s.mode] || modeColors.readonly};border-radius:var(--radius-sm);margin-bottom:4px">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
            <div>
              <div style="color:var(--color-heading);font-size:.85rem;font-weight:600">${fromName}</div>
              ${fromEmail ? '<div style="color:var(--color-text-muted);font-size:.72rem">' + fromEmail + '</div>' : ''}
              <div style="font-size:.72rem;color:${modeColors[s.mode]};font-weight:600">${modeLabels[s.mode] || 'Read Only'}</div>
            </div>
          </div>
          <div style="display:flex;gap:6px;flex-wrap:wrap">
            ${s.mode === 'readonly' || !s.mode ? `
              <button class="btn btn--outline btn--sm" style="padding:4px 12px;font-size:.72rem" onclick="SupabaseSync.viewSharedData('${s.owner_id}')">View Collection</button>
              <button class="btn btn--outline btn--sm" style="padding:4px 12px;font-size:.72rem" onclick="SupabaseSync.syncFromUser('${s.owner_id}')">Copy to My Account</button>
            ` : ''}
            ${s.mode === 'coown' ? `
              <button class="btn btn--outline btn--sm" style="padding:4px 12px;font-size:.72rem;color:#cf6b6b;border-color:#cf6b6b33" onclick="SupabaseSync.separateCoown('${s.id}', '${s.owner_id}')">Separate & Keep Data</button>
            ` : ''}
          </div>
        </div>`;
    }
    container.innerHTML = html;
  }

  // ── Share Actions ─────────────────────────────────────
  async function handleShare() {
    const email = document.getElementById('share-email-input')?.value?.trim();
    const mode = document.getElementById('share-mode-select')?.value || 'readonly';
    const errorEl = document.getElementById('share-error');
    if (!email) { errorEl.textContent = 'Enter an email address.'; return; }
    if (email === currentUser.email) { errorEl.textContent = "You can't share with yourself."; return; }

    try {
      const { data, error } = await sb.from('shares')
        .insert({ owner_id: currentUser.id, shared_with_email: email.toLowerCase(), mode })
        .select();
      console.log('Share insert result:', { data, error });
      if (error) { errorEl.textContent = error.message || 'Failed to share.'; console.error('Share error:', error); return; }
      if (!data || data.length === 0) { errorEl.textContent = 'Share was blocked — check database permissions.'; return; }
      errorEl.textContent = '';
      document.getElementById('share-email-input').value = '';
      showToast(`Shared with ${email} (${mode === 'coown' ? 'Co-Own' : 'Read Only'})`, 'success');
      loadSharesAsync();
    } catch (e) {
      errorEl.textContent = 'Share failed: ' + e.message;
      console.error('Share exception:', e);
    }
  }

  async function acceptShare(shareId, mode) {
    await sb.from('shares').update({ accepted: true, shared_with_id: currentUser.id }).eq('id', shareId);
    if (mode === 'coown') {
      await loadCoownState();
      await fullSync();
    }
    showToast('Invitation accepted!', 'success');
    await renderAccountView();
    if (typeof navigate === 'function') navigate(currentPage);
  }

  async function declineShare(shareId) {
    await sb.from('shares').delete().eq('id', shareId);
    showToast('Invitation declined', 'info');
    await loadPendingInvitations();
  }

  async function revokeShare(shareId) {
    await sb.from('shares').delete().eq('id', shareId);
    await loadCoownState();
    showToast('Share revoked', 'info');
    await loadSharesUI();
  }

  // ── Option 1: View shared data (readonly) ─────────────
  async function viewSharedData(ownerId) {
    closeAuthModal();
    const { data: decks } = await sb.from('decks').select('*').eq('user_id', ownerId);
    const { data: cards } = await sb.from('owned_cards').select('*').eq('user_id', ownerId);

    const modal = document.getElementById('auth-modal');
    modal.style.display = 'flex';
    const body = document.getElementById('auth-modal-body');

    const deckCount = decks?.length || 0;
    const cardCount = cards?.length || 0;
    const totalQty = (cards || []).reduce((s, c) => s + (c.qty || 1), 0);
    const totalValue = (cards || []).reduce((s, c) => s + (parseFloat(c.price) || 0) * (c.qty || 1), 0);

    body.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
        <h2 style="color:var(--color-heading)">Shared Collection</h2>
        <button class="btn btn--outline btn--sm" onclick="SupabaseSync.renderAccountView()">Back</button>
      </div>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:16px">
        <div style="padding:10px;background:var(--color-bg-card);border:1px solid var(--color-border);border-radius:var(--radius-sm);text-align:center">
          <div style="color:var(--color-heading);font-size:1.1rem;font-weight:700">${deckCount}</div>
          <div style="color:var(--color-text-muted);font-size:.72rem">Decks</div>
        </div>
        <div style="padding:10px;background:var(--color-bg-card);border:1px solid var(--color-border);border-radius:var(--radius-sm);text-align:center">
          <div style="color:var(--color-heading);font-size:1.1rem;font-weight:700">${totalQty}</div>
          <div style="color:var(--color-text-muted);font-size:.72rem">Cards</div>
        </div>
        <div style="padding:10px;background:var(--color-bg-card);border:1px solid var(--color-border);border-radius:var(--radius-sm);text-align:center">
          <div style="color:var(--color-accent);font-size:1.1rem;font-weight:700">$${totalValue.toFixed(0)}</div>
          <div style="color:var(--color-text-muted);font-size:.72rem">Value</div>
        </div>
      </div>
      ${deckCount > 0 ? `
        <h3 style="color:var(--color-heading);font-size:.88rem;margin-bottom:8px">Decks</h3>
        <div style="max-height:200px;overflow-y:auto;margin-bottom:16px">
          ${decks.map(d => `
            <div style="padding:8px 10px;background:var(--color-bg-card);border:1px solid var(--color-border);border-radius:var(--radius-sm);margin-bottom:4px;display:flex;justify-content:space-between;align-items:center">
              <div><div style="color:var(--color-heading);font-size:.85rem;font-weight:600">${d.name}</div><div style="color:var(--color-text-muted);font-size:.72rem">${d.format} · ${(d.cards||[]).reduce((s,c) => s+(c.qty||1),0)} cards</div></div>
            </div>
          `).join('')}
        </div>
      ` : ''}
      ${cardCount > 0 ? `
        <h3 style="color:var(--color-heading);font-size:.88rem;margin-bottom:8px">Top Cards</h3>
        <div style="max-height:200px;overflow-y:auto">
          ${(cards || []).sort((a,b) => (parseFloat(b.price)||0) - (parseFloat(a.price)||0)).slice(0,20).map(c => `
            <div style="padding:6px 10px;display:flex;justify-content:space-between;align-items:center;font-size:.82rem;border-bottom:1px solid var(--color-border)">
              <span style="color:var(--color-heading)">${c.card_name} <span style="color:var(--color-text-muted)">${c.qty > 1 ? c.qty + 'x' : ''}</span></span>
              <span style="color:var(--color-text-muted)">${c.price ? '$' + parseFloat(c.price).toFixed(2) : ''}</span>
            </div>
          `).join('')}
        </div>
      ` : ''}
    `;
  }

  // ── Option 2: One-time sync/copy from another user ────
  async function syncFromUser(ownerId) {
    if (!confirm('This will COPY all their decks and owned cards into your account. Your existing data will be REPLACED. Continue?')) return;

    setSyncStatus('syncing');
    showToast('Copying collection...', 'info', 5000);

    try {
      const { data: decks } = await sb.from('decks').select('*').eq('user_id', ownerId);
      const { data: cards } = await sb.from('owned_cards').select('*').eq('user_id', ownerId);

      // Replace local data
      const localDecks = (decks || []).map(d => ({
        id: d.id, name: d.name, format: d.format,
        cards: d.cards || [], sideboard: d.sideboard || [],
        createdAt: d.created_at, updatedAt: d.updated_at,
      }));
      Storage.saveDecks(localDecks);

      const localCards = {};
      (cards || []).forEach(c => {
        localCards[c.card_name] = {
          typeLine: c.type_line || '', manaCost: c.mana_cost || '', setName: c.set_name || '',
          setCode: c.set_code || '', imageUrl: c.image_url || '', price: c.price || null,
          colors: c.colors || [], cmc: c.cmc || 0, qty: c.qty || 1, rarity: c.rarity || '',
        };
      });
      Storage.saveOwnedCardsRich(localCards);

      // Push to my own Supabase account
      await fullSync();
      setSyncStatus('synced');
      showToast('Collection copied successfully!', 'success');
      closeAuthModal();
      if (typeof navigate === 'function') navigate(currentPage);
    } catch (err) {
      setSyncStatus('error');
      showToast('Copy failed: ' + err.message, 'error');
    }
  }

  // ── Option 4: Separate co-owned account ───────────────
  async function separateCoown(shareId, ownerId) {
    if (!confirm('This will separate the co-owned account. You will keep a copy of all current data but go your own way from now on. Continue?')) return;

    setSyncStatus('syncing');
    try {
      // Pull all co-owned data
      const { data: decks } = await sb.from('decks').select('*').eq('user_id', ownerId);
      const { data: cards } = await sb.from('owned_cards').select('*').eq('user_id', ownerId);

      // Copy decks to my own user_id
      if (decks?.length > 0) {
        for (const d of decks) {
          await sb.from('decks').upsert({
            id: d.id, user_id: currentUser.id, name: d.name, format: d.format,
            cards: d.cards, sideboard: d.sideboard, created_at: d.created_at, updated_at: d.updated_at,
          }, { onConflict: 'id,user_id' });
        }
      }

      // Copy cards to my own user_id
      if (cards?.length > 0) {
        for (let i = 0; i < cards.length; i += 50) {
          const batch = cards.slice(i, i + 50).map(c => ({
            user_id: currentUser.id, card_name: c.card_name, type_line: c.type_line,
            mana_cost: c.mana_cost, set_name: c.set_name, set_code: c.set_code,
            image_url: c.image_url, price: c.price, colors: c.colors,
            cmc: c.cmc, qty: c.qty, rarity: c.rarity,
          }));
          await sb.from('owned_cards').upsert(batch, { onConflict: 'user_id,card_name' });
        }
      }

      // Delete the share
      await sb.from('shares').delete().eq('id', shareId);
      _coownPartnerId = null;

      // Sync local with my own data
      await fullSync();
      setSyncStatus('synced');
      showToast('Separated! Your data is now independent.', 'success');
      await renderAccountView();
      if (typeof navigate === 'function') navigate(currentPage);
    } catch (err) {
      setSyncStatus('error');
      showToast('Separate failed: ' + err.message, 'error');
    }
  }

  // ═══════════════════════════════════════════════════════
  //  SYNC ENGINE
  // ═══════════════════════════════════════════════════════
  function debouncedSync() { clearTimeout(_syncDebounce); _syncDebounce = setTimeout(() => fullSync(), 2000); }

  async function fullSync() {
    if (!sb || !currentUser) { console.log('[Sync] skipped — no client or user'); return; }
    if (_syncing) { console.log('[Sync] skipped — already syncing'); return; }
    _syncing = true;
    _suppressHook = true;
    _activeSyncUid = _coownPartnerId || currentUser?.id; // Snapshot uid for this sync
    setSyncStatus('syncing');
    console.log('[Sync] uid:', _activeSyncUid, _coownPartnerId ? '(co-owning)' : '(own)');
    try {
      console.log('[Sync] starting decks...');
      await syncDecks();
      console.log('[Sync] starting owned cards...');
      await syncOwnedCards();
      console.log('[Sync] starting settings...');
      await syncSettings();
      console.log('[Sync] complete');
      setSyncStatus('synced');
    } catch (err) {
      console.error('[Sync] error:', err);
      setSyncStatus('error');
      showToast('Sync failed: ' + err.message, 'error', 4000);
    }
    _activeSyncUid = null;
    _suppressHook = false;
    _syncing = false;
  }

  async function syncDecks() {
    const uid = syncUserId();
    console.log('[Sync] decks: fetching remote for uid', uid);
    const localDecks = Storage.getDecks();
    console.log('[Sync] decks: local count', localDecks.length);
    const { data: remoteDecks, error: decksErr } = await sb.from('decks').select('*').eq('user_id', uid);
    console.log('[Sync] decks: remote response', decksErr ? 'ERROR: ' + decksErr.message : (remoteDecks?.length || 0) + ' decks');
    if (decksErr) throw new Error(decksErr.message);
    const remote = remoteDecks || [];
    const remoteMap = {}; remote.forEach(d => { remoteMap[d.id] = d; });
    const localMap = {}; localDecks.forEach(d => { localMap[d.id] = d; });

    for (const ld of localDecks) {
      const rd = remoteMap[ld.id];
      if (!rd || new Date(ld.updatedAt) > new Date(rd.updated_at)) {
        const { error: upsErr } = await sb.from('decks').upsert({
          id: ld.id, user_id: uid, name: ld.name, format: ld.format,
          cards: ld.cards, sideboard: ld.sideboard,
          created_at: ld.createdAt, updated_at: ld.updatedAt,
        }, { onConflict: 'id,user_id' });
        if (upsErr) throw new Error(upsErr.message);
      }
    }
    for (const rd of remote) {
      const ld = localMap[rd.id];
      if (!ld || new Date(rd.updated_at) > new Date(ld.updatedAt)) {
        Storage.saveDeck({ id: rd.id, name: rd.name, format: rd.format, cards: rd.cards || [], sideboard: rd.sideboard || [], createdAt: rd.created_at, updatedAt: rd.updated_at });
      }
    }
  }

  async function syncOwnedCards() {
    const uid = syncUserId();
    const localMap = Storage.getOwnedCardsRich();
    const { data: remoteCards, error: cardsErr } = await sb.from('owned_cards').select('*').eq('user_id', uid);
    if (cardsErr) throw new Error(cardsErr.message);
    const remote = remoteCards || [];
    const remoteMap = {}; remote.forEach(c => { remoteMap[c.card_name] = c; });

    const toUpsert = [];
    for (const [name, meta] of Object.entries(localMap)) {
      const rc = remoteMap[name];
      if (!rc || rc.qty !== (meta.qty || 1)) {
        toUpsert.push({
          user_id: uid, card_name: name, type_line: meta.typeLine || '', mana_cost: meta.manaCost || '',
          set_name: meta.setName || '', set_code: meta.setCode || '', image_url: meta.imageUrl || '',
          price: meta.price ? String(meta.price) : '', colors: meta.colors || [], cmc: meta.cmc || 0,
          qty: meta.qty || 1, rarity: meta.rarity || '',
        });
      }
    }
    if (toUpsert.length > 0) {
      for (let i = 0; i < toUpsert.length; i += 50) {
        const { error: batchErr } = await sb.from('owned_cards').upsert(toUpsert.slice(i, i + 50), { onConflict: 'user_id,card_name' });
        if (batchErr) throw new Error(batchErr.message);
      }
    }
    for (const rc of remote) {
      if (!localMap[rc.card_name]) {
        localMap[rc.card_name] = { typeLine: rc.type_line||'', manaCost: rc.mana_cost||'', setName: rc.set_name||'', setCode: rc.set_code||'', imageUrl: rc.image_url||'', price: rc.price||null, colors: rc.colors||[], cmc: rc.cmc||0, qty: rc.qty||1, rarity: rc.rarity||'' };
      }
    }
    Storage.saveOwnedCardsRich(localMap);

    const localNames = new Set(Object.keys(localMap));
    const toDelete = remote.filter(rc => !localNames.has(rc.card_name)).map(rc => rc.card_name);
    if (toDelete.length > 0) {
      await sb.from('owned_cards').delete().eq('user_id', uid).in('card_name', toDelete);
    }
  }

  async function syncSettings() {
    const localSettings = Storage.getSettings();
    await sb.from('user_settings').upsert({ user_id: currentUser.id, theme: localSettings.theme || 'dark', updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
  }

  // ── Background Push ───────────────────────────────────
  let _pushDeckTimeout = null;
  let _pushOwnedTimeout = null;

  function onStorageWrite(eventType, data) {
    if (!currentUser || !sb || _suppressHook) return;
    switch (eventType) {
      case 'deck:save': clearTimeout(_pushDeckTimeout); _pushDeckTimeout = setTimeout(() => pushDeck(data), 1000); break;
      case 'deck:delete': deleteDeckRemote(data); break;
      case 'owned:save': clearTimeout(_pushOwnedTimeout); _pushOwnedTimeout = setTimeout(() => pushAllOwnedCards(), 1500); break;
      case 'settings:save': syncSettings(); break;
    }
  }

  async function pushDeck(deck) {
    if (!sb || !currentUser) return;
    const uid = syncUserId();
    setSyncStatus('syncing');
    try {
      await sb.from('decks').upsert({ id: deck.id, user_id: uid, name: deck.name, format: deck.format, cards: deck.cards, sideboard: deck.sideboard, created_at: deck.createdAt, updated_at: deck.updatedAt }, { onConflict: 'id,user_id' });
      setSyncStatus('synced');
    } catch (e) { setSyncStatus('error'); }
  }

  async function deleteDeckRemote(deckId) {
    if (!sb || !currentUser) return;
    const uid = syncUserId();
    await sb.from('decks').delete().eq('id', deckId).eq('user_id', uid);
  }

  async function pushAllOwnedCards() {
    if (!sb || !currentUser) return;
    setSyncStatus('syncing');
    try { await syncOwnedCards(); setSyncStatus('synced'); } catch (e) { setSyncStatus('error'); }
  }

  function setSyncStatus(status) {
    const el = document.getElementById('sync-status');
    if (!el) return;
    el.style.display = '';
    el.className = 'sync-indicator sync-indicator--' + status;
    const labels = { syncing: 'Syncing...', synced: 'Synced', error: 'Sync error' };
    el.title = labels[status] || '';
    el.innerHTML = `
      <div class="sync-indicator__label"><span class="sync-indicator__dot"></span><span>${labels[status] || ''}</span></div>
      <div class="sync-indicator__bar"><div class="sync-indicator__fill"></div></div>
    `;
  }

  // ── Public API ────────────────────────────────────────
  return {
    init, signUp, signIn, signOut, isLoggedIn, getUser, isCoowning,
    showAuthModal, closeAuthModal, renderAuthForm, handleAuth,
    showAccountModal, renderAccountView,
    handleShare, acceptShare, declineShare, revokeShare,
    viewSharedData, syncFromUser, separateCoown,
    fullSync, onStorageWrite,
  };
})();
