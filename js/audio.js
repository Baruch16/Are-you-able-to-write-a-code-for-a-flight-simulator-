/* ==========================================================================
 * audio.js — all sound, synthesized live with the Web Audio API (no files)
 *
 * Mixer:  master ─┬─ effects bus ─┬─ cabin filter (muffled inside canopy)
 *                 │               └─ direct (warnings, clicks, voice-like)
 *                 └─ music bus (see music.js)
 *
 * Effects: turbine whine & roar, starter, wind, airframe buffet, runway
 * rumble and expansion-joint thumps, tyre screech, brake squeal, gear /
 * flap / airbrake motors and lock "clunks", switch clicks, oxygen-mask
 * breathing and G-strain, overspeed clacker, stall/gear/over-G warnings,
 * caution chime, flare launches, crash explosion, ejection, voice call-outs.
 * ========================================================================== */
(function (root) {
  'use strict';
  const SIM = root.SIM = root.SIM || {};
  const U = SIM.util;
  const A = SIM.audio = {
    enabled: true, callouts: true, breathing: true,
    vol: { master: 0.8, sfx: 0.8, music: 0.5 }
  };

  function noiseBuffer(ctx, seconds, brown) {
    const n = Math.floor(ctx.sampleRate * seconds), buf = ctx.createBuffer(1, n, ctx.sampleRate), d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < n; i++) {
      const w = Math.random() * 2 - 1;
      if (brown) { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; } else d[i] = w;
    }
    return buf;
  }

  A.init = function () {
    if (A.ctx) { if (A.ctx.state !== 'running') A.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = A.ctx = new AC();
    A.white = noiseBuffer(ctx, 2, false); A.brown = noiseBuffer(ctx, 3, true);
    A.master = ctx.createGain(); A.master.connect(ctx.destination);
    A.sfx = ctx.createGain(); A.sfx.connect(A.master);
    A.musicBus = ctx.createGain(); A.musicBus.connect(A.master);
    A.applyVolumes();
    // cockpit filter: outside sound is muffled by the canopy and helmet
    A.cabin = ctx.createBiquadFilter(); A.cabin.type = 'lowpass'; A.cabin.frequency.value = 2500; A.cabin.connect(A.sfx);
    const loop = (buf) => { const s = ctx.createBufferSource(); s.buffer = buf; s.loop = true; s.start(0, Math.random()); return s; };
    const chain = (src, type, freq, q, dest) => {
      const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; if (q) f.Q.value = q;
      const g = ctx.createGain(); g.gain.value = 0; src.connect(f); f.connect(g); g.connect(dest || A.cabin);
      return { f, g };
    };
    // turbine whine (two partials through a resonant band-pass)
    A.whine = ctx.createOscillator(); A.whine.type = 'sawtooth';
    A.whine2 = ctx.createOscillator(); A.whine2.type = 'triangle';
    const wf = ctx.createBiquadFilter(); wf.type = 'bandpass'; wf.Q.value = 3; A.whineF = wf;
    A.whineG = ctx.createGain(); A.whineG.gain.value = 0;
    A.whine.connect(wf); A.whine2.connect(wf); wf.connect(A.whineG); A.whineG.connect(A.cabin);
    A.whine.start(); A.whine2.start();
    // jet roar, wind, buffet, ground rumble
    ({ f: A.roarF, g: A.roarG } = chain(loop(A.brown), 'lowpass', 200));
    ({ f: A.windF, g: A.windG } = chain(loop(A.white), 'bandpass', 600, 0.6));
    ({ f: A.buffetF, g: A.buffetG } = chain(loop(A.brown), 'lowpass', 60, 4, A.sfx));
    ({ g: A.rumbleG } = chain(loop(A.brown), 'lowpass', 90, 0, A.sfx));
    // hydraulic motor (gear / flaps / airbrake travel)
    A.motor = ctx.createOscillator(); A.motor.type = 'sawtooth'; A.motor.frequency.value = 95;
    ({ f: A.motorF, g: A.motorG } = chain(A.motor, 'lowpass', 500, 2, A.sfx));
    ({ g: A.motorNG } = chain(loop(A.white), 'bandpass', 900, 3, A.sfx));
    A.motor.start();
    // brake squeal
    A.squeal = ctx.createOscillator(); A.squeal.type = 'sine'; A.squeal.frequency.value = 1150;
    A.squealG = ctx.createGain(); A.squealG.gain.value = 0; A.squeal.connect(A.squealG); A.squealG.connect(A.sfx); A.squeal.start();
    // warning tone generator
    A.warn = ctx.createOscillator(); A.warn.type = 'square'; A.warnG = ctx.createGain(); A.warnG.gain.value = 0;
    const warnF = ctx.createBiquadFilter(); warnF.type = 'lowpass'; warnF.frequency.value = 1800;
    A.warn.connect(warnF); warnF.connect(A.warnG); A.warnG.connect(A.sfx); A.warn.start();
    A.lastCallout = 99999; A.calloutsDone = {};
    A.prev = null; A.seamDist = 0; A.breathT = 0; A.strainT = 0; A.clackT = 0;
    if (SIM.music) SIM.music.init(ctx, A.musicBus);
  };

  A.applyVolumes = function () {
    if (!A.ctx) return;
    const t = A.ctx.currentTime;
    A.master.gain.setTargetAtTime(A.vol.master, t, 0.05);
    A.sfx.gain.setTargetAtTime(A.vol.sfx, t, 0.05);
    A.musicBus.gain.setTargetAtTime(A.vol.music, t, 0.3);
  };

  // ---------------- one-shot helpers ----------------------------------------
  function tone(freq, dur, vol, type, when, dest) {
    if (!A.ctx) return;
    const ctx = A.ctx, t = ctx.currentTime + (when || 0), o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type || 'sine'; o.frequency.value = freq;
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + 0.01); g.gain.linearRampToValueAtTime(0, t + dur);
    o.connect(g); g.connect(dest || A.sfx); o.start(t); o.stop(t + dur + 0.05);
  }
  function noise(dur, vol, freq, opts) {
    if (!A.ctx) return;
    opts = opts || {};
    const ctx = A.ctx, t = ctx.currentTime + (opts.when || 0), s = ctx.createBufferSource();
    s.buffer = opts.brown ? A.brown : A.white;
    const f = ctx.createBiquadFilter(); f.type = opts.type || 'bandpass'; f.frequency.value = freq; f.Q.value = opts.q || 1.2;
    if (opts.sweep) { f.frequency.setValueAtTime(opts.sweep[0], t); f.frequency.exponentialRampToValueAtTime(opts.sweep[1], t + dur); }
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + (opts.attack || 0.005));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(opts.dest || A.sfx);
    s.start(t, Math.random() * 0.8); s.stop(t + dur + 0.05);
  }
  function thump(vol, freq) { // low, short body thud
    if (!A.ctx) return;
    const ctx = A.ctx, t = ctx.currentTime, o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.setValueAtTime(freq || 90, t); o.frequency.exponentialRampToValueAtTime((freq || 90) * 0.45, t + 0.15);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
    o.connect(g); g.connect(A.sfx); o.start(t); o.stop(t + 0.25);
  }
  /** Switch click: mechanical toggle "clack". */
  A.click = function () {
    noise(0.025, 0.35, 3200, { type: 'highpass' });
    thump(0.12, 260);
  };

  /** Pleasant two-note chime: instructor step completed. */
  A.chime = function () { tone(880, 0.18, 0.12, 'sine', 0, A.sfx); tone(1320, 0.3, 0.1, 'sine', 0.1, A.sfx); };

  A.say = function (txt) {
    if (!A.callouts || !window.speechSynthesis) return;
    try {
      const u = new SpeechSynthesisUtterance(txt); u.rate = 1.15; u.pitch = 0.9; u.volume = Math.min(1, A.vol.master * 1.2);
      speechSynthesis.cancel(); speechSynthesis.speak(u);
    } catch (e) { /* ignore */ }
  };

  // big events
  function explosion() {
    noise(3.5, 1.0, 400, { brown: true, type: 'lowpass', q: 0.5, attack: 0.01 });
    noise(1.2, 0.6, 2500, { sweep: [4000, 300] });
    thump(1.0, 70);
    setTimeout(() => noise(2.0, 0.35, 900, { type: 'lowpass' }), 400);
  }
  function ejection() {
    noise(0.35, 0.9, 1500, { q: 0.4 });            // canopy jettison / seat cartridge
    thump(0.9, 110);
    noise(1.4, 0.5, 700, { when: 0.15, sweep: [500, 1800], q: 0.5 }); // rocket motor
    noise(3.0, 0.4, 900, { when: 0.3, type: 'bandpass', q: 0.3 });   // wind blast
  }

  // ---------------- per-frame update ----------------------------------------
  A.update = function (ac, dt, view, time) {
    if (!A.ctx || !A.enabled) { ac.events.length = 0; return; }
    const ctx = A.ctx, t = ctx.currentTime, s = ac.sys, o = ac.out, c = ac.controls;
    const inside = view === 'cockpit';
    const paused = SIM.main && SIM.main.paused;
    const k = paused ? 0 : 1; // silence continuous effects while paused
    A.cabin.frequency.setTargetAtTime(inside ? 2200 : 9000, t, 0.1);

    // ---- engine
    const n1 = s.n1 / 100;
    A.whine.frequency.setTargetAtTime(180 + n1 * 2600, t, 0.05);
    A.whine2.frequency.setTargetAtTime(90 + n1 * 1300 + (s.starter ? 40 : 0), t, 0.05);
    A.whineF.frequency.setTargetAtTime(400 + n1 * 3000, t, 0.05);
    A.whineG.gain.setTargetAtTime(k * (n1 > 0.02 ? 0.05 + n1 * 0.08 : 0), t, 0.1);
    A.roarF.frequency.setTargetAtTime(150 + n1 * n1 * 1200, t, 0.1);
    A.roarG.gain.setTargetAtTime(k * (s.engineRunning ? 0.15 + Math.pow(Math.max(0, n1 - 0.5) * 2, 2) * 0.9 : s.lightOff ? 0.1 : 0) * (inside ? 0.7 : 1.2), t, 0.15);

    // ---- airflow: wind grows with speed², airbrake adds turbulence
    const v = o.tas / 400;
    A.windF.frequency.setTargetAtTime(300 + v * 1400 + s.airbrakePos * 300, t, 0.2);
    A.windG.gain.setTargetAtTime(k * Math.min(0.5, v * v * 0.5 + s.airbrakePos * v * 0.25 + s.gearPos * v * 0.06), t, 0.15);
    // airframe buffet: near the stall, or pulling hard at high AoA
    const buffet = ac.onGround ? 0 : U.smoothstep(11, 16, o.aoa) * Math.min(1, o.ias / 120) + (o.mach > 0.82 ? (o.mach - 0.82) * 4 : 0);
    A.buffetF.frequency.setTargetAtTime(35 + buffet * 40, t, 0.1);
    A.buffetG.gain.setTargetAtTime(k * Math.min(0.9, buffet * 0.9), t, 0.08);

    // ---- ground roll: rumble + expansion-joint thumps on concrete
    A.rumbleG.gain.setTargetAtTime(k * (ac.onGround ? Math.min(0.6, o.gs / 120) * (o.surface === 'grass' ? 1.8 : 1) : 0), t, 0.08);
    if (ac.onGround && !paused && o.surface && o.surface !== 'grass') {
      A.seamDist += o.gs * U.KT2MS * dt;
      if (A.seamDist > 22) { A.seamDist = 0; if (o.gs > 4) thump(Math.min(0.35, 0.05 + o.gs / 400), 70); }
    }
    // brakes squeal a little at slow speed
    const braking = ac.onGround && o.gs > 3 && Math.max(c.brakeL, c.brakeR, 0) > 0.3;
    A.squeal.frequency.setTargetAtTime(1050 + Math.sin(time * 9) * 60, t, 0.02);
    A.squealG.gain.setTargetAtTime(k * (braking ? 0.025 * U.smoothstep(40, 5, o.gs) : 0), t, 0.05);

    // ---- hydraulic motors and lock clunks
    const p = A.prev || { gear: s.gearPos, flap: s.flapPos, brake: s.airbrakePos };
    const gearMoving = Math.abs(s.gearPos - p.gear) > 1e-5, flapMoving = Math.abs(s.flapPos - p.flap) > 1e-5, abMoving = Math.abs(s.airbrakePos - p.brake) > 1e-5;
    const motor = (gearMoving ? 1 : 0) + (flapMoving ? 0.6 : 0) + (abMoving ? 0.5 : 0);
    A.motor.frequency.setTargetAtTime(gearMoving ? 82 : flapMoving ? 120 : 105, t, 0.05);
    A.motorG.gain.setTargetAtTime(k * Math.min(1, motor) * 0.09, t, 0.08);
    A.motorNG.gain.setTargetAtTime(k * Math.min(1, motor) * 0.05, t, 0.08);
    if (p.gearMoving && !gearMoving) { thump(0.55, 75); noise(0.08, 0.25, 1800); }   // gear locks (up or down)
    if (p.flapMoving && !flapMoving) thump(0.2, 140);
    if (p.abMoving && !abMoving && s.airbrakePos > 0.9) thump(0.25, 120);
    A.prev = { gear: s.gearPos, flap: s.flapPos, brake: s.airbrakePos, gearMoving, flapMoving, abMoving, crashed: A.prev && A.prev.crashed };

    // ---- pilot: oxygen-mask breathing, and anti-G straining under load
    if (A.breathing && inside && !paused && s.engineRunning && !ac.crashed) {
      const g = o.g;
      const period = g > 4 ? 2.0 : 4.6 - Math.min(1.5, Math.max(0, g - 1)) * 0.6;
      A.breathT += dt;
      if (A.breathT > period) {
        A.breathT = 0;
        const vb = 0.05 + Math.min(0.1, Math.max(0, g - 2) * 0.03);
        noise(period * 0.32, vb, 1700, { q: 0.8, attack: period * 0.12 });                 // inhale (valve hiss)
        noise(period * 0.4, vb * 0.8, 650, { q: 0.7, attack: 0.08, when: period * 0.42 }); // exhale
      }
      A.strainT += dt;
      if (g > 5 && A.strainT > 2.6) { A.strainT = 0; noise(0.18, 0.12, 320, { q: 2 }); noise(0.5, 0.09, 1200, { when: 0.2, q: 0.6 }); }
    }

    // ---- overspeed clacker (fixed-rate clicking above Vne)
    if (!paused && s.powered && o.ias > SIM.acData.Vne) {
      A.clackT += dt;
      if (A.clackT > 0.09) { A.clackT = 0; noise(0.02, 0.3, 2500, { type: 'highpass' }); }
    }

    // ---- warnings: stall = fast high beeps; gear horn = low steady; over-G
    let wv = 0, wf = 0;
    if (!paused) {
      if (s.stallWarn) { wf = 900; wv = (time * 8) % 1 < 0.5 ? 0.12 : 0; }
      else if (s.gearHorn) { wf = 320; wv = time % 1 < 0.6 ? 0.1 : 0; }
      else if (o.g > 7.8 && s.powered) { wf = 1200; wv = (time * 4) % 1 < 0.5 ? 0.08 : 0; }
    }
    A.warn.frequency.setTargetAtTime(wf || 500, t, 0.01);
    A.warnG.gain.setTargetAtTime(wv, t, 0.01);

    // ---- discrete events from the aircraft & simulator
    while (ac.events.length) {
      const e = ac.events.shift();
      if (e === 'caution') { tone(1250, 0.12, 0.2); tone(1250, 0.12, 0.2, 'sine', 0.18); }
      else if (e === 'starter') { noise(0.5, 0.25, 500); thump(0.3, 60); }
      else if (e === 'touchdown') {
        const spd = Math.min(1, o.gs / 140), hard = Math.min(1, (ac._tdVS || 200) / 600);
        noise(0.45, 0.25 + 0.5 * spd, 2600, { sweep: [3200, 1400], q: 2 });  // tyre screech
        noise(0.3, 0.2 * spd, 900, { when: 0.12, q: 1 });
        thump(0.3 + 0.6 * hard, 65);
      }
      else if (e === 'flare') { thump(0.3, 160); noise(0.6, 0.35, 1100, { sweep: [2500, 500] }); }
      else if (e === 'flameout') { A.say('Engine flame out'); thump(0.4, 50); }
      else if (e === 'engineStarted') tone(700, 0.05, 0.1);
    }
    if (ac.crashed && !(A.prev && A.prev.crashed)) {
      if (ac._ejected) ejection(); else explosion();
      if (SIM.music) SIM.music.stinger('crash');
      A.prev.crashed = true;
    }
    if (!ac.crashed && A.prev) A.prev.crashed = false;

    // ---- radar-altitude call-outs on approach (gear down, descending)
    const ra = o.agl * U.M2FT;
    if (s.gearPos > 0.9 && !ac.onGround && ac.vel.y < -0.5 && s.avionicsPowered) {
      [500, 100, 50, 30, 10].forEach((h) => {
        if (A.lastCallout > h && ra <= h && !A.calloutsDone[h]) { A.calloutsDone[h] = true; A.say(h === 500 ? 'Five hundred' : h === 100 ? 'One hundred' : String(h)); }
      });
    }
    if (ra > 700) A.calloutsDone = {};
    A.lastCallout = ra;
    if (!paused && SIM.hud.pullUp && (!A._pu || time - A._pu > 2.2)) { A._pu = time; A.say('Pull up'); }

    // ---- adaptive music: how exciting is the flying right now?
    if (SIM.music) {
      SIM.music.tick();
      let kx = 0.12;
      if (!ac.onGround) {
        kx = 0.25 + U.clamp(o.tas / 550, 0, 1) * 0.3 + U.clamp((Math.abs(o.g - 1)) / 5, 0, 1) * 0.35;
        if (ra < 1000 && o.tas > 280) kx += 0.25;                       // fast and low
        if (s.stallWarn || SIM.hud.pullUp || o.g > 7) kx += 0.3;          // danger
        if (s.gearPos > 0.9 && o.tas < 180) kx = Math.min(kx, 0.35);      // calm on approach
      } else if (o.gs > 60) kx = 0.45;                                    // take-off roll
      SIM.music.setIntensity(kx);
    }
  };
})(typeof window !== 'undefined' ? window : globalThis);
