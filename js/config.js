/* =========================================================================
 * Slap-a-KOL — static game configuration
 * -------------------------------------------------------------------------
 * Everything tunable lives here: the KOL roster, economy numbers and the
 * power-meter zones. All KOLs are fictional parody characters.
 * Exposed on the global `SAK` namespace (no build step / no modules, so the
 * game also runs straight from file://).
 * ========================================================================= */
window.SAK = window.SAK || {};

/* ---- Economy overview -----------------------------------------------------
 *  POINTS ONLY (for now). Every number in the game is in-game PTS:
 *  FREE TO PLAY : every match is free and awards PTS (play-to-earn).
 *  OPTIONAL BET : wager PTS on a match for a bigger PTS payout.
 *  STAKE VAULT  : lock PTS to earn PTS yield + a reward boost tier.
 *  UPGRADES     : HEALTH / POWER / Golden Fist are bought with PTS.
 *  The "Connect Wallet" button is a MOCK Solana placeholder only — no token
 *  balances exist yet. See README → "Where a token plugs in later".      */
SAK.POINTS = {
  symbol: 'PTS',
  welcomeBonus: 1000,      // granted once on first launch
  rescueAmount: 300,       // "broke bonus" so players never soft-lock
  rescueThreshold: 100     // rescue available below this balance
};

/* Placeholder for the future on-chain integration (unused today). */
SAK.SOLANA = { enabled: false, cluster: 'devnet', tokenMint: null, vaultProgramId: null };

/* Bet options shown before a fight (0 = free match), in PTS. */
SAK.BETS = [0, 100, 250, 500, 1000, 2500];

/* Free-match point rewards. Win = kol.winPts + bonuses; loss still pays a
 * little so free players always progress. */
SAK.POINT_REWARDS = { lossBase: 10, perHitLanded: 3, perPerfect: 10, streakPct: 0.1, streakCap: 5 };

/* Stake Vault (mock, PTS). APR accrues continuously; `demoTimeScale` speeds
 * up time so yield is visible in a prototype (1440 => 1 real minute = 1 day).
 * Boost tiers multiply PTS earned from wins AND bet payouts. */
SAK.STAKING = {
  apr: 0.36,
  demoTimeScale: 1440,
  tiers: [
    { min: 0,     name: 'None',    boost: 0,    color: '#a49bc4' },
    { min: 500,   name: 'Bronze',  boost: 0.10, color: '#d9884a' },
    { min: 2000,  name: 'Silver',  boost: 0.25, color: '#d6dbe8' },
    { min: 5000,  name: 'Gold',    boost: 0.50, color: '#ffd23f' },
    { min: 15000, name: 'Diamond', boost: 1.00, color: '#7ae8ff' }
  ]
};

/* ---- Player base stats + upgrade economy --------------------------------- */
SAK.PLAYER = {
  name: 'YOU',
  baseHp: 100,
  hpPerLevel: 20,
  basePower: 12,
  powerPerLevel: 3,
  maxUpgradeLevel: 10,
  look: { skin: '#f2c49b', shirt: '#2f80ff', hair: '#3b2416', pants: '#1d2a4d', accessory: 'headband', accent: '#ffffff' }
};

SAK.UPGRADES = {
  health: { label: 'HEALTH', icon: '❤', baseCost: 120, growth: 1.55 },
  power:  { label: 'POWER',  icon: '✊', baseCost: 150, growth: 1.55 }
};

/* Shop v1: permanent upgrades = HEALTH + POWER only (bought with PTS).
 *
 * POWER-UPS: limited-use consumables shown on the right rail during a fight.
 * Each can be activated once per fight. If you own none, tapping buys one
 * for `cost` PTS and activates it. Golden Fist also refills 1 free per day. */
SAK.POWERUPS = {
  fist:   { id: 'fist',   icon: '🔥', name: 'GOLDEN FIST', cost: 150, max: 5,
            desc: 'Next landed slap x2.5, never whiffs (kept if braced)', mult: 2.5, freePerDay: 1 },
  helmet: { id: 'helmet', icon: '⛑', name: 'HELMET',      cost: 120, max: 5,
            desc: 'Next 2 slaps you take: -50% dmg', hits: 2, damageMult: 0.5 },
  rage:   { id: 'rage',   icon: '😤', name: 'DEGEN RAGE',  cost: 100, max: 5,
            desc: 'Next 3 slaps +40% dmg, meter +25% faster', slaps: 3, damageMult: 1.4, meterMult: 1.25 }
};
SAK.FIRE_FIST = SAK.POWERUPS.fist;   // back-compat alias

/* ---- Power meter --------------------------------------------------------
 * The needle sweeps -90°..+90° (triangle wave). |angle| decides the grade.
 * Zones are symmetric around the centre (green = perfect).                */
SAK.METER = {
  zones: [
    { id: 'perfect', maxAngle: 10, mult: 1.75, color: '#2ee66b', label: 'BASED SLAP!' },
    { id: 'good',    maxAngle: 30, mult: 1.0,  color: '#ffe23d', label: 'SOLID PUMP!' },
    { id: 'weak',    maxAngle: 56, mult: 0.5,  color: '#ff9a1f', label: 'PAPER HANDS' },
    { id: 'miss',    maxAngle: 90, mult: 0,    color: '#ff3b3b', label: 'NGMI!' }
  ],
  baseSpeed: 150,       // degrees per second for difficulty 1
  speedPerDifficulty: 30
};

