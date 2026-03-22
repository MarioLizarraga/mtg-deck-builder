/* ═══════════════════════════════════════════════════════════
   MTG Deck Builder — Main Application
   ═══════════════════════════════════════════════════════════ */

let currentPage = 'dashboard';
let currentDeckId = null;
let searchTimeout = null;
let globalSearchTimeout = null;

// ═══════════════════════════════════════════════════════════
//  TOAST NOTIFICATIONS
// ═══════════════════════════════════════════════════════════
function showToast(message, type = 'info', duration = 3000) {
  const container = document.getElementById('toast-container');
  const icons = { success: '&#10003;', error: '&#10007;', info: '&#8505;', warning: '&#9888;' };
  const toast = document.createElement('div');
  toast.className = `toast toast--${type}`;
  toast.innerHTML = `
    <span class="toast__icon">${icons[type] || icons.info}</span>
    <span>${message}</span>
    <button class="toast__close" onclick="dismissToast(this.parentElement)">&times;</button>
  `;
  container.appendChild(toast);
  setTimeout(() => dismissToast(toast), duration);
}
function dismissToast(el) {
  if (!el || el.classList.contains('toast--out')) return;
  el.classList.add('toast--out');
  setTimeout(() => el.remove(), 200);
}

// ═══════════════════════════════════════════════════════════
//  CARD HOVER PREVIEW
// ═══════════════════════════════════════════════════════════
let _previewTimeout = null;
function setupCardPreview() {
  document.addEventListener('mouseover', (e) => {
    const nameEl = e.target.closest('.deck-card__name');
    if (!nameEl) return;
    clearTimeout(_previewTimeout);
    _previewTimeout = setTimeout(() => {
      const name = nameEl.textContent.trim();
      const tooltip = document.getElementById('card-preview-tooltip');
      const img = tooltip.querySelector('img');
      // Try to find card image from deck data or search cache
      let imgUrl = '';
      const deck = currentDeckId ? Storage.getDeck(currentDeckId) : null;
      if (deck) {
        const card = [...deck.cards, ...deck.sideboard].find(c => c.name === name);
        if (card?.imageUrl) {
          // Convert small to normal for better preview
          imgUrl = card.imageUrl.replace('/small/', '/normal/');
        }
      }
      if (!imgUrl) {
        // Fallback: construct Scryfall URL from name
        imgUrl = `https://api.scryfall.com/cards/named?exact=${encodeURIComponent(name)}&format=image&version=normal`;
      }
      img.src = imgUrl;
      tooltip.style.display = 'block';
      positionPreview(e, tooltip);
    }, 300);
  });

  document.addEventListener('mousemove', (e) => {
    const tooltip = document.getElementById('card-preview-tooltip');
    if (tooltip.style.display === 'block') positionPreview(e, tooltip);
  });

  document.addEventListener('mouseout', (e) => {
    const nameEl = e.target.closest('.deck-card__name');
    if (!nameEl) return;
    clearTimeout(_previewTimeout);
    const tooltip = document.getElementById('card-preview-tooltip');
    tooltip.style.display = 'none';
  });
}
function positionPreview(e, tooltip) {
  const pad = 16;
  let x = e.clientX + pad;
  let y = e.clientY - 60;
  if (x + 240 > window.innerWidth) x = e.clientX - 240 - pad;
  if (y + 320 > window.innerHeight) y = window.innerHeight - 330;
  if (y < 10) y = 10;
  tooltip.style.left = x + 'px';
  tooltip.style.top = y + 'px';
}

// ── Init ─────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  const settings = Storage.getSettings();
  if (settings.theme) {
    document.documentElement.setAttribute('data-theme', settings.theme);
    updateThemeIcon(settings.theme);
  }
  // Restore last page from hash, or default to dashboard
  const hash = location.hash.replace('#', '');
  const validPages = ['dashboard', 'builder', 'meta', 'compare', 'collection'];
  const startPage = validPages.includes(hash) ? hash : 'dashboard';
  navigate(startPage);
  setupCardPreview();

  // Keyboard shortcut: Ctrl+K for card search
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
      e.preventDefault();
      openSearch();
    }
    if (e.key === 'Escape') closeSearch();
  });

  // Global search input
  document.getElementById('global-search-input').addEventListener('input', (e) => {
    clearTimeout(globalSearchTimeout);
    globalSearchTimeout = setTimeout(() => globalSearchCards(e.target.value), 300);
  });
});

// ── Navigation ───────────────────────────────────────────
function navigate(page, data) {
  currentPage = page;
  location.hash = page;

  // Update active link
  document.querySelectorAll('.admin__link').forEach(link => {
    link.classList.toggle('active', link.dataset.page === page);
  });

  // Hide all views
  document.querySelectorAll('.view').forEach(v => v.style.display = 'none');

  // Show target view
  const view = document.getElementById(`view-${page}`);
  if (view) {
    view.style.display = 'block';
    switch (page) {
      case 'dashboard': renderDashboard(); break;
      case 'builder': renderBuilder(data); break;
      case 'meta': renderMeta(); break;
      case 'compare': renderCompare(); break;
      case 'collection': renderCollection(); break;
    }
  }
}

// ── Theme ────────────────────────────────────────────────
function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme') || 'dark';
  const next = current === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  updateThemeIcon(next);
  Storage.saveSettings({ ...Storage.getSettings(), theme: next });
}

function updateThemeIcon(theme) {
  document.getElementById('theme-icon-sun').style.display = theme === 'dark' ? '' : 'none';
  document.getElementById('theme-icon-moon').style.display = theme === 'light' ? '' : 'none';
  document.getElementById('theme-label').textContent = theme === 'dark' ? 'Light' : 'Dark';
}

// ── Global Search ────────────────────────────────────────
function openSearch() {
  document.getElementById('card-search-modal').style.display = 'flex';
  const input = document.getElementById('global-search-input');
  input.value = '';
  input.focus();
  document.getElementById('global-search-results').innerHTML = '<p class="gsearch__empty">Type a card name to search Scryfall...</p>';
}

function closeSearch() {
  document.getElementById('card-search-modal').style.display = 'none';
}

async function globalSearchCards(query) {
  const container = document.getElementById('global-search-results');
  if (!query || query.length < 2) {
    container.innerHTML = '<p class="gsearch__empty">Type a card name to search Scryfall...</p>';
    return;
  }
  container.innerHTML = '<p class="gsearch__loading">Searching...</p>';
  try {
    const data = await Scryfall.search(query);
    if (!data.data || data.data.length === 0) {
      container.innerHTML = '<p class="gsearch__empty">No cards found.</p>';
      return;
    }
    container.innerHTML = data.data.slice(0, 15).map(card => `
      <button class="gsearch__result" onclick="showCardDetail('${card.id}'); closeSearch();">
        <img class="gsearch__result-img" src="${Scryfall.getSmallImage(card)}" alt="" loading="lazy">
        <div class="gsearch__result-info">
          <span class="gsearch__result-label">${card.name}</span>
          <span class="gsearch__result-sub">${card.type_line || ''} ${Scryfall.renderMana(card.mana_cost)}</span>
        </div>
        <span class="gsearch__result-price">${Scryfall.formatPrice(Scryfall.getPrice(card))}</span>
      </button>
    `).join('');
  } catch (err) {
    container.innerHTML = '<p class="gsearch__empty">Search error. Try again.</p>';
  }
}

// ── Card Detail Modal ────────────────────────────────────
let _detailRequestId = 0; // Cancel stale requests

function openDetailSkeleton() {
  const modal = document.getElementById('card-detail-modal');
  const title = document.getElementById('card-detail-title');
  const body = document.getElementById('card-detail-body');
  modal.style.display = 'flex';
  title.textContent = 'Loading...';
  body.innerHTML = `<div class="card-detail"><div class="skeleton skeleton-img" style="width:240px;height:340px"></div><div style="flex:1;display:flex;flex-direction:column;gap:8px"><div class="skeleton skeleton-text"></div><div class="skeleton skeleton-text--short skeleton-text"></div><div class="skeleton skeleton-text"></div><div class="skeleton skeleton-text"></div></div></div>`;
}

function renderCardDetail(card) {
  const title = document.getElementById('card-detail-title');
  const body = document.getElementById('card-detail-body');
  title.textContent = card.name;
  const oracleText = card.oracle_text || card.card_faces?.map(f => f.oracle_text).join('\n\n---\n\n') || 'No text';
  const price = Scryfall.getPrice(card);
  const decks = Storage.getDecks();
  const deckOptions = decks.length ? decks.map(d => `<option value="${d.id}">${d.name}</option>`).join('') : '<option value="">No decks yet</option>';

  body.innerHTML = `
    <div class="card-detail">
      <img class="card-detail__img" src="${Scryfall.getImageUrl(card, 'normal')}" alt="${card.name}" loading="lazy">
      <div class="card-detail__info">
        <div class="card-detail__type">${card.type_line || ''}</div>
        <div style="margin-bottom:8px">${Scryfall.renderMana(card.mana_cost)}</div>
        <div class="card-detail__oracle">${oracleText}</div>
        ${card.power != null ? `<div class="card-detail__row"><span class="card-detail__row-label">P/T</span><span class="card-detail__row-val">${card.power}/${card.toughness}</span></div>` : ''}
        <div class="card-detail__row"><span class="card-detail__row-label">Set</span><span class="card-detail__row-val">${card.set_name} (${card.set.toUpperCase()})</span></div>
        <div class="card-detail__row"><span class="card-detail__row-label">Rarity</span><span class="card-detail__row-val" style="text-transform:capitalize">${card.rarity}</span></div>
        <div class="card-detail__row card-detail__price-row"><span class="card-detail__row-label">Price (USD)</span><span class="card-detail__row-val">${Scryfall.formatPrice(price)}</span></div>
        ${card.prices?.usd_foil ? `<div class="card-detail__row"><span class="card-detail__row-label">Foil Price</span><span class="card-detail__row-val" style="color:#c9a86c">$${parseFloat(card.prices.usd_foil).toFixed(2)}</span></div>` : ''}
        ${card.legalities ? `
          <div class="card-detail__row">
            <span class="card-detail__row-label">Legality</span>
            <span class="card-detail__row-val" style="display:flex;gap:4px;flex-wrap:wrap">
              ${['standard','pioneer','modern','legacy','commander','pauper'].map(f =>
                `<span class="legality-badge legality-badge--${card.legalities[f]}">${f.slice(0,3).toUpperCase()}</span>`
              ).join('')}
            </span>
          </div>
        ` : ''}
        <div class="card-detail__actions">
          <select id="detail-deck-select" class="deck-info-bar__format">${deckOptions}</select>
          <button class="btn btn--primary btn--sm" onclick="addCardFromDetail('${card.id}')">Add to Deck</button>
        </div>
      </div>
    </div>
  `;
  window._lastDetailCard = card;
}

async function showCardDetail(cardId) {
  // Use cached data from search results if available (instant, no API call)
  const cached = window._searchResults?.[cardId] || _ownedScryfallCache?.[cardId];
  if (cached) {
    openDetailSkeleton();
    renderCardDetail(cached);
    return;
  }
  const reqId = ++_detailRequestId;
  openDetailSkeleton();
  try {
    const card = await Scryfall.getById(cardId);
    if (reqId !== _detailRequestId) return;
    renderCardDetail(card);
  } catch (err) {
    if (reqId !== _detailRequestId) return;
    document.getElementById('card-detail-body').innerHTML = '<p class="gsearch__empty">Error loading card.</p>';
  }
}

