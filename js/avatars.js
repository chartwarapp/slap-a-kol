/* =========================================================================
 * Procedural SVG portraits (used in HUD + KOL cards). Same `look` object as
 * the 3D model so colours always match.
 * ========================================================================= */
window.SAK = window.SAK || {};

SAK.avatarSVG = function (look, opts) {
  opts = opts || {};
  const bg = opts.bg || look.shirt;
  const s = look.skin, h = look.hair, a = look.accent || '#111';
  const dead = !!opts.ko;

  const ec = look.eyeColor || '#222', es = look.eyes || 'round';
  let eyes;
  if (dead) eyes = `<g stroke="#222" stroke-width="3" stroke-linecap="round">
         <path d="M33 45l8 8M41 45l-8 8"/><path d="M59 45l8 8M67 45l-8 8"/></g>`;
  else if (es === 'dot') eyes = `<circle cx="37" cy="49" r="4" fill="${ec}"/><circle cx="63" cy="49" r="4" fill="${ec}"/>`;
  else if (es === 'big') eyes = `<circle cx="37" cy="49" r="8.5" fill="#fff"/><circle cx="63" cy="49" r="8.5" fill="#fff"/>
       <circle cx="38" cy="50" r="4.5" fill="${ec}"/><circle cx="62" cy="50" r="4.5" fill="${ec}"/>`;
  else eyes = `<circle cx="37" cy="49" r="6" fill="#fff"/><circle cx="63" cy="49" r="6" fill="#fff"/>
       <circle cx="38" cy="50" r="${es === 'angry' ? 2.4 : 3}" fill="${ec}"/><circle cx="62" cy="50" r="${es === 'angry' ? 2.4 : 3}" fill="${ec}"/>`
       + (es === 'sleepy' ? `<path d="M30 49a7 7 0 0 1 14 0Z" fill="${s}"/><path d="M56 49a7 7 0 0 1 14 0Z" fill="${s}"/>` : '');
  const brows = es === 'angry' ? `<path d="M30 39l12 5M70 39l-12 5" stroke="${h}" stroke-width="3.5" stroke-linecap="round"/>`
    : `<path d="M30 40l12 2M70 40l-12 2" stroke="${h}" stroke-width="3.5" stroke-linecap="round"/>`;

  // hair (KOLs without hairStyle keep the classic cap)
  let hs = look.hairStyle || 'short';
  if (['cap', 'beanie', 'tophat'].includes(look.accessory) && ['spiky', 'mohawk', 'afro', 'bun'].includes(hs)) hs = 'short';
  const capPath = `<path d="M20 46 Q22 16 50 16 Q78 16 80 46 Q66 30 50 32 Q34 30 20 46Z" fill="${h}"/>`;
  let hairBack = '', hairFront = '';
  switch (hs) {
    case 'bald': break;
    case 'buzz': hairFront = `<path d="M22 42 Q24 20 50 20 Q76 20 78 42 Q66 31 50 32 Q34 31 22 42Z" fill="${h}" opacity="0.9"/>`; break;
    case 'spiky': hairFront = capPath + `<path d="M24 32 L28 10 L37 24 L44 4 L50 20 L57 4 L63 24 L72 10 L76 32Z" fill="${h}"/>`; break;
    case 'mohawk': hairFront = `<path d="M43 34 L44 4 L50 0 L56 4 L57 34Z" fill="${h}"/>`; break;
    case 'long': hairBack = `<path d="M18 46 Q16 86 26 92 L74 92 Q84 86 82 46Z" fill="${h}"/>`; hairFront = capPath; break;
    case 'afro': hairBack = `<circle cx="50" cy="36" r="34" fill="${h}"/>`; hairFront = `<path d="M22 44 Q24 22 50 24 Q76 22 78 44 Q66 32 50 34 Q34 32 22 44Z" fill="${h}"/>`; break;
    case 'bun': hairFront = capPath + `<circle cx="50" cy="12" r="9" fill="${h}"/>`; break;
    default: hairFront = capPath;
  }
  const sw = { chonk: [10, 90], gymbro: [8, 92], noodle: [26, 74], smol: [20, 80] }[look.body] || [18, 82];

  let acc = '';
  switch (look.accessory) {
    case 'shades':
      acc = `<rect x="25" y="42" width="22" height="12" rx="4" fill="${a}"/><rect x="53" y="42" width="22" height="12" rx="4" fill="${a}"/><rect x="45" y="45" width="10" height="3" fill="${a}"/>`; break;
    case 'cap':
      acc = `<path d="M22 36 Q50 4 78 36 Z" fill="${look.shirt}" stroke="#0003" stroke-width="2"/><rect x="50" y="31" width="38" height="7" rx="3" fill="${look.shirt}" stroke="#0003" stroke-width="2"/>`; break;
    case 'crown':
      acc = `<path d="M28 30 L32 12 L41 24 L50 8 L59 24 L68 12 L72 30 Z" fill="${a}" stroke="#a87b00" stroke-width="2"/>`; break;
    case 'laser':
      acc = `<path d="M37 50 L2 70" stroke="#ff1a1a" stroke-width="4"/><path d="M63 50 L98 70" stroke="#ff1a1a" stroke-width="4"/><circle cx="37" cy="50" r="5" fill="#ff1a1a"/><circle cx="63" cy="50" r="5" fill="#ff1a1a"/>`; break;
    case 'headphones':
      acc = `<path d="M20 52 Q20 14 50 14 Q80 14 80 52" fill="none" stroke="${a}" stroke-width="6"/><rect x="13" y="44" width="12" height="20" rx="5" fill="${a}"/><rect x="75" y="44" width="12" height="20" rx="5" fill="${a}"/>`; break;
    case 'tophat':
      acc = `<rect x="22" y="26" width="56" height="6" rx="2" fill="#111"/><rect x="32" y="2" width="36" height="26" rx="2" fill="#111"/><rect x="32" y="20" width="36" height="5" fill="${a}"/>`; break;
    case 'beanie':
      acc = `<path d="M23 38 Q50 0 77 38 Z" fill="${a}"/><rect x="21" y="32" width="58" height="9" rx="4" fill="#fff"/><circle cx="50" cy="12" r="6" fill="#fff"/>`; break;
    case 'visor':
      acc = `<rect x="22" y="40" width="56" height="14" rx="7" fill="${a}" opacity="0.9"/><rect x="26" y="43" width="20" height="4" rx="2" fill="#fff8"/>`; break;
    case 'unicorn':
      acc = `<path d="M44 22 L56 22 L52 -2 Z" fill="${a}" stroke="#0004" stroke-width="2"/><path d="M45 15h10M46 8h7" stroke="#fff8" stroke-width="2"/>`; break;
    case 'headband':
      acc = `<rect x="22" y="30" width="56" height="8" rx="3" fill="#ff3b3b"/>`; break;
  }

  const mouth = dead
    ? `<ellipse cx="50" cy="70" rx="7" ry="5" fill="#5a1a1a"/>`
    : `<path d="M40 67 Q50 75 60 67" stroke="#5a1a1a" stroke-width="3" fill="none" stroke-linecap="round"/>`;

  return `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" class="avatar-svg">
    <rect width="100" height="100" rx="18" fill="${bg}"/>
    <rect y="80" width="100" height="20" fill="#0002"/>
    ${hairBack}
    <path d="M${sw[0]} 100 Q50 72 ${sw[1]} 100 Z" fill="${look.shirt}" stroke="#0003" stroke-width="2"/>
    <circle cx="50" cy="50" r="30" fill="${s}" stroke="#0003" stroke-width="2"/>
    ${hairFront}
    <circle cx="24" cy="54" r="5" fill="${s}" stroke="#0002" stroke-width="2"/>
    <circle cx="76" cy="54" r="5" fill="${s}" stroke="#0002" stroke-width="2"/>
    ${eyes}
    ${brows}
    <ellipse cx="50" cy="59" rx="4" ry="3" fill="#0002"/>
    ${mouth}
    ${opts.blush ? '<ellipse cx="68" cy="62" rx="9" ry="6" fill="#ff2d2d" opacity="0.55"/>' : ''}
    ${acc}
  </svg>`;
};
