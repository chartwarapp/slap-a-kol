/* =========================================================================
 * Semi-circular power meter (SVG). Red → orange → yellow → green (centre).
 * Multi-instance factory: attack meters can run JERKY unpredictable speed.
 * lock() returns zone + distance-from-center for dual-meter challenge scoring.
 * ========================================================================= */
window.SAK = window.SAK || {};

SAK.createMeter = function (el, opts) {
  opts = opts || {};
  const CX = 100, CY = 100, R = 78, W = 26;
  let svg, needle, running = false, angle = -90, dir = 1, speed = 150;
  let raf = 0, last = 0, frozen = false, jerky = !!opts.jerky;
  let nextJerkAt = 0, baseSpeed = 150;

  const rad = d => (d - 90) * Math.PI / 180;
  const pt = (d, r) => [CX + r * Math.cos(rad(d)), CY + r * Math.sin(rad(d))];

  function arcPath(a0, a1, r) {
    const [x0, y0] = pt(a0, r), [x1, y1] = pt(a1, r);
    return `M${x0.toFixed(2)} ${y0.toFixed(2)} A${r} ${r} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
  }

  function build() {
    const zones = SAK.METER.zones;
    let segs = '';
    for (let i = zones.length - 1; i >= 0; i--) {
      const z = zones[i];
      segs += `<path d="${arcPath(-z.maxAngle, z.maxAngle, R)}" stroke="${z.color}" stroke-width="${W}" fill="none"/>`;
    }
    let ticks = '';
    zones.slice(0, -1).forEach(z => {
      for (const s of [-1, 1]) {
        const [x0, y0] = pt(s * z.maxAngle, R - W / 2), [x1, y1] = pt(s * z.maxAngle, R + W / 2);
        ticks += `<line x1="${x0}" y1="${y0}" x2="${x1}" y2="${y1}" stroke="#0005" stroke-width="2"/>`;
      }
    });
    const label = opts.label ? `<text x="100" y="108" text-anchor="middle" class="meter-role-label">${opts.label}</text>` : '';
    el.innerHTML = `
      <svg viewBox="0 0 200 118" class="meter-svg">
        <path d="${arcPath(-90, 90, R)}" stroke="#2a1458" stroke-width="${W + 12}" fill="none" stroke-linecap="round"/>
        ${segs}${ticks}
        <path d="${arcPath(-90, 90, R + W / 2 + 1)}" stroke="#fff" stroke-width="3" fill="none" opacity=".9"/>
        <text x="100" y="${CY - R - W / 2 - 4}" text-anchor="middle" class="meter-perfect">★</text>
        <g class="meter-needle" transform="rotate(-90 ${CX} ${CY})">
          <polygon points="${CX - 6},${CY} ${CX + 6},${CY} ${CX + 1.5},${CY - R - 10} ${CX - 1.5},${CY - R - 10}" fill="#fff" stroke="#1a0b3a" stroke-width="2.5" stroke-linejoin="round"/>
        </g>
        <circle cx="${CX}" cy="${CY}" r="12" fill="#1a0b3a"/><circle cx="${CX}" cy="${CY}" r="7" fill="#ffd23f"/>
        ${label}
      </svg>`;
    svg = el.querySelector('svg');
    needle = el.querySelector('.meter-needle');
  }

  function render() {
    if (needle) needle.setAttribute('transform', `rotate(${angle.toFixed(2)} ${CX} ${CY})`);
  }

  function scheduleJerk(now) {
    const C = SAK.CHALLENGE || {};
    const lo = (C.jerkyInterval && C.jerkyInterval[0]) || 0.12;
    const hi = (C.jerkyInterval && C.jerkyInterval[1]) || 0.42;
    nextJerkAt = now + (lo + Math.random() * (hi - lo));
  }

  function applyJerk() {
    const C = SAK.CHALLENGE || {};
    const minS = C.jerkyMin || 70;
    const maxS = C.jerkyMax || 340;
    // Unpredictable: big speed jumps + occasional mid-swing reverse
    speed = minS + Math.random() * (maxS - minS);
    if (Math.random() < 0.28) dir *= -1;
    // Rare micro-stutter freeze-feel via very low speed
    if (Math.random() < 0.12) speed = minS * 0.35;
  }

  function tick(ts) {
    if (!running) return;
    const dt = Math.min(0.05, (ts - last) / 1000 || 0); last = ts;
    if (!frozen) {
      if (jerky) {
        const now = ts / 1000;
        if (now >= nextJerkAt) { applyJerk(); scheduleJerk(now); }
      }
      angle += dir * speed * dt;
      if (angle > 90) { angle = 90 - (angle - 90); dir = -1; }
      if (angle < -90) { angle = -90 + (-90 - angle); dir = 1; }
      render();
    }
    raf = requestAnimationFrame(tick);
  }

  function gradeFor(a) {
    const abs = Math.abs(a);
    return SAK.METER.zones.find(z => abs <= z.maxAngle) || SAK.METER.zones[SAK.METER.zones.length - 1];
  }

  build();

  return {
    el,
    setJerky(v) { jerky = !!v; },
    /** Start swinging at `degPerSec` (base). Jerky mode overrides with random jumps. */
    start(degPerSec) {
      baseSpeed = degPerSec || 150;
      speed = baseSpeed;
      frozen = false;
      angle = -90 + Math.random() * 40;
      dir = Math.random() < 0.5 ? 1 : -1;
      if (jerky) {
        applyJerk();
        scheduleJerk(performance.now() / 1000);
      }
      if (!running) {
        running = true;
        last = performance.now();
        raf = requestAnimationFrame(tick);
      }
    },
    stop() { running = false; cancelAnimationFrame(raf); },
    /** Freeze the needle and return grade + distance from green centre. */
    lock() {
      if (frozen) return { zone: gradeFor(angle), angle, dist: Math.abs(angle), already: true };
      frozen = true;
      return { zone: gradeFor(angle), angle, dist: Math.abs(angle), already: false };
    },
    unfreeze() { frozen = false; },
    get angle() { return angle; },
    get frozen() { return frozen; },
    get running() { return running; },
    /** Force needle to a specific angle (AI lock-in). */
    forceLock(targetAngle) {
      angle = Math.max(-90, Math.min(90, targetAngle));
      frozen = true;
      render();
      return { zone: gradeFor(angle), angle, dist: Math.abs(angle), already: false };
    }
  };
};

/** Legacy singleton wrapper (single-meter screens / debug). */
SAK.Meter = (function () {
  let inst = null;
  return {
    build(el) { inst = SAK.createMeter(el, {}); return inst; },
    start(s) { inst && inst.start(s); },
    stop() { inst && inst.stop(); },
    lock() { return inst ? inst.lock() : { zone: SAK.METER.zones[3], angle: 90, dist: 90 }; },
    unfreeze() { inst && inst.unfreeze(); },
    get angle() { return inst ? inst.angle : 0; }
  };
})();
