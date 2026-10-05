/* =========================================================================
 * 3D arena + low-poly fighters (Three.js r158, classic script build).
 * -------------------------------------------------------------------------
 * Layout (world space):
 *   - table centred at origin, long axis on X
 *   - PLAYER stands at z=+0.8 facing -z (back three-quarters to camera)
 *   - KOL    stands at z=-0.8 facing +z (face towards camera)
 *   - camera sits front-right so both faces/slapping arms read clearly
 * Public API (SAK.Scene3D): init, setPlayer, setOpponent, resetFight,
 *   slap, knockout, setFireArmed, setBrace, screenPos, setMode
 * ========================================================================= */
window.SAK = window.SAK || {};

/* ------------------------------------------------------------------ tween */
SAK.Ease = {
  linear: t => t,
  inCubic: t => t * t * t,
  outCubic: t => 1 - Math.pow(1 - t, 3),
  inOutQuad: t => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2),
  outBack: t => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); }
};

SAK.Tween = (function () {
  let list = [];
  /** Animate numeric props of `obj` to `to` over `dur` seconds. Returns a Promise. */
  function to(obj, target, dur, ease) {
    return new Promise(resolve => {
      const from = {};
      for (const k in target) from[k] = obj[k];
      list.push({ obj, from, target, dur: Math.max(0.0001, dur), t: 0, ease: ease || SAK.Ease.inOutQuad, resolve });
    });
  }
  function update(dt) {
    if (!list.length) return;
    const done = [];
    for (const tw of list) {
      tw.t += dt;
      const p = Math.min(1, tw.t / tw.dur), e = tw.ease(p);
      for (const k in tw.target) tw.obj[k] = tw.from[k] + (tw.target[k] - tw.from[k]) * e;
      if (p >= 1) done.push(tw);
    }
    if (done.length) { list = list.filter(t => !done.includes(t)); done.forEach(t => t.resolve()); }
  }
  function clear() { list = []; }
  return { to, update, clear };
})();

