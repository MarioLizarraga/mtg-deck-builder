/* ═══════════════════════════════════════════════════════════
   MTG Deck Builder — Main Application
   ═══════════════════════════════════════════════════════════ */

let currentPage = 'dashboard';
let currentDeckId = null;
let searchTimeout = null;
let globalSearchTimeout = null;

// ── Init ─────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  const settings = Storage.getSettings();
  if (settings.theme) {
    document.documentElement.setAttribute('data-theme', settings.theme);
    updateThemeIcon(settings.theme);
  }
  navigate('dashboard');

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
async function showCardDetail(cardId) {
  const modal = document.getElementById('card-detail-modal');
  const title = document.getElementById('card-detail-title');
  const body = document.getElementById('card-detail-body');
  modal.style.display = 'flex';
  title.textContent = 'Loading...';
  body.innerHTML = '<p class="gsearch__loading">Fetching card data...</p>';

  try {
    const card = await Scryfall.getById(cardId);
    title.textContent = card.name;
    const oracleText = card.oracle_text || card.card_faces?.map(f => f.oracle_text).join('\n\n---\n\n') || 'No text';
    const price = Scryfall.getPrice(card);

    // Build deck selector
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
          <div class="card-detail__actions">
            <select id="detail-deck-select" class="deck-info-bar__format">${deckOptions}</select>
            <button class="btn btn--primary btn--sm" onclick="addCardFromDetail('${card.id}')">Add to Deck</button>
          </div>
        </div>
      </div>
    `;
    // Store card data for adding
    window._lastDetailCard = card;
  } catch (err) {
    body.innerHTML = '<p class="gsearch__empty">Error loading card.</p>';
  }
}

async function addCardFromDetail(cardId) {
  const select = document.getElementById('detail-deck-select');
  const deckId = select?.value;
  if (!deckId) {
    alert('Create a deck first!');
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
  const totalCards = decks.reduce((s, d) => s + Storage.getDeckTotalCards(d), 0);
  const totalValue = decks.reduce((s, d) => s + Storage.getDeckTotalPrice(d), 0);
  const formats = [...new Set(decks.map(d => d.format))];

  container.innerHTML = `
    <div class="dashboard">
      <div class="dashboard__header">
        <h1>Welcome, Planeswalker</h1>
        <p>Your MTG deck building headquarters. Search cards, build decks, dominate the meta.</p>
      </div>

      <div class="dashboard__stats">
        <div class="stat-card stat-card--accent" onclick="navigate('collection')">
          <span class="stat-card__value">${decks.length}</span>
          <span class="stat-card__label">My Decks</span>
        </div>
        <div class="stat-card stat-card--blue" onclick="navigate('builder')">
          <span class="stat-card__value">${totalCards}</span>
          <span class="stat-card__label">Total Cards</span>
        </div>
        <div class="stat-card stat-card--green">
          <span class="stat-card__value">$${totalValue.toFixed(0)}</span>
          <span class="stat-card__label">Collection Value</span>
        </div>
        <div class="stat-card stat-card--red" onclick="navigate('meta')">
          <span class="stat-card__value">${MetaDecks.length}</span>
          <span class="stat-card__label">Meta Decks</span>
        </div>
      </div>

      <div class="dash-grid">
        <!-- Recent Decks -->
        <div class="dash-card">
          <div class="dash-card__header">
            <h3>My Decks</h3>
            <span class="dash-card__link" onclick="navigate('collection')">View all</span>
          </div>
          <div class="dash-card__body">
            ${decks.length === 0 ? '<p class="dash-card__empty">No decks yet. Create your first deck!</p>' : ''}
            ${decks.slice(0, 6).map(d => `
              <div class="dash-task" onclick="navigate('builder', { deckId: '${d.id}' })">
                <div class="dash-task__left">
                  <span class="dash-task__dot dash-task__dot--amber"></span>
                  <div>
                    <span class="dash-task__title">${d.name}</span>
                    <span class="dash-task__meta">${d.format} — ${Storage.getDeckTotalCards(d)} cards</span>
                  </div>
                </div>
                <div class="dash-task__right">
                  <span class="dash-task__price">$${Storage.getDeckTotalPrice(d).toFixed(0)}</span>
                  <span class="dash-task__badge dash-task__badge--amber">${d.format}</span>
                </div>
              </div>
            `).join('')}
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
            <div class="dash-quick" onclick="navigate('builder')">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>
              <div>
                <strong>Deck Builder</strong>
                <span>Search cards, drag & drop, build decks</span>
              </div>
            </div>
            <div class="dash-quick" onclick="navigate('meta')">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20"><path d="M12 20V10"/><path d="M18 20V4"/><path d="M6 20v-4"/></svg>
              <div>
                <strong>Meta Decks 2025-2026</strong>
                <span>Championship-winning decklists & prices</span>
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

        <!-- Format Breakdown -->
        <div class="dash-card">
          <div class="dash-card__header">
            <h3>Format Breakdown</h3>
          </div>
          <div class="dash-card__body">
            ${['Standard', 'Pioneer', 'Modern', 'Commander', 'Legacy'].map(fmt => {
              const count = decks.filter(d => d.format === fmt).length;
              const metaCount = MetaDecks.filter(d => d.format === fmt).length;
              return `
                <div class="dash-task">
                  <div class="dash-task__left">
                    <span class="dash-task__dot dash-task__dot--blue"></span>
                    <div>
                      <span class="dash-task__title">${fmt}</span>
                      <span class="dash-task__meta">${count} deck${count !== 1 ? 's' : ''} built</span>
                    </div>
                  </div>
                  <div class="dash-task__right">
                    <span class="dash-task__badge dash-task__badge--blue">${metaCount} meta</span>
                  </div>
                </div>
              `;
            }).join('')}
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

  // Group cards by category
  const categories = {};
  deck.cards.forEach(card => {
    const cat = Scryfall.getCategory(card);
    if (!categories[cat]) categories[cat] = [];
    categories[cat].push(card);
  });

  const categoryOrder = ['Creatures', 'Instants', 'Sorceries', 'Planeswalkers', 'Enchantments', 'Artifacts', 'Lands', 'Other'];

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
        </div>
      </div>

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
            ${categoryOrder.filter(cat => categories[cat]).map(cat => `
              <div class="deck-section">
                <div class="deck-section__header" onclick="this.nextElementSibling.style.display = this.nextElementSibling.style.display === 'none' ? '' : 'none'">
                  <h3>${cat}</h3>
                  <span class="deck-section__count">${categories[cat].reduce((s, c) => s + (c.qty || 1), 0)}</span>
                </div>
                <div class="deck-section__body" ondragover="event.preventDefault(); this.classList.add('deck-section__body--drop-target')" ondragleave="this.classList.remove('deck-section__body--drop-target')" ondrop="handleDeckDrop(event, '${deck.id}'); this.classList.remove('deck-section__body--drop-target')">
                  ${categories[cat].map(card => renderDeckCard(card, deck.id, 'cards')).join('')}
                </div>
              </div>
            `).join('')}

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
  return `
    <div class="deck-card" draggable="true" ondragstart="event.dataTransfer.setData('text/plain', '${card.name}')">
      <span class="deck-card__qty">${card.qty}x</span>
      <span class="deck-card__name" onclick="showCardDetailByName('${card.name.replace(/'/g, "\\'")}')">${card.name}</span>
      <span class="deck-card__mana">${Scryfall.renderMana(card.manaCost)}</span>
      <span class="deck-card__price">${card.price ? '$' + parseFloat(card.price).toFixed(2) : '—'}</span>
      <div class="deck-card__actions">
        <button class="deck-card__btn" onclick="addOneMore('${deckId}', '${card.name.replace(/'/g, "\\'")}', '${zone}')">+</button>
        <button class="deck-card__btn deck-card__btn--remove" onclick="removeOne('${deckId}', '${card.name.replace(/'/g, "\\'")}', '${zone}')">-</button>
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

  resultsContainer.innerHTML = '<p class="gsearch__loading">Searching Scryfall...</p>';
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
        <button class="search-card__add" onclick="addCardFromSearch('${card.id}')">+</button>
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
async function addCardFromSearch(cardId) {
  if (!currentDeckId) return;
  const card = window._searchResults?.[cardId];
  if (card) {
    Storage.addCardToDeck(currentDeckId, card, 'cards');
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
  try {
    const card = await Scryfall.getByName(name);
    showCardDetail(card.id);
  } catch {
    alert('Card not found.');
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
  alert(`"${meta.name}" imported! Open it from Deck Builder or Collection.`);
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

    results.innerHTML += `
      <div class="dash-card" style="grid-column:span 2">
        <div class="dash-card__header">
          <h3>Analysis</h3>
        </div>
        <div class="dash-card__body" style="padding:16px">
          <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:16px;text-align:center;margin-bottom:16px">
            <div><span style="color:var(--color-heading);font-size:1.5rem;font-weight:800">${shared.length}</span><br><span style="color:var(--color-text-muted);font-size:.75rem">Shared Cards</span></div>
            <div><span style="color:#6cabcf;font-size:1.5rem;font-weight:800">${unique1.length}</span><br><span style="color:var(--color-text-muted);font-size:.75rem">Unique to ${deck1.name}</span></div>
            <div><span style="color:#6bcf8e;font-size:1.5rem;font-weight:800">${unique2.length}</span><br><span style="color:var(--color-text-muted);font-size:.75rem">Unique to ${deck2.name}</span></div>
          </div>
          ${shared.length > 0 ? `<p style="color:var(--color-text-muted);font-size:.8rem"><strong style="color:var(--color-heading)">Shared:</strong> ${shared.join(', ')}</p>` : ''}
        </div>
      </div>
    `;
  }
}

// ═══════════════════════════════════════════════════════════
//  COLLECTION (My Decks)
// ═══════════════════════════════════════════════════════════
function renderCollection() {
  const container = document.getElementById('view-collection');
  const decks = Storage.getDecks();

  container.innerHTML = `
    <div class="collection-header">
      <h1>My Decks</h1>
      <button class="btn btn--primary btn--sm" onclick="createNewDeckFromCollection()">+ New Deck</button>
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
