/* =========================================================================
 * Semi-circular power meter (SVG). Red → orange → yellow → green (centre).
 * The needle sweeps with a triangle wave; lock() returns the grade.
 * ========================================================================= */
window.SAK = window.SAK || {};

SAK.Meter = (function () {
  const CX = 100, CY = 100, R = 78, W = 26;
  let svg, needle, running = false, angle = -90, dir = 1, speed = 150, raf = 0, last = 0, frozen = false;

  const rad = d => (d - 90) * Math.PI / 180;           // 0° = straight up
  const pt = (d, r) => [CX + r * Math.cos(rad(d)), CY + r * Math.sin(rad(d))];

  function arcPath(a0, a1, r) {
    const [x0, y0] = pt(a0, r), [x1, y1] = pt(a1, r);
    return `M${x0.toFixed(2)} ${y0.toFixed(2)} A${r} ${r} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
  }

  function build(el) {
    const zones = SAK.METER.zones;
    let segs = '';
    // draw from outside in so inner (green) zone sits on top
    for (let i = zones.length - 1; i >= 0; i--) {
      const z = zones[i];
      segs += `<path d="${arcPath(-z.maxAngle, z.maxAngle, R)}" stroke="${z.color}" stroke-width="${W}" fill="none"/>`;
    }
    // tick marks between zones
    let ticks = '';
    zones.slice(0, -1).forEach(z => {
      for (const s of [-1, 1]) {
        const [x0, y0] = pt(s * z.maxAngle, R - W / 2), [x1, y1] = pt(s * z.maxAngle, R + W / 2);
        ticks += `<line x1="${x0}" y1="${y0}" x2="${x1}" y2="${y1}" stroke="#0005" stroke-width="2"/>`;
      }
    });
    el.innerHTML = `
      <svg viewBox="0 0 200 112" class="meter-svg">
        <path d="${arcPath(-90, 90, R)}" stroke="#2a1458" stroke-width="${W + 12}" fill="none" stroke-linecap="round"/>
        ${segs}${ticks}
        <path d="${arcPath(-90, 90, R + W / 2 + 1)}" stroke="#fff" stroke-width="3" fill="none" opacity=".9"/>
        <text x="100" y="${CY - R - W / 2 - 4}" text-anchor="middle" class="meter-perfect">★</text>
        <g class="meter-needle" transform="rotate(-90 ${CX} ${CY})">
          <polygon points="${CX - 6},${CY} ${CX + 6},${CY} ${CX + 1.5},${CY - R - 10} ${CX - 1.5},${CY - R - 10}" fill="#fff" stroke="#1a0b3a" stroke-width="2.5" stroke-linejoin="round"/>
        </g>
        <circle cx="${CX}" cy="${CY}" r="12" fill="#1a0b3a"/><circle cx="${CX}" cy="${CY}" r="7" fill="#ffd23f"/>
      </svg>`;
    svg = el.querySelector('svg');
    needle = el.querySelector('.meter-needle');
  }

  function render() { needle.setAttribute('transform', `rotate(${angle.toFixed(2)} ${CX} ${CY})`); }

  function tick(ts) {
    if (!running) return;
    const dt = Math.min(0.05, (ts - last) / 1000 || 0); last = ts;
    if (!frozen) {
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

  return {
    build,
    /** Start swinging at `degPerSec`. */
    start(degPerSec) {
      speed = degPerSec; frozen = false;
      if (!running) { running = true; last = performance.now(); angle = -90 + Math.random() * 30; dir = 1; raf = requestAnimationFrame(tick); }
    },
    stop() { running = false; cancelAnimationFrame(raf); },
    /** Freeze the needle and return the zone it landed in. */
    lock() { frozen = true; return { zone: gradeFor(angle), angle }; },
    unfreeze() { frozen = false; },
    get angle() { return angle; }
  };
})();
