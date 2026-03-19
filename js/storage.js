/* ═══════════════════════════════════════════════════════════
   Local Storage — Deck persistence
   ═══════════════════════════════════════════════════════════ */

const Storage = (() => {
  const DECKS_KEY = 'mtg_decks';
  const SETTINGS_KEY = 'mtg_settings';
  const OWNED_KEY = 'mtg_owned_cards';

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
    return deck;
  }

  function deleteDeck(id) {
    saveDecks(getDecks().filter(d => d.id !== id));
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
  }

  // ── Owned Cards ────────────────────────────────────────
  function getOwnedCards() {
    try {
      return new Set(JSON.parse(localStorage.getItem(OWNED_KEY)) || []);
    } catch { return new Set(); }
  }

  function saveOwnedCards(owned) {
    localStorage.setItem(OWNED_KEY, JSON.stringify([...owned]));
  }

  function isCardOwned(cardName) {
    return getOwnedCards().has(cardName);
  }

  function toggleCardOwned(cardName) {
    const owned = getOwnedCards();
    if (owned.has(cardName)) owned.delete(cardName);
    else owned.add(cardName);
    saveOwnedCards(owned);
    return owned.has(cardName);
  }

  function setCardOwned(cardName, isOwned) {
    const owned = getOwnedCards();
    if (isOwned) owned.add(cardName);
    else owned.delete(cardName);
    saveOwnedCards(owned);
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

  return {
    getDecks, saveDecks, getDeck, saveDeck, deleteDeck, createDeck,
    addCardToDeck, removeCardFromDeck,
    getDeckTotalCards, getDeckTotalPrice,
    getSettings, saveSettings,
    getOwnedCards, saveOwnedCards, isCardOwned, toggleCardOwned, setCardOwned, getDeckOwnedCount,
  };
})();