async function addCardFromDetail(cardId) {
  const select = document.getElementById('detail-deck-select');
  const deckId = select?.value;
  if (!deckId) {
    showToast('Create a deck first!', 'warning');
    return;
  }
  const card = window._lastDetailCard;
  if (card) {
    Storage.addCardToDeck(deckId, card);
    closeCardDetail();
    if (currentPage === 'builder' && currentDeckId === deckId) renderBuilder({ deckId });
    if (currentPage === 'dashboard') renderDashboard();
  }
}

function closeCardDetail() {
  document.getElementById('card-detail-modal').style.display = 'none';
}

// ═══════════════════════════════════════════════════════════
//  DASHBOARD
// ═══════════════════════════════════════════════════════════
function renderDashboard() {
  const container = document.getElementById('view-dashboard');
  const decks = Storage.getDecks();
  const richMap = Storage.getOwnedCardsRich();
  const ownedNames = Object.keys(richMap);
  const ownedUniqueCount = ownedNames.length;
  const ownedTotalQty = ownedNames.reduce((s, n) => s + (richMap[n].qty || 1), 0);
  const ownedValue = ownedNames.reduce((s, n) => s + (parseFloat(richMap[n].price) || 0) * (richMap[n].qty || 1), 0);

  // Most valuable owned cards
  const topCards = ownedNames
    .filter(n => richMap[n].price)
    .sort((a, b) => (parseFloat(richMap[b].price) || 0) - (parseFloat(richMap[a].price) || 0))
    .slice(0, 5);

  container.innerHTML = `
    <div class="dashboard">
      <div class="dashboard__header">
        <h1>Welcome, Planeswalker</h1>
        <p>Your MTG deck building headquarters. Search cards, build decks, dominate the meta.</p>
      </div>

      <div class="dashboard__stats">
        <div class="stat-card stat-card--green" onclick="navigate('collection')">
          <span class="stat-card__value">${ownedTotalQty}</span>
          <span class="stat-card__label">Cards Owned</span>
        </div>
        <div class="stat-card stat-card--accent" onclick="navigate('collection')">
          <span class="stat-card__value">$${ownedValue.toFixed(0)}</span>
          <span class="stat-card__label">Collection Value</span>
        </div>
        <div class="stat-card stat-card--blue" onclick="navigate('collection')">
          <span class="stat-card__value">${decks.length}</span>
          <span class="stat-card__label">Decks Built</span>
        </div>
        <div class="stat-card stat-card--red" onclick="navigate('meta')">
          <span class="stat-card__value">${MetaDecks.length}</span>
          <span class="stat-card__label">Meta Decks</span>
        </div>
      </div>

      <div class="dash-grid">
        <!-- Collection Overview -->
        <div class="dash-card">
          <div class="dash-card__header">
            <h3>My Collection</h3>
            <span class="dash-card__link" onclick="navigate('collection')">Manage</span>
          </div>
          <div class="dash-card__body">
            ${ownedUniqueCount === 0 ? '<p class="dash-card__empty">No cards in your collection yet. Go to Collection to start adding cards you own.</p>' : `
              <div class="dash-task">
                <div class="dash-task__left">
                  <span class="dash-task__dot dash-task__dot--green"></span>
                  <div>
                    <span class="dash-task__title">${ownedUniqueCount} unique cards</span>
                    <span class="dash-task__meta">${ownedTotalQty} total including duplicates</span>
                  </div>
                </div>
                <div class="dash-task__right">
                  <span class="dash-task__price">$${ownedValue.toFixed(2)}</span>
                </div>
              </div>
              ${topCards.length > 0 ? `
                <div style="margin-top:4px;padding-top:8px;border-top:1px solid var(--color-border)">
                  <div style="color:var(--color-text-muted);font-size:.72rem;font-weight:600;text-transform:uppercase;letter-spacing:.04em;margin-bottom:6px">Most Valuable</div>
                  ${topCards.map(name => {
                    const m = richMap[name];
                    return `
                      <div class="dash-task" onclick="showCardDetailByName('${name.replace(/'/g, "\\'")}')">
                        <div class="dash-task__left">
                          ${m.imageUrl ? `<img src="${m.imageUrl}" style="width:28px;height:38px;border-radius:3px;object-fit:cover;flex-shrink:0" alt="">` : '<span class="dash-task__dot dash-task__dot--amber"></span>'}
                          <div>
                            <span class="dash-task__title">${name}</span>
                            <span class="dash-task__meta">${m.typeLine || ''}${m.qty > 1 ? ' · ' + m.qty + 'x' : ''}</span>
                          </div>
                        </div>
                        <div class="dash-task__right">
                          <span class="dash-task__price">$${parseFloat(m.price).toFixed(2)}</span>
                        </div>
                      </div>
                    `;
                  }).join('')}
                </div>
              ` : ''}
            `}
          </div>
        </div>

        <!-- My Decks -->
        <div class="dash-card">
          <div class="dash-card__header">
            <h3>My Decks</h3>
            <span class="dash-card__link" onclick="navigate('collection')">View all</span>
          </div>
          <div class="dash-card__body">
            ${decks.length === 0 ? '<p class="dash-card__empty">No decks yet. Create your first deck!</p>' : ''}
            ${decks.slice(0, 6).map(d => {
              const { have, missing } = Storage.getDeckOwnedCount(d);
              return `
              <div class="dash-task" onclick="navigate('builder', { deckId: '${d.id}' })">
                <div class="dash-task__left">
                  <span class="dash-task__dot dash-task__dot--amber"></span>
                  <div>
                    <span class="dash-task__title">${d.name}</span>
                    <span class="dash-task__meta">${d.format} — ${Storage.getDeckTotalCards(d)} cards · <span style="color:#6bcf8e">${have} owned</span>${missing > 0 ? ` · <span style="color:#cf6b6b">${missing} missing</span>` : ''}</span>
                  </div>
                </div>
                <div class="dash-task__right">
                  <span class="dash-task__price">$${Storage.getDeckTotalPrice(d).toFixed(0)}</span>
                  <span class="dash-task__badge dash-task__badge--amber">${d.format}</span>
                </div>
              </div>
            `}).join('')}
          </div>
        </div>

        <!-- Top Meta Decks -->
        <div class="dash-card">
          <div class="dash-card__header">
            <h3>Top Meta Decks</h3>
            <span class="dash-card__link" onclick="navigate('meta')">Browse all</span>
          </div>
          <div class="dash-card__body">
            ${MetaDecks.filter(d => d.tier === 1).slice(0, 6).map(d => `
              <div class="dash-task" onclick="navigate('meta')">
                <div class="dash-task__left">
                  <span class="dash-task__dot dash-task__dot--${d.colors.includes('R') ? 'red' : d.colors.includes('U') ? 'blue' : d.colors.includes('G') ? 'green' : 'amber'}"></span>
                  <div>
                    <span class="dash-task__title">${d.name}</span>
                    <span class="dash-task__meta">${d.format} — Tier ${d.tier}</span>
                  </div>
                </div>
                <div class="dash-task__right">
                  <span class="dash-task__price">~$${d.approxPrice}</span>
                  <span class="dash-task__badge dash-task__badge--green">Tier ${d.tier}</span>
                </div>
              </div>
            `).join('')}
          </div>
        </div>

        <!-- Quick Links -->
        <div class="dash-card">
          <div class="dash-card__header">
            <h3>Quick Access</h3>
          </div>
          <div class="dash-card__body dash-quick-links">
            <div class="dash-quick" onclick="navigate('collection')">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20"><path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/></svg>
              <div>
                <strong>My Collection</strong>
                <span>Add cards you own, track your collection</span>
              </div>
            </div>
            <div class="dash-quick" onclick="navigate('builder')">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>
              <div>
                <strong>Deck Builder</strong>
                <span>Search cards, drag & drop, build decks</span>
              </div>
            </div>
            <div class="dash-quick" onclick="navigate('compare')">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>
              <div>
                <strong>Compare Decks</strong>
                <span>Side-by-side deck analysis</span>
              </div>
            </div>
            <div class="dash-quick" onclick="openSearch()">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
              <div>
                <strong>Card Search</strong>
                <span>Search any card via Scryfall — Ctrl+K</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;
}

// ═══════════════════════════════════════════════════════════
//  DECK BUILDER
// ═══════════════════════════════════════════════════════════
function renderBuilder(data) {
  const container = document.getElementById('view-builder');

  // Load or create deck
  let deck;
  if (data?.deckId) {
    deck = Storage.getDeck(data.deckId);
    currentDeckId = data.deckId;
  }
  if (!deck) {
    const decks = Storage.getDecks();
    if (decks.length > 0) {
      deck = decks[0];
      currentDeckId = deck.id;
    } else {
      deck = Storage.createDeck('My First Deck', 'standard');
      currentDeckId = deck.id;
    }
  }

  const totalCards = Storage.getDeckTotalCards(deck);
  const totalPrice = Storage.getDeckTotalPrice(deck);
  const { have: ownedCount, missing: missingCount } = Storage.getDeckOwnedCount(deck);

  // Group cards by category
  const categories = {};
  deck.cards.forEach(card => {
    const cat = Scryfall.getCategory(card);
    if (!categories[cat]) categories[cat] = [];
    categories[cat].push(card);
  });

  const categoryOrder = ['Creatures', 'Planeswalkers', 'Battles', 'Instants', 'Sorceries', 'Enchantments', 'Artifacts', 'Lands', 'Other'];

  // All decks for switcher
  const allDecks = Storage.getDecks();

  container.innerHTML = `
    <div class="builder">
      <div class="builder__header">
        <h1>Deck Builder</h1>
        <div class="builder__controls">
          <select onchange="switchDeck(this.value)" class="deck-info-bar__format">
            ${allDecks.map(d => `<option value="${d.id}" ${d.id === deck.id ? 'selected' : ''}>${d.name}</option>`).join('')}
          </select>
          <button class="btn btn--primary btn--sm" onclick="createNewDeck()">+ New Deck</button>
          <button class="btn btn--outline btn--sm" onclick="document.getElementById('import-file-input').click()">Import .txt</button>
          <input type="file" id="import-file-input" accept=".txt,.dec,.dek" style="display:none" onchange="importFromFile(this)">
        </div>
      </div>

      <div class="deck-info-bar">
        <div class="deck-info-bar__left">
          <input class="deck-info-bar__name" value="${deck.name}" onchange="renameDeck('${deck.id}', this.value)" placeholder="Deck name...">
          <select class="deck-info-bar__format" onchange="changeDeckFormat('${deck.id}', this.value)">
            ${['standard', 'pioneer', 'modern', 'commander', 'legacy', 'vintage', 'pauper'].map(f =>
              `<option value="${f}" ${deck.format === f ? 'selected' : ''}>${f.charAt(0).toUpperCase() + f.slice(1)}</option>`
            ).join('')}
          </select>
        </div>
        <div class="deck-info-bar__stats">
          <div class="deck-info-bar__stat">
            <span class="deck-info-bar__stat-val">${totalCards}</span>
            <span class="deck-info-bar__stat-label">Main</span>
          </div>
          <div class="deck-info-bar__stat">
            <span class="deck-info-bar__stat-val">${deck.sideboard.reduce((s, c) => s + (c.qty || 1), 0)}</span>
            <span class="deck-info-bar__stat-label">Side</span>
          </div>
          <div class="deck-info-bar__stat">
            <span class="deck-info-bar__stat-val" style="color:var(--color-accent)">$${totalPrice.toFixed(2)}</span>
            <span class="deck-info-bar__stat-label">Value</span>
          </div>
          <div class="deck-info-bar__stat">
            <span class="deck-info-bar__stat-val stat-owned">${ownedCount}</span>
            <span class="deck-info-bar__stat-label">Owned</span>
          </div>
          <div class="deck-info-bar__stat">
            <span class="deck-info-bar__stat-val stat-missing">${missingCount}</span>
            <span class="deck-info-bar__stat-label">Missing</span>
          </div>
        </div>
      </div>

      ${totalCards > 0 ? buildDeckStatsPanel(deck) : ''}

      <div class="builder__layout">
        <!-- Search Panel -->
        <div class="builder__search-panel">
          <div class="builder__search-header">
            <input id="builder-search-input" class="builder__search-input" type="text" placeholder="Search cards to add..." autocomplete="off">
            <div class="builder__search-filters">
              <button class="filter-btn active" onclick="filterSearch(this, '')">All</button>
              <button class="filter-btn" onclick="filterSearch(this, 't:creature')">Creatures</button>
              <button class="filter-btn" onclick="filterSearch(this, 't:instant')">Instants</button>
              <button class="filter-btn" onclick="filterSearch(this, 't:sorcery')">Sorceries</button>
              <button class="filter-btn" onclick="filterSearch(this, 't:land')">Lands</button>
              <button class="filter-btn" onclick="filterSearch(this, 't:enchantment')">Enchant</button>
              <button class="filter-btn" onclick="filterSearch(this, 't:artifact')">Artifacts</button>
            </div>
          </div>
          <div id="builder-search-results" class="builder__search-results">
            <div class="empty-state">
              <div class="empty-state__icon">&#x1F50D;</div>
              <div class="empty-state__title">Search for cards</div>
              <div class="empty-state__text">Type a card name above or use Ctrl+K for quick search</div>
            </div>
          </div>
        </div>

        <!-- Deck Panel -->
        <div class="builder__deck-panel">
          <input id="deck-filter-input" class="builder__search-input" type="text" placeholder="Filter deck list by card name..." autocomplete="off" oninput="filterDeckList(this.value)" style="margin-bottom:12px">
          <div class="deck-sections">
            ${totalCards === 0 ? `
              <div class="deck-section">
                <div class="empty-state">
                  <div class="empty-state__icon">&#x1F0CF;</div>
                  <div class="empty-state__title">Empty Deck</div>
                  <div class="empty-state__text">Search for cards on the left and click + to add them, or drag & drop cards here</div>
                </div>
              </div>
            ` : ''}
            ${categoryOrder.filter(cat => categories[cat]).map(cat => {
              const catColors = { Creatures:'#6bcf8e', Planeswalkers:'#e0c992', Battles:'#cf6b6b', Instants:'#6cabcf', Sorceries:'#b06ccf', Enchantments:'#c9a86c', Artifacts:'#8899aa', Lands:'#8B7355', Other:'#6b6b80' };
              const catIcons = { Creatures:'&#x1F43E;', Planeswalkers:'&#x2726;', Battles:'&#x2694;', Instants:'&#x26A1;', Sorceries:'&#x2728;', Enchantments:'&#x2B50;', Artifacts:'&#x2699;', Lands:'&#x26F0;', Other:'&#x2756;' };
              const cc = catColors[cat] || '#6b6b80';
              const ci = catIcons[cat] || '';
              return `
              <div class="deck-section" style="border-left:3px solid ${cc}">
                <div class="deck-section__header" onclick="this.nextElementSibling.style.display = this.nextElementSibling.style.display === 'none' ? '' : 'none'">
                  <h3><span style="margin-right:6px">${ci}</span>${cat}</h3>
                  <span class="deck-section__count" style="color:${cc}">${categories[cat].reduce((s, c) => s + (c.qty || 1), 0)}</span>
                </div>
                <div class="deck-section__body" ondragover="event.preventDefault(); this.classList.add('deck-section__body--drop-target')" ondragleave="this.classList.remove('deck-section__body--drop-target')" ondrop="handleDeckDrop(event, '${deck.id}'); this.classList.remove('deck-section__body--drop-target')">
                  ${categories[cat].map(card => renderDeckCard(card, deck.id, 'cards')).join('')}
                </div>
              </div>`;
            }).join('')}

            <!-- Sideboard -->
            <div class="deck-section">
              <div class="deck-section__header" onclick="this.nextElementSibling.style.display = this.nextElementSibling.style.display === 'none' ? '' : 'none'">
                <h3>Sideboard</h3>
                <span class="deck-section__count">${deck.sideboard.reduce((s, c) => s + (c.qty || 1), 0)}</span>
              </div>
              <div class="deck-section__body" ondragover="event.preventDefault(); this.classList.add('deck-section__body--drop-target')" ondragleave="this.classList.remove('deck-section__body--drop-target')" ondrop="handleSideboardDrop(event, '${deck.id}'); this.classList.remove('deck-section__body--drop-target')">
                ${deck.sideboard.length === 0 ? '<p style="color:var(--color-text-muted);font-size:.8rem;padding:8px;text-align:center">Drop cards here for sideboard</p>' : ''}
                ${deck.sideboard.map(card => renderDeckCard(card, deck.id, 'sideboard')).join('')}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;

  // Setup builder search
  const builderInput = document.getElementById('builder-search-input');
  builderInput.addEventListener('input', (e) => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => builderSearch(e.target.value), 350);
  });
}