/* Bet reward formula (PTS; on win, only if a bet was placed):
 *   payout = (bet * kol.payout
 *          + bet * perfectBonus * min(perfects, perfectBonusCap)
 *          + bet * streakBonus  * min(streakBeforeWin, streakBonusCap)) * (1 + vaultBoost)
 * On loss the bet (escrowed when the fight starts) is forfeited. */
SAK.REWARDS = { perfectBonus: 0.05, perfectBonusCap: 5, streakBonus: 0.05, streakBonusCap: 5 };

/* ---- Match modes (private per-device meter) ------------------------------
 * classic : best of 5 round challenges (first to 3).
 * duel    : best of 3 round challenges (first to 2).
 * Each round: each player only sees THEIR meter (ATTACK or BRACE); both use
 * jerky speed. Closer to the green centre wins the exchange.              */
SAK.MODES = {
  classic: { id: 'classic', label: 'CLASSIC KO', icon: '🥊', desc: 'Best of 5 · closer to green wins each round', ptsMult: 1, bestOf: 5 },
  duel:    { id: 'duel',    label: 'QUICK DUEL', icon: '⚡', desc: 'Best of 3 · closer to green wins each round', ptsMult: 0.5, bestOf: 3 }
};

/* Private-meter challenge tuning. Tie-break: attacker wins when equally close.
 * Both ATTACK and BRACE use jerky unpredictable speed on each device. */
SAK.CHALLENGE = {
  tieBreak: 'attacker',          // equal dist → attacker takes the round
  defenderSpeed: 170,            // seed for brace (also jerky; kept for tuning)
  attackerBaseSpeed: 170,        // seed speed before jerky jumps
  jerkyMin: 70,
  jerkyMax: 340,
  jerkyInterval: [0.10, 0.38],   // seconds between speed/dir jerks
  aiLockDelay: [0.55, 1.35],     // AI thinks then locks
  windowMs: 4500                 // soft timeout before auto-resolve nudge
};

/* Degen copy pools (English only; loud meme energy, still readable). */
SAK.COPY = {
  winTitles: ['BASED!', 'WAGMI!', 'GIGA PUMP!', 'NUMBER GO UP!'],
  loseTitles: ['NGMI…', 'REKT!', 'RUGGED!', 'LIQUIDATED!'],
  winSubs: ['{k} got slapped straight into the bear market. 📉', '{k} is now exit liquidity. 💀', 'Chart says: {k} DUMPED. 📉', '{k} has been sent to zero. Few understand.', '{k} just got margin-called by your palm. 🖐', 'Slapped {k} so hard their bags went to zero.'],
  loseSubs: ['{k}: “{t}”', 'You got farmed by {k}. Cope & seethe.', 'Down bad. {k} ate your cheeks.', 'Your portfolio and your face: both red. 📕', 'Cheeks rugged. Have fun staying poor (jk, run it back).'],
  missTaunts: ['NGMI with that aim 😜', 'Paper-handed swing, ser.', 'Was that a slap or a gm?', 'Skill issue. 📉']
};

/* Legacy brace ring (kept for reference). Private per-device meter replaced it:
 * each player locks their own meter; closer-to-centre decides the round. */
SAK.BRACE = { window: 0.28, damageMult: 0.5 };

/* ---- KOL roster lives in js/roster.js (easy to edit) ---------------- */

/* ---- User-submitted KOLs ----------------------------------------------
 * Players design their own parody KOL. Slots unlock with LIFETIME PTS earned.
 * Stats are derived from the chosen difficulty (see SAK.customKolStats).    */
SAK.UGC = {
  slotMilestones: [0, 500, 1500, 3000, 6000],   // slot N unlocks at this lifetime PTS
  maxName: 16, maxCatchphrase: 60,
  palettes: {
    skin:  ['#ffe0c4', '#f6c9a0', '#e0a77a', '#c98b5f', '#a8714d', '#7a4a2e', '#9fd3ff', '#b6ff9f'],
    shirt: ['#ff4fa3', '#2f80ff', '#2ee6a6', '#ffe23d', '#ff7a1a', '#9b5cff', '#ff3b5c', '#1f1f2e'],
    hair:  ['#1a1a1a', '#3b2416', '#7a4a24', '#ffcf33', '#e9e9f5', '#ff5a36', '#22c3ff', '#ff7ad9']
  },
  accessories: ['cap', 'shades', 'crown', 'headphones', 'tophat', 'beanie', 'visor', 'laser', 'unicorn', 'none'],
  // tiny starter blocklist — real moderation would happen server-side
  blocklist: ['nazi', 'hitler', 'rape', 'kill yourself', 'kys', 'retard', 'nigger', 'faggot']
};

/** Derive fight stats for a user-made KOL from difficulty 1..5. */
SAK.customKolStats = function (d) {
  d = Math.max(1, Math.min(5, d | 0));
  return {
    difficulty: d,
    hp: 60 + (d - 1) * 45,
    power: 8 + (d - 1) * 4,
    accuracy: +(0.35 + (d - 1) * 0.13).toFixed(2),
    winPts: 100 + (d - 1) * 180,
    minBet: [100, 100, 250, 500, 1000][d - 1],
    payout: +(1.6 + (d - 1) * 0.35).toFixed(2)
  };
};
