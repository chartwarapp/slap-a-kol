/* =========================================================================
 * Slap-a-KOL — KOL ROSTER (edit me!)
 * -------------------------------------------------------------------------
 * Plain data array: add / remove / rename entries freely, no other code
 * changes needed. Order = progression order in the picker.
 * Required fields: id (unique), name, handle, level, tagline, difficulty
 * (1-5), hp, power, accuracy (0-1), winPts, minBet, payout, look{}, taunts[].
 * ========================================================================= */
window.SAK = window.SAK || {};

/* ---- KOL roster ---------------------------------------------------------
 * PARODY characters loosely inspired by well-known crypto-Twitter personas,
 * with altered names, cartoon looks and invented handles. Jokes riff on public
 * meme personas only — nothing here is a factual claim about anyone.
 *
 * winPts = PTS for a (free) win. payout = optional-bet multiplier.
 * minBet = smallest PTS bet allowed vs this KOL.
 * difficulty 1..5 → meter speed + AI accuracy. `accuracy` (0..1) drives the AI
 * timing roll. `look` drives both the 3D model and the SVG portrait.
 * accessory: shades | cap | crown | laser | headphones | tophat | beanie | visor | unicorn | headband */
SAK.PARODY_DISCLAIMER = 'All KOLs are fictional parody cartoons. Not affiliated with, endorsed by, or depicting any real person.';

SAK.KOLS = [
  {
    id: 'ansom', name: 'Ansom', handle: '@BottomCallerAnsom', level: 1,
    tagline: 'Calls the bottom. Then calls it again. And again.',
    difficulty: 1, hp: 60, power: 8, accuracy: 0.35, winPts: 100, minBet: 100, payout: 1.6,
    look: { skin: '#f6c9a0', shirt: '#1f1f2e', hair: '#2a1a10', pants: '#3a3a52', accessory: 'cap', accent: '#ffffff' },
    taunts: ['This is the bottom. Probably.', 'Send it. 🚀', 'I\'m bullish on your face.']
  },
  {
    id: 'kobee', name: 'Kobee', handle: '@UpOnlySlaps', level: 2,
    tagline: 'Retired from posting. Un-retired just to slap you.',
    difficulty: 2, hp: 85, power: 11, accuracy: 0.45, winPts: 160, minBet: 100, payout: 1.8,
    look: { skin: '#f2c49b', shirt: '#ff7a1a', hair: '#7a4a24', pants: '#2b2b44', accessory: 'headphones', accent: '#222222' },
    taunts: ['UpOnly? More like SlapOnly.', 'Season 2 of this slap: coming soon™.', 'Hold on, I\'m recording this.']
  },
  {
    id: 'pentoshy', name: 'Pentoshy', handle: '@PenguinCharts', level: 3,
    tagline: 'A chart-drawing penguin. Speaks only in trendlines.',
    difficulty: 2, hp: 110, power: 13, accuracy: 0.55, winPts: 230, minBet: 100, payout: 2.0,
    look: { skin: '#e9f1ff', shirt: '#111a2e', hair: '#0b0f1a', pants: '#111a2e', accessory: 'beanie', accent: '#ffb000' },
    taunts: ['Higher timeframe says: slap.', 'Bullish divergence on my palm.', 'Zoom out. Still slapping.']
  },
  {
    id: 'murrad', name: 'Murrad', handle: '@SupercycleSlap', level: 4,
    tagline: 'Preaching the memecoin supercycle, one slap at a time.',
    difficulty: 3, hp: 130, power: 15, accuracy: 0.62, winPts: 320, minBet: 250, payout: 2.2,
    look: { skin: '#d9a37a', shirt: '#2ee6a6', hair: '#1b1029', pants: '#0f3d3a', accessory: 'shades', accent: '#111111' },
    taunts: ['It\'s a supercycle, ser.', 'Cult slaps only.', 'Your bags are not ready.']
  },
  {
    id: 'arthurhaze', name: 'Arthur Haze', handle: '@EssaysAndSlaps', level: 5,
    tagline: 'Drops a 10,000-word macro essay between slaps.',
    difficulty: 3, hp: 155, power: 18, accuracy: 0.7, winPts: 420, minBet: 250, payout: 2.4,
    look: { skin: '#f0c8a8', shirt: '#9b5cff', hair: '#1a1a1a', pants: '#2b1b4f', accessory: 'tophat', accent: '#ffd23f' },
    taunts: ['Long volatility. Short your HP.', 'Chapter 37: The Slap Printer.', 'Money printer goes slap.']
  },
  {
    id: 'tolly', name: 'Tolly', handle: '@400msSlaps', level: 6,
    tagline: 'Runs on 400ms blocks. Chews glass. Slaps faster.',
    difficulty: 4, hp: 180, power: 20, accuracy: 0.76, winPts: 540, minBet: 500, payout: 2.6,
    look: { skin: '#f4c7a1', shirt: '#14f195', hair: '#3b2416', pants: '#3a1f6b', accessory: 'visor', accent: '#9945ff' },
    taunts: ['Sub-second finality on your cheek.', 'Chewing glass, serving slaps.', 'Throughput: one slap per block.']
  },
  {
    id: 'mikesailor', name: 'Mike Sailor', handle: '@NoSecondBestSlap', level: 7,
    tagline: 'Laser eyes. Infinite conviction. Zero chill.',
    difficulty: 4, hp: 200, power: 22, accuracy: 0.82, winPts: 680, minBet: 500, payout: 2.8,
    look: { skin: '#f0b98f', shirt: '#ff9500', hair: '#cfcfd8', pants: '#1a1a2a', accessory: 'laser', accent: '#ff1a1a' },
    taunts: ['There is no second-best slap.', 'I just bought more slaps.', 'Laser-focused on your cheek. 👁👁']
  },
  {
    id: 'vitaleek', name: 'Vitaleek', handle: '@UltrasoundSlap', level: 8,
    tagline: 'Galaxy-brained unicorn whisperer. Final boss.',
    difficulty: 5, hp: 240, power: 25, accuracy: 0.88, winPts: 850, minBet: 1000, payout: 3.0,
    look: { skin: '#f6d2b4', shirt: '#ff7ad9', hair: '#c9a46b', pants: '#2a2a40', accessory: 'unicorn', accent: '#ffffff' },
    taunts: ['Have you considered a layer-2 slap?', 'Ultrasound slap incoming.', 'Gas-efficient palm deployed.']
  }
];