/* --------------------------------------------------------------- the scene */
SAK.Scene3D = (function () {
  const T = window.THREE;
  let renderer, scene, camera, container, clock;
  let player = null, kol = null;
  let particles = [], rings = [];
  let candles = [], coins = [];
  let shake = 0, time = 0, mode = 'menu';
  let koCam = null; // { track:Fighter, offset:Vector3, until:number } — follow loser fly-out + land
  let hitCam = null; // { target:Fighter, w:0..1, peak } — cinematic orbit onto the slapped fighter's FACE
  let camK = 1;      // aspect pull-back factor from frameCamera (narrow screens > 1)
  const camBase = { pos: new T.Vector3(), look: new T.Vector3() };
  const camCur = { pos: new T.Vector3(), look: new T.Vector3() };
  const camFight = { pos: new T.Vector3(), look: new T.Vector3() }; // resting fight framing

  const matCache = {};
  function mat(color, opts) {
    if (opts) return new T.MeshLambertMaterial(Object.assign({ color, flatShading: true }, opts));
    if (!matCache[color]) matCache[color] = new T.MeshLambertMaterial({ color, flatShading: true });
    return matCache[color];
  }
  function mesh(geo, material, x, y, z) {
    const m = new T.Mesh(geo, material);
    m.position.set(x || 0, y || 0, z || 0);
    m.castShadow = true; m.receiveShadow = true;
    return m;
  }
  const wait = s => new Promise(r => setTimeout(r, s * 1000));

  /* Slapstick KO landing poses — cartoon meme energy, no gore.
   * rx/ry/rz = root euler; y = root height; t* / h* = torso/head; arm* = [lift,swing,elbow]. */
  const LAND_POSES = [
    { id: 'faceplant', rx: Math.PI * 0.52, ry: 0.12, rz: 0.18, y: 0.42,
      tx: 0.28, ty: 0.1, tz: 0.08, hx: 0.9, hy: 0.35, hz: 0.1,
      armL: [1.55, -1.15, 0.25], armR: [1.5, 1.25, 0.2] },
    { id: 'akimbo', rx: -Math.PI * 0.5, ry: 0.45, rz: 0.25, y: 0.4,
      tx: -0.2, ty: 0.55, tz: 0.35, hx: -0.45, hy: -0.7, hz: 0.45,
      armL: [1.85, 1.45, 1.7], armR: [1.75, -1.55, 1.85] },
    { id: 'headstuck', rx: Math.PI * 0.95, ry: 0.25, rz: 0.2, y: 1.55,
      tx: 0.15, ty: 0.1, tz: 0.05, hx: 0.35, hy: 0.15, hz: 0.1,
      armL: [0.45, 0.9, 1.85], armR: [0.55, -0.95, 1.7] },
    { id: 'pretzel', rx: Math.PI * 0.38, ry: 1.15, rz: Math.PI * 0.58, y: 0.36,
      tx: 0.65, ty: 0.95, tz: -0.55, hx: 0.55, hy: 1.25, hz: 0.45,
      armL: [2.05, -0.35, 2.15], armR: [0.35, 1.85, 0.45] },
    { id: 'buttup', rx: Math.PI * 0.72, ry: 0.08, rz: 0.12, y: 0.52,
      tx: 0.85, ty: 0.05, tz: 0.1, hx: 1.15, hy: 0.1, hz: 0.25,
      armL: [1.25, -0.55, 0.35], armR: [1.3, 0.55, 0.3] },
    { id: 'oneleg', rx: 0.28, ry: 0.2, rz: Math.PI * 0.55, y: 0.26,
      tx: 0.25, ty: -0.35, tz: 0.65, hx: 0.45, hy: 0.55, hz: 0.85,
      armL: [0.25, 0.25, 0.15], armR: [1.95, -1.25, 1.55] },
    { id: 'superman', rx: Math.PI * 0.5, ry: 0.05, rz: 0.05, y: 0.38,
      tx: -0.18, ty: 0, tz: 0, hx: -0.35, hy: 0.05, hz: 0,
      armL: [0.25, -1.65, 0.12], armR: [0.25, 1.65, 0.12] },
    { id: 'starfished', rx: -Math.PI * 0.5, ry: 0.1, rz: 0.08, y: 0.4,
      tx: 0.05, ty: 0.1, tz: 0.05, hx: -0.25, hy: 0.15, hz: 0.1,
      armL: [1.95, 0.25, 0.2], armR: [1.95, -0.25, 0.2] },
    { id: 'sideflop', rx: 0.18, ry: 0.55, rz: Math.PI * 0.48, y: 0.3,
      tx: 0.4, ty: 0.25, tz: 0.2, hx: 0.65, hy: 0.45, hz: 0.55,
      armL: [1.65, 0.85, 1.25], armR: [0.18, -0.35, 0.25] },
    { id: 'heap', rx: Math.PI * 0.42, ry: 0.75, rz: Math.PI * 0.38, y: 0.28,
      tx: 0.75, ty: 0.45, tz: -0.45, hx: 0.95, hy: -0.55, hz: 0.65,
      armL: [1.45, 1.05, 2.05], armR: [1.85, -0.45, 1.75] },
  ];
  function pickLandPose() { return LAND_POSES[(Math.random() * LAND_POSES.length) | 0]; }

  /* Hit-reaction tiers — cartoon pain scaled by how close to green (no gore). */
  const HIT_REACT = {
    /* light  = weak / outer zone — small flinch, mild wince
     * medium = good / mid yellow — bigger head snap + wobble
     * heavy  = inner good / fire-boosted — strong recoil, stars, scream
     * perfect = green centre — max slapstick pain (no gore) */
    light: {
      yaw: 5.5, roll: 3.2, lean: 0.14, mouthX: 1.08, mouthY: 2.0, mouthMs: 220,
      eyeSx: 1.05, eyeSy: 0.72, sx: 1.18, sy: 0.82, sz: 1.12, squashDur: 0.24,
      stars: 0, burstN: 9, burstSpd: 2.5, shake: 0.15, hitStop: 0.03, hop: 0,
      blushAdd: 0.12, colors: ['#ffffff', '#fff27a'], ring: '#ffffff', yelpDelay: 0
    },
    medium: {
      yaw: 9.5, roll: 5.8, lean: 0.24, mouthX: 1.2, mouthY: 2.7, mouthMs: 340,
      eyeSx: 1.12, eyeSy: 0.62, sx: 1.3, sy: 0.7, sz: 1.2, squashDur: 0.34,
      stars: 2, burstN: 18, burstSpd: 3.5, shake: 0.26, hitStop: 0.055, hop: 0.08,
      blushAdd: 0.22, colors: ['#ffffff', '#ffd23f', '#ff9a1f'], ring: '#ffd23f', yelpDelay: 0.02
    },
    heavy: {
      yaw: 14.5, roll: 9.2, lean: 0.36, mouthX: 1.55, mouthY: 3.6, mouthMs: 440,
      eyeSx: 1.28, eyeSy: 1.38, sx: 1.42, sy: 0.55, sz: 1.28, squashDur: 0.45,
      stars: 4, burstN: 28, burstSpd: 4.6, shake: 0.4, hitStop: 0.09, hop: 0.18,
      blushAdd: 0.38, colors: ['#ffd23f', '#ff9a1f', '#ff4fd8', '#ffffff'], ring: '#ff9a1f', yelpDelay: 0.04
    },
    perfect: {
      yaw: 19, roll: 12.5, lean: 0.45, mouthX: 1.8, mouthY: 4.1, mouthMs: 560,
      eyeSx: 1.4, eyeSy: 1.55, sx: 1.58, sy: 0.45, sz: 1.38, squashDur: 0.58,
      stars: 6, burstN: 40, burstSpd: 5.8, shake: 0.58, hitStop: 0.13, hop: 0.32,
      blushAdd: 0.55, colors: ['#39ff88', '#ffd23f', '#ffffff', '#ff4fd8', '#ff7a9a'], ring: '#39ff88', yelpDelay: 0.06
    }
  };

  /** Map meter grade (+ fire / distance) → light|medium|heavy|perfect. */
  function reactTier(grade, fire, dist) {
    if (!grade || grade === 'miss') return null;
    if (grade === 'perfect') return 'perfect';
    if (grade === 'weak') return fire ? 'medium' : 'light';
    if (grade === 'good') {
      if (fire) return 'heavy';
      if (dist != null && dist < 20) return 'heavy'; // inner yellow → heavy
      return 'medium';
    }
    return 'medium';
  }



  /* ================================================================ Fighter */
  class Fighter {
    /**
     * @param look   colours/accessory (see config.js)
     * @param facing +1 faces +z (KOL), -1 faces -z (player)
     * @param armSide local x side of the slapping arm (+1 / -1)
     */
    constructor(look, facing, armSide) {
      this.look = look; this.facing = facing; this.armSide = armSide;
      this.root = new T.Group();
      this.root.rotation.y = facing > 0 ? 0 : Math.PI;
      this.homeZ = facing > 0 ? -0.8 : 0.8;
      this.root.position.set(0, 0, this.homeZ);
      // animated pose values (tweened), applied every frame
      this.pose = { lift: 0.12, swing: 0, elbow: 0.15, twist: 0, lean: 0, lunge: 0, guard: 0 };
      // damped springs for hit reactions
      this.yaw = { x: 0, v: 0 }; this.roll = { x: 0, v: 0 };
      this.ko = null;               // knockout physics state
      this.fire = false;
      this.idlePhase = Math.random() * 10;
      this.build();
    }

    build() {
      const L = this.look;
      const skin = mat(L.skin), shirt = mat(L.shirt), pants = mat(L.pants), hair = mat(L.hair);

      // legs
      for (const sx of [-0.22, 0.22]) {
        this.root.add(mesh(new T.CylinderGeometry(0.15, 0.13, 0.95, 6), pants, sx, 0.475, 0));
        this.root.add(mesh(new T.BoxGeometry(0.26, 0.12, 0.38), mat('#222'), sx, 0.06, 0.06));
      }
      // torso pivot at hips
      this.torso = new T.Group(); this.torso.position.y = 0.95; this.root.add(this.torso);
      const body = mesh(new T.CylinderGeometry(0.5, 0.42, 0.88, 7), shirt, 0, 0.44, 0);
      body.scale.z = 0.68; this.torso.add(body);
      this.torso.add(mesh(new T.BoxGeometry(0.86, 0.1, 0.42), pants, 0, 0.03, 0)); // belt
      this.torso.add(mesh(new T.CylinderGeometry(0.14, 0.16, 0.18, 6), skin, 0, 0.92, 0)); // neck

      // head
      this.head = new T.Group(); this.head.position.y = 0.98; this.torso.add(this.head);
      const skull = mesh(new T.IcosahedronGeometry(0.5, 1), skin, 0, 0.42, 0);
      skull.scale.set(1, 1.06, 0.98); this.head.add(skull);
      this.skull = skull;
      this.skullBase = new T.Vector3(1, 1.06, 0.98);
      this.hitFX = null; // { until, dur, sx, sy, sz, stars }
      // hair cap (top + back), forehead stays visible
      const hairCap = mesh(new T.SphereGeometry(0.535, 9, 6, 0, Math.PI * 2, 0, Math.PI * 0.5), hair, 0, 0.47, -0.04);
      hairCap.rotation.x = -0.35; this.head.add(hairCap);
      // ears
      for (const sx of [-1, 1]) this.head.add(mesh(new T.IcosahedronGeometry(0.1, 0), skin, sx * 0.5, 0.4, 0));
      // eyes
      this.eyes = new T.Group(); this.head.add(this.eyes);
      for (const sx of [-1, 1]) {
        this.eyes.add(mesh(new T.SphereGeometry(0.1, 8, 6), mat('#ffffff'), sx * 0.18, 0.5, 0.42));
        this.eyes.add(mesh(new T.SphereGeometry(0.055, 6, 5), mat('#1a1a1a'), sx * 0.18, 0.5, 0.51));
        const brow = mesh(new T.BoxGeometry(0.2, 0.05, 0.06), hair, sx * 0.19, 0.65, 0.45);
        brow.rotation.z = sx * -0.18; this.head.add(brow);
      }
      // KO "X" eyes (hidden until knocked out)
      this.xEyes = new T.Group(); this.xEyes.visible = false; this.head.add(this.xEyes);
      for (const sx of [-1, 1]) for (const r of [0.785, -0.785]) {
        const b = mesh(new T.BoxGeometry(0.2, 0.045, 0.04), mat('#1a1a1a'), sx * 0.18, 0.5, 0.5);
        b.rotation.z = r; this.xEyes.add(b);
      }
      // nose + mouth
      this.head.add(mesh(new T.IcosahedronGeometry(0.085, 0), skin, 0, 0.36, 0.52));
      this.mouth = mesh(new T.BoxGeometry(0.2, 0.05, 0.05), mat('#6b1d1d'), 0, 0.2, 0.46);
      this.head.add(this.mouth);
      // cheeks: blush grows with damage taken (both cheeks so it reads from any angle)
      this.blushMat = new T.MeshBasicMaterial({ color: '#ff2a2a', transparent: true, opacity: 0, depthWrite: false });
      for (const sx of [-1, 1]) {
        const c = new T.Mesh(new T.SphereGeometry(0.13, 8, 6), this.blushMat);
        c.position.set(sx * 0.33, 0.3, 0.36); c.scale.set(1, 0.7, 0.4); this.head.add(c);
      }
      this.buildAccessory();
      // 👁👁 laser eyes, flashed on a PERFECT slap
      this.lasers = new T.Group(); this.lasers.visible = false; this.head.add(this.lasers);
      const lm = new T.MeshBasicMaterial({ color: '#ff1a1a', transparent: true, opacity: 0.9 });
      for (const sx of [-1, 1]) {
        const beam = new T.Mesh(new T.CylinderGeometry(0.022, 0.04, 4, 6), lm);
        beam.rotation.x = Math.PI / 2; beam.position.set(sx * 0.18, 0.5, 2.5); this.lasers.add(beam);
        const glow = new T.Mesh(new T.SphereGeometry(0.11, 8, 6), new T.MeshBasicMaterial({ color: '#ffdddd' }));
        glow.position.set(sx * 0.18, 0.5, 0.5); this.lasers.add(glow);
      }
      this.laserUntil = 0;
      // ⛑ Defense Helmet power-up (hidden until used)
      this.helmet = new T.Group(); this.helmet.visible = false; this.head.add(this.helmet);
      const hm = mat('#ffd23f', {}); hm.emissive = new T.Color('#4a3300');
      this.helmet.add(mesh(new T.SphereGeometry(0.58, 10, 6, 0, Math.PI * 2, 0, Math.PI * 0.5), hm, 0, 0.55, 0));
      this.helmet.add(mesh(new T.CylinderGeometry(0.66, 0.66, 0.05, 12), hm, 0, 0.56, 0.05));
      this.helmet.add(mesh(new T.BoxGeometry(0.1, 0.12, 0.62), mat('#ff3b5c'), 0, 1.1, 0));
      // 😤 Degen Rage aura (hidden until used)
      this.rage = new T.Mesh(new T.SphereGeometry(0.8, 12, 8), new T.MeshBasicMaterial({ color: '#ff2a2a', transparent: true, opacity: 0.22, depthWrite: false }));
      this.rage.position.y = 0.45; this.rage.visible = false; this.head.add(this.rage);

      // arms
      this.arms = {};
      for (const side of [-1, 1]) {
        const shoulder = new T.Group(); shoulder.position.set(side * 0.55, 0.78, 0); this.torso.add(shoulder);
        shoulder.add(mesh(new T.IcosahedronGeometry(0.16, 0), shirt, 0, 0, 0));
        shoulder.add(mesh(new T.CylinderGeometry(0.13, 0.11, 0.55, 6), shirt, 0, -0.27, 0));
        const elbow = new T.Group(); elbow.position.y = -0.55; shoulder.add(elbow);
        elbow.add(mesh(new T.CylinderGeometry(0.105, 0.09, 0.45, 6), skin, 0, -0.22, 0));
        const handMat = mat(L.skin, {}); // own material so it can turn golden
        const hand = mesh(new T.IcosahedronGeometry(0.16, 1), handMat, 0, -0.52, 0);
        hand.scale.set(0.75, 1.1, 1.15);
        elbow.add(hand);
        this.arms[side] = { shoulder, elbow, hand, handMat, side };
      }
      this.root.traverse(o => { o.userData.fighter = this; });
    }

    buildAccessory() {
      const L = this.look, a = L.accent || '#111', H = this.head;
      const add = (geo, color, x, y, z, opts) => { const m = mesh(geo, typeof color === 'string' ? mat(color) : color, x, y, z); if (opts) opts(m); H.add(m); return m; };
      switch (L.accessory) {
        case 'shades':
          for (const sx of [-1, 1]) add(new T.BoxGeometry(0.28, 0.16, 0.06), a, sx * 0.18, 0.5, 0.53);
          add(new T.BoxGeometry(0.14, 0.04, 0.04), a, 0, 0.53, 0.54); break;
        case 'cap':
          add(new T.SphereGeometry(0.55, 9, 5, 0, Math.PI * 2, 0, Math.PI * 0.45), L.shirt, 0, 0.55, 0);
          add(new T.BoxGeometry(0.62, 0.05, 0.4), L.shirt, 0, 0.7, 0.45, m => { m.rotation.x = 0.15; }); break;
        case 'crown': {
          add(new T.CylinderGeometry(0.34, 0.36, 0.18, 8, 1, true), mat(a, { side: T.DoubleSide }), 0, 0.97, 0);
          for (let i = 0; i < 6; i++) { const ang = i / 6 * Math.PI * 2; add(new T.ConeGeometry(0.07, 0.18, 4), a, Math.sin(ang) * 0.34, 1.14, Math.cos(ang) * 0.34); }
          add(new T.IcosahedronGeometry(0.06, 0), '#ff2d55', 0, 0.98, 0.36); break; }
        case 'laser':
          this.laserMat = new T.MeshBasicMaterial({ color: '#ff1a1a' });
          for (const sx of [-1, 1]) {
            const beam = new T.Mesh(new T.CylinderGeometry(0.025, 0.025, 2.5, 6), this.laserMat);
            beam.rotation.x = Math.PI / 2 - 0.15; beam.position.set(sx * 0.18, 0.4, 1.7); H.add(beam);
            add(new T.SphereGeometry(0.06, 6, 5), this.laserMat, sx * 0.18, 0.5, 0.52);
          } break;
        case 'headphones':
          add(new T.TorusGeometry(0.56, 0.05, 6, 14, Math.PI), a, 0, 0.42, 0);
          for (const sx of [-1, 1]) add(new T.CylinderGeometry(0.15, 0.15, 0.12, 8), a, sx * 0.54, 0.42, 0, m => { m.rotation.z = Math.PI / 2; }); break;
        case 'tophat':
          add(new T.CylinderGeometry(0.55, 0.55, 0.05, 10), '#111', 0, 0.9, 0);
          add(new T.CylinderGeometry(0.36, 0.38, 0.55, 10), '#111', 0, 1.18, 0);
          add(new T.CylinderGeometry(0.385, 0.385, 0.1, 10), a, 0, 0.98, 0); break;
        case 'beanie':
          add(new T.SphereGeometry(0.55, 9, 5, 0, Math.PI * 2, 0, Math.PI * 0.5), a, 0, 0.52, 0);
          add(new T.CylinderGeometry(0.56, 0.56, 0.14, 10), '#ffffff', 0, 0.55, 0);
          add(new T.IcosahedronGeometry(0.11, 0), '#ffffff', 0, 1.1, 0); break;
        case 'visor':
          add(new T.BoxGeometry(0.78, 0.18, 0.12), mat(a, { transparent: true, opacity: 0.85 }), 0, 0.5, 0.47);
          add(new T.TorusGeometry(0.52, 0.03, 4, 16), '#222', 0, 0.5, 0, m => { m.rotation.x = Math.PI / 2; }); break;
        case 'unicorn': {
          const horn = add(new T.ConeGeometry(0.11, 0.55, 6), mat(a, {}), 0, 1.02, 0.22, m => { m.rotation.x = 0.45; });
          horn.material.emissive = new T.Color('#5a2a7a');
          for (const sx of [-1, 1]) add(new T.ConeGeometry(0.09, 0.2, 4), L.hair, sx * 0.3, 0.92, -0.05, m => { m.rotation.z = -sx * 0.4; });
          break; }
        case 'headband':
          add(new T.CylinderGeometry(0.52, 0.52, 0.1, 10), '#ff3b3b', 0, 0.68, 0);
          add(new T.BoxGeometry(0.06, 0.3, 0.06), '#ff3b3b', 0.1, 0.55, -0.52, m => { m.rotation.z = 0.5; }); break;
      }
    }

    /** Apply a pose to one arm. lift = sideways raise, swing >0 back / <0 forward. */
    applyArm(arm, lift, swing, elbow) {
      const s = arm.side;
      arm.shoulder.rotation.set(0, s * swing, s * lift);
      arm.elbow.rotation.set(0, 0, s * elbow);
    }

    update(dt) {
      this.idlePhase += dt;
      // knockout: ballistic flight → slapstick landing pose
      if (this.ko) {
        const k = this.ko;
        if (k.phase === 'land') {
          this.applyLandPose(k.landPose);
          // tiny cartoon settle wobble
          this.root.rotation.z += Math.sin(time * 14) * 0.004;
          return;
        }
        k.vel.y -= 11.5 * dt; // slightly floatier cartoon arc
        this.root.position.addScaledVector(k.vel, dt);
        this.root.rotation.x += k.spin.x * dt;
        this.root.rotation.y += (k.spin.y || 0) * dt;
        this.root.rotation.z += k.spin.z * dt;
        // Ground hit → freeze into a random awkward pose
        if (this.root.position.y <= 0.08 && k.vel.y < 0) {
          this.root.position.y = 0.08;
          k.vel.set(0, 0, 0);
          k.spin.set(0, 0, 0);
          k.phase = 'land';
          k.landPose = k.landPose || pickLandPose();
          this.applyLandPose(k.landPose);
          const dust = this.root.position.clone(); dust.y = 0.12;
          burst(dust, ['#c4a574', '#ffd23f', '#ffffff', '#e8d5a3'], 32, 3.2);
          ring(dust, '#ffd23f');
          shake = Math.max(shake, 0.5);
        }
        return;
      }
      // springs
      for (const sp of [this.yaw, this.roll]) { sp.v += (-140 * sp.x - 10 * sp.v) * dt; sp.x += sp.v * dt; }
      const p = this.pose, idle = Math.sin(this.idlePhase * 2.2);
      this.torso.rotation.set(p.lean + idle * 0.015, p.twist, this.roll.x * 0.5);
      this.head.rotation.set(-p.lean * 0.5, this.yaw.x, this.roll.x);
      this.torso.position.y = 0.95 + idle * 0.012;
      this.root.position.z = this.homeZ + this.facing * p.lunge;
      // slapping arm uses the tweened pose; the other arm idles / guards
      this.applyArm(this.arms[this.armSide], p.lift, p.swing, p.elbow);
      const g = p.guard;
      this.applyArm(this.arms[-this.armSide], 0.12 + idle * 0.03 + g * 0.9, -g * 1.2, 0.15 + g * 1.9);
      if (this.laserMat) this.laserMat.color.setHSL(0, 1, 0.45 + Math.sin(time * 12) * 0.08);
      this.lasers.visible = time < this.laserUntil;
      if (this.rage.visible) { const k = 1 + Math.sin(time * 14) * 0.08; this.rage.scale.set(k, k, k); this.rage.material.opacity = 0.18 + Math.random() * 0.12; }
      if (this.lasers.visible) this.lasers.children.forEach(c => { if (c.geometry.type === 'CylinderGeometry') c.scale.set(1 + Math.random() * 0.6, 1, 1 + Math.random() * 0.6); });
      // Face-squash + dizzy stars from a slap reaction
      if (this.hitFX) {
        const h = this.hitFX;
        const u = Math.max(0, Math.min(1, (h.until - time) / h.dur)); // 1→0
        const e = u * u;
        this.skull.scale.set(
          this.skullBase.x * (1 + (h.sx - 1) * e),
          this.skullBase.y * (1 + (h.sy - 1) * e),
          this.skullBase.z * (1 + (h.sz - 1) * e)
        );
        if (h.stars) {
          h.stars.rotation.y += dt * (5 + (1 - u) * 2);
          h.stars.children.forEach((c, i) => {
            c.position.y = 0.75 + Math.sin(time * 9 + i * 1.7) * 0.1;
            c.rotation.z += dt * 5;
            c.rotation.x += dt * 3;
          });
        }
        if (time >= h.until) {
          this.skull.scale.copy(this.skullBase);
          if (h.stars) {
            h.stars.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
            this.head.remove(h.stars);
          }
          this.hitFX = null;
        }
      }
    }

    get slapHand() { return this.arms[this.armSide].hand; }

    headWorld(out) { return this.skull.getWorldPosition(out || new T.Vector3()); }

    setDamage(frac) { this.blushMat.opacity = Math.min(0.75, frac * 0.9); }

    setFire(on) {
      this.fire = on;
      const m = this.arms[this.armSide].handMat;
      if (on) { m.color.set('#ffc21a'); m.emissive.set('#ff6a00'); m.emissiveIntensity = 0.9; }
      else { m.color.set(this.look.skin); m.emissive.set('#000000'); }
      this.slapHand.scale.set(on ? 1.1 : 0.75, on ? 1.5 : 1.1, on ? 1.6 : 1.15);
    }

    /** Snap into a slapstick KO landing pose (root + torso/head/arms). */
    applyLandPose(P) {
      if (!P) return;
      const faceY = this.facing > 0 ? 0 : Math.PI;
      this.root.rotation.set(P.rx, faceY + (P.ry || 0), P.rz || 0);
      this.root.position.y = P.y;
      this.torso.position.y = 0.95;
      this.torso.rotation.set(P.tx || 0, P.ty || 0, P.tz || 0);
      this.head.rotation.set(P.hx || 0, P.hy || 0, P.hz || 0);
      this.applyArm(this.arms[-1], ...(P.armL || [1.2, 0.5, 0.4]));
      this.applyArm(this.arms[1], ...(P.armR || [1.2, -0.5, 0.4]));
      this.xEyes.visible = true; this.eyes.visible = false;
      this.mouth.scale.set(1, 3, 1);
    }

    clearHitFX() {
      if (!this.hitFX) return;
      if (this.hitFX.stars) {
        this.hitFX.stars.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
        this.head.remove(this.hitFX.stars);
      }
      if (this.skullBase) this.skull.scale.copy(this.skullBase);
      this.hitFX = null;
    }

    resetPose() {
      Object.assign(this.pose, { lift: 0.12, swing: 0, elbow: 0.15, twist: 0, lean: 0, lunge: 0, guard: 0 });
      this.yaw.x = this.yaw.v = this.roll.x = this.roll.v = 0;
      this.ko = null; this.xEyes.visible = false; this.eyes.visible = true; this.laserUntil = 0;
      this.mouth.scale.set(1, 1, 1);
      if (this.eyes) this.eyes.scale.set(1, 1, 1);
      this.clearHitFX();
      this.root.position.set(0, 0, this.homeZ);
      this.root.rotation.set(0, this.facing > 0 ? 0 : Math.PI, 0);
      this.torso.position.y = 0.95;
      this.torso.rotation.set(0, 0, 0);
      this.head.rotation.set(0, 0, 0);
      this.setDamage(0);
    }

    dispose() {
      this.root.traverse(o => {
        if (o.geometry) o.geometry.dispose();
        if (o.material && !Object.values(matCache).includes(o.material)) o.material.dispose();
      });
      if (this.root.parent) this.root.parent.remove(this.root);
    }
  }

  /* ============================================================== Arena */
  // Degenerate-memecoin arena: neon ring, chart billboards, WAGMI/HODL/GM
  // banners, moon + rocket, original frog & dog mascots, crowd.
  let chart = null, rocket = null, mascots = [], neonLights = [], coinRainList = [];

  /** Canvas → texture helper. draw(ctx, w, h) paints the canvas. */
  function canvasTex(w, h, draw) {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const ctx = c.getContext('2d'); draw(ctx, w, h);
    const tex = new T.CanvasTexture(c);
    if ('colorSpace' in tex) tex.colorSpace = T.SRGBColorSpace;
    tex.anisotropy = 4;
    return { tex, ctx, canvas: c };
  }
  const FONT = '"Lilita One", "Arial Black", Impact, sans-serif';

  function neonText(ctx, text, x, y, size, color, glow) {
    ctx.font = `${size}px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round'; ctx.lineWidth = size * 0.14; ctx.strokeStyle = '#12002b';
    ctx.shadowColor = glow || color; ctx.shadowBlur = size * 0.35;
    ctx.strokeText(text, x, y); ctx.fillStyle = color; ctx.fillText(text, x, y);
    ctx.shadowBlur = 0;
  }

  /** Live pump/dump candlestick screen. */
  function makeChart() {
    const candlesData = [];
    let price = 100;
    for (let i = 0; i < 26; i++) { const o = price; price *= 1 + (Math.random() - 0.45) * 0.12; candlesData.push({ o, c: price, h: Math.max(o, price) * 1.03, l: Math.min(o, price) * 0.97 }); }
    const ct = canvasTex(512, 320, () => {});
    const draw = () => {
      const ctx = ct.ctx, w = 512, h = 320;
      ctx.fillStyle = '#0a0220'; ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = '#2b1a5a'; ctx.lineWidth = 1;
      for (let x = 0; x < w; x += 32) { ctx.beginPath(); ctx.moveTo(x, 50); ctx.lineTo(x, h); ctx.stroke(); }
      for (let y = 50; y < h; y += 30) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }
      const hi = Math.max(...candlesData.map(c => c.h)), lo = Math.min(...candlesData.map(c => c.l));
      const Y = v => 300 - (v - lo) / (hi - lo || 1) * 230;
      candlesData.forEach((c, i) => {
        const x = 14 + i * 19, up = c.c >= c.o, col = up ? '#39ff88' : '#ff3b5c';
        ctx.strokeStyle = col; ctx.fillStyle = col; ctx.shadowColor = col; ctx.shadowBlur = 8; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(x + 6, Y(c.h)); ctx.lineTo(x + 6, Y(c.l)); ctx.stroke();
        ctx.fillRect(x, Math.min(Y(c.o), Y(c.c)), 12, Math.max(3, Math.abs(Y(c.o) - Y(c.c))));
      });
      ctx.shadowBlur = 0;
      const first = candlesData[0].o, last = candlesData[candlesData.length - 1].c, pct = (last / first - 1) * 100, up = pct >= 0;
      ctx.fillStyle = '#12002b'; ctx.fillRect(0, 0, w, 46);
      neonText(ctx, '$SLAP / PTS', 110, 25, 28, '#ffffff', '#b44dff');
      neonText(ctx, `${up ? '▲ +' : '▼ '}${pct.toFixed(1)}%`, 380, 25, 30, up ? '#39ff88' : '#ff3b5c');
      if (Math.abs(pct) > 25) neonText(ctx, up ? 'PUMP IT!' : 'DUMP!', 256, 170, 64, up ? '#39ff88' : '#ff3b5c');
      ct.tex.needsUpdate = true;
    };
    draw();
    return {
      tex: ct.tex, t: 0,
      step() {   // push a new candle: random walk with occasional mega pump / dump
        const o = candlesData[candlesData.length - 1].c;
        const shock = Math.random() < 0.08 ? (Math.random() < 0.6 ? 0.35 : -0.3) : 0;
        const c = o * (1 + (Math.random() - 0.46) * 0.14 + shock);
        candlesData.push({ o, c, h: Math.max(o, c) * (1 + Math.random() * 0.04), l: Math.min(o, c) * (1 - Math.random() * 0.04) });
        candlesData.shift(); draw();
      }
    };
  }

  function billboard(tex, w, h, ang, r, y) {
    const g = new T.Group();
    const frame = mesh(new T.BoxGeometry(w + 0.25, h + 0.25, 0.15), mat('#1a0b3a'), 0, 0, -0.1); g.add(frame);
    const glow = new T.Mesh(new T.BoxGeometry(w + 0.4, h + 0.4, 0.05), new T.MeshBasicMaterial({ color: '#b44dff' }));
    glow.position.z = -0.2; g.add(glow);
    const screen = new T.Mesh(new T.PlaneGeometry(w, h), new T.MeshBasicMaterial({ map: tex, toneMapped: false }));
    g.add(screen);
    for (const sx of [-1, 1]) g.add(mesh(new T.CylinderGeometry(0.08, 0.1, y, 6), mat('#2a1458'), sx * w * 0.35, -y / 2 - h / 2 + 0.2, -0.2));
    const rad = ang * Math.PI / 180;
    g.position.set(Math.cos(rad) * r, y, Math.sin(rad) * r);
    g.lookAt(0, y, 0);
    scene.add(g);
    return g;
  }

  function textPanel(text, color, bg, w, h) {
    return canvasTex(w, h, (ctx, W2, H2) => {
      const grd = ctx.createLinearGradient(0, 0, 0, H2); grd.addColorStop(0, bg[0]); grd.addColorStop(1, bg[1]);
      ctx.fillStyle = grd; ctx.fillRect(0, 0, W2, H2);
      ctx.strokeStyle = color; ctx.lineWidth = 10; ctx.shadowColor = color; ctx.shadowBlur = 20; ctx.strokeRect(10, 10, W2 - 20, H2 - 20); ctx.shadowBlur = 0;
      neonText(ctx, text, W2 / 2, H2 / 2 + 4, H2 * 0.55, color);
    }).tex;
  }

  /** Original low-poly frog mascot (memecoin vibe, not any existing character). */
  function makeFrog() {
    const g = new T.Group(), green = mat('#5ee05a'), belly = mat('#c9f7a0');
    const body = mesh(new T.IcosahedronGeometry(0.6, 1), green, 0, 0.55, 0); body.scale.set(1.15, 0.9, 1); g.add(body);
    g.add(mesh(new T.IcosahedronGeometry(0.42, 1), belly, 0, 0.45, 0.32));
    for (const sx of [-1, 1]) {
      g.add(mesh(new T.IcosahedronGeometry(0.22, 1), green, sx * 0.3, 1.08, 0.12));
      g.add(mesh(new T.SphereGeometry(0.15, 8, 6), mat('#ffffff'), sx * 0.3, 1.12, 0.26));
      g.add(mesh(new T.SphereGeometry(0.075, 6, 5), mat('#111111'), sx * 0.3, 1.13, 0.39));
      g.add(mesh(new T.IcosahedronGeometry(0.18, 0), green, sx * 0.55, 0.12, 0.25));
    }
    const mouth = mesh(new T.TorusGeometry(0.3, 0.04, 4, 12, Math.PI), mat('#2b6b1f'), 0, 0.72, 0.5); mouth.rotation.z = Math.PI; g.add(mouth);
    g.add(mesh(new T.CylinderGeometry(0.05, 0.05, 1.3, 5), mat('#3a2a1a'), 0.75, 0.9, 0.1));            // sign pole
    const sign = new T.Mesh(new T.PlaneGeometry(0.9, 0.5), new T.MeshBasicMaterial({ map: textPanel('GM', '#39ff88', ['#12002b', '#2a0b5e'], 256, 140), side: T.DoubleSide }));
    sign.position.set(0.75, 1.6, 0.12); g.add(sign);
    return g;
  }

  /** Original low-poly dog mascot. */
  function makeDog() {
    const g = new T.Group(), fur = mat('#ffae3b'), white = mat('#fff3e0');
    const body = mesh(new T.IcosahedronGeometry(0.5, 1), fur, 0, 0.5, 0); body.scale.set(1, 1, 1.1); g.add(body);
    const head = new T.Group(); head.position.y = 1.15; g.add(head);
    head.add(mesh(new T.IcosahedronGeometry(0.42, 1), fur, 0, 0, 0));
    head.add(mesh(new T.IcosahedronGeometry(0.22, 1), white, 0, -0.1, 0.32));
    head.add(mesh(new T.SphereGeometry(0.07, 6, 5), mat('#111111'), 0, -0.02, 0.52));
    for (const sx of [-1, 1]) {
      const ear = mesh(new T.ConeGeometry(0.14, 0.32, 4), fur, sx * 0.24, 0.42, 0); ear.rotation.z = -sx * 0.3; head.add(ear);
      head.add(mesh(new T.SphereGeometry(0.06, 6, 5), mat('#111111'), sx * 0.15, 0.1, 0.36));
    }
    const tail = mesh(new T.TorusGeometry(0.15, 0.06, 4, 8, Math.PI * 1.5), fur, 0, 0.75, -0.5); g.add(tail);
    g.add(mesh(new T.CylinderGeometry(0.05, 0.05, 1.3, 5), mat('#3a2a1a'), -0.7, 0.9, 0.1));
    const sign = new T.Mesh(new T.PlaneGeometry(0.95, 0.5), new T.MeshBasicMaterial({ map: textPanel('HODL', '#ffd23f', ['#12002b', '#2a0b5e'], 256, 140), side: T.DoubleSide }));
    sign.position.set(-0.7, 1.6, 0.12); g.add(sign);
    g.userData.head = head;
    return g;
  }

  function makeRocket() {
    const g = new T.Group();
    g.add(mesh(new T.CylinderGeometry(0.28, 0.32, 1.4, 8), mat('#f2f2ff'), 0, 0, 0));
    g.add(mesh(new T.ConeGeometry(0.28, 0.55, 8), mat('#ff3b5c'), 0, 0.97, 0));
    g.add(mesh(new T.CylinderGeometry(0.13, 0.13, 0.06, 10), mat('#39c5ff'), 0, 0.25, 0.28)).rotation.x = Math.PI / 2;
    for (let i = 0; i < 3; i++) {
      const fin = mesh(new T.BoxGeometry(0.06, 0.45, 0.35), mat('#b44dff'), 0, -0.55, 0);
      const holder = new T.Group(); holder.rotation.y = i * Math.PI * 2 / 3; fin.position.z = 0.3; holder.add(fin); g.add(holder);
    }
    const flame = new T.Mesh(new T.ConeGeometry(0.22, 0.8, 8), new T.MeshBasicMaterial({ color: '#ffb000' }));
    flame.rotation.x = Math.PI; flame.position.y = -1.1; g.add(flame);
    g.userData.flame = flame;
    g.scale.setScalar(0.9);
    return g;
  }

  function buildArena() {
    // floor + neon ring
    const floor = mesh(new T.CylinderGeometry(14, 14, 0.2, 28), mat('#1a0640'), 0, -0.1, 0);
    floor.castShadow = false; scene.add(floor);
    const ringTex = canvasTex(512, 512, (ctx, w, h) => {
      ctx.fillStyle = '#4b16b0'; ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = '#6d2fe0'; ctx.lineWidth = 3;
      for (let i = 0; i <= w; i += 32) { ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, h); ctx.stroke(); ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(w, i); ctx.stroke(); }
      ctx.save(); ctx.translate(w / 2, h / 2);
      neonText(ctx, '$SLAP', 0, -150, 64, '#39ff88');
      ctx.rotate(Math.PI); neonText(ctx, 'WAGMI', 0, -150, 64, '#ff4fd8'); ctx.restore();
    }).tex;
    const ringMat = new T.MeshLambertMaterial({ map: ringTex });
    const mat2 = mesh(new T.CylinderGeometry(3.2, 3.4, 0.12, 24), [mat('#2a0b5e'), ringMat, mat('#2a0b5e')], 0, 0.02, 0);
    mat2.castShadow = false; scene.add(mat2);
    const neonG = new T.MeshBasicMaterial({ color: '#39ff88' }), neonP = new T.MeshBasicMaterial({ color: '#ff4fd8' });
    const ringEdge = new T.Mesh(new T.TorusGeometry(3.3, 0.07, 6, 48), neonG); ringEdge.rotation.x = Math.PI / 2; ringEdge.position.y = 0.1; scene.add(ringEdge);
    const ringEdge2 = new T.Mesh(new T.TorusGeometry(3.55, 0.05, 6, 48), neonP); ringEdge2.rotation.x = Math.PI / 2; ringEdge2.position.y = 0.06; scene.add(ringEdge2);

    // table (wood) + PTS coin stacks
    const wood = mat('#c9844a'), woodDark = mat('#8f5427');
    scene.add(mesh(new T.BoxGeometry(1.9, 0.12, 1.0), wood, 0, 1.0, 0));
    scene.add(mesh(new T.BoxGeometry(1.95, 0.06, 1.05), woodDark, 0, 0.92, 0));
    for (const x of [-0.8, 0.8]) for (const z of [-0.38, 0.38]) scene.add(mesh(new T.CylinderGeometry(0.06, 0.05, 0.9, 6), woodDark, x, 0.45, z));
    const coinMat = mat('#ffcc22', {}); coinMat.emissive = new T.Color('#5a3a00');
    SAK.Scene3D._coinMat = coinMat;
    for (let i = 0; i < 5; i++) scene.add(mesh(new T.CylinderGeometry(0.12, 0.12, 0.035, 10), coinMat, -0.65, 1.075 + i * 0.037, 0.05 * (i % 2)));
    for (let i = 0; i < 3; i++) scene.add(mesh(new T.CylinderGeometry(0.12, 0.12, 0.035, 10), coinMat, -0.4, 1.075 + i * 0.037, -0.15));

    // billboards: live chart + slogans (arc behind the ring, visible from both cameras)
    chart = makeChart();
    billboard(chart.tex, 4.2, 2.6, 215, 8.5, 3.6);
    billboard(textPanel('WAGMI', '#39ff88', ['#12002b', '#2a0b5e'], 512, 220), 3.6, 1.55, 248, 8.5, 4.4);
    billboard(textPanel('TO THE MOON 🚀', '#ffd23f', ['#2a0b5e', '#5a1aa8'], 768, 200), 4.6, 1.2, 278, 8.8, 3.0);
    billboard(textPanel('NGMI', '#ff3b5c', ['#12002b', '#3a0b2e'], 512, 220), 3.0, 1.3, 183, 8.5, 2.6);
    billboard(chart.tex, 3.2, 2.0, 302, 8.6, 4.2);

    // low ring-side banners
    const words = [['HODL', '#ffd23f'], ['GM', '#39ff88'], ['NGMI', '#ff3b5c'], ['WAGMI', '#39ff88'], ['PUMP IT', '#ff4fd8'], ['GM', '#39ff88'], ['HODL', '#ffd23f']];
    words.forEach(([w, c], i) => {
      const ang = (150 + i * 25) * Math.PI / 180, r = 4.3;
      const b = new T.Mesh(new T.PlaneGeometry(1.7, 0.55), new T.MeshBasicMaterial({ map: textPanel(w, c, ['#12002b', '#2a0b5e'], 384, 124), side: T.DoubleSide }));
      b.position.set(Math.cos(ang) * r, 0.45, Math.sin(ang) * r); b.lookAt(0, 0.45, 0); scene.add(b);
    });

    // moon + stars
    const moon = new T.Mesh(new T.IcosahedronGeometry(2.6, 1), new T.MeshBasicMaterial({ color: '#fff4c2' }));
    moon.position.set(-10, 12, -18); scene.add(moon);
    for (let i = 0; i < 6; i++) {
      const cr = new T.Mesh(new T.IcosahedronGeometry(0.35 + Math.random() * 0.4, 0), new T.MeshBasicMaterial({ color: '#e6d48a' }));
      const v = new T.Vector3(Math.random() - 0.5, Math.random() - 0.5, 1).normalize().multiplyScalar(2.45);
      cr.position.copy(moon.position).add(v); cr.scale.z = 0.4; cr.lookAt(moon.position); scene.add(cr);
    }
    const starGeo = new T.BufferGeometry(), pts = [];
    for (let i = 0; i < 260; i++) { const a = Math.PI * (0.8 + Math.random() * 1.0), r = 22 + Math.random() * 6; pts.push(Math.cos(a) * r, 6 + Math.random() * 16, Math.sin(a) * r); }
    starGeo.setAttribute('position', new T.Float32BufferAttribute(pts, 3));
    scene.add(new T.Points(starGeo, new T.PointsMaterial({ color: '#ffffff', size: 0.18, fog: false })));

    // rocket that keeps launching to the moon
    rocket = makeRocket(); rocket.userData.t = 0; scene.add(rocket);

    // neon candle skyline far back
    const green = new T.MeshBasicMaterial({ color: '#39ff88' }), red = new T.MeshBasicMaterial({ color: '#ff3b5c' });
    let price = 3;
    for (let i = 0; i < 26; i++) {
      const up = Math.random() > 0.4, h = 0.6 + Math.random() * 1.8;
      price += up ? h * 0.35 : -h * 0.3; price = Math.max(2, Math.min(8, price));
      const g = new T.Group();
      g.add(new T.Mesh(new T.BoxGeometry(0.5, h, 0.5), up ? green : red), new T.Mesh(new T.BoxGeometry(0.08, h + 1, 0.08), up ? green : red));
      const ang = (170 + i * 5.2) * Math.PI / 180;
      g.position.set(Math.cos(ang) * 14, price + 1, Math.sin(ang) * 14);
      g.userData.baseY = price + 1; g.userData.phase = Math.random() * 6;
      scene.add(g); candles.push(g);
    }
    // floating coins
    for (let i = 0; i < 9; i++) {
      const c = new T.Mesh(new T.CylinderGeometry(0.35, 0.35, 0.07, 14), coinMat);
      c.rotation.x = Math.PI / 2;
      const ang = (180 + Math.random() * 100) * Math.PI / 180, r = 6 + Math.random() * 3;
      c.position.set(Math.cos(ang) * r, 3 + Math.random() * 4, Math.sin(ang) * r);
      c.userData.phase = Math.random() * 6; scene.add(c); coins.push(c);
    }
    // mascots at the ring corners
    const frog = makeFrog(); frog.position.set(-3.9, 0, -2.2); frog.lookAt(2, 0, 3); scene.add(frog);
    const dog = makeDog(); dog.position.set(1.4, 0, -4.2); dog.lookAt(1, 0, 2); scene.add(dog);
    mascots = [frog, dog];

    // crowd with neon glow sticks
    const crowdCols = ['#ff4fd8', '#39c5ff', '#ffe23d', '#39ff88', '#ff7a1a', '#b44dff'];
    for (let i = 0; i < 26; i++) {
      const ang = Math.PI * 0.85 + (i / 25) * Math.PI * 1.25;
      const r = 5.6 + (i % 2) * 0.8;
      const g = new T.Group(), c = crowdCols[i % crowdCols.length];
      g.add(new T.Mesh(new T.CylinderGeometry(0.3, 0.38, 0.9, 6), mat(c)));
      const hd = new T.Mesh(new T.IcosahedronGeometry(0.28, 0), mat('#f2c49b')); hd.position.y = 0.7; g.add(hd);
      const stick = new T.Mesh(new T.CylinderGeometry(0.03, 0.03, 0.5, 4), new T.MeshBasicMaterial({ color: i % 2 ? '#39ff88' : '#ff4fd8' }));
      stick.position.set(0.3, 1.0, 0); stick.rotation.z = -0.4; g.add(stick);
      g.position.set(Math.cos(ang) * r, 0.45, Math.sin(ang) * r);
      g.lookAt(0, 0.45, 0);
      g.userData.phase = Math.random() * 6; g.userData.crowd = true;
      scene.add(g); candles.push(g);
    }
    // coloured neon fill lights
    const l1 = new T.PointLight('#39ff88', 18, 12); l1.position.set(-3, 3, -3); scene.add(l1);
    const l2 = new T.PointLight('#ff4fd8', 18, 12); l2.position.set(3, 3, -2); scene.add(l2);
    neonLights = [l1, l2];
  }

  function updateArena(dt) {
    chart.t += dt; if (chart.t > 0.7) { chart.t = 0; chart.step(); }
    // rocket: launch from behind the billboards towards the moon, loop
    const r = rocket.userData; r.t += dt;
    const cyc = r.t % 9;
    rocket.visible = cyc < 6.5;
    const p0 = new T.Vector3(-4, -1, -11), p1 = new T.Vector3(-10, 12, -18);
    const kk = Math.min(1, cyc / 6.5), e = kk * kk;
    rocket.position.lerpVectors(p0, p1, e);
    rocket.position.x += Math.sin(kk * 9) * 0.3;
    rocket.rotation.z = 0.45; rocket.rotation.x = -0.35;
    rocket.userData.flame.scale.set(1, 0.7 + Math.random() * 0.7, 1);
    if (rocket.visible && Math.random() < 0.5) {
      const m = new T.Mesh(partGeo(), new T.MeshBasicMaterial({ color: Math.random() < 0.5 ? '#ffb000' : '#ff4fd8', transparent: true }));
      m.position.copy(rocket.position).add(new T.Vector3(0.4, -0.9, 0.3));
      particles.push({ m, v: new T.Vector3((Math.random() - 0.5), -1.5, (Math.random() - 0.5)), life: 0.7, age: 0, spin: 4, noGrav: true });
      scene.add(m);
    }
    // mascots bounce
    mascots.forEach((m, i) => { m.position.y = Math.abs(Math.sin(time * 3 + i * 1.7)) * 0.18; });
    if (mascots[1] && mascots[1].userData.head) mascots[1].userData.head.rotation.z = Math.sin(time * 2.5) * 0.25;
    // neon lights pulse
    neonLights.forEach((l, i) => { l.intensity = 14 + Math.sin(time * 3 + i * 2) * 6; });
    // coin rain physics
    coinRainList = coinRainList.filter(c => {
      c.age += dt;
      c.v.y -= 9.8 * dt; c.m.position.addScaledVector(c.v, dt);
      c.m.rotation.x += c.spin.x * dt; c.m.rotation.z += c.spin.z * dt;
      if (c.m.position.y < 0.12 && c.v.y < 0) { c.m.position.y = 0.12; c.v.y *= -0.35; c.v.x *= 0.6; c.v.z *= 0.6; c.spin.multiplyScalar(0.6); }
      if (c.age > 3.2) { scene.remove(c.m); c.m.geometry.dispose(); return false; }
      return true;
    });
  }

  /** 🪙 Coin rain over the ring (knockout celebration). */
  function coinRain(n) {
    const cm = SAK.Scene3D._coinMat;
    for (let i = 0; i < n; i++) {
      setTimeout(() => {
        const m = new T.Mesh(new T.CylinderGeometry(0.13, 0.13, 0.04, 10), cm);
        m.position.set((Math.random() - 0.5) * 4.5, 5 + Math.random() * 3, (Math.random() - 0.5) * 3.5);
        m.castShadow = true;
        coinRainList.push({ m, v: new T.Vector3((Math.random() - 0.5) * 1.5, -Math.random() * 2, (Math.random() - 0.5) * 1.5), spin: new T.Vector3(Math.random() * 12, 0, Math.random() * 12), age: 0 });
        scene.add(m);
      }, i * 18);
    }
  }

  /* ============================================================ particles */
  const partGeo = () => new T.OctahedronGeometry(0.07, 0);
  function burst(pos, colors, count, speed) {
    for (let i = 0; i < count; i++) {
      const m = new T.Mesh(partGeo(), new T.MeshBasicMaterial({ color: colors[i % colors.length], transparent: true }));
      m.position.copy(pos);
      const v = new T.Vector3(Math.random() - 0.5, Math.random() * 0.9 + 0.1, Math.random() - 0.5).normalize().multiplyScalar(speed * (0.5 + Math.random()));
      particles.push({ m, v, life: 0.6 + Math.random() * 0.5, age: 0, spin: Math.random() * 10 });
      scene.add(m);
    }
  }
  function ring(pos, color) {
    const m = new T.Mesh(new T.RingGeometry(0.15, 0.25, 20), new T.MeshBasicMaterial({ color, transparent: true, side: T.DoubleSide, depthWrite: false }));
    m.position.copy(pos); m.lookAt(camera.position);
    rings.push({ m, age: 0 }); scene.add(m);
  }
  function updateParticles(dt) {
    particles = particles.filter(p => {
      p.age += dt;
      if (p.age >= p.life) { scene.remove(p.m); p.m.geometry.dispose(); p.m.material.dispose(); return false; }
      if (!p.noGrav) p.v.y -= 6 * dt;
      p.m.position.addScaledVector(p.v, dt);
      p.m.rotation.x += p.spin * dt; p.m.rotation.y += p.spin * dt;
      p.m.material.opacity = 1 - p.age / p.life;
      return true;
    });
    rings = rings.filter(r => {
      r.age += dt;
      if (r.age > 0.35) { scene.remove(r.m); r.m.geometry.dispose(); r.m.material.dispose(); return false; }
      const s = 1 + r.age * 14; r.m.scale.set(s, s, s); r.m.material.opacity = 1 - r.age / 0.35;
      return true;
    });
    // golden fire fist trail
    for (const f of [player, kol]) {
      if (f && f.fire && Math.random() < 0.7) {
        const p = f.slapHand.getWorldPosition(new T.Vector3());
        p.x += (Math.random() - 0.5) * 0.2; p.z += (Math.random() - 0.5) * 0.2;
        const m = new T.Mesh(partGeo(), new T.MeshBasicMaterial({ color: Math.random() < 0.5 ? '#ffb000' : '#ff4a00', transparent: true }));
        m.position.copy(p);
        particles.push({ m, v: new T.Vector3((Math.random() - 0.5) * 0.4, 1.5 + Math.random(), (Math.random() - 0.5) * 0.4), life: 0.45, age: 0, spin: 6 });
        scene.add(m);
      }
    }
  }

  /* =============================================================== camera */
  function frameCamera() {
    const w = container.clientWidth, h = container.clientHeight;
    const aspect = w / Math.max(1, h);
    camera.aspect = aspect;
    // narrower screens => pull back so both fighters fit
    const k = Math.min(1.75, Math.max(1, 0.82 / aspect));
    camK = k;
    const preview = mode === 'pick';
    if (player) player.root.visible = !preview;   // picker focuses on the KOL only
    if (mode === 'menu') {
      // wide establishing shot; fighters sit in the upper half above the logo
      camBase.look.set(-0.6, 0.2 - 0.5 * (k - 1), -0.6);
      const dir = new T.Vector3(1, 0.55, 0.75).normalize();
      camBase.pos.set(0, 1.9, 0).addScaledVector(dir, 6.2 * k);
    } else if (preview) {
      // KOL close-up from the front, kept in the upper half (bottom sheet below)
      camBase.look.set(0, 2.0 - 0.75 * (k - 1), -0.8);
      const dir = new T.Vector3(0.35, 0.12, 1).normalize();
      camBase.pos.set(0, 2.3, -0.8).addScaledVector(dir, 4.1 * k);
    } else if (!koCam) {
      // side three-quarter view: both faces + the slapping arms read clearly
      camBase.look.set(0, 1.75, 0);
      const dir = new T.Vector3(1, 0.42, 0.42).normalize();
      camBase.pos.copy(camBase.look).addScaledVector(dir, 5.9 * k);
      camBase.look.y -= 0.35 * (k - 1); // leave room for the meter at the bottom
      camFight.pos.copy(camBase.pos); camFight.look.copy(camBase.look);
    }
    // during KO fly-out, loop() owns camBase (tracks the loser) — don't overwrite
    camera.updateProjectionMatrix();
    renderer.setSize(w, h, false);
  }

  /* ------------------------------------------------------- slap face-cam */
  // Face close-up framing for fighter F: three-quarter front on the slap side
  // (+x, where every slapping hand enters), slightly above eye level.
  const _faceOff = new T.Vector3(), _sA = new T.Spherical(), _sB = new T.Spherical();
  const _vA = new T.Vector3(), _vB = new T.Vector3(), _face = { pos: new T.Vector3(), look: new T.Vector3() };
  function faceFraming(F, out) {
    const head = F.homeHead || F.headWorld();
    // Fit ~2.1 units of width (head + slapping hand + FX) for this aspect:
    // portrait phones (the usual case) need more distance than landscape.
    const halfV = Math.tan(T.MathUtils.degToRad(45) / 2);
    const dist = Math.min(5.8, Math.max(2.5, 1.0 / (halfV * Math.min(1, camera.aspect || 1))));
    // ~57° off the face normal on the -x side: every slap travels +x → -x, so
    // the struck head snaps TOWARD this camera (full scream/wince face), and the
    // attacker's head/shoulder sits at frame edge instead of masking the face.
    const ang = -1.0;
    // HUD covers the top, meter the bottom — centre the head in what's left
    out.look.set(head.x, head.y - 0.1, head.z);
    _faceOff.set(Math.sin(ang), 0, Math.cos(ang) * F.facing).multiplyScalar(dist);
    out.pos.set(head.x + _faceOff.x, head.y + 1.2, head.z + _faceOff.z);
    return out;
  }

  /** Blend fight framing → face framing by w, orbiting (spherical) not cutting. */
  function orbitBlend(a, b, w, out) {
    out.look.lerpVectors(a.look, b.look, w);
    _sA.setFromVector3(_vA.subVectors(a.pos, a.look));
    _sB.setFromVector3(_vB.subVectors(b.pos, b.look));
    let dTheta = _sB.theta - _sA.theta;
    while (dTheta > Math.PI) dTheta -= Math.PI * 2;
    while (dTheta < -Math.PI) dTheta += Math.PI * 2;
    _sA.set(
      _sA.radius + (_sB.radius - _sA.radius) * w,
      _sA.phi + (_sB.phi - _sA.phi) * w,
      _sA.theta + dTheta * w
    );
    out.pos.setFromSpherical(_sA).add(out.look);
  }

  /* ================================================================= loop */
  function loop() {
    const dt = Math.min(0.05, clock.getDelta());
    time += dt;
    SAK.Tween.update(dt);
    if (player) player.update(dt);
    if (kol) kol.update(dt);
    updateParticles(dt);
    updateArena(dt);
    for (const c of candles) {
      if (c.userData.crowd) c.position.y = 0.45 + Math.abs(Math.sin(time * 4 + c.userData.phase)) * 0.12;
      else c.position.y = c.userData.baseY + Math.sin(time * 0.8 + c.userData.phase) * 0.15;
    }
    for (const c of coins) { c.rotation.z += dt * 1.5; c.position.y += Math.sin(time * 1.3 + c.userData.phase) * 0.003; }

    // KO camera: hard-track the loser through fly-out AND landing pose
    if (koCam) {
      const F = koCam.track;
      if (F && F.root) {
        const head = F.headWorld();
        const landed = F.ko && F.ko.phase === 'land';
        // Aim at the skull; drop look floor once they pancake so the pose reads
        const lookY = Math.max(landed ? 0.12 : 0.35, head.y - (landed ? 0.05 : 0.2));
        camBase.look.set(head.x, lookY, head.z);
        // Ride a three-quarter offset; ease a touch closer on the landing beat
        const off = koCam.offset || new T.Vector3(5.2, 2.6, 3.4);
        const pull = landed ? 0.82 : 1;
        camBase.pos.set(
          head.x + off.x * pull,
          Math.max(landed ? 1.35 : 1.8, head.y + off.y * (landed ? 0.7 : 1)),
          head.z + off.z * pull
        );
      }
      if (time > koCam.until) koCam = null;
    } else if (hitCam && hitCam.target && mode !== 'menu' && mode !== 'pick') {
      // Slap face-cam: orbit from the fight framing onto the defender's face
      const F = hitCam.target;
      faceFraming(F, _face);
      // follow the head's recoil a little so the reaction stays centred
      const live = F.headWorld(_vA);
      const home = F.homeHead || live;
      _face.look.x += (live.x - home.x) * 0.9;
      _face.look.y += (live.y - home.y) * 0.9;
      _face.look.z += (live.z - home.z) * 0.9;
      orbitBlend(camFight, _face, hitCam.w, camBase);
    }
    // smooth camera + shake (snappier during KO pullback)
    const camLerp = koCam ? (1 - Math.pow(0.00005, dt)) : (1 - Math.pow(0.001, dt));
    camCur.pos.lerp(camBase.pos, camLerp);
    camCur.look.lerp(camBase.look, camLerp);
    camera.position.copy(camCur.pos);
    if (shake > 0) {
      // close-ups magnify shake — tame it while the face-cam is in tight
      const sh = shake * ((!koCam && hitCam) ? (1 - 0.45 * hitCam.w) : 1);
      camera.position.x += (Math.random() - 0.5) * sh;
      camera.position.y += (Math.random() - 0.5) * sh;
      shake = Math.max(0, shake - dt * (koCam ? 1.1 : 1.6));
    }
    camera.lookAt(camCur.look);
    renderer.render(scene, camera);
    requestAnimationFrame(loop);
  }

  /* ================================================================ API */
  function init(el) {
    container = el;
    renderer = new T.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = T.PCFSoftShadowMap;
    if ('outputColorSpace' in renderer) renderer.outputColorSpace = T.SRGBColorSpace;
    container.appendChild(renderer.domElement);

    scene = new T.Scene();
    scene.fog = new T.Fog('#2a0b5e', 16, 34);
    camera = new T.PerspectiveCamera(45, 1, 0.1, 100);

    scene.add(new T.HemisphereLight('#ffffff', '#9b6bff', 2.0));
    const sun = new T.DirectionalLight('#fff4e0', 2.6);
    sun.position.set(6, 9, 3);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    Object.assign(sun.shadow.camera, { left: -4, right: 4, top: 4, bottom: -4, near: 1, far: 25 });
    scene.add(sun);
    const rim = new T.DirectionalLight('#7ad7ff', 1.2); rim.position.set(-5, 4, -6); scene.add(rim);

    buildArena();
    clock = new T.Clock();
    frameCamera();
    camCur.pos.copy(camBase.pos); camCur.look.copy(camBase.look);
    new ResizeObserver(frameCamera).observe(container);
    window.addEventListener('resize', frameCamera);
    loop();
  }

  function setPlayer(look) {
    if (player) player.dispose();
    player = new Fighter(look, -1, -1);   // player slaps with right hand (local -x)
    scene.add(player.root);
  }

  function setOpponent(look) {
    if (kol) kol.dispose();
    kol = new Fighter(look, +1, +1);      // KOL slaps with left hand (camera side)
    scene.add(kol.root);
  }

  function setMode(m) { mode = m; frameCamera(); }

  function resetFight() {
    SAK.Tween.clear();
    koCam = null;
    endHitCam(true);
    if (player) { player.resetPose(); player.setFire(false); }
    if (kol) { kol.resetPose(); kol.setFire(false); }
    if (mode === 'fight' || mode === 'arena') frameCamera();
  }

  /** Spawn dizzy ★ stars that orbit the defender's head for a beat. */
  function spawnHitStars(F, count) {
    if (count <= 0) return null;
    const g = new T.Group();
    const starMat = new T.MeshBasicMaterial({ color: '#ffd23f' });
    for (let i = 0; i < count; i++) {
      const ang = (i / count) * Math.PI * 2;
      const s = new T.Mesh(new T.OctahedronGeometry(0.09, 0), starMat.clone());
      s.position.set(Math.cos(ang) * 0.55, 0.75, Math.sin(ang) * 0.55);
      s.scale.set(1, 1.35, 0.55);
      g.add(s);
    }
    F.head.add(g);
    return g;
  }

  /** Apply tiered cartoon damage reaction to the defender (no gore). */
  function applyHitReact(D, tier, fire) {
    const R = HIT_REACT[tier] || HIT_REACT.light;
    const fireMul = fire ? 1.35 : 1;
    const hp = D.headWorld(); hp.x += 0.35; hp.y -= 0.05;
    // Head snap + body wobble (springs)
    const k = R.yaw * fireMul;
    D.yaw.v += -D.facing * k;
    D.roll.v += -(R.roll * fireMul);
    // Lean-back flinch, then settle; medium+ get a delayed wobble kick
    SAK.Tween.to(D.pose, { lean: R.lean }, 0.08, SAK.Ease.outCubic);
    setTimeout(() => SAK.Tween.to(D.pose, { lean: 0 }, 0.35, SAK.Ease.inOutQuad), 140 + R.mouthMs * 0.25);
    if (tier === 'medium' || tier === 'heavy' || tier === 'perfect') {
      setTimeout(() => { if (!D.ko) D.roll.v += (Math.random() > 0.5 ? 1 : -1) * R.roll * 0.5; }, 110);
      setTimeout(() => { if (!D.ko) D.yaw.v += -D.facing * R.yaw * 0.28; }, 200);
    }
    // Wince (light/medium) or scream face (heavy/perfect)
    D.mouth.scale.set(R.mouthX || 1, R.mouthY, 1);
    if (D.eyes) D.eyes.scale.set(R.eyeSx || 1, R.eyeSy || 1, 1);
    setTimeout(() => {
      if (D.ko) return;
      D.mouth.scale.set(1, 1, 1);
      if (D.eyes) D.eyes.scale.set(1, 1, 1);
    }, R.mouthMs);
    // Tiny cartoon hop on heavier hits
    if (R.hop) {
      const y0 = D.root.position.y;
      SAK.Tween.to(D.root.position, { y: y0 + R.hop }, 0.07, SAK.Ease.outCubic)
        .then(() => { if (!D.ko) return SAK.Tween.to(D.root.position, { y: y0 }, 0.18, SAK.Ease.inCubic); });
    }
    // Face squash
    D.clearHitFX();
    D.hitFX = {
      until: time + R.squashDur, dur: R.squashDur,
      sx: R.sx, sy: R.sy, sz: R.sz,
      stars: spawnHitStars(D, R.stars)
    };
    // Impact FX
    const cols = fire ? ['#ffd000', '#ff7a00', '#ff3b00', '#fff3a0', ...R.colors] : R.colors;
    burst(hp, cols, fire ? R.burstN + 12 : R.burstN, fire ? R.burstSpd + 1.2 : R.burstSpd);
    ring(hp, fire ? '#ffb000' : R.ring);
    if (tier === 'heavy' || tier === 'perfect') {
      ring(hp.clone().add(new T.Vector3(0, 0.1, 0)), tier === 'perfect' ? '#ff4fd8' : '#ff9a1f');
    }
    shake = Math.max(shake, R.shake + (fire ? 0.18 : 0));
    D.setDamage(Math.min(0.85, (D.blushMat.opacity / 0.9) + R.blushAdd));
    // Yelp slightly after contact so the slap "lands" first
    const yelpTier = tier;
    setTimeout(() => { if (SAK.Audio && SAK.Audio.yelp) SAK.Audio.yelp(yelpTier); }, (R.yelpDelay || 0) * 1000);
    return R;
  }

  /** Begin the face-cam on defender D. Returns the cam token. */
  function startHitCam(D, peak) {
    D.homeHead = D.headWorld(new T.Vector3());
    hitCam = { target: D, w: hitCam && hitCam.target === D ? hitCam.w : 0, peak: peak };
    return hitCam;
  }
  /** Ease the face-cam back to the fight framing (or snap off). */
  async function endHitCam(snap, cam) {
    const hc = cam || hitCam;
    if (!hc) return;
    if (!snap) {
      await SAK.Tween.to(hc, { w: 0 }, 0.8, SAK.Ease.inOutQuad);
      if (hitCam !== hc) return;   // superseded by a newer slap / KO
    }
    if (hitCam === hc) {
      hitCam = null;
      if (!koCam && mode !== 'menu' && mode !== 'pick') { camBase.pos.copy(camFight.pos); camBase.look.copy(camFight.look); }
    }
  }

  /**
   * Full slap animation.
   * @param who      'player' | 'kol' (the attacker)
   * @param opts     { grade:'perfect'|'good'|'weak'|'miss', fire:bool, dist:number, windup:sec, onImpact:fn }
   */
  async function slap(who, opts) {
    const A = who === 'player' ? player : kol, D = who === 'player' ? kol : player;
    const p = A.pose, E = SAK.Ease;
    const tier = reactTier(opts.grade, opts.fire, opts.dist);
    if (opts.fire) A.setFire(true);

    // Face-cam: orbit toward the fighter about to be slapped so the hit
    // reaction reads on their FACE. Anticipation drift during wind-up, fast
    // cinematic swing in on the strike, hold through the reaction, ease back.
    // Stuffed (defender won) / light hits get a shallower swing.
    const landsHit = opts.grade !== 'miss' && !!tier;
    const peak = !landsHit ? 0.45 : (opts.landed === false ? 0.7 : 1);
    const cam = startHitCam(D, peak);
    const windup = opts.windup || 0.42;
    SAK.Tween.to(cam, { w: peak * 0.4 }, windup + 0.06, E.inOutQuad);

    // 1) wind-up: arm out and back, torso twists away
    await SAK.Tween.to(p, { lift: 2.5, swing: 0.9, elbow: 1.3, twist: A.armSide * 0.55, lean: -0.1 }, windup, E.outCubic);
    if (opts.onWindupDone) opts.onWindupDone();
    await wait(0.06);

    // 2) strike: fast forward arc across the face
    SAK.Audio.whoosh();
    if (hitCam === cam) SAK.Tween.to(cam, { w: peak }, 0.42, E.outCubic); // swing in to the face through contact
    if (opts.grade === 'miss') SAK.Tween.to(D.pose, { lean: -0.32 }, 0.12, E.outCubic); // dodge
    const strike = SAK.Tween.to(p, { lift: 2.25, swing: -2.05, elbow: 0.1, twist: -A.armSide * 0.5, lean: 0.2, lunge: 0.3 }, 0.16, E.inCubic);
    await wait(0.1);
    if (opts.grade !== 'miss' && tier) {
      const R = applyHitReact(D, tier, !!opts.fire);
      const hp = D.headWorld();
      if (opts.onImpact) opts.onImpact(hp);
      // Cartoon hit-stop — longer for heavier tiers
      if (R.hitStop) await wait(R.hitStop);
    } else if (opts.onImpact) opts.onImpact(null);
    await strike;
    await wait(0.12);

    // 3) recover — hold on the reaction face a beat, then ease back for next round
    if (opts.grade === 'miss') SAK.Tween.to(D.pose, { lean: 0 }, 0.3);
    A.setFire(false);
    const holdS = tier === 'perfect' || tier === 'heavy' ? 0.42 : 0.28;
    wait(holdS).then(() => { if (hitCam === cam && !koCam) endHitCam(false, cam); });
    await SAK.Tween.to(p, { lift: 0.12, swing: 0, elbow: 0.15, twist: 0, lean: 0, lunge: 0 }, 0.38, E.inOutQuad);
  }

  /** Send the loser flying backwards off the ring. Resolves when done.
   *  Camera hard-tracks through fly-out + slapstick landing pose. */
  async function knockout(who) {
    const F = who === 'player' ? player : kol;
    endHitCam(true); // KO follow-cam takes over from the face-cam
    F.xEyes.visible = true; F.eyes.visible = false;
    F.mouth.scale.set(1, 3, 1);

    // Impact beat: big shake + star burst + shock rings (no gore)
    const hp = F.headWorld();
    shake = 1.2;
    burst(hp, ['#39ff88', '#ff4fd8', '#ffd23f', '#ffffff', '#ff7a9a'], 58, 8.5);
    ring(hp, '#ffd23f');
    ring(hp.clone().add(new T.Vector3(0, 0.12, 0)), '#ff4fd8');
    await wait(0.1); // tiny cartoon hit-stop

    // Stronger fly-out: higher arc, farther smack, more spin
    // facing +1 => fly to -z (away from camera); player flies towards +z / camera-left
    const landPose = pickLandPose();
    F.ko = {
      phase: 'fly',
      landPose,
      vel: new T.Vector3(-5.2 + Math.random() * 2.2, 13.5 + Math.random() * 3, -F.facing * (13.5 + Math.random() * 2)),
      spin: new T.Vector3(-F.facing * (18 + Math.random() * 8), 5 + Math.random() * 8, 14 + Math.random() * 6)
    };
    shake = Math.max(shake, 0.7);
    burst(F.headWorld(), ['#ffd23f', '#ffffff', '#39ff88'], 24, 5);

    // Follow-cam: lock onto the loser through fly-out AND landing
    const head0 = F.headWorld();
    const followOff = new T.Vector3(5.2, 2.6, 3.4); // pulled-back three-quarter
    camBase.look.set(head0.x, Math.max(0.35, head0.y - 0.2), head0.z);
    camBase.pos.set(head0.x + followOff.x, Math.max(1.8, head0.y + followOff.y), head0.z + followOff.z);
    const fov0 = camera.fov;
    camera.fov = Math.min(58, fov0 + 10);
    camera.updateProjectionMatrix();
    koCam = { track: F, offset: followOff, until: time + 8 }; // cleared after landing beat

    // Wait until they actually hit the dirt (safety cap ~4s)
    const t0 = time;
    while (!(F.ko && F.ko.phase === 'land') && time - t0 < 4) await wait(0.05);
    // Hold on the awkward pose so the gag lands before the result card
    await wait(0.95);

    koCam = null;
    camera.fov = fov0;
    camera.updateProjectionMatrix();
    frameCamera(); // restore fight framing for result transition
  }

  function setFireArmed(on) { if (player) player.setFire(on); }

  function setHelmet(on) { if (player) player.helmet.visible = !!on; }
  function setRage(on) { if (player) player.rage.visible = !!on; }

  function setBrace(on) { if (player) SAK.Tween.to(player.pose, { guard: on ? 1 : 0, lean: on ? -0.1 : 0 }, 0.12); }

  /** Project a fighter's head into container pixel coords (for floating text). */
  function screenPos(who) {
    const F = who === 'player' ? player : kol;
    if (!F) return { x: 0, y: 0 };
    const v = F.headWorld().project(camera);
    return { x: (v.x + 1) / 2 * container.clientWidth, y: (1 - v.y) / 2 * container.clientHeight };
  }

  /** Idle "taunt" bounce used on the picker screen. */
  function taunt() {
    if (!kol || kol.ko) return;
    const p = kol.pose;
    SAK.Tween.to(p, { lift: 2.6, swing: -0.3, elbow: 1.2 }, 0.25, SAK.Ease.outBack)
      .then(() => wait(0.35)).then(() => SAK.Tween.to(p, { lift: 0.12, swing: 0, elbow: 0.15 }, 0.3));
    kol.yaw.v += 3;
  }

  /** Flash laser eyes on a fighter for `dur` seconds. */
  function laserEyes(who, dur) {
    const F = who === 'player' ? player : kol;
    if (F) F.laserUntil = time + (dur || 1);
  }

  return { init, setPlayer, setOpponent, setMode, resetFight, slap, knockout, setFireArmed, setBrace, screenPos, taunt, coinRain, laserEyes, setHelmet, setRage,
    get player() { return player; }, get kol() { return kol; },
    get camDebug() { return { hit: hitCam ? +hitCam.w.toFixed(3) : null, ko: !!koCam, t: +time.toFixed(2) }; } };
})();
