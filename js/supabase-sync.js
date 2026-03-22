/* ═══════════════════════════════════════════════════════════
   Supabase Sync — Auth, Cloud Sync, Sharing
   Local-first: localStorage is always the source of truth.
   When logged in, changes are mirrored to Supabase in the background.
   ═══════════════════════════════════════════════════════════ */

const SupabaseSync = (() => {
  const SUPABASE_URL = 'https://cuzipcfnvtndaxzedtsk.supabase.co';
  const SUPABASE_ANON_KEY = 'sb_publishable_7lqFPSSdEj_iv_f25DJN3w_B1_bDzhM';

  let sb = null;
  let currentUser = null;
  let _syncing = false;
  let _syncDebounce = null;

  async function init() {
    if (typeof supabase === 'undefined') {
      console.warn('Supabase SDK not loaded');
      return;
    }
    sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        storageKey: 'mtg-auth',
        lock: false,
        flowType: 'implicit',
      }
    });

    // Listen for auth state changes
    sb.auth.onAuthStateChange(async (event, session) => {
      const wasLoggedIn = !!currentUser;
      currentUser = session?.user || null;
      updateAuthUI();

      if (event === 'SIGNED_OUT') {
        currentUser = null;
        updateAuthUI();
        return;
      }

      // Sync when user signs in fresh (not on every INITIAL_SESSION reload)
      if (event === 'SIGNED_IN' && currentUser && !wasLoggedIn) {
        await fullSync();
        if (typeof navigate === 'function') navigate(currentPage);
      }
    });

    // On init, check for existing session and sync
    const { data: { session } } = await sb.auth.getSession();
    if (session?.user) {
      currentUser = session.user;
      updateAuthUI();
      await fullSync();
      if (typeof navigate === 'function') navigate(currentPage);
    }

    // Sync on tab focus (catch changes from other devices)
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && currentUser) {
        debouncedSync();
      }
    });
  }

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

    // Update sync indicator
    const syncEl = document.getElementById('sync-status');
    if (syncEl) {
      syncEl.style.display = currentUser ? '' : 'none';
      syncEl.title = currentUser ? 'Synced to cloud' : '';
    }
  }

  // ── Auth ──────────────────────────────────────────────
  async function signUp(email, password) {
    if (!sb) return { error: 'Not initialized' };
    const { data, error } = await sb.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: window.location.origin + window.location.pathname,
      }
    });
    return { data, error };
  }

  async function signIn(email, password) {
    if (!sb) return { error: 'Not initialized' };
    const { data, error } = await sb.auth.signInWithPassword({ email, password });
    return { data, error };
  }

  async function signOut() {
    if (!sb) return;
    await sb.auth.signOut();
    currentUser = null;
    updateAuthUI();
    showToast('Signed out', 'info');
  }

  function isLoggedIn() { return !!currentUser; }
  function getUser() { return currentUser; }

  // ── Auth Modal ────────────────────────────────────────
  function showAuthModal() {
    const modal = document.getElementById('auth-modal');
    modal.style.display = 'flex';
    renderAuthForm('login');
  }

  function closeAuthModal() {
    document.getElementById('auth-modal').style.display = 'none';
  }

  function renderAuthForm(mode) {
    const body = document.getElementById('auth-modal-body');
    const isLogin = mode === 'login';

    body.innerHTML = `
      <div class="auth-form">
        <h2 style="color:var(--color-heading);margin-bottom:4px">${isLogin ? 'Welcome Back' : 'Create Account'}</h2>
        <p style="color:var(--color-text-muted);font-size:.85rem;margin-bottom:20px">
          ${isLogin ? 'Sign in to sync your collection across devices.' : 'Sign up to save your collection to the cloud.'}
        </p>
        <div class="auth-form__field">
          <label>Email</label>
          <input type="email" id="auth-email" class="auth-form__input" placeholder="you@example.com" autocomplete="email">
        </div>
        <div class="auth-form__field">
          <label>Password</label>
          <input type="password" id="auth-password" class="auth-form__input" placeholder="${isLogin ? 'Your password' : 'Min 6 characters'}" autocomplete="${isLogin ? 'current-password' : 'new-password'}">
        </div>
        <div id="auth-error" style="color:#cf6b6b;font-size:.82rem;min-height:20px;margin:4px 0"></div>
        <button class="btn btn--primary btn--full" onclick="SupabaseSync.handleAuth('${mode}')" id="auth-submit-btn">
          ${isLogin ? 'Sign In' : 'Sign Up'}
        </button>
        <p style="text-align:center;margin-top:16px;font-size:.85rem;color:var(--color-text-muted)">
          ${isLogin
            ? `Don't have an account? <a href="#" onclick="event.preventDefault(); SupabaseSync.renderAuthForm('signup')">Sign Up</a>`
            : `Already have an account? <a href="#" onclick="event.preventDefault(); SupabaseSync.renderAuthForm('login')">Sign In</a>`
          }
        </p>
      </div>
    `;

    // Focus email field
    setTimeout(() => document.getElementById('auth-email')?.focus(), 100);

    // Enter key to submit
    const handler = (e) => { if (e.key === 'Enter') document.getElementById('auth-submit-btn')?.click(); };
    document.getElementById('auth-email')?.addEventListener('keydown', handler);
    document.getElementById('auth-password')?.addEventListener('keydown', handler);
  }

  async function handleAuth(mode) {
    const email = document.getElementById('auth-email')?.value?.trim();
    const password = document.getElementById('auth-password')?.value;
    const errorEl = document.getElementById('auth-error');
    const btn = document.getElementById('auth-submit-btn');

    if (!email || !password) {
      errorEl.textContent = 'Please enter email and password.';
      return;
    }
    if (mode === 'signup' && password.length < 6) {
      errorEl.textContent = 'Password must be at least 6 characters.';
      return;
    }

    btn.disabled = true;
    btn.textContent = mode === 'login' ? 'Signing in...' : 'Signing up...';
    errorEl.textContent = '';

    const { data, error } = mode === 'login'
      ? await signIn(email, password)
      : await signUp(email, password);

    btn.disabled = false;
    btn.textContent = mode === 'login' ? 'Sign In' : 'Sign Up';

    if (error) {
      errorEl.textContent = error.message || 'An error occurred.';
      return;
    }

    if (mode === 'signup') {
      // Check if email confirmation is needed
      if (data?.user && !data.user.confirmed_at && !data.session) {
        document.getElementById('auth-modal-body').innerHTML = `
          <div style="text-align:center;padding:20px">
            <div style="font-size:2.5rem;margin-bottom:12px">&#x2709;</div>
            <h2 style="color:var(--color-heading);margin-bottom:8px">Check Your Email</h2>
            <p style="color:var(--color-text-muted);font-size:.9rem;line-height:1.6">
              We sent a confirmation link to <strong style="color:var(--color-heading)">${email}</strong>.<br>
              Click the link in the email to activate your account, then come back and sign in.
            </p>
            <button class="btn btn--outline" style="margin-top:20px" onclick="SupabaseSync.renderAuthForm('login')">Back to Sign In</button>
          </div>
        `;
        return;
      }
    }

    closeAuthModal();
    showToast(`Signed in as ${email}`, 'success');
  }

  // ── Account / Share Modal ─────────────────────────────
  function showAccountModal() {
    const modal = document.getElementById('auth-modal');
    modal.style.display = 'flex';
    renderAccountView();
  }

  async function renderAccountView() {
    const body = document.getElementById('auth-modal-body');
    if (!currentUser) { renderAuthForm('login'); return; }

    body.innerHTML = `
      <h2 style="color:var(--color-heading);margin-bottom:16px">Account</h2>
      <div style="margin-bottom:20px;padding:12px;background:var(--color-bg-card);border-radius:var(--radius-md);border:1px solid var(--color-border)">
        <div style="color:var(--color-heading);font-weight:600">${currentUser.email}</div>
        <div style="color:var(--color-text-muted);font-size:.82rem;margin-top:2px">Joined ${new Date(currentUser.created_at).toLocaleDateString()}</div>
      </div>

      <h3 style="color:var(--color-heading);font-size:.95rem;margin-bottom:8px">Share My Collection</h3>
      <p style="color:var(--color-text-muted);font-size:.82rem;margin-bottom:12px">Share your decks and owned cards with another player. They'll be able to view (read-only) your data.</p>
      <div style="display:flex;gap:8px;margin-bottom:20px">
        <input type="email" id="share-email-input" class="auth-form__input" placeholder="Their email address..." style="flex:1">
        <button class="btn btn--primary btn--sm" onclick="SupabaseSync.handleShare()">Share</button>
      </div>
      <div id="share-error" style="color:#cf6b6b;font-size:.82rem;min-height:18px;margin-bottom:12px"></div>

      <div id="shares-list" style="margin-bottom:20px">
        <div class="skeleton skeleton-card"></div>
      </div>

      <div id="pending-invitations" style="margin-bottom:20px"></div>

      <div style="display:flex;gap:8px;margin-top:12px">
        <button class="btn btn--outline btn--sm" onclick="SupabaseSync.fullSync().then(() => { showToast('Synced!', 'success'); if(typeof navigate==='function') navigate(currentPage); })">Sync Now</button>
        <button class="btn btn--outline btn--sm" onclick="SupabaseSync.closeAuthModal()">Close</button>
      </div>
    `;

    // Load shares
    await loadSharesUI();
    await loadPendingInvitations();
  }

  async function loadSharesUI() {
    const container = document.getElementById('shares-list');
    if (!container || !sb) return;

    const { data: shares, error } = await sb
      .from('shares')
      .select('*')
      .eq('owner_id', currentUser.id)
      .order('created_at', { ascending: false });

    if (error || !shares || shares.length === 0) {
      container.innerHTML = '<div style="color:var(--color-text-muted);font-size:.82rem">No active shares.</div>';
      return;
    }

    container.innerHTML = `
      <div style="color:var(--color-text-muted);font-size:.72rem;font-weight:600;text-transform:uppercase;letter-spacing:.04em;margin-bottom:6px">Shared With</div>
      ${shares.map(s => `
        <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 10px;background:var(--color-bg-card);border:1px solid var(--color-border);border-radius:var(--radius-sm);margin-bottom:4px">
          <div>
            <div style="color:var(--color-heading);font-size:.85rem;font-weight:600">${s.shared_with_email}</div>
            <div style="color:var(--color-text-muted);font-size:.72rem">${s.accepted ? 'Accepted' : 'Pending'}</div>
          </div>
          <button class="btn btn--sm" style="color:#cf6b6b;border:1px solid #cf6b6b33;background:transparent;padding:4px 12px;font-size:.75rem" onclick="SupabaseSync.revokeShare('${s.id}')">Revoke</button>
        </div>
      `).join('')}
    `;
  }

  async function loadPendingInvitations() {
    const container = document.getElementById('pending-invitations');
    if (!container || !sb) return;

    const { data: invitations } = await sb
      .from('shares')
      .select('*, owner:profiles!shares_owner_id_fkey(email, display_name)')
      .or(`shared_with_id.eq.${currentUser.id},shared_with_email.eq.${currentUser.email}`)
      .eq('accepted', false);

    if (!invitations || invitations.length === 0) {
      container.innerHTML = '';
      return;
    }

    container.innerHTML = `
      <div style="color:var(--color-text-muted);font-size:.72rem;font-weight:600;text-transform:uppercase;letter-spacing:.04em;margin-bottom:6px">Pending Invitations</div>
      ${invitations.map(inv => `
        <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 10px;background:rgba(224,192,96,.06);border:1px solid rgba(224,192,96,.2);border-radius:var(--radius-sm);margin-bottom:4px">
          <div>
            <div style="color:var(--color-heading);font-size:.85rem;font-weight:600">${inv.owner?.display_name || inv.owner?.email || 'Someone'}</div>
            <div style="color:var(--color-text-muted);font-size:.72rem">wants to share their collection</div>
          </div>
          <button class="btn btn--primary btn--sm" style="padding:4px 14px;font-size:.75rem" onclick="SupabaseSync.acceptShare('${inv.id}')">Accept</button>
        </div>
      `).join('')}
    `;
  }

  async function handleShare() {
    const email = document.getElementById('share-email-input')?.value?.trim();
    const errorEl = document.getElementById('share-error');
    if (!email) { errorEl.textContent = 'Enter an email address.'; return; }
    if (email === currentUser.email) { errorEl.textContent = "You can't share with yourself."; return; }

    const { error } = await sb.from('shares').insert({
      owner_id: currentUser.id,
      shared_with_email: email,
    });

    if (error) {
      errorEl.textContent = error.message || 'Failed to share.';
      return;
    }

    errorEl.textContent = '';
    document.getElementById('share-email-input').value = '';
    showToast(`Shared with ${email}`, 'success');
    await loadSharesUI();
  }

  async function acceptShare(shareId) {
    await sb.from('shares').update({ accepted: true, shared_with_id: currentUser.id }).eq('id', shareId);
    showToast('Invitation accepted!', 'success');
    await renderAccountView();
  }

  async function revokeShare(shareId) {
    await sb.from('shares').delete().eq('id', shareId);
    showToast('Share revoked', 'info');
    await loadSharesUI();
  }

  // ── Sync Engine ───────────────────────────────────────
  function debouncedSync() {
    clearTimeout(_syncDebounce);
    _syncDebounce = setTimeout(() => fullSync(), 2000);
  }

  function withTimeout(promise, ms = 15000) {
    return Promise.race([
      promise,
      new Promise((_, reject) => setTimeout(() => reject(new Error('Sync timeout')), ms))
    ]);
  }

  async function fullSync() {
    if (!sb || !currentUser || _syncing) return;
    _syncing = true;
    setSyncStatus('syncing');

    try {
      await withTimeout(Promise.all([syncDecks(), syncOwnedCards(), syncSettings()]));
      setSyncStatus('synced');
    } catch (err) {
      console.error('Sync error:', err);
      setSyncStatus('error');
      showToast('Sync failed: ' + err.message, 'error', 4000);
    }
    _syncing = false;
  }

  async function syncDecks() {
    const localDecks = Storage.getDecks();
    const { data: remoteDecks, error: decksErr } = await sb.from('decks').select('*').eq('user_id', currentUser.id);
    if (decksErr) { console.error('Sync decks pull error:', decksErr); showToast('Sync error: ' + decksErr.message, 'error'); return; }
    const remote = remoteDecks || [];

    const remoteMap = {};
    remote.forEach(d => { remoteMap[d.id] = d; });
    const localMap = {};
    localDecks.forEach(d => { localMap[d.id] = d; });

    // Push local-only or newer local decks
    for (const ld of localDecks) {
      const rd = remoteMap[ld.id];
      if (!rd || new Date(ld.updatedAt) > new Date(rd.updated_at)) {
        const { error: upsErr } = await sb.from('decks').upsert({
          id: ld.id,
          user_id: currentUser.id,
          name: ld.name,
          format: ld.format,
          cards: ld.cards,
          sideboard: ld.sideboard,
          created_at: ld.createdAt,
          updated_at: ld.updatedAt,
        }, { onConflict: 'id,user_id' });
        if (upsErr) console.error('Deck push error:', ld.name, upsErr);
      }
    }

    // Pull remote-only or newer remote decks
    for (const rd of remote) {
      const ld = localMap[rd.id];
      if (!ld || new Date(rd.updated_at) > new Date(ld.updatedAt)) {
        const merged = {
          id: rd.id,
          name: rd.name,
          format: rd.format,
          cards: rd.cards || [],
          sideboard: rd.sideboard || [],
          createdAt: rd.created_at,
          updatedAt: rd.updated_at,
        };
        Storage.saveDeck(merged);
      }
    }

    // Delete remote decks that were deleted locally (remote exists, local doesn't)
    // Skip this to be safe — deletions only happen explicitly via deleteDeckRemote
  }

  async function syncOwnedCards() {
    const localMap = Storage.getOwnedCardsRich();
    const { data: remoteCards, error: cardsErr } = await sb.from('owned_cards').select('*').eq('user_id', currentUser.id);
    if (cardsErr) { console.error('Sync owned cards pull error:', cardsErr); showToast('Sync error: ' + cardsErr.message, 'error'); return; }
    const remote = remoteCards || [];

    const remoteMap = {};
    remote.forEach(c => { remoteMap[c.card_name] = c; });

    // Push local cards not in remote or with different qty
    const toUpsert = [];
    for (const [name, meta] of Object.entries(localMap)) {
      const rc = remoteMap[name];
      if (!rc || rc.qty !== (meta.qty || 1)) {
        toUpsert.push({
          user_id: currentUser.id,
          card_name: name,
          type_line: meta.typeLine || '',
          mana_cost: meta.manaCost || '',
          set_name: meta.setName || '',
          set_code: meta.setCode || '',
          image_url: meta.imageUrl || '',
          price: meta.price ? String(meta.price) : '',
          colors: meta.colors || [],
          cmc: meta.cmc || 0,
          qty: meta.qty || 1,
          rarity: meta.rarity || '',
        });
      }
    }
    if (toUpsert.length > 0) {
      // Batch in chunks of 50
      for (let i = 0; i < toUpsert.length; i += 50) {
        const { error: batchErr } = await sb.from('owned_cards').upsert(toUpsert.slice(i, i + 50), { onConflict: 'user_id,card_name' });
        if (batchErr) console.error('Owned cards push error:', batchErr);
      }
    }

    // Pull remote cards not in local
    for (const rc of remote) {
      if (!localMap[rc.card_name]) {
        localMap[rc.card_name] = {
          typeLine: rc.type_line || '',
          manaCost: rc.mana_cost || '',
          setName: rc.set_name || '',
          setCode: rc.set_code || '',
          imageUrl: rc.image_url || '',
          price: rc.price || null,
          colors: rc.colors || [],
          cmc: rc.cmc || 0,
          qty: rc.qty || 1,
          rarity: rc.rarity || '',
        };
      }
    }
    Storage.saveOwnedCardsRich(localMap);

    // Delete remote cards that were removed locally
    const localNames = new Set(Object.keys(localMap));
    const toDelete = remote.filter(rc => !localNames.has(rc.card_name)).map(rc => rc.card_name);
    if (toDelete.length > 0) {
      await sb.from('owned_cards').delete().eq('user_id', currentUser.id).in('card_name', toDelete);
    }
  }

  async function syncSettings() {
    const localSettings = Storage.getSettings();
    await sb.from('user_settings').upsert({
      user_id: currentUser.id,
      theme: localSettings.theme || 'dark',
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id' });
  }

  // ── Background Push (called after Storage writes) ─────
  let _pushDeckTimeout = null;
  let _pushOwnedTimeout = null;

  function onStorageWrite(eventType, data) {
    if (!currentUser || !sb) return;
    switch (eventType) {
      case 'deck:save':
        clearTimeout(_pushDeckTimeout);
        _pushDeckTimeout = setTimeout(() => pushDeck(data), 1000);
        break;
      case 'deck:delete':
        deleteDeckRemote(data);
        break;
      case 'owned:save':
        clearTimeout(_pushOwnedTimeout);
        _pushOwnedTimeout = setTimeout(() => pushAllOwnedCards(), 1500);
        break;
      case 'settings:save':
        syncSettings();
        break;
    }
  }

  async function pushDeck(deck) {
    if (!sb || !currentUser) return;
    setSyncStatus('syncing');
    try {
      await sb.from('decks').upsert({
        id: deck.id,
        user_id: currentUser.id,
        name: deck.name,
        format: deck.format,
        cards: deck.cards,
        sideboard: deck.sideboard,
        created_at: deck.createdAt,
        updated_at: deck.updatedAt,
      }, { onConflict: 'id,user_id' });
      setSyncStatus('synced');
    } catch (e) {
      setSyncStatus('error');
    }
  }

  async function deleteDeckRemote(deckId) {
    if (!sb || !currentUser) return;
    await sb.from('decks').delete().eq('id', deckId).eq('user_id', currentUser.id);
  }

  async function pushAllOwnedCards() {
    if (!sb || !currentUser) return;
    setSyncStatus('syncing');
    try {
      await syncOwnedCards();
      setSyncStatus('synced');
    } catch (e) {
      setSyncStatus('error');
    }
  }

  function setSyncStatus(status) {
    const el = document.getElementById('sync-status');
    if (!el) return;
    el.style.display = '';
    el.className = 'sync-indicator sync-indicator--' + status;
    const labels = { syncing: 'Syncing...', synced: 'Synced', error: 'Sync error' };
    el.textContent = labels[status] || '';
    el.title = labels[status] || '';
  }

  return {
    init, signUp, signIn, signOut, isLoggedIn, getUser,
    showAuthModal, closeAuthModal, renderAuthForm, handleAuth,
    showAccountModal,
    handleShare, acceptShare, revokeShare,
    fullSync, onStorageWrite,
  };
})();