function renderDeckCard(card, deckId, zone) {
  const isOwned = Storage.isCardOwned(card.name);
  const escapedName = card.name.replace(/'/g, "\\'");
  return `
    <div class="deck-card ${isOwned ? '' : 'deck-card--missing'}" draggable="true" ondragstart="event.dataTransfer.setData('text/plain', '${card.name}')">
      <div class="deck-card__owned ${isOwned ? 'owned' : ''}" onclick="toggleOwned('${escapedName}', '${deckId}')" title="${isOwned ? 'Owned — click to unmark' : 'Click to mark as owned'}">&#10003;</div>
      <span class="deck-card__qty">${card.qty}x</span>
      <span class="deck-card__name" onclick="showCardDetailByName('${escapedName}')">${card.name}</span>
      <span class="deck-card__mana">${Scryfall.renderMana(card.manaCost)}</span>
      <span class="deck-card__price">${card.price ? '$' + parseFloat(card.price).toFixed(2) : '—'}</span>
      <div class="deck-card__actions">
        <button class="deck-card__btn deck-card__btn--move" onclick="moveCardZone('${deckId}', '${escapedName}', '${zone}')" title="${zone === 'cards' ? 'Move to Sideboard' : 'Move to Main'}">
          ${zone === 'cards' ? '&#x21E9;' : '&#x21E7;'}
        </button>
        <button class="deck-card__btn" onclick="addOneMore('${deckId}', '${escapedName}', '${zone}')">+</button>
        <button class="deck-card__btn deck-card__btn--remove" onclick="removeOne('${deckId}', '${escapedName}', '${zone}')">-</button>
      </div>
    </div>
  `;
}

function toggleOwned(cardName, deckId) {
  // Get metadata from deck data
  const deck = Storage.getDeck(deckId);
  let meta = null;
  if (deck) {
    const found = [...deck.cards, ...deck.sideboard].find(c => c.name === cardName);
    if (found) meta = { typeLine: found.typeLine || '', manaCost: found.manaCost || '', imageUrl: found.imageUrl || '', price: found.price || null, colors: found.colors || [], cmc: found.cmc || 0 };
  }
  Storage.toggleCardOwned(cardName, meta);
  renderBuilder({ deckId });
  // Restore filter text after re-render
  const filterInput = document.getElementById('deck-filter-input');
  if (filterInput && window._lastDeckFilter) {
    filterInput.value = window._lastDeckFilter;
    filterDeckList(window._lastDeckFilter);
  }
}

function filterDeckList(query) {
  window._lastDeckFilter = query;
  const q = query.toLowerCase().trim();
  document.querySelectorAll('.deck-sections .deck-card').forEach(card => {
    const name = card.querySelector('.deck-card__name')?.textContent?.toLowerCase() || '';
    card.style.display = !q || name.includes(q) ? '' : 'none';
  });
  // Hide empty sections, show sections with matches
  document.querySelectorAll('.deck-sections .deck-section').forEach(section => {
    const cards = section.querySelectorAll('.deck-card');
    if (cards.length === 0) return; // sideboard empty state or empty deck
    const hasVisible = [...cards].some(c => c.style.display !== 'none');
    section.style.display = hasVisible || !q ? '' : 'none';
  });
}

// ═══════════════════════════════════════════════════════════
//  DECK STATS PANEL (Mana Curve + Color Pie + Legality)
// ═══════════════════════════════════════════════════════════
function buildDeckStatsPanel(deck) {
  const cards = deck.cards || [];
  if (cards.length === 0) return '';

  // Mana curve data (CMC 0-7+)
  const curve = [0, 0, 0, 0, 0, 0, 0, 0]; // indices 0-7+
  cards.forEach(c => {
    const cmc = Math.min(c.cmc || 0, 7);
    curve[cmc] += (c.qty || 1);
  });
  const maxCurve = Math.max(...curve, 1);

  // Color distribution from mana symbols
  const colorCounts = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };
  const colorNames = { W: 'White', U: 'Blue', B: 'Black', R: 'Red', G: 'Green', C: 'Colorless' };
  const colorHex = { W: '#F9FAF4', U: '#0E68AB', B: '#555', R: '#D3202A', G: '#00733E', C: '#AABBCC' };
  cards.forEach(c => {
    const symbols = Scryfall.parseMana(c.manaCost);
    const qty = c.qty || 1;
    symbols.forEach(s => {
      if (colorCounts[s] !== undefined) colorCounts[s] += qty;
      else if (!isNaN(s)) colorCounts.C += parseInt(s) * qty;
    });
  });
  const totalMana = Object.values(colorCounts).reduce((a, b) => a + b, 0) || 1;

  // Build conic gradient for color pie
  const activeColors = Object.entries(colorCounts).filter(([, v]) => v > 0);
  let gradientParts = [];
  let cumPercent = 0;
  activeColors.forEach(([color, count]) => {
    const pct = (count / totalMana) * 100;
    gradientParts.push(`${colorHex[color]} ${cumPercent}% ${cumPercent + pct}%`);
    cumPercent += pct;
  });
  const gradient = gradientParts.length > 0
    ? `conic-gradient(${gradientParts.join(', ')})`
    : `conic-gradient(var(--color-border) 0% 100%)`;

  // Card type counts
  const landCount = cards.filter(c => Scryfall.getCategory(c) === 'Lands').reduce((s, c) => s + (c.qty || 1), 0);
  const creatureCount = cards.filter(c => Scryfall.getCategory(c) === 'Creatures').reduce((s, c) => s + (c.qty || 1), 0);
  const spellCount = cards.filter(c => !['Lands', 'Creatures'].includes(Scryfall.getCategory(c))).reduce((s, c) => s + (c.qty || 1), 0);
  const totalCards = cards.reduce((s, c) => s + (c.qty || 1), 0);
  const nonLandCards = cards.filter(c => Scryfall.getCategory(c) !== 'Lands');
  const avgCmc = nonLandCards.length > 0
    ? (nonLandCards.reduce((s, c) => s + (c.cmc || 0) * (c.qty || 1), 0) / nonLandCards.reduce((s, c) => s + (c.qty || 1), 0)).toFixed(2)
    : '0';

  // Format legality check
  const format = deck.format || 'standard';
  const formatDisplay = format.charAt(0).toUpperCase() + format.slice(1);

  return `
    <div class="deck-stats">
      <div class="deck-stats__section">
        <div class="deck-stats__title">Mana Curve</div>
        <div class="mana-curve">
          ${curve.map((count, i) => `
            <div class="mana-curve__bar-wrap">
              <span class="mana-curve__count">${count || ''}</span>
              <div class="mana-curve__bar" style="height:${maxCurve > 0 ? (count / maxCurve) * 60 : 0}px" title="${count} card${count !== 1 ? 's' : ''} at CMC ${i === 7 ? '7+' : i}"></div>
              <span class="mana-curve__label">${i === 7 ? '7+' : i}</span>
            </div>
          `).join('')}
        </div>
      </div>
      <div class="deck-stats__section">
        <div class="deck-stats__title">Colors</div>
        <div class="color-pie">
          <div class="color-pie__ring" style="background:${gradient}"></div>
          <div class="color-pie__legend">
            ${activeColors.map(([color, count]) => `
              <div class="color-pie__item">
                <div class="color-pie__dot" style="background:${colorHex[color]}"></div>
                <span>${colorNames[color]} ${Math.round((count / totalMana) * 100)}%</span>
              </div>
            `).join('')}
          </div>
        </div>
      </div>
      <div class="deck-stats__section">
        <div class="deck-stats__title">Breakdown</div>
        <div style="display:flex;gap:16px;flex-wrap:wrap;font-size:.82rem;color:var(--color-text)">
          <span>Creatures: <strong style="color:var(--color-heading)">${creatureCount}</strong></span>
          <span>Spells: <strong style="color:var(--color-heading)">${spellCount}</strong></span>
          <span>Lands: <strong style="color:var(--color-heading)">${landCount}</strong></span>
          <span>Avg CMC: <strong style="color:var(--color-heading)">${avgCmc}</strong></span>
        </div>
      </div>
      <div class="deck-stats__section">
        <div class="deck-stats__title">Format</div>
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
          <span class="legality-badge legality-badge--legal">${formatDisplay}</span>
          <span style="color:var(--color-text-muted);font-size:.75rem">${totalCards} / ${format === 'commander' ? '100' : '60'} cards</span>
        </div>
      </div>
    </div>
  `;
}

