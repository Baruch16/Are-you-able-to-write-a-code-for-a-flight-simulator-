/* ==========================================================================
 * music.js — original generative soundtrack, synthesized live (no files)
 *
 * A small step sequencer drives synthesizer voices (pads, bass, arpeggio,
 * lead, drums) through a generated reverb. Two themes:
 *   MENU   — "Kestrel Theme": a broad D-minor anthem.
 *   FLIGHT — "Open Sky": an airy score that adapts to how you fly. Calm
 *            cruising = soft pads; speed, G, low-level flying and warnings
 *            bring in bass, arpeggios, melody and drums.
 * Plus short stingers for a good landing and for a crash.
 * ========================================================================== */
(function (root) {
  'use strict';
  const SIM = root.SIM = root.SIM || {};
  const U = SIM.util;
  const M = SIM.music = { theme: null, mode: 'adaptive', intensity: 0.2, target: 0.2 };

  const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
  const _ = null;

  // ---------------- compositions ---------------------------------------------
  // chords: { bass: MIDI root, pad: MIDI notes }, one chord per bar.
  // melody: 8 eighth-note slots per bar (null = rest).
  const THEMES = {
    menu: {
      bpm: 92,
      chords: [
        { bass: 38, pad: [62, 65, 69] }, { bass: 34, pad: [58, 62, 65] }, { bass: 41, pad: [60, 65, 69] }, { bass: 36, pad: [60, 64, 67] },
        { bass: 38, pad: [62, 65, 69] }, { bass: 34, pad: [58, 62, 65] }, { bass: 43, pad: [62, 67, 70] }, { bass: 45, pad: [61, 64, 69] }
      ],
      melody: [
        [69, _, 74, _, 76, 77, 76, _], [74, _, _, _, 77, _, 74, _], [72, _, 77, _, 81, _, 79, 77], [76, _, _, _, 79, _, 76, _],
        [81, _, 79, 77, 76, _, 74, _], [77, _, 74, _, 70, _, 74, _], [67, _, 70, _, 74, _, 79, _], [76, _, 73, _, 69, _, _, _]
      ],
      // fixed arrangement by pass through the 8 bars
      arrange: (pass) => [
        { pad: 1, bass: 0.6, arp: 0, lead: 0, drums: 0 },
        { pad: 1, bass: 1, arp: 1, lead: 0, drums: 0 },
        { pad: 1, bass: 1, arp: 1, lead: 1, drums: 1 },
        { pad: 1, bass: 0.8, arp: 0.6, lead: 1, drums: 0 }
      ][pass % 4]
    },
    flight: {
      bpm: 84,
      chords: [
        { bass: 41, pad: [65, 69, 72, 76] }, { bass: 43, pad: [67, 71, 74] }, { bass: 40, pad: [64, 67, 71, 74] }, { bass: 45, pad: [64, 69, 72] },
        { bass: 38, pad: [62, 65, 69, 72] }, { bass: 43, pad: [67, 71, 74] }, { bass: 36, pad: [64, 67, 72] }, { bass: 40, pad: [64, 68, 71] }
      ],
      melody: [
        [76, _, _, 79, _, _, 77, _], [74, _, _, _, 71, _, 74, _], [76, _, 79, _, 83, _, 81, 79], [76, _, _, _, _, _, _, _],
        [77, _, 76, _, 74, _, 72, _], [74, _, _, 71, _, _, 67, _], [72, _, 74, _, 76, _, 79, _], [80, _, _, _, 76, _, _, _]
      ],
      // layers fade in with flight intensity
      arrange: (pass, k) => ({
        pad: 1,
        bass: U.smoothstep(0.15, 0.35, k),
        arp: U.smoothstep(0.3, 0.5, k),
        lead: pass % 2 === 1 ? U.smoothstep(0.4, 0.55, k) : 0,
        drums: U.smoothstep(0.55, 0.75, k),
        fastArp: k > 0.65,
        snare: k > 0.8
      })
    }
  };

  // ---------------- audio graph -------------------------------------------
  function impulse(ctx, secs, decay) {
    const n = Math.floor(ctx.sampleRate * secs), b = ctx.createBuffer(2, n, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = b.getChannelData(c);
      for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, decay);
    }
    return b;
  }

  M.init = function (ctx, out) {
    if (M.ctx) return;
    M.ctx = ctx;
    M.out = ctx.createGain(); M.out.gain.value = 1; M.out.connect(out);
    M.dry = ctx.createGain(); M.dry.gain.value = 0.8; M.dry.connect(M.out);
    M.verb = ctx.createConvolver(); M.verb.buffer = impulse(ctx, 2.8, 2.6);
    M.wet = ctx.createGain(); M.wet.gain.value = 0.35; M.verb.connect(M.wet); M.wet.connect(M.out);
    M.bus = ctx.createGain(); M.bus.gain.value = 0.55;
    M.bus.connect(M.dry); M.bus.connect(M.verb);
    // shared noise for drums
    const n = ctx.sampleRate, nb = ctx.createBuffer(1, n, ctx.sampleRate), d = nb.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    M.noise = nb;
    M.step = 0; M.pass = 0; M.nextTime = 0;
    M.timer = setInterval(schedule, 40);
  };

  // ---------------- voices -----------------------------------------------
  function env(g, t, a, peak, hold, rel) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + a);
    g.gain.setValueAtTime(peak, t + a + hold);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + hold + rel);
  }
  function voice(type, freq, t, dur, opts) {
    const ctx = M.ctx, o = ctx.createOscillator(), g = ctx.createGain(), f = ctx.createBiquadFilter();
    o.type = type; o.frequency.value = freq;
    if (opts.detune) o.detune.value = opts.detune;
    f.type = 'lowpass'; f.frequency.value = opts.cutoff || 2000; f.Q.value = opts.q || 0.7;
    if (opts.sweep) { f.frequency.setValueAtTime(opts.sweep[0], t); f.frequency.exponentialRampToValueAtTime(opts.sweep[1], t + dur); }
    env(g, t, opts.a || 0.01, opts.vol, opts.hold || 0, opts.rel || dur);
    o.connect(f); f.connect(g); g.connect(opts.dest || M.bus);
    o.start(t); o.stop(t + (opts.a || 0.01) + (opts.hold || 0) + (opts.rel || dur) + 0.05);
  }
  function pad(notes, t, dur, vol) {
    notes.forEach((m) => [-7, 7].forEach((dt) => voice('sawtooth', mtof(m), t, dur, { detune: dt, cutoff: 900, a: dur * 0.3, hold: dur * 0.35, rel: dur * 0.6, vol: vol * 0.035 })));
  }
  function bass(m, t, dur, vol) { voice('sawtooth', mtof(m), t, dur, { cutoff: 420, q: 2, a: 0.01, hold: dur * 0.5, rel: dur * 0.5, vol: vol * 0.16 }); }
  function pluck(m, t, vol) { voice('triangle', mtof(m), t, 0.35, { cutoff: 3200, sweep: [4000, 600], a: 0.004, rel: 0.4, vol: vol * 0.09 }); }
  function lead(m, t, dur, vol) {
    voice('square', mtof(m), t, dur, { cutoff: 1800, a: 0.04, hold: dur * 0.6, rel: dur * 0.6, vol: vol * 0.045 });
    voice('sine', mtof(m + 12), t, dur, { a: 0.05, hold: dur * 0.5, rel: dur * 0.6, vol: vol * 0.03 });
  }
  function kick(t, vol) {
    const ctx = M.ctx, o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.setValueAtTime(130, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.25);
    env(g, t, 0.003, vol * 0.5, 0, 0.32);
    o.connect(g); g.connect(M.dry); o.start(t); o.stop(t + 0.4);
  }
  function noiseHit(t, vol, freq, type, dur) {
    const ctx = M.ctx, s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    s.buffer = M.noise; f.type = type; f.frequency.value = freq;
    env(g, t, 0.002, vol, 0, dur);
    s.connect(f); f.connect(g); g.connect(M.bus); s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.05);
  }

  // ---------------- sequencer -------------------------------------------
  function schedule() {
    if (!M.ctx || M.ctx.state !== 'running') return;
    const th = THEMES[M.theme];
    if (!th) return;
    const ahead = M.ctx.currentTime + 0.6; // generous look-ahead survives slow frames
    if (M.nextTime < M.ctx.currentTime) M.nextTime = M.ctx.currentTime + 0.05;
    while (M.nextTime < ahead) {
      playStep(th, M.step, M.nextTime);
      const sixteenth = 60 / th.bpm / 4;
      M.nextTime += sixteenth;
      M.step++;
      if (M.step >= th.chords.length * 16) { M.step = 0; M.pass++; }
    }
  }

  function playStep(th, step, t) {
    M.intensity = U.lerp(M.intensity, M.mode === 'calm' ? Math.min(M.target, 0.35) : M.target, 0.02);
    const bar = Math.floor(step / 16), s16 = step % 16, beat = 60 / th.bpm;
    const ch = th.chords[bar], L = th.arrange(M.pass, M.intensity);
    if (s16 === 0) {
      if (L.pad) pad(ch.pad, t, beat * 4.2, L.pad);
    }
    // bass: whole notes when soft, eighth pulses when driving
    if (L.bass > 0.05) {
      if (L.drums > 0.3 || th === THEMES.menu) { if (s16 % 2 === 0) bass(ch.bass + (s16 % 8 === 4 ? 12 : 0), t, beat * 0.45, L.bass); }
      else if (s16 === 0) bass(ch.bass, t, beat * 3.5, L.bass);
    }
    // arpeggio over the chord, two octaves
    if (L.arp > 0.05 && (L.fastArp || th === THEMES.menu || s16 % 2 === 0)) {
      const tones = ch.pad.concat(ch.pad.map((m) => m + 12));
      const idx = [0, 2, 4, 1, 3, 5, 2, 4][Math.floor(s16 / (L.fastArp || th === THEMES.menu ? 1 : 2)) % 8] % tones.length;
      pluck(tones[idx], t, L.arp * (s16 % 4 === 0 ? 1 : 0.7));
    }
    // melody on eighth notes
    if (L.lead > 0.05 && s16 % 2 === 0) {
      const mel = th.melody[bar][s16 / 2];
      if (mel !== null && mel !== undefined) {
        let len = 1; while (s16 / 2 + len < 8 && th.melody[bar][s16 / 2 + len] === null && len < 3) len++;
        lead(mel, t, beat * 0.5 * len, L.lead);
      }
    }
    // drums
    if (L.drums > 0.05) {
      if (s16 % 8 === 0) kick(t, L.drums);
      if (s16 % 4 === 2 && th === THEMES.flight && M.intensity > 0.85) kick(t, L.drums * 0.6);
      if (s16 % 2 === 0) noiseHit(t, 0.035 * L.drums * (s16 % 4 === 2 ? 1.4 : 0.8), 7000, 'highpass', 0.05);
      if ((L.snare || th === THEMES.menu) && s16 % 8 === 4) noiseHit(t, 0.12 * L.drums, 1800, 'bandpass', 0.18);
    }
  }

  M.tick = schedule;

  // ---------------- control -------------------------------------------
  /** Switch theme ('menu' | 'flight' | null). Restarts at the top of the piece. */
  M.setTheme = function (name) {
    if (M.mode === 'off') name = null;
    if (name === M.theme) return;
    M.theme = name; M.step = 0; M.pass = 0;
    if (M.ctx) M.nextTime = M.ctx.currentTime + 0.6;
  };
  M.setMode = function (mode) {
    M.mode = mode;
    if (mode === 'off') { M.theme = null; }
  };
  M.setIntensity = function (k) { M.target = U.clamp(k, 0, 1); };

  /** One-shot stingers */
  M.stinger = function (kind) {
    if (!M.ctx || M.mode === 'off') return;
    const t = M.ctx.currentTime + 0.05;
    if (kind === 'landing') {
      [60, 64, 67, 72, 76].forEach((m, i) => pluck(m + 2, t + i * 0.09, 1.2));
      pad([62, 66, 69, 74], t + 0.4, 2.6, 1.3);
    } else if (kind === 'crash') {
      M.theme = null;
      pad([38, 39, 45, 46], t, 3.5, 1.6);
      [57, 56, 55, 53].forEach((m, i) => lead(m, t + 0.2 + i * 0.45, 0.5, 1));
    } else if (kind === 'lesson') {
      [74, 78, 81].forEach((m, i) => pluck(m, t + i * 0.07, 0.9));
    }
  };
})(typeof window !== 'undefined' ? window : globalThis);
