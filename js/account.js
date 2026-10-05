/* =========================================================================
 * Local accounts + fighter avatar params (no backend; localStorage only).
 * -------------------------------------------------------------------------
 * Profile (stored as SAK.Storage.state.profile, versioned):
 *   { v: 2, id, name, createdAt, phrase,
 *     avatar: { body, hairStyle, hairColor, skin, eyes, eyeColor, accessory, shirt } }
 * `avatar` is the single source for the player's look: SAK.Account.toLook()
 * turns it into the `look` used by the 3D Fighter (Scene3D.applyAvatar) and
 * the SVG portraits (SAK.avatarSVG).
 * Future hook: an "Upload PFP → AI fighter" feature only needs to return an
 * `avatar` object with these keys (see SAK.Account.fromPfp stub).
 * ========================================================================= */
window.SAK = window.SAK || {};

SAK.Account = (function () {
  const VERSION = 2;
  const OPTIONS = {
    body: [
      { id: 'classic', label: 'Classic' }, { id: 'chonk', label: 'Chonk' }, { id: 'gymbro', label: 'Gym Bro' },
      { id: 'noodle', label: 'Noodle' }, { id: 'smol', label: 'Smol' }
    ],
    hairStyle: [
      { id: 'short', label: 'Short' }, { id: 'buzz', label: 'Buzz' }, { id: 'spiky', label: 'Spiky' }, { id: 'mohawk', label: 'Mohawk' },
      { id: 'long', label: 'Long' }, { id: 'afro', label: 'Afro' }, { id: 'bun', label: 'Bun' }, { id: 'bald', label: 'Bald' }
    ],
    eyes: [
      { id: 'round', label: 'Round' }, { id: 'big', label: 'Big' }, { id: 'sleepy', label: 'Sleepy' },
      { id: 'angry', label: 'Angry' }, { id: 'dot', label: 'Dot' }
    ],
    accessory: [
      { id: 'headband', label: 'Headband' }, { id: 'none', label: 'None' }, { id: 'cap', label: 'Cap' }, { id: 'shades', label: 'Shades' },
      { id: 'crown', label: 'Crown' }, { id: 'headphones', label: 'Cans' }, { id: 'beanie', label: 'Beanie' }, { id: 'visor', label: 'Visor' },
      { id: 'laser', label: 'Laser eyes' }, { id: 'tophat', label: 'Top hat' }, { id: 'unicorn', label: 'Unicorn' }
    ],
    skin: ['#ffe0c4', '#f6c9a0', '#f2c49b', '#e0a77a', '#c98b5f', '#a8714d', '#7a4a2e', '#9fd3ff', '#b6ff9f'],
    hairColor: ['#1a1a1a', '#3b2416', '#7a4a24', '#ffcf33', '#e9e9f5', '#ff5a36', '#22c3ff', '#ff7ad9', '#39ff88'],
    eyeColor: ['#1a1a1a', '#3a6fd8', '#2e9e4f', '#7a4a24', '#9b5cff', '#ff3b5c', '#ffd23f'],
    shirt: ['#2f80ff', '#ff4fa3', '#2ee6a6', '#ffe23d', '#ff7a1a', '#9b5cff', '#ff3b5c', '#1f1f2e', '#39ff88', '#ffffff']
  };
  const ids = k => OPTIONS[k].map(o => (typeof o === 'string' ? o : o.id));
  const pick = a => a[Math.floor(Math.random() * a.length)];

  function defaultAvatar() {
    const L = SAK.PLAYER.look;
    return { body: 'classic', hairStyle: 'short', hairColor: L.hair, skin: L.skin, eyes: 'round', eyeColor: '#1a1a1a', accessory: L.accessory, shirt: L.shirt };
  }

  /** Clamp any (possibly old / hand-edited) avatar to valid values. */
  function sanitize(a) {
    const d = defaultAvatar(), out = {};
    a = a || {};
    const hex = v => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v);
    const PICK = ['body', 'hairStyle', 'eyes', 'accessory'];
    for (const k of ['body', 'hairStyle', 'hairColor', 'skin', 'eyes', 'eyeColor', 'accessory', 'shirt']) {
      out[k] = PICK.includes(k) ? (ids(k).includes(a[k]) ? a[k] : d[k]) : (hex(a[k]) ? a[k] : d[k]);
    }
    return out;
  }

  function randomAvatar() {
    return {
      body: pick(ids('body')), hairStyle: pick(ids('hairStyle')), hairColor: pick(OPTIONS.hairColor), skin: pick(OPTIONS.skin),
      eyes: pick(ids('eyes')), eyeColor: pick(OPTIONS.eyeColor), accessory: pick(ids('accessory')), shirt: pick(OPTIONS.shirt)
    };
  }

  /** Avatar params → `look` consumed by Scene3D Fighter + SAK.avatarSVG. */
  function toLook(avatar) {
    const a = sanitize(avatar);
    return {
      skin: a.skin, shirt: a.shirt, hair: a.hairColor, pants: SAK.PLAYER.look.pants, accessory: a.accessory,
      accent: a.accessory === 'laser' ? '#ff1a1a' : a.accessory === 'crown' ? '#ffd23f' : '#ffffff',
      body: a.body, hairStyle: a.hairStyle, eyes: a.eyes, eyeColor: a.eyeColor
    };
  }

  function newId() { return 'acct_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

  function create(name, avatar, phrase) {
    return { v: VERSION, id: newId(), name, createdAt: Date.now(), phrase: phrase || '', avatar: sanitize(avatar) };
  }

  /**
   * Upgrade an old save's fighter ({ name, colour, phrase }) into a v2 profile.
   * `lookFromName` keeps the face/hair the old build hashed from the name.
   */
  function migrate(state, lookFromName) {
    const p = state.profile;
    if (!p) return false;
    if (p.v === VERSION && p.avatar) { p.avatar = sanitize(p.avatar); return false; }
    const L = lookFromName ? lookFromName(p.name || 'YOU', p.colour || SAK.PLAYER.look.shirt) : {};
    state.profile = {
      v: VERSION, id: p.id || newId(), name: p.name || 'YOU', createdAt: p.createdAt || Date.now(), phrase: p.phrase || '',
      avatar: sanitize(Object.assign(defaultAvatar(), { skin: L.skin, hairColor: L.hair, shirt: p.colour, accessory: 'headband' }))
    };
    return true;
  }

  /** Player name: 2–16 chars after trimming / collapsing spaces. */
  function validateName(raw) {
    const t = String(raw || '').replace(/\s+/g, ' ').trim();
    if (t.length < 2) return { err: 'min 2 characters' };
    if (t.length > 16) return { err: 'max 16 characters' };
    return { ok: t };
  }

  /** FUTURE: AI reads an uploaded PFP and returns avatar params. Not built yet. */
  function fromPfp(/* imageFile */) { return Promise.reject(new Error('AI fighter from PFP: coming soon')); }

  return { VERSION, OPTIONS, defaultAvatar, sanitize, randomAvatar, toLook, create, migrate, validateName, fromPfp };
})();
