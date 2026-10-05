/* =========================================================================
 * Leaderboards — LOCAL PROTOTYPE.
 * -------------------------------------------------------------------------
 * GLOBAL : seeded fake degens persisted in localStorage + YOU (ranked by
 *          lifetime PTS). Seeds drift up a little each visit to feel alive.
 * FRIENDS: stub list of fake friends + you. "Invite" copies a share link.
 * Later: swap global()/friends() for API calls (e.g. Supabase table with
 * server-validated scores; friends via invite codes or wallet follows).
 * ========================================================================= */
window.SAK = window.SAK || {};

SAK.Leaderboard = (function () {
  const KEY = 'slapakol.leaderboard.v1';
  const GLOBAL_NAMES = ['cheekmaxxer', 'gm_sniper.sol', 'wenlambo420', 'diamondpalm', 'rektangle', 'slapoor', 'fudbuster', 'whalecheeks',
    'apeintoslap', 'exitliq_ellie', 'mintmaxi', 'paperhands_pete', 'ngmi_nico', 'touchgrass_tom', 'bagholder_bob', 'ser_slapsalot',
    'pumpamentals', 'copium_carl', 'hopium_hannah', 'degen_dana'];
  const FRIEND_NAMES = ['your_cousin_kev', 'gm_gabby', 'liquidated_luke', 'moonboy_mo', 'hodl_hailey', 'rugpull_ron'];

  function seeded() {
    let data = null;
    try { data = JSON.parse(localStorage.getItem(KEY)); } catch (e) { data = null; }
    if (!data || !Array.isArray(data.global)) {
      data = {
        global: GLOBAL_NAMES.map((n, i) => ({ name: n, pts: Math.round(9000 / (i * 0.45 + 1) + Math.random() * 400), wins: Math.round(120 / (i * 0.3 + 1)) })),
        friends: FRIEND_NAMES.map(n => ({ name: n, pts: Math.round(Math.random() * 1800), wins: Math.round(Math.random() * 25), online: Math.random() < 0.5 })),
        lastVisit: Date.now()
      };
    } else {
      // simulate other players grinding since the last visit
      const mins = Math.min(600, (Date.now() - (data.lastVisit || Date.now())) / 60000);
      data.global.forEach(e => { if (Math.random() < 0.6) { e.pts += Math.round(Math.random() * mins * 3); e.wins += Math.random() < mins / 30 ? 1 : 0; } });
      data.friends.forEach(e => { e.online = Math.random() < 0.5; });
      data.lastVisit = Date.now();
    }
    localStorage.setItem(KEY, JSON.stringify(data));
    return data;
  }

  function withMe(list, me) {
    return list.map(e => Object.assign({}, e)).concat([Object.assign({ me: true, online: true }, me)])
      .sort((a, b) => b.pts - a.pts).map((e, i) => Object.assign(e, { rank: i + 1 }));
  }

  return {
    /** @param me { name, pts, wins } */
    global(me) { return withMe(seeded().global, me); },
    friends(me) { return withMe(seeded().friends, me); },
    inviteLink() { return location.href.split('#')[0] + '#invite=' + Math.random().toString(36).slice(2, 8); }
  };
})();
