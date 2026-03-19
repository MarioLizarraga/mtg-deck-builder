/* ═══════════════════════════════════════════════════════════
   Scryfall API Integration
   Free API — no auth required. Rate limit: 50ms between requests.
   ═══════════════════════════════════════════════════════════ */

const Scryfall = (() => {
  const BASE = 'https://api.scryfall.com';
  let lastRequest = 0;

  async function throttledFetch(url) {
    const now = Date.now();
    const wait = Math.max(0, 100 - (now - lastRequest));
    if (wait > 0) await new Promise(r => setTimeout(r, wait));
    lastRequest = Date.now();
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Scryfall ${res.status}`);
    return res.json();
  }

  // Search cards by name (autocomplete)
  async function autocomplete(query) {
    if (!query || query.length < 2) return [];
    const data = await throttledFetch(`${BASE}/cards/autocomplete?q=${encodeURIComponent(query)}`);
    return data.data || [];
  }

  // Full search with filters
  async function search(query, page = 1) {
    if (!query || query.length < 2) return { data: [], has_more: false, total_cards: 0 };
    const data = await throttledFetch(`${BASE}/cards/search?q=${encodeURIComponent(query)}&page=${page}&order=name`);
    return data;
  }

  // Get card by exact name
  async function getByName(name) {
    const data = await throttledFetch(`${BASE}/cards/named?exact=${encodeURIComponent(name)}`);
    return data;
  }

  // Get card by fuzzy name
  async function getByFuzzyName(name) {
    const data = await throttledFetch(`${BASE}/cards/named?fuzzy=${encodeURIComponent(name)}`);
    return data;
  }

  // Get card by Scryfall ID
  async function getById(id) {
    const data = await throttledFetch(`${BASE}/cards/${id}`);
    return data;
  }

  // Get card image URL
  function getImageUrl(card, size = 'normal') {
    if (card.image_uris) return card.image_uris[size] || card.image_uris.normal;
    if (card.card_faces && card.card_faces[0].image_uris) {
      return card.card_faces[0].image_uris[size] || card.card_faces[0].image_uris.normal;
    }
    return '';
  }

  // Get small image for lists
  function getSmallImage(card) {
    return getImageUrl(card, 'small');
  }

  // Get price from card data
  function getPrice(card) {
    if (!card.prices) return null;
    return card.prices.usd || card.prices.usd_foil || null;
  }

  // Format price
  function formatPrice(price) {
    if (!price) return '—';
    return `$${parseFloat(price).toFixed(2)}`;
  }

  // Parse mana cost into symbols
  function parseMana(manaCost) {
    if (!manaCost) return [];
    return manaCost.match(/\{([^}]+)\}/g)?.map(s => s.replace(/[{}]/g, '')) || [];
  }

  // Render mana symbols as HTML
  function renderMana(manaCost) {
    const symbols = parseMana(manaCost);
    if (!symbols.length) return '';
    return `<span class="mana">${symbols.map(s => {
      const cls = ['W','U','B','R','G','C'].includes(s) ? `mana-${s}` : 'mana-num';
      return `<span class="mana-sym ${cls}">${s}</span>`;
    }).join('')}</span>`;
  }

  // Get card type category for deck sections
  function getCategory(card) {
    const typeLine = (card.type_line || '').toLowerCase();
    if (typeLine.includes('creature')) return 'Creatures';
    if (typeLine.includes('instant')) return 'Instants';
    if (typeLine.includes('sorcery')) return 'Sorceries';
    if (typeLine.includes('planeswalker')) return 'Planeswalkers';
    if (typeLine.includes('enchantment')) return 'Enchantments';
    if (typeLine.includes('artifact')) return 'Artifacts';
    if (typeLine.includes('land')) return 'Lands';
    return 'Other';
  }

  // Get color identity dot class
  function getColorDot(card) {
    const colors = card.colors || card.color_identity || [];
    if (colors.length === 0) return 'dash-task__dot--white';
    if (colors.length > 1) return 'dash-task__dot--multi';
    const map = { W: 'white', U: 'blue', B: 'black', R: 'red', G: 'green' };
    return `dash-task__dot--${map[colors[0]] || 'white'}`;
  }

  return {
    autocomplete, search, getByName, getByFuzzyName, getById,
    getImageUrl, getSmallImage, getPrice, formatPrice,
    parseMana, renderMana, getCategory, getColorDot
  };
})();
