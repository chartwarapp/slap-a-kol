/* =========================================================================
 * Tiny WebAudio synth — no audio files needed.
 * ========================================================================= */
window.SAK = window.SAK || {};

SAK.Audio = (function () {
  let ctx = null, master = null, noiseBuf = null;

  function enabled() { return SAK.Storage.state.settings.sound; }

  // Must be called from a user gesture (browser autoplay policy).
  function unlock() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.5;
    master.connect(ctx.destination);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 0.6, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }

  function ready() { return ctx && enabled(); }

  function noise(dur, freq, q, gain, type) {
    const src = ctx.createBufferSource(); src.buffer = noiseBuf;
    const f = ctx.createBiquadFilter(); f.type = type || 'bandpass'; f.frequency.value = freq; f.Q.value = q;
    const g = ctx.createGain(); const t = ctx.currentTime;
    g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f); f.connect(g); g.connect(master);
    src.start(t); src.stop(t + dur + 0.05);
    return f;
  }

  function tone(freq, dur, type, gain, when, slideTo) {
    const o = ctx.createOscillator(); const g = ctx.createGain();
    const t = ctx.currentTime + (when || 0);
    o.type = type || 'sine'; o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain || 0.3, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(master); o.start(t); o.stop(t + dur + 0.05);
  }

  return {
    unlock,
    slap(strength) {          // strength 0..1+
      if (!ready()) return;
      const s = Math.min(1.5, strength);
      noise(0.12 + 0.08 * s, 2200, 0.8, 0.9 * Math.max(0.3, s));
      noise(0.05, 5000, 1.2, 0.5);
      tone(140, 0.12, 'sine', 0.5 * s, 0, 60);
    },
    whoosh() { if (!ready()) return; const f = noise(0.22, 600, 1.5, 0.25); f.frequency.exponentialRampToValueAtTime(2400, ctx.currentTime + 0.2); },
    miss() { if (!ready()) return; tone(400, 0.25, 'triangle', 0.15, 0, 180); },
    perfect() { if (!ready()) return; [880, 1108, 1318].forEach((f, i) => tone(f, 0.3, 'triangle', 0.18, i * 0.05)); },
    coin() { if (!ready()) return; tone(988, 0.08, 'square', 0.12); tone(1318, 0.25, 'square', 0.12, 0.08); },
    click() { if (!ready()) return; tone(660, 0.05, 'square', 0.08); },
    fire() { if (!ready()) return; noise(0.5, 900, 0.6, 0.4, 'lowpass'); tone(220, 0.5, 'sawtooth', 0.15, 0, 880); },
    ko() { if (!ready()) return; tone(520, 0.7, 'sawtooth', 0.2, 0, 90); noise(0.4, 300, 0.7, 0.6, 'lowpass'); },
    win() { if (!ready()) return; [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.35, 'triangle', 0.2, i * 0.11)); },
    lose() { if (!ready()) return; [392, 330, 262].forEach((f, i) => tone(f, 0.45, 'sine', 0.2, i * 0.18)); },
    brace() { if (!ready()) return; tone(300, 0.1, 'square', 0.12); },
    /** Cartoon pain yelp — louder / lower for bigger hit tiers. */
    yelp(tier) {
      if (!ready()) return;
      const t = tier || 'light';
      if (t === 'light') {
        tone(560, 0.07, 'square', 0.11, 0, 400);
      } else if (t === 'medium') {
        tone(500, 0.1, 'square', 0.15, 0, 320);
        tone(210, 0.12, 'triangle', 0.1, 0.03, 130);
      } else if (t === 'heavy') {
        tone(400, 0.14, 'sawtooth', 0.2, 0, 170);
        noise(0.12, 900, 1.0, 0.28);
        tone(150, 0.2, 'sine', 0.16, 0.05, 70);
      } else { // perfect
        tone(360, 0.18, 'sawtooth', 0.24, 0, 130);
        tone(980, 0.09, 'square', 0.12, 0.03, 520);
        noise(0.16, 700, 0.85, 0.38);
        tone(110, 0.28, 'sine', 0.22, 0.06, 55);
      }
    }
  };
})();