let currentTypeFilter = '';

function filterSearch(btn, filter) {
  document.querySelectorAll('.builder__search-filters .filter-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  currentTypeFilter = filter;
  const input = document.getElementById('builder-search-input');
  if (input.value) builderSearch(input.value);
}

async function builderSearch(query) {
  const resultsContainer = document.getElementById('builder-search-results');
  if (!query || query.length < 2) {
    resultsContainer.innerHTML = `
      <div class="empty-state">
        <div class="empty-state__icon">&#x1F50D;</div>
        <div class="empty-state__title">Search for cards</div>
        <div class="empty-state__text">Type a card name to search</div>
      </div>
    `;
    return;
  }

  resultsContainer.innerHTML = `<div style="padding:8px">${Array(5).fill('<div class="skeleton skeleton-card"></div>').join('')}</div>`;
  try {
    const fullQuery = currentTypeFilter ? `${query} ${currentTypeFilter}` : query;
    const data = await Scryfall.search(fullQuery);
    if (!data.data || data.data.length === 0) {
      resultsContainer.innerHTML = '<p class="gsearch__empty">No cards found.</p>';
      return;
    }
    resultsContainer.innerHTML = data.data.slice(0, 30).map(card => `
      <div class="search-card" draggable="true" ondragstart="handleCardDragStart(event, '${card.id}')">
        <img class="search-card__img" src="${Scryfall.getSmallImage(card)}" alt="" loading="lazy">
        <div class="search-card__info">
          <div class="search-card__name">${card.name}</div>
          <div class="search-card__type">${card.type_line || ''}</div>
          <div class="search-card__mana">${Scryfall.renderMana(card.mana_cost)}</div>
          <div class="search-card__price">${Scryfall.formatPrice(Scryfall.getPrice(card))}</div>
        </div>
        <div class="search-card__actions">
          <button class="search-card__add" onclick="addCardFromSearch('${card.id}')" title="Add to Main Deck">+</button>
          <button class="search-card__side" onclick="addCardFromSearch('${card.id}', 'sideboard')" title="Add to Sideboard">SB</button>
        </div>
      </div>
    `).join('');

    // Store search results for drag & drop
    window._searchResults = {};
    data.data.forEach(card => { window._searchResults[card.id] = card; });
  } catch (err) {
    resultsContainer.innerHTML = '<p class="gsearch__empty">Search error. Try again.</p>';
  }
}

// ── Drag & Drop ──────────────────────────────────────────
function handleCardDragStart(event, cardId) {
  event.dataTransfer.setData('application/card-id', cardId);
  event.dataTransfer.effectAllowed = 'copy';
}

async function handleDeckDrop(event, deckId) {
  event.preventDefault();
  const cardId = event.dataTransfer.getData('application/card-id');
  if (cardId && window._searchResults?.[cardId]) {
    Storage.addCardToDeck(deckId, window._searchResults[cardId], 'cards');
    renderBuilder({ deckId });
  }
}

async function handleSideboardDrop(event, deckId) {
  event.preventDefault();
  const cardId = event.dataTransfer.getData('application/card-id');
  if (cardId && window._searchResults?.[cardId]) {
    Storage.addCardToDeck(deckId, window._searchResults[cardId], 'sideboard');
    renderBuilder({ deckId });
  }
}

// ── Deck Actions ─────────────────────────────────────────
async function addCardFromSearch(cardId, zone = 'cards') {
  if (!currentDeckId) return;
  const card = window._searchResults?.[cardId];
  if (card) {
    Storage.addCardToDeck(currentDeckId, card, zone);
    renderBuilder({ deckId: currentDeckId });
  }
}

function addOneMore(deckId, cardName, zone) {
  const deck = Storage.getDeck(deckId);
  if (!deck) return;
  const card = deck[zone].find(c => c.name === cardName);
  if (card) {
    card.qty++;
    deck.updatedAt = new Date().toISOString();
    Storage.saveDeck(deck);
    renderBuilder({ deckId });
  }
}

function removeOne(deckId, cardName, zone) {
  Storage.removeCardFromDeck(deckId, cardName, zone);
  renderBuilder({ deckId });
}

function moveCardZone(deckId, cardName, fromZone) {
  const deck = Storage.getDeck(deckId);
  if (!deck) return;
  const toZone = fromZone === 'cards' ? 'sideboard' : 'cards';
  const fromList = deck[fromZone];
  const idx = fromList.findIndex(c => c.name === cardName);
  if (idx < 0) return;
  const card = fromList[idx];
  // Remove from source
  fromList.splice(idx, 1);
  // Add to target (merge qty if already there)
  const existing = deck[toZone].find(c => c.name === cardName);
  if (existing) {
    existing.qty = (existing.qty || 1) + (card.qty || 1);
  } else {
    deck[toZone].push(card);
  }
  deck.updatedAt = new Date().toISOString();
  Storage.saveDeck(deck);
  showToast(`Moved ${cardName} to ${toZone === 'sideboard' ? 'Sideboard' : 'Main Deck'}`, 'info', 2000);
  renderBuilder({ deckId });
}

function createNewDeck() {
  const name = prompt('Deck name:', 'New Deck');
  if (!name) return;
  const deck = Storage.createDeck(name, 'standard');
  currentDeckId = deck.id;
  renderBuilder({ deckId: deck.id });
}

function switchDeck(deckId) {
  currentDeckId = deckId;
  renderBuilder({ deckId });
}

function renameDeck(deckId, newName) {
  const deck = Storage.getDeck(deckId);
  if (deck) {
    deck.name = newName;
    Storage.saveDeck(deck);
  }
}

function changeDeckFormat(deckId, format) {
  const deck = Storage.getDeck(deckId);
  if (deck) {
    deck.format = format;
    Storage.saveDeck(deck);
  }
}

async function showCardDetailByName(name) {
  // Check search result caches first (instant)
  if (window._searchResults) {
    const cached = Object.values(window._searchResults).find(c => c.name === name);
    if (cached) { openDetailSkeleton(); renderCardDetail(cached); return; }
  }
  if (_ownedScryfallCache) {
    const cached = Object.values(_ownedScryfallCache).find(c => c.name === name);
    if (cached) { openDetailSkeleton(); renderCardDetail(cached); return; }
  }

  // Fall back to API
  const reqId = ++_detailRequestId;
  openDetailSkeleton();
  try {
    const card = await Scryfall.getByName(name);
    if (reqId !== _detailRequestId) return;
    renderCardDetail(card);
  } catch {
    if (reqId !== _detailRequestId) return;
    showToast('Card not found.', 'error');
    document.getElementById('card-detail-modal').style.display = 'none';
  }
}

// ═══════════════════════════════════════════════════════════
//  META DECKS
// ═══════════════════════════════════════════════════════════
let currentMetaFormat = 'all';

function renderMeta() {
  const container = document.getElementById('view-meta');
  const formats = ['all', ...new Set(MetaDecks.map(d => d.format))];
  const filtered = currentMetaFormat === 'all' ? MetaDecks : MetaDecks.filter(d => d.format === currentMetaFormat);

  container.innerHTML = `
    <div class="meta-header">
      <h1>Meta Decks 2025-2026</h1>
      <p>Championship-winning archetypes with decklists and approximate pricing from Scryfall.</p>
    </div>

    <div class="meta-tabs">
      ${formats.map(f => `
        <button class="meta-tab ${currentMetaFormat === f ? 'active' : ''}" onclick="setMetaFormat('${f}')">${f === 'all' ? 'All Formats' : f}</button>
      `).join('')}
    </div>

    <div class="meta-grid">
      ${filtered.map((d, i) => `
        <div class="meta-deck-card" onclick="showMetaDeck(${i})">
          <div class="meta-deck-card__header">
            <div class="meta-deck-card__name">${d.name}</div>
            <span class="meta-deck-card__tier meta-deck-card__tier--${d.tier}">Tier ${d.tier}</span>
          </div>
          <div class="meta-deck-card__format">${d.format}</div>
          <div class="meta-deck-card__colors">
            ${d.colors.map(c => `<span class="mana-sym mana-${c}" style="width:20px;height:20px;font-size:.7rem">${c}</span>`).join('')}
          </div>
          <div class="meta-deck-card__desc">${d.description}</div>
          <div class="meta-deck-card__footer">
            <span class="meta-deck-card__price">~$${d.approxPrice}</span>
            <span class="meta-deck-card__cards">${d.cards.reduce((s, c) => s + (c.qty || 1), 0)} cards</span>
            <button class="meta-deck-card__btn" onclick="event.stopPropagation(); importMetaDeck(${MetaDecks.indexOf(d)})">Import</button>
          </div>
        </div>
      `).join('')}
    </div>
  `;
}

function setMetaFormat(format) {
  currentMetaFormat = format;
  renderMeta();
}

function showMetaDeck(index) {
  const deck = MetaDecks[index];
  const modal = document.getElementById('card-detail-modal');
  const title = document.getElementById('card-detail-title');
  const body = document.getElementById('card-detail-body');
  modal.style.display = 'flex';
  title.textContent = deck.name;

  body.innerHTML = `
    <div style="margin-bottom:16px">
      <div style="display:flex;gap:8px;margin-bottom:8px">
        ${deck.colors.map(c => `<span class="mana-sym mana-${c}" style="width:22px;height:22px;font-size:.75rem">${c}</span>`).join('')}
        <span class="meta-deck-card__tier meta-deck-card__tier--${deck.tier}" style="margin-left:8px">Tier ${deck.tier}</span>
      </div>
      <p style="color:var(--color-text);font-size:.9rem;line-height:1.6;margin-bottom:12px">${deck.description}</p>
      <div class="card-detail__row card-detail__price-row">
        <span class="card-detail__row-label">Approximate Price</span>
        <span class="card-detail__row-val">~$${deck.approxPrice}</span>
      </div>
      <div class="card-detail__row">
        <span class="card-detail__row-label">Format</span>
        <span class="card-detail__row-val">${deck.format}</span>
      </div>
    </div>

    <h3 style="color:var(--color-heading);font-size:.9rem;margin-bottom:12px">Mainboard (${deck.cards.reduce((s, c) => s + c.qty, 0)})</h3>
    ${deck.cards.map(c => `
      <div style="display:flex;justify-content:space-between;padding:4px 0;font-size:.82rem;border-bottom:1px solid var(--color-border)">
        <span><strong style="color:var(--color-accent);margin-right:6px">${c.qty}x</strong><span style="color:var(--color-heading)">${c.name}</span></span>
      </div>
    `).join('')}

    ${deck.sideboard ? `
      <h3 style="color:var(--color-heading);font-size:.9rem;margin:16px 0 12px">Sideboard (${deck.sideboard.reduce((s, c) => s + c.qty, 0)})</h3>
      ${deck.sideboard.map(c => `
        <div style="display:flex;justify-content:space-between;padding:4px 0;font-size:.82rem;border-bottom:1px solid var(--color-border)">
          <span><strong style="color:var(--color-accent);margin-right:6px">${c.qty}x</strong><span style="color:var(--color-heading)">${c.name}</span></span>
        </div>
      `).join('')}
    ` : ''}

    <div style="margin-top:20px">
      <button class="btn btn--primary btn--sm" onclick="importMetaDeck(${MetaDecks.indexOf(deck)}); closeCardDetail();">Import to My Decks</button>
    </div>
  `;
}

function importMetaDeck(index) {
  const meta = MetaDecks[index];
  const deck = Storage.createDeck(meta.name, meta.format.toLowerCase());
  deck.cards = meta.cards.map(c => ({
    name: c.name, qty: c.qty, scryfallId: '', manaCost: '', typeLine: '',
    price: null, imageUrl: '', colors: [], cmc: 0,
  }));
  if (meta.sideboard) {
    deck.sideboard = meta.sideboard.map(c => ({
      name: c.name, qty: c.qty, scryfallId: '', manaCost: '', typeLine: '',
      price: null, imageUrl: '', colors: [], cmc: 0,
    }));
  }
  Storage.saveDeck(deck);
  showToast(`"${meta.name}" imported! Open it from Deck Builder or Collection.`, 'success', 4000);
  if (currentPage === 'dashboard') renderDashboard();
}

// ═══════════════════════════════════════════════════════════
//  COMPARE
// ═══════════════════════════════════════════════════════════
function renderCompare() {
  const container = document.getElementById('view-compare');
  const decks = Storage.getDecks();
  const allDecks = [...decks, ...MetaDecks.map((m, i) => ({
    id: `meta_${i}`, name: `[Meta] ${m.name}`, format: m.format,
    cards: m.cards, sideboard: m.sideboard || [],
  }))];

  container.innerHTML = `
    <div class="compare-header">
      <h1>Compare Decks</h1>
      <p>Select two decks to compare side by side — stats, card lists, and pricing.</p>
    </div>

    <div class="compare-selectors">
      <select id="compare-deck-1" class="compare-select" onchange="updateCompare()">
        <option value="">Select Deck A</option>
        ${allDecks.map(d => `<option value="${d.id}">${d.name} (${d.format})</option>`).join('')}
      </select>
      <select id="compare-deck-2" class="compare-select" onchange="updateCompare()">
        <option value="">Select Deck B</option>
        ${allDecks.map(d => `<option value="${d.id}">${d.name} (${d.format})</option>`).join('')}
      </select>
    </div>

    <div id="compare-results" class="compare-grid"></div>
  `;
}

function updateCompare() {
  const id1 = document.getElementById('compare-deck-1').value;
  const id2 = document.getElementById('compare-deck-2').value;
  const results = document.getElementById('compare-results');

  if (!id1 && !id2) {
    results.innerHTML = '<p class="gsearch__empty" style="grid-column:span 2">Select two decks above to compare.</p>';
    return;
  }

  function getDeckData(id) {
    if (!id) return null;
    if (id.startsWith('meta_')) {
      const i = parseInt(id.replace('meta_', ''));
      const m = MetaDecks[i];
      return { name: m.name, format: m.format, cards: m.cards, sideboard: m.sideboard || [], price: m.approxPrice };
    }
    const d = Storage.getDeck(id);
    return d ? { name: d.name, format: d.format, cards: d.cards, sideboard: d.sideboard, price: Storage.getDeckTotalPrice(d) } : null;
  }

  const deck1 = getDeckData(id1);
  const deck2 = getDeckData(id2);

  results.innerHTML = [deck1, deck2].map(d => {
    if (!d) return '<div class="compare-deck"><div class="compare-deck__header"><h3>No deck selected</h3></div></div>';
    const totalCards = d.cards.reduce((s, c) => s + (c.qty || 1), 0);
    const sideCards = d.sideboard.reduce((s, c) => s + (c.qty || 1), 0);
    return `
      <div class="compare-deck">
        <div class="compare-deck__header">
          <h3>${d.name}</h3>
          <div class="compare-deck__stats">
            <span class="compare-deck__stat"><strong>${totalCards}</strong> main</span>
            <span class="compare-deck__stat"><strong>${sideCards}</strong> side</span>
            <span class="compare-deck__stat" style="color:var(--color-accent)"><strong>$${typeof d.price === 'number' ? d.price.toFixed(0) : '?'}</strong></span>
          </div>
        </div>
        <div class="compare-deck__body">
          ${d.cards.map(c => `
            <div style="display:flex;justify-content:space-between;padding:4px 8px;font-size:.82rem;border-bottom:1px solid var(--color-border)">
              <span><strong style="color:var(--color-accent);margin-right:4px">${c.qty}x</strong><span style="color:var(--color-heading)">${c.name}</span></span>
              ${c.price ? `<span style="color:var(--color-text-muted)">$${(parseFloat(c.price) * c.qty).toFixed(2)}</span>` : ''}
            </div>
          `).join('')}
          ${d.sideboard.length > 0 ? `
            <div style="padding:8px;font-size:.75rem;color:var(--color-accent);font-weight:700;text-transform:uppercase;letter-spacing:.06em;border-bottom:1px solid var(--color-border)">Sideboard</div>
            ${d.sideboard.map(c => `
              <div style="display:flex;justify-content:space-between;padding:4px 8px;font-size:.82rem;border-bottom:1px solid var(--color-border)">
                <span><strong style="color:var(--color-accent);margin-right:4px">${c.qty}x</strong><span style="color:var(--color-heading)">${c.name}</span></span>
              </div>
            `).join('')}
          ` : ''}
        </div>
      </div>
    `;
  }).join('');

  // Shared cards analysis
  if (deck1 && deck2) {
    const names1 = new Set(deck1.cards.map(c => c.name));
    const names2 = new Set(deck2.cards.map(c => c.name));
    const shared = [...names1].filter(n => names2.has(n));
    const unique1 = [...names1].filter(n => !names2.has(n));
    const unique2 = [...names2].filter(n => !names1.has(n));

    // Owned status for all cards across both decks
    const owned = Storage.getOwnedCards();
    const allCardNames = new Set([...names1, ...names2]);
    const notOwned = [...allCardNames].filter(n => !owned.has(n));

    // Helper to get qty from a deck's card list
    function getQty(deckData, name) {
      const c = deckData.cards.find(x => x.name === name);
      return c ? (c.qty || 1) : 0;
    }

    // Build clickable card list HTML
    function renderAnalysisCards(cardNames, deck1Data, deck2Data) {
      return cardNames.map(name => {
        const isOwned = owned.has(name);
        const q1 = deck1Data ? getQty(deck1Data, name) : 0;
        const q2 = deck2Data ? getQty(deck2Data, name) : 0;
        const qtyLabel = q1 && q2 ? `${q1}/${q2}` : `${q1 || q2}x`;
        return `
          <div class="analysis-card" onclick="showCardDetailByName('${name.replace(/'/g, "\\'")}')">
            <span class="analysis-card__qty">${qtyLabel}</span>
            <span class="analysis-card__name">${name}</span>
            <span class="analysis-card__owned-tag ${isOwned ? 'analysis-card__owned-tag--have' : 'analysis-card__owned-tag--need'}">${isOwned ? 'Have' : 'Need'}</span>
          </div>
        `;
      }).join('');
    }

    // Store data for export
    window._compareAnalysis = { shared, unique1, unique2, notOwned, deck1Name: deck1.name, deck2Name: deck2.name };

    results.innerHTML += `
      <div class="dash-card" style="grid-column:span 2">
        <div class="dash-card__header">
          <h3>Analysis</h3>
        </div>
        <div class="dash-card__body" style="padding:16px;max-height:none">
          <!-- Stats Row -->
          <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:16px;text-align:center;margin-bottom:20px">
            <div><span style="color:var(--color-heading);font-size:1.5rem;font-weight:800">${shared.length}</span><br><span style="color:var(--color-text-muted);font-size:.75rem">Shared</span></div>
            <div><span style="color:#6cabcf;font-size:1.5rem;font-weight:800">${unique1.length}</span><br><span style="color:var(--color-text-muted);font-size:.75rem">Unique to A</span></div>
            <div><span style="color:#6bcf8e;font-size:1.5rem;font-weight:800">${unique2.length}</span><br><span style="color:var(--color-text-muted);font-size:.75rem">Unique to B</span></div>
            <div><span style="color:#cf6b6b;font-size:1.5rem;font-weight:800">${notOwned.length}</span><br><span style="color:var(--color-text-muted);font-size:.75rem">Not Owned</span></div>
          </div>

          <!-- Shared Cards -->
          <div class="analysis-section">
            <div class="analysis-section__header">
              <h4 style="color:var(--color-heading)">Shared Cards</h4>
              <span class="analysis-section__count" style="color:var(--color-text-muted)">${shared.length}</span>
            </div>
            ${shared.length === 0 ? '<p style="color:var(--color-text-muted);font-size:.82rem;padding:8px">No shared cards.</p>' : renderAnalysisCards(shared, deck1, deck2)}
          </div>

          <!-- Unique to Deck A -->
          <div class="analysis-section">
            <div class="analysis-section__header">
              <h4 style="color:#6cabcf">Unique to ${deck1.name}</h4>
              <span class="analysis-section__count" style="color:#6cabcf">${unique1.length}</span>
            </div>
            ${unique1.length === 0 ? '<p style="color:var(--color-text-muted);font-size:.82rem;padding:8px">No unique cards.</p>' : renderAnalysisCards(unique1, deck1, null)}
          </div>

          <!-- Unique to Deck B -->
          <div class="analysis-section">
            <div class="analysis-section__header">
              <h4 style="color:#6bcf8e">Unique to ${deck2.name}</h4>
              <span class="analysis-section__count" style="color:#6bcf8e">${unique2.length}</span>
            </div>
            ${unique2.length === 0 ? '<p style="color:var(--color-text-muted);font-size:.82rem;padding:8px">No unique cards.</p>' : renderAnalysisCards(unique2, null, deck2)}
          </div>

          <!-- Cards Not Owned (combined) -->
          <div class="analysis-section">
            <div class="analysis-section__header">
              <h4 style="color:#cf6b6b">Cards I Don't Own (Combined)</h4>
              <span class="analysis-section__count" style="color:#cf6b6b">${notOwned.length}</span>
            </div>
            ${notOwned.length === 0 ? '<p style="color:var(--color-text-muted);font-size:.82rem;padding:8px">You own all the cards! Nice collection.</p>' : renderAnalysisCards(notOwned, deck1, deck2)}
          </div>

          <!-- Export bar -->
          <div class="analysis-export-bar">
            <button class="btn btn--outline btn--sm" onclick="exportAnalysis('shared')">Export Shared</button>
            <button class="btn btn--outline btn--sm" onclick="exportAnalysis('unique1')">Export Unique A</button>
            <button class="btn btn--outline btn--sm" onclick="exportAnalysis('unique2')">Export Unique B</button>
            <button class="btn btn--danger btn--sm" style="border-radius:var(--radius-full)" onclick="exportAnalysis('notOwned')">Export Missing</button>
            <button class="btn btn--primary btn--sm" onclick="exportAnalysis('all')">Export All</button>
          </div>
        </div>
      </div>
    `;
  }
}

function exportAnalysis(type) {
  const data = window._compareAnalysis;
  if (!data) return;
  let lines = [];
  let filename = '';

  switch (type) {
    case 'shared':
      filename = 'shared_cards';
      lines.push(`// Shared cards between ${data.deck1Name} and ${data.deck2Name}`);
      data.shared.forEach(n => lines.push(`1 ${n}`));
      break;
    case 'unique1':
      filename = `unique_${data.deck1Name.replace(/[^a-z0-9]/gi, '_')}`;
      lines.push(`// Cards unique to ${data.deck1Name}`);
      data.unique1.forEach(n => lines.push(`1 ${n}`));
      break;
    case 'unique2':
      filename = `unique_${data.deck2Name.replace(/[^a-z0-9]/gi, '_')}`;
      lines.push(`// Cards unique to ${data.deck2Name}`);
      data.unique2.forEach(n => lines.push(`1 ${n}`));
      break;
    case 'notOwned':
      filename = 'cards_not_owned';
      lines.push(`// Cards not owned (combined from ${data.deck1Name} + ${data.deck2Name})`);
      data.notOwned.forEach(n => lines.push(`1 ${n}`));
      break;
    case 'all':
      filename = 'compare_analysis';
      lines.push(`// Compare Analysis: ${data.deck1Name} vs ${data.deck2Name}\n`);
      lines.push(`// Shared (${data.shared.length})`);
      data.shared.forEach(n => lines.push(`1 ${n}`));
      lines.push(`\n// Unique to ${data.deck1Name} (${data.unique1.length})`);
      data.unique1.forEach(n => lines.push(`1 ${n}`));
      lines.push(`\n// Unique to ${data.deck2Name} (${data.unique2.length})`);
      data.unique2.forEach(n => lines.push(`1 ${n}`));
      lines.push(`\n// Not Owned (${data.notOwned.length})`);
      data.notOwned.forEach(n => lines.push(`1 ${n}`));
      break;
  }

  const blob = new Blob([lines.join('\n')], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${filename}.txt`;
  a.click();
  URL.revokeObjectURL(url);
}

// ═══════════════════════════════════════════════════════════
//  COLLECTION (My Decks)
// ═══════════════════════════════════════════════════════════
function renderCollection() {
  const container = document.getElementById('view-collection');
  const decks = Storage.getDecks();

  container.innerHTML = `
    <div class="collection-header">
      <h1>Collection</h1>
    </div>

    <div class="owned-section">
      <div class="owned-section__header">
        <h2>My Collection</h2>
        <span class="owned-section__count" id="owned-total-count"></span>
      </div>
      <p class="owned-section__subtitle">Search any Magic card and add it to your collection. Cards needed by your decks are highlighted so you can sort them out physically.</p>

      <div class="owned-section__search">
        <div class="collection-search__input-wrap">
          <svg class="collection-search__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          <input type="text" id="owned-scryfall-search" class="collection-search__input" placeholder="Search any card by name, type, set, or text..." oninput="debouncedOwnedSearch(this.value)">
          <button id="owned-scryfall-clear" class="collection-search__clear" onclick="clearOwnedScryfallSearch()" style="display:none">&times;</button>
        </div>
        <div id="owned-scryfall-results" class="collection-search__results"></div>
      </div>

      <div class="owned-section__divider"></div>

      <div class="owned-section__browser">
        <div class="owned-section__browser-header">
          <h3>Owned Cards</h3>
          <span class="owned-section__showing" id="owned-showing-count"></span>
        </div>
        <div class="owned-section__controls">
          <div class="collection-search__input-wrap" style="flex:1">
            <svg class="collection-search__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            <input type="text" id="owned-filter-input" class="collection-search__input" placeholder="Filter your collection..." oninput="filterOwnedCards(this.value)">
          </div>
        </div>
        <div class="owned-type-filters" id="owned-type-filters">
          <button class="filter-btn active" onclick="setOwnedTypeFilter(this, '')">All</button>
          <button class="filter-btn" onclick="setOwnedTypeFilter(this, 'Creatures')">Creatures</button>
          <button class="filter-btn" onclick="setOwnedTypeFilter(this, 'Instants')">Instants</button>
          <button class="filter-btn" onclick="setOwnedTypeFilter(this, 'Sorceries')">Sorceries</button>
          <button class="filter-btn" onclick="setOwnedTypeFilter(this, 'Enchantments')">Enchant</button>
          <button class="filter-btn" onclick="setOwnedTypeFilter(this, 'Artifacts')">Artifacts</button>
          <button class="filter-btn" onclick="setOwnedTypeFilter(this, 'Lands')">Lands</button>
          <button class="filter-btn" onclick="setOwnedTypeFilter(this, 'Planeswalkers')">Planes</button>
        </div>
        <div id="owned-cards-list" class="owned-cards-grid"></div>
      </div>
    </div>

    <div class="collection-header" style="margin-top:32px">
      <h2>My Decks</h2>
      <div style="display:flex;gap:10px">
        <button class="btn btn--primary btn--sm" onclick="createNewDeckFromCollection()">+ New Deck</button>
        <button class="btn btn--outline btn--sm" onclick="document.getElementById('import-file-collection').click()">Import .txt</button>
        <input type="file" id="import-file-collection" accept=".txt,.dec,.dek" style="display:none" onchange="importFromFile(this)">
      </div>
    </div>

    <div class="collection-search">
      <div class="collection-search__input-wrap">
        <svg class="collection-search__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        <input type="text" id="collection-card-search" class="collection-search__input" placeholder="Search cards across all decks..." oninput="searchCollectionCards(this.value)">
        <button id="collection-search-clear" class="collection-search__clear" onclick="clearCollectionSearch()" style="display:none">&times;</button>
      </div>
      <div id="collection-search-results" class="collection-search__results"></div>
    </div>

    <div class="decks-grid">
      <div class="deck-tile deck-tile--new" onclick="createNewDeckFromCollection()">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        <span>Create New Deck</span>
      </div>

      ${decks.map(d => {
        const totalCards = Storage.getDeckTotalCards(d);
        const totalPrice = Storage.getDeckTotalPrice(d);
        return `
          <div class="deck-tile" onclick="navigate('builder', { deckId: '${d.id}' })">
            <div class="deck-tile__name">${d.name}</div>
            <div class="deck-tile__format">${d.format}</div>
            <div class="deck-tile__stats">
              <span class="deck-tile__stat"><strong>${totalCards}</strong> cards</span>
              <span class="deck-tile__stat"><strong>${d.sideboard.length}</strong> side</span>
            </div>
            <div class="deck-tile__footer">
              <span class="deck-tile__price">$${totalPrice.toFixed(2)}</span>
              <div class="deck-tile__actions">
                <button class="deck-tile__btn" onclick="event.stopPropagation(); exportDeck('${d.id}')">Export</button>
                <button class="deck-tile__btn deck-tile__btn--delete" onclick="event.stopPropagation(); deleteDeckConfirm('${d.id}')">Delete</button>
              </div>
            </div>
          </div>
        `;
      }).join('')}
    </div>
  `;

  // Populate the owned cards browser after render
  renderOwnedCardsList();
}

function createNewDeckFromCollection() {
  const name = prompt('Deck name:', 'New Deck');
  if (!name) return;
  const deck = Storage.createDeck(name, 'standard');
  navigate('builder', { deckId: deck.id });
}

function deleteDeckConfirm(deckId) {
  if (confirm('Delete this deck?')) {
    Storage.deleteDeck(deckId);
    renderCollection();
  }
}

function exportDeck(deckId) {
  const deck = Storage.getDeck(deckId);
  if (!deck) return;
  let text = `// ${deck.name} (${deck.format})\n`;
  deck.cards.forEach(c => { text += `${c.qty} ${c.name}\n`; });
  if (deck.sideboard.length > 0) {
    text += `\n// Sideboard\n`;
    deck.sideboard.forEach(c => { text += `${c.qty} ${c.name}\n`; });
  }
  const blob = new Blob([text], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${deck.name.replace(/[^a-z0-9]/gi, '_')}.txt`;
  a.click();
  URL.revokeObjectURL(url);
}

// ═══════════════════════════════════════════════════════════
//  COLLECTION CARD SEARCH
// ═══════════════════════════════════════════════════════════
function searchCollectionCards(query) {
  const resultsContainer = document.getElementById('collection-search-results');
  const clearBtn = document.getElementById('collection-search-clear');
  if (!resultsContainer) return;

  query = query.trim().toLowerCase();
  clearBtn.style.display = query ? 'block' : 'none';

  if (!query) {
    resultsContainer.innerHTML = '';
    return;
  }

  const decks = Storage.getDecks();
  // Build a map: cardName → [{ deckName, deckId, qty, zone }]
  const cardMap = {};
  decks.forEach(deck => {
    deck.cards.forEach(c => {
      if (!c.name.toLowerCase().includes(query)) return;
      if (!cardMap[c.name]) cardMap[c.name] = { imageUrl: c.imageUrl, manaCost: c.manaCost, typeLine: c.typeLine, decks: [] };
      cardMap[c.name].decks.push({ deckName: deck.name, deckId: deck.id, qty: c.qty, zone: 'Main' });
    });
    deck.sideboard.forEach(c => {
      if (!c.name.toLowerCase().includes(query)) return;
      if (!cardMap[c.name]) cardMap[c.name] = { imageUrl: c.imageUrl, manaCost: c.manaCost, typeLine: c.typeLine, decks: [] };
      cardMap[c.name].decks.push({ deckName: deck.name, deckId: deck.id, qty: c.qty, zone: 'Side' });
    });
  });

  const entries = Object.entries(cardMap);
  if (entries.length === 0) {
    resultsContainer.innerHTML = `<div class="collection-search__empty">No cards found matching "${query}"</div>`;
    return;
  }

  // Sort alphabetically
  entries.sort((a, b) => a[0].localeCompare(b[0]));

  resultsContainer.innerHTML = entries.map(([name, info]) => {
    const escapedName = name.replace(/'/g, "\\'");
    const isOwned = Storage.isCardOwned(name);
    return `
    <div class="collection-search__card ${isOwned ? '' : 'collection-search__card--missing'}">
      <div class="collection-search__card-info">
        <div class="collection-search__owned ${isOwned ? 'owned' : ''}" onclick="event.stopPropagation(); toggleCollectionOwned('${escapedName}')" title="${isOwned ? 'Owned — click to unmark' : 'Click to mark as owned'}">&#10003;</div>
        ${info.imageUrl ? `<img class="collection-search__card-img" src="${info.imageUrl}" alt="${name}">` : ''}
        <div>
          <div class="collection-search__card-name">${name}</div>
          <div class="collection-search__card-type">${info.typeLine || ''}${info.manaCost ? ' · ' + Scryfall.renderMana(info.manaCost) : ''}</div>
        </div>
      </div>
      <div class="collection-search__card-decks">
        ${info.decks.map(d => `
          <span class="collection-search__deck-tag" onclick="event.stopPropagation(); navigate('builder', { deckId: '${d.deckId}' })">
            ${d.deckName} <span class="collection-search__deck-qty">${d.qty}x ${d.zone}</span>
          </span>
        `).join('')}
      </div>
    </div>
  `}).join('');
}

function toggleCollectionOwned(cardName) {
  // Try to get metadata from deck data for the card
  const decks = Storage.getDecks();
  let meta = null;
  for (const deck of decks) {
    const found = [...deck.cards, ...deck.sideboard].find(c => c.name === cardName);
    if (found) {
      meta = { typeLine: found.typeLine || '', manaCost: found.manaCost || '', imageUrl: found.imageUrl || '', price: found.price || null, colors: found.colors || [], cmc: found.cmc || 0 };
      break;
    }
  }
  Storage.toggleCardOwned(cardName, meta);
  const input = document.getElementById('collection-card-search');
  if (input && input.value) searchCollectionCards(input.value);
}

function clearCollectionSearch() {
  const input = document.getElementById('collection-card-search');
  if (input) { input.value = ''; input.focus(); }
  searchCollectionCards('');
}

// ═══════════════════════════════════════════════════════════
//  OWNED CARDS — Scryfall Search + Browser
// ═══════════════════════════════════════════════════════════

let _ownedSearchTimeout = null;
let _ownedTypeFilter = '';
let _ownedScryfallCache = {}; // cardId → card data for toggle

function debouncedOwnedSearch(query) {
  clearTimeout(_ownedSearchTimeout);
  _ownedSearchTimeout = setTimeout(() => searchScryfallForOwned(query), 350);
}

// Build a map of cardName → [{ deckName, deckId, qty, zone }] for all decks
function buildDeckNeedMap() {
  const decks = Storage.getDecks();
  const map = {};
  decks.forEach(deck => {
    deck.cards.forEach(c => {
      if (!map[c.name]) map[c.name] = [];
      map[c.name].push({ deckName: deck.name, deckId: deck.id, qty: c.qty, zone: 'Main' });
    });
    deck.sideboard.forEach(c => {
      if (!map[c.name]) map[c.name] = [];
      map[c.name].push({ deckName: deck.name, deckId: deck.id, qty: c.qty, zone: 'Side' });
    });
  });
  return map;
}

function getSetIconUrl(setCode) {
  return `https://svgs.scryfall.io/sets/${setCode}.svg`;
}

async function searchScryfallForOwned(query) {
  const resultsContainer = document.getElementById('owned-scryfall-results');
  const clearBtn = document.getElementById('owned-scryfall-clear');
  if (!resultsContainer) return;

  query = query.trim();
  clearBtn.style.display = query ? 'block' : 'none';

  if (!query || query.length < 2) {
    resultsContainer.innerHTML = '';
    return;
  }

  resultsContainer.innerHTML = `<div style="padding:8px">${Array(4).fill('<div class="skeleton skeleton-card"></div>').join('')}</div>`;
  try {
    const data = await Scryfall.search(query);
    if (!data.data || data.data.length === 0) {
      resultsContainer.innerHTML = '<div class="collection-search__empty">No cards found.</div>';
      return;
    }

    const deckNeedMap = buildDeckNeedMap();
    _ownedScryfallCache = {};
    data.data.slice(0, 25).forEach(c => { _ownedScryfallCache[c.id] = c; });

    resultsContainer.innerHTML = data.data.slice(0, 25).map(card => {
      const escapedName = card.name.replace(/'/g, "\\'");
      const isOwned = Storage.isCardOwned(card.name);
      const ownedQty = isOwned ? Storage.getOwnedCardQty(card.name) : 0;
      const neededIn = deckNeedMap[card.name] || [];
      const setName = card.set_name || '';
      const setCode = (card.set || '').toLowerCase();

      return `
        <div class="scryfall-result ${isOwned ? 'scryfall-result--owned' : ''}">
          ${isOwned ? `
            <div class="scryfall-result__qty-controls">
              <button class="owned-card__qty-btn" onclick="event.stopPropagation(); changeScryfallOwnedQty('${card.id}', -1)">-</button>
              <span class="scryfall-result__qty">${ownedQty}x</span>
              <button class="owned-card__qty-btn" onclick="event.stopPropagation(); changeScryfallOwnedQty('${card.id}', 1)">+</button>
            </div>
          ` : `
            <div class="scryfall-result__toggle" onclick="event.stopPropagation(); toggleScryfallOwned('${card.id}')" title="Add to collection">+</div>
          `}
          <img class="scryfall-result__img" src="${Scryfall.getSmallImage(card)}" alt="" loading="lazy" onclick="showCardDetailByName('${escapedName}')">
          <div class="scryfall-result__details">
            <div class="scryfall-result__name">${card.name}</div>
            <div class="scryfall-result__meta">
              <span class="scryfall-result__type">${card.type_line || ''}</span>
              ${card.mana_cost ? '<span class="scryfall-result__mana">' + Scryfall.renderMana(card.mana_cost) + '</span>' : ''}
            </div>
            <div class="scryfall-result__set">
              <img class="scryfall-result__set-icon" src="${getSetIconUrl(setCode)}" alt="${setCode}" onerror="this.style.display='none'">
              <span>${setName}</span>
              <span class="scryfall-result__rarity scryfall-result__rarity--${(card.rarity || '').toLowerCase()}">${card.rarity || ''}</span>
            </div>
            ${neededIn.length > 0 ? `
              <div class="scryfall-result__needed">
                <span class="scryfall-result__needed-label">Needed in:</span>
                ${neededIn.map(d => `
                  <span class="scryfall-result__needed-deck" onclick="event.stopPropagation(); navigate('builder', { deckId: '${d.deckId}' })">
                    ${d.deckName} <span class="collection-search__deck-qty">${d.qty}x</span>
                  </span>
                `).join('')}
              </div>
            ` : ''}
          </div>
          <span class="scryfall-result__price">${Scryfall.formatPrice(Scryfall.getPrice(card))}</span>
        </div>
      `;
    }).join('');
  } catch (err) {
    resultsContainer.innerHTML = '<div class="collection-search__empty">Search error. Try again.</div>';
  }
}

function cardMetaFromScryfall(card) {
  return {
    typeLine: card.type_line || '',
    manaCost: card.mana_cost || (card.card_faces?.[0]?.mana_cost) || '',
    setName: card.set_name || '',
    setCode: (card.set || '').toLowerCase(),
    rarity: card.rarity || '',
    imageUrl: Scryfall.getSmallImage(card),
    price: Scryfall.getPrice(card),
    colors: card.colors || card.color_identity || [],
    cmc: card.cmc || 0,
  };
}

function toggleScryfallOwned(cardId) {
  const card = _ownedScryfallCache[cardId];
  if (!card) return;
  const meta = cardMetaFromScryfall(card);
  Storage.toggleCardOwned(card.name, meta);
  rerenderScryfallResults();
  renderOwnedCardsList();
}

function changeScryfallOwnedQty(cardId, delta) {
  const card = _ownedScryfallCache[cardId];
  if (!card) return;
  const currentQty = Storage.getOwnedCardQty(card.name);
  const newQty = currentQty + delta;
  if (newQty <= 0) {
    Storage.setCardOwned(card.name, false);
  } else {
    Storage.setOwnedCardQty(card.name, newQty);
  }
  rerenderScryfallResults();
  renderOwnedCardsList();
}

function rerenderScryfallResults() {
  const input = document.getElementById('owned-scryfall-search');
  if (input && input.value) searchScryfallForOwned(input.value);
}

function clearOwnedScryfallSearch() {
  const input = document.getElementById('owned-scryfall-search');
  if (input) { input.value = ''; input.focus(); }
  const results = document.getElementById('owned-scryfall-results');
  if (results) results.innerHTML = '';
  const clearBtn = document.getElementById('owned-scryfall-clear');
  if (clearBtn) clearBtn.style.display = 'none';
}

function setOwnedTypeFilter(btn, type) {
  document.querySelectorAll('#owned-type-filters .filter-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  _ownedTypeFilter = type;
  renderOwnedCardsList();
}

function getTypeCategory(typeLine) {
  const t = (typeLine || '').toLowerCase();
  if (t.includes('creature')) return 'Creatures';
  if (t.includes('planeswalker')) return 'Planeswalkers';
  if (t.includes('battle')) return 'Battles';
  if (t.includes('instant')) return 'Instants';
  if (t.includes('sorcery')) return 'Sorceries';
  if (t.includes('enchantment')) return 'Enchantments';
  if (t.includes('artifact')) return 'Artifacts';
  if (t.includes('land')) return 'Lands';
  return 'Other';
}

function enrichOwnedFromDecks(richMap) {
  // Fill in empty metadata from deck card data
  const decks = Storage.getDecks();
  const deckCardMap = {};
  decks.forEach(deck => {
    [...deck.cards, ...deck.sideboard].forEach(c => {
      if (!deckCardMap[c.name]) deckCardMap[c.name] = c;
    });
  });
  let changed = false;
  for (const name of Object.keys(richMap)) {
    const meta = richMap[name];
    if (!meta.typeLine && deckCardMap[name]) {
      const dc = deckCardMap[name];
      richMap[name] = {
        typeLine: dc.typeLine || '',
        manaCost: dc.manaCost || '',
        imageUrl: dc.imageUrl || '',
        price: dc.price || null,
        colors: dc.colors || [],
        cmc: dc.cmc || 0,
        setName: meta.setName || '',
        setCode: meta.setCode || '',
        rarity: meta.rarity || '',
      };
      changed = true;
    }
  }
  if (changed) Storage.saveOwnedCardsRich(richMap);
  return richMap;
}

function renderOwnedCardsList() {
  const container = document.getElementById('owned-cards-list');
  const countEl = document.getElementById('owned-total-count');
  const showingEl = document.getElementById('owned-showing-count');
  if (!container) return;

  const richMap = enrichOwnedFromDecks(Storage.getOwnedCardsRich());
  const allNames = Object.keys(richMap).sort((a, b) => a.localeCompare(b));
  const totalQty = allNames.reduce((sum, name) => sum + ((richMap[name] || {}).qty || 1), 0);
  if (countEl) countEl.textContent = `${allNames.length} unique \u00b7 ${totalQty} total`;

  if (allNames.length === 0) {
    container.innerHTML = `
      <div class="owned-empty">
        <div class="owned-empty__icon">&#x1F4E6;</div>
        <div class="owned-empty__title">Your collection is empty</div>
        <div class="owned-empty__text">Use the search bar above to find cards and add them to your collection.</div>
      </div>
    `;
    if (showingEl) showingEl.textContent = '';
    return;
  }

  const filter = (document.getElementById('owned-filter-input')?.value || '').trim().toLowerCase();

  let filtered = allNames;
  if (filter) {
    filtered = filtered.filter(name => {
      const meta = richMap[name] || {};
      return name.toLowerCase().includes(filter)
        || (meta.typeLine || '').toLowerCase().includes(filter)
        || (meta.setName || '').toLowerCase().includes(filter);
    });
  }
  if (_ownedTypeFilter) {
    filtered = filtered.filter(name => {
      const meta = richMap[name] || {};
      return getTypeCategory(meta.typeLine) === _ownedTypeFilter;
    });
  }

  if (showingEl) {
    showingEl.textContent = filtered.length === allNames.length ? '' : `Showing ${filtered.length} of ${allNames.length}`;
  }

  if (filtered.length === 0) {
    container.innerHTML = `<div class="collection-search__empty">No cards match your filter.</div>`;
    return;
  }

  const deckNeedMap = buildDeckNeedMap();

  container.innerHTML = filtered.map(name => {
    const meta = richMap[name] || {};
    const escapedName = name.replace(/'/g, "\\'");
    const inDecks = deckNeedMap[name] || [];
    const setCode = (meta.setCode || '').toLowerCase();
    const category = getTypeCategory(meta.typeLine);

    const qty = meta.qty || 1;
    return `
      <div class="owned-card">
        ${meta.imageUrl ? `<img class="owned-card__img" src="${meta.imageUrl}" alt="" loading="lazy" onclick="showCardDetailByName('${escapedName}')">` : '<div class="owned-card__img-placeholder"></div>'}
        <div class="owned-card__info">
          <div class="owned-card__top">
            <div class="owned-card__name">${name}</div>
            ${meta.manaCost ? '<span class="owned-card__mana">' + Scryfall.renderMana(meta.manaCost) + '</span>' : ''}
          </div>
          <div class="owned-card__meta">
            <span class="owned-card__category owned-card__category--${category.toLowerCase()}">${category}</span>
            ${meta.setName ? `
              <span class="owned-card__set">
                <img class="owned-card__set-icon" src="${getSetIconUrl(setCode)}" alt="" onerror="this.style.display='none'">
                ${meta.setName}
              </span>
            ` : ''}
            ${meta.price ? `<span class="owned-card__price">$${parseFloat(meta.price).toFixed(2)}</span>` : ''}
          </div>
          ${inDecks.length > 0 ? `
            <div class="owned-card__decks">
              ${inDecks.map(d => `
                <span class="collection-search__deck-tag" onclick="event.stopPropagation(); navigate('builder', { deckId: '${d.deckId}' })">
                  ${d.deckName} <span class="collection-search__deck-qty">${d.qty}x ${d.zone}</span>
                </span>
              `).join('')}
            </div>
          ` : ''}
        </div>
        <div class="owned-card__qty-controls">
          <button class="owned-card__qty-btn" onclick="changeOwnedQty('${escapedName}', -1)">-</button>
          <span class="owned-card__qty">${qty}x</span>
          <button class="owned-card__qty-btn" onclick="changeOwnedQty('${escapedName}', 1)">+</button>
        </div>
        <button class="owned-card__remove" onclick="removeOwnedCard('${escapedName}')" title="Remove from collection">&times;</button>
      </div>
    `;
  }).join('');
}

function filterOwnedCards(query) {
  renderOwnedCardsList();
}

function changeOwnedQty(cardName, delta) {
  const currentQty = Storage.getOwnedCardQty(cardName);
  const newQty = currentQty + delta;
  if (newQty <= 0) {
    Storage.setCardOwned(cardName, false);
  } else {
    Storage.setOwnedCardQty(cardName, newQty);
  }
  renderOwnedCardsList();
}

function removeOwnedCard(cardName) {
  Storage.setCardOwned(cardName, false);
  renderOwnedCardsList();
}

// ═══════════════════════════════════════════════════════════
//  IMPORT FROM .TXT FILE
// ═══════════════════════════════════════════════════════════
function importFromFile(input) {
  const file = input.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    const text = e.target.result;
    const deckName = file.name.replace(/\.\w+$/, '').replace(/[_-]/g, ' ');
    importDeckFromText(text, deckName);
  };
  reader.readAsText(file);
  input.value = ''; // reset so same file can be re-imported
}

async function importDeckFromText(text, deckName) {
  const lines = text.split('\n').map(l => l.trim()).filter(l => l);

  // Parse lines: "qty name" or "qty x name" — skip comments and blank lines
  let mainCards = [];
  let sideboardCards = [];
  let inSideboard = false;
  let hasCommander = false;
  let commanderName = null;

  for (const line of lines) {
    // Skip comments
    if (line.startsWith('//') || line.startsWith('#')) {
      if (/sideboard/i.test(line)) inSideboard = true;
      if (/commander/i.test(line)) hasCommander = true;
      continue;
    }
    // Skip empty or section headers like "Deck" or "Sideboard"
    if (/^(deck|mainboard|main\s*deck)$/i.test(line)) { inSideboard = false; continue; }
    if (/^(sideboard|side\s*board|side)$/i.test(line)) { inSideboard = true; continue; }

    // Parse "qty name" or "qtyx name"
    const match = line.match(/^(\d+)\s*x?\s+(.+)$/i);
    if (!match) continue;

    const qty = parseInt(match[1], 10);
    const name = match[2].trim();
    if (!name || qty < 1) continue;

    const entry = { name, qty };
    if (inSideboard) {
      sideboardCards.push(entry);
    } else {
      mainCards.push(entry);
    }
  }

  if (mainCards.length === 0 && sideboardCards.length === 0) {
    showToast('No cards found. Expected format: "1 Card Name" per line.', 'error', 5000);
    return;
  }

  // Detect format from card count (100 cards = commander, 60 = standard/modern/pioneer)
  const totalMain = mainCards.reduce((s, c) => s + c.qty, 0);
  const format = totalMain >= 99 ? 'commander' : 'standard';

  // Create the deck
  const deck = Storage.createDeck(deckName || 'Imported Deck', format);

  // Show progress modal
  const modal = document.getElementById('card-detail-modal');
  const title = document.getElementById('card-detail-title');
  const body = document.getElementById('card-detail-body');
  modal.style.display = 'flex';
  title.textContent = `Importing "${deckName}"`;

  const allCards = [
    ...mainCards.map(c => ({ ...c, zone: 'cards' })),
    ...sideboardCards.map(c => ({ ...c, zone: 'sideboard' })),
  ];
  const total = allCards.length;
  let loaded = 0;
  let failed = [];

  body.innerHTML = `
    <div style="text-align:center;padding:20px">
      <p style="color:var(--color-heading);font-size:1rem;font-weight:700;margin-bottom:8px">Fetching card data from Scryfall...</p>
      <p style="color:var(--color-text-muted);font-size:.85rem" id="import-progress">0 / ${total} cards</p>
      <div style="background:var(--color-border);border-radius:4px;height:6px;margin-top:16px;overflow:hidden">
        <div id="import-progress-bar" style="background:var(--color-accent);height:100%;width:0%;transition:width .2s;border-radius:4px"></div>
      </div>
    </div>
  `;

  // Fetch cards from Scryfall in batches (respect rate limit)
  for (const entry of allCards) {
    try {
      const card = await Scryfall.getByFuzzyName(entry.name);
      const cardData = {
        name: card.name,
        qty: entry.qty,
        scryfallId: card.id,
        manaCost: card.mana_cost || (card.card_faces?.[0]?.mana_cost) || '',
        typeLine: card.type_line || '',
        price: Scryfall.getPrice(card),
        imageUrl: Scryfall.getSmallImage(card),
        colors: card.colors || card.color_identity || [],
        cmc: card.cmc || 0,
      };
      deck[entry.zone].push(cardData);
    } catch (err) {
      failed.push(entry.name);
      // Still add the card with minimal data so it shows up
      deck[entry.zone].push({
        name: entry.name,
        qty: entry.qty,
        scryfallId: '',
        manaCost: '',
        typeLine: '',
        price: null,
        imageUrl: '',
        colors: [],
        cmc: 0,
      });
    }
    loaded++;
    const pct = Math.round((loaded / total) * 100);
    const progressEl = document.getElementById('import-progress');
    const barEl = document.getElementById('import-progress-bar');
    if (progressEl) progressEl.textContent = `${loaded} / ${total} cards`;
    if (barEl) barEl.style.width = `${pct}%`;
  }

  deck.updatedAt = new Date().toISOString();
  Storage.saveDeck(deck);
  currentDeckId = deck.id;

  // Show completion
  body.innerHTML = `
    <div style="text-align:center;padding:20px">
      <div style="font-size:2.5rem;margin-bottom:12px">${failed.length === 0 ? '&#10003;' : '&#9888;'}</div>
      <p style="color:var(--color-heading);font-size:1.1rem;font-weight:700;margin-bottom:8px">
        ${failed.length === 0 ? 'Import Complete!' : 'Import Complete (with warnings)'}
      </p>
      <p style="color:var(--color-text-muted);font-size:.85rem;margin-bottom:4px">
        <strong>${deck.cards.length}</strong> mainboard cards, <strong>${deck.sideboard.length}</strong> sideboard cards
      </p>
      <p style="color:var(--color-text-muted);font-size:.85rem;margin-bottom:4px">
        Total: <strong>${totalMain + sideboardCards.reduce((s, c) => s + c.qty, 0)}</strong> cards &mdash; Format: <strong>${format}</strong>
      </p>
      <p style="color:var(--color-accent);font-size:1rem;font-weight:700;margin-bottom:16px">
        $${Storage.getDeckTotalPrice(deck).toFixed(2)} estimated value
      </p>
      ${failed.length > 0 ? `
        <div style="text-align:left;background:var(--color-bg);border:1px solid #cf6b6b4d;border-radius:var(--radius-sm);padding:12px;margin-bottom:16px">
          <p style="color:#cf6b6b;font-size:.82rem;font-weight:600;margin-bottom:6px">${failed.length} card(s) not found on Scryfall:</p>
          <p style="color:var(--color-text-muted);font-size:.78rem">${failed.join(', ')}</p>
        </div>
      ` : ''}
      <button class="btn btn--primary btn--sm" onclick="closeCardDetail(); navigate('builder', { deckId: '${deck.id}' });">Open Deck</button>
    </div>
  `;
}

// ═══════════════════════════════════════════════════════════
//  BACKUP & RESTORE
// ═══════════════════════════════════════════════════════════
function backupAllData() {
  const data = Storage.exportAll();
  const json = JSON.stringify(data, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const date = new Date().toISOString().slice(0, 10);
  a.download = `mtg-deck-builder-backup-${date}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

function restoreAllData(input) {
  const file = input.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const data = JSON.parse(e.target.result);
      const ownedCount = Array.isArray(data.ownedCards) ? data.ownedCards.length : Object.keys(data.ownedCards || {}).length;
      if (!confirm(`Restore backup from ${data.exportedAt || 'unknown date'}?\n\nThis contains ${(data.decks || []).length} deck(s) and ${ownedCount} owned card(s).\n\nThis will REPLACE all current data.`)) return;
      Storage.importAll(data);
      // Apply restored theme
      const settings = Storage.getSettings();
      if (settings.theme) {
        document.documentElement.setAttribute('data-theme', settings.theme);
        updateThemeIcon(settings.theme);
      }
      navigate(currentPage);
      showToast('Backup restored successfully!', 'success');
    } catch (err) {
      showToast('Invalid backup file: ' + err.message, 'error', 5000);
    }
  };
  reader.readAsText(file);
  input.value = '';
}
