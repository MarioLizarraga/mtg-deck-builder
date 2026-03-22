/* ═══════════════════════════════════════════════════════════
   Local Storage — Deck persistence
   ═══════════════════════════════════════════════════════════ */

const Storage = (() => {
  const DECKS_KEY = 'mtg_decks';
  const SETTINGS_KEY = 'mtg_settings';
  const OWNED_KEY = 'mtg_owned_cards';

  // Sync hook — called after each write if set
  let _onWrite = null;
  function setWriteHook(fn) { _onWrite = fn; }

  function getDecks() {
    try {
      return JSON.parse(localStorage.getItem(DECKS_KEY)) || [];
    } catch { return []; }
  }

  function saveDecks(decks) {
    localStorage.setItem(DECKS_KEY, JSON.stringify(decks));
  }

  function getDeck(id) {
    return getDecks().find(d => d.id === id) || null;
  }

  function saveDeck(deck) {
    const decks = getDecks();
    const idx = decks.findIndex(d => d.id === deck.id);
    if (idx >= 0) decks[idx] = deck;
    else decks.push(deck);
    saveDecks(decks);
    if (_onWrite) _onWrite('deck:save', deck);
    return deck;
  }

  function deleteDeck(id) {
    saveDecks(getDecks().filter(d => d.id !== id));
    if (_onWrite) _onWrite('deck:delete', id);
  }

  function createDeck(name = 'New Deck', format = 'standard') {
    const deck = {
      id: 'deck_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
      name,
      format,
      cards: [],       // { name, qty, scryfallId, manaCost, typeLine, price, imageUrl }
      sideboard: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    return saveDeck(deck);
  }

  function addCardToDeck(deckId, card, zone = 'cards') {
    const deck = getDeck(deckId);
    if (!deck) return null;
    const list = deck[zone];
    const existing = list.find(c => c.name === card.name);
    if (existing) {
      existing.qty = (existing.qty || 1) + 1;
    } else {
      list.push({
        name: card.name,
        qty: 1,
        scryfallId: card.id,
        manaCost: card.mana_cost || (card.card_faces?.[0]?.mana_cost) || '',
        typeLine: card.type_line || '',
        price: Scryfall.getPrice(card),
        imageUrl: Scryfall.getSmallImage(card),
        colors: card.colors || card.color_identity || [],
        cmc: card.cmc || 0,
      });
    }
    deck.updatedAt = new Date().toISOString();
    return saveDeck(deck);
  }

  function removeCardFromDeck(deckId, cardName, zone = 'cards') {
    const deck = getDeck(deckId);
    if (!deck) return null;
    const list = deck[zone];
    const idx = list.findIndex(c => c.name === cardName);
    if (idx >= 0) {
      if (list[idx].qty > 1) list[idx].qty--;
      else list.splice(idx, 1);
    }
    deck.updatedAt = new Date().toISOString();
    return saveDeck(deck);
  }

  function getDeckTotalCards(deck) {
    return (deck.cards || []).reduce((s, c) => s + (c.qty || 1), 0);
  }

  function getDeckTotalPrice(deck) {
    const mainPrice = (deck.cards || []).reduce((s, c) => s + (parseFloat(c.price) || 0) * (c.qty || 1), 0);
    const sidePrice = (deck.sideboard || []).reduce((s, c) => s + (parseFloat(c.price) || 0) * (c.qty || 1), 0);
    return mainPrice + sidePrice;
  }

  function getSettings() {
    try {
      return JSON.parse(localStorage.getItem(SETTINGS_KEY)) || { theme: 'dark' };
    } catch { return { theme: 'dark' }; }
  }

  function saveSettings(settings) {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    if (_onWrite) _onWrite('settings:save', settings);
  }

  // ── Owned Cards ────────────────────────────────────────
  // Owned cards stored as { name: { typeLine, manaCost, setName, setCode, imageUrl, price, colors, cmc } }
  // Backward compatible: old format was string[] of names
  function getOwnedCards() {
    try {
      const raw = JSON.parse(localStorage.getItem(OWNED_KEY)) || [];
      // Old format: array of strings → convert to Set
      if (Array.isArray(raw)) {
        const set = new Set();
        raw.forEach(item => set.add(typeof item === 'string' ? item : item));
        return set;
      }
      return new Set(Object.keys(raw));
    } catch { return new Set(); }
  }

  function getOwnedCardsRich() {
    try {
      const raw = JSON.parse(localStorage.getItem(OWNED_KEY)) || [];
      // Old format: array of strings → convert to map with empty metadata
      if (Array.isArray(raw)) {
        const map = {};
        raw.forEach(item => {
          if (typeof item === 'string') map[item] = {};
        });
        return map;
      }
      return raw;
    } catch { return {}; }
  }

  function saveOwnedCardsRich(map) {
    localStorage.setItem(OWNED_KEY, JSON.stringify(map));
    if (_onWrite) _onWrite('owned:save', map);
  }

  function saveOwnedCards(owned) {
    // Convert Set to rich map, preserving existing metadata
    const existing = getOwnedCardsRich();
    const map = {};
    owned.forEach(name => { map[name] = existing[name] || {}; });
    saveOwnedCardsRich(map);
  }

  function isCardOwned(cardName) {
    return getOwnedCards().has(cardName);
  }

  function toggleCardOwned(cardName, meta) {
    const map = getOwnedCardsRich();
    if (map[cardName] !== undefined) {
      delete map[cardName];
      saveOwnedCardsRich(map);
      return false;
    } else {
      map[cardName] = meta || {};
      saveOwnedCardsRich(map);
      return true;
    }
  }

  function setCardOwned(cardName, isOwned, meta) {
    const map = getOwnedCardsRich();
    if (isOwned) {
      map[cardName] = meta || map[cardName] || {};
    } else {
      delete map[cardName];
    }
    saveOwnedCardsRich(map);
  }

  function setOwnedCardQty(cardName, qty) {
    const map = getOwnedCardsRich();
    if (map[cardName] === undefined) return;
    if (qty <= 0) {
      delete map[cardName];
    } else {
      map[cardName].qty = qty;
    }
    saveOwnedCardsRich(map);
  }

  function getOwnedCardQty(cardName) {
    const map = getOwnedCardsRich();
    if (map[cardName] === undefined) return 0;
    return map[cardName].qty || 1;
  }

  function getDeckOwnedCount(deck) {
    const owned = getOwnedCards();
    let have = 0, missing = 0;
    for (const c of (deck.cards || [])) {
      if (owned.has(c.name)) have += (c.qty || 1);
      else missing += (c.qty || 1);
    }
    for (const c of (deck.sideboard || [])) {
      if (owned.has(c.name)) have += (c.qty || 1);
      else missing += (c.qty || 1);
    }
    return { have, missing };
  }

  // ── Backup & Restore ────────────────────────────────────
  function exportAll() {
    return {
      version: 1,
      exportedAt: new Date().toISOString(),
      decks: getDecks(),
      ownedCards: getOwnedCardsRich(),
      settings: getSettings(),
    };
  }

  function importAll(data) {
    if (!data || data.version !== 1) throw new Error('Invalid backup file');
    if (data.decks) saveDecks(data.decks);
    if (data.ownedCards) {
      // Support both old format (string[]) and new format (object map)
      if (Array.isArray(data.ownedCards)) {
        const map = {};
        data.ownedCards.forEach(name => { if (typeof name === 'string') map[name] = {}; });
        saveOwnedCardsRich(map);
      } else {
        saveOwnedCardsRich(data.ownedCards);
      }
    }
    if (data.settings) saveSettings(data.settings);
  }

  return {
    setWriteHook,
    getDecks, saveDecks, getDeck, saveDeck, deleteDeck, createDeck,
    addCardToDeck, removeCardFromDeck,
    getDeckTotalCards, getDeckTotalPrice,
    getSettings, saveSettings,
    getOwnedCards, getOwnedCardsRich, saveOwnedCards, saveOwnedCardsRich, isCardOwned, toggleCardOwned, setCardOwned, setOwnedCardQty, getOwnedCardQty, getDeckOwnedCount,
    exportAll, importAll,
  };
})();
