/* =========================================================================
 * Matchmaking — STUB.
 * -------------------------------------------------------------------------
 * Design target: live player-vs-player challenges with an optional PTS wager.
 * Prototype behaviour: there is no server, so we list fake "online" players,
 * pretend to search / wait for an accept, then FALL BACK TO AN AI STAND-IN
 * built from that player's profile. The AI fight path never blocks on this.
 *
 * Later: replace listOnline() / findMatch() with a realtime backend
 * (WebSocket / Supabase Realtime / Colyseus). The server should own the RNG,
 * validate slap timings (anti-cheat) and escrow wagers. Interface:
 *   listOnline()                                  -> Promise<Player[]>
 *   findMatch({ target, wager, mode }, onStatus)  -> Promise<{ live, opponent }>
 *   cancel()
 * ========================================================================= */
window.SAK = window.SAK || {};

SAK.Matchmaking = (function () {
  const NAMES = ['gm_sniper.sol', 'ser_slapsalot', 'wenlambo420', 'paperhands_pete', 'diamondpalm', 'apeintoslap', 'rektangle', 'bagholder_bob',
    'cheekmaxxer', 'fudbuster', 'exitliq_ellie', 'mintmaxi', 'slapoor', 'touchgrass_tom', 'ngmi_nico', 'whalecheeks'];
  const ACC = ['cap', 'shades', 'beanie', 'headphones', 'visor', 'crown', 'laser', 'tophat', 'none'];
  let timer = 0, cancelled = false, online = null;
  const pick = a => a[Math.floor(Math.random() * a.length)];

  function fakePlayer(name) {
    const P = SAK.UGC.palettes, d = 1 + Math.floor(Math.random() * 4);
    return {
      name, rank: ['Shrimp', 'Crab', 'Dolphin', 'Shark', 'Whale'][d], difficulty: d,
      wins: 5 + Math.floor(Math.random() * 400), winRate: 35 + Math.floor(Math.random() * 40),
      status: Math.random() < 0.75 ? 'online' : 'in-match',
      look: { skin: pick(P.skin), shirt: pick(P.shirt), hair: pick(P.hair), pants: '#2a2a40', accessory: pick(ACC), accent: '#ff1a1a' }
    };
  }

  /** Turn a player profile into an AI opponent ("stand-in") for the fight engine. */
  function standIn(p) {
    return Object.assign({
      id: 'pvp_' + p.name, name: p.name, handle: '@' + p.name, level: 'PVP', pvp: true,
      tagline: `${p.rank} · ${p.winRate}% win rate — AI stand-in while they're AFK`,
      look: p.look,
      taunts: ['gm. prepare to get slapped.', 'ratio + slapped', 'my cheeks have diamond hands', 'imagine losing to an AI stand-in lol']
    }, SAK.customKolStats(Math.min(5, p.difficulty)));
  }

  return {
    listOnline() {
      if (!online) online = NAMES.slice().sort(() => Math.random() - 0.5).slice(0, 7).map(fakePlayer);
      return Promise.resolve(online);
    },
    /** Pretend to find/await a live opponent, then fall back to an AI stand-in. */
    findMatch(opts, onStatus) {
      cancelled = false;
      return new Promise(resolve => {
        const target = opts.target || fakePlayer(pick(NAMES));
        const steps = opts.target
          ? [`Pinging ${target.name}…`, `Waiting for ${target.name} to accept…`, `${target.name} is AFK (probably staring at charts)`]
          : ['Scanning the mempool for degens…', 'Finding opponent…', 'No live slappers online rn…'];
        let i = 0;
        const tick = () => {
          if (cancelled) return;
          if (i < steps.length) { onStatus && onStatus(steps[i++], false); timer = setTimeout(tick, 1100); }
          else { onStatus && onStatus('🤖 AI stand-in deployed. SEND IT!', true); timer = setTimeout(() => !cancelled && resolve({ live: false, opponent: standIn(target) }), 800); }
        };
        tick();
      });
    },
    cancel() { cancelled = true; clearTimeout(timer); }
  };
})();
