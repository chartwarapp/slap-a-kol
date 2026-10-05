/* =========================================================================
 * Persistence (localStorage). One JSON blob under a versioned key.
 * ========================================================================= */
window.SAK = window.SAK || {};

SAK.Storage = (function () {
  const KEY = 'slapakol.save.v1';

  function defaults() {
    return {
      wallet: { connected: false, address: null, provider: 'mock' },
      points: 0,                       // PTS — the only currency (for now)
      welcomeGranted: false,           // welcome bonus is granted once
      staking: { amount: 0, since: null, accrued: 0 },  // Stake Vault (PTS)
      upgrades: { health: 0, power: 0 },
      powerups: { fist: 0, helmet: 1, rage: 1 },   // consumable inventory (starter pack)
      lastFreeFistDate: null,          // YYYY-MM-DD of last daily free Golden Fist
      stats: { wins: 0, losses: 0, streak: 0, bestStreak: 0, perfects: 0, biggestHit: 0, lifetimePts: 0 },
      beaten: {},                      // kolId -> true
      customKols: [],
      profile: null,                   // player fighter { name, colour, phrase } (null = not created yet)                  // user-submitted parody KOLs (see SAK.UGC)
      settings: { sound: true, haptics: true }
    };
  }

  // Deep-merge saved data over defaults so new fields survive old saves.
  function merge(base, saved) {
    if (!saved || typeof saved !== 'object') return base;
    for (const k of Object.keys(base)) {
      if (saved[k] === undefined) continue;
      if (base[k] && typeof base[k] === 'object' && !Array.isArray(base[k])) {
        base[k] = merge(base[k], saved[k]);
      } else {
        base[k] = saved[k];
      }
    }
    // keep dynamic maps (e.g. beaten) entirely
    if (saved.beaten) base.beaten = Object.assign({}, saved.beaten);
    if (Array.isArray(saved.customKols)) base.customKols = saved.customKols.slice();
    if (saved.profile) base.profile = Object.assign({}, saved.profile);
    return base;
  }

  let state = defaults();

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      state = merge(defaults(), raw ? JSON.parse(raw) : null);
    } catch (e) {
      console.warn('[SAK] could not load save, starting fresh', e);
      state = defaults();
    }
    return state;
  }

  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(state)); }
    catch (e) { console.warn('[SAK] could not save', e); }
  }

  function reset() {
    state = defaults();
    save();
    return state;
  }

  return { load, save, reset, get state() { return state; } };
})();
