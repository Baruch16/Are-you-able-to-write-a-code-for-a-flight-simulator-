/* ==========================================================================
 * audio.js — synthesized sounds (no audio files needed): turbine whine and
 * roar, wind, warning tones, switch clicks, tyre chirp, voice call-outs.
 * ========================================================================== */
(function (root) {
  'use strict';
  const SIM = root.SIM = root.SIM || {};
  const U = SIM.util;
  const A = SIM.audio = { enabled: true, volume: 0.7, callouts: true };

  function noiseBuffer(ctx, seconds, brown) {
    const n = ctx.sampleRate * seconds, buf = ctx.createBuffer(1, n, ctx.sampleRate), d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < n; i++) {
      const w = Math.random() * 2 - 1;
      if (brown) { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; } else d[i] = w;
    }
    return buf;
  }

  A.init = function () {
    if (A.ctx) { A.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = A.ctx = new AC();
    A.master = ctx.createGain(); A.master.gain.value = A.volume; A.master.connect(ctx.destination);
    // cockpit filter: sound inside the canopy is muffled
    A.cabin = ctx.createBiquadFilter(); A.cabin.type = 'lowpass'; A.cabin.frequency.value = 2500; A.cabin.connect(A.master);
    const src = (buf) => { const s = ctx.createBufferSource(); s.buffer = buf; s.loop = true; s.start(); return s; };
    // turbine whine
    A.whine = ctx.createOscillator(); A.whine.type = 'sawtooth';
    A.whine2 = ctx.createOscillator(); A.whine2.type = 'triangle';
    A.whineG = ctx.createGain(); A.whineG.gain.value = 0;
    const wf = ctx.createBiquadFilter(); wf.type = 'bandpass'; wf.Q.value = 3; A.whineF = wf;
    A.whine.connect(wf); A.whine2.connect(wf); wf.connect(A.whineG); A.whineG.connect(A.cabin);
    A.whine.start(); A.whine2.start();
    // jet roar
    A.roar = src(noiseBuffer(ctx, 3, true));
    A.roarF = ctx.createBiquadFilter(); A.roarF.type = 'lowpass'; A.roarF.frequency.value = 200;
    A.roarG = ctx.createGain(); A.roarG.gain.value = 0;
    A.roar.connect(A.roarF); A.roarF.connect(A.roarG); A.roarG.connect(A.cabin);
    // wind
    A.wind = src(noiseBuffer(ctx, 3, false));
    A.windF = ctx.createBiquadFilter(); A.windF.type = 'bandpass'; A.windF.frequency.value = 600; A.windF.Q.value = 0.6;
    A.windG = ctx.createGain(); A.windG.gain.value = 0;
    A.wind.connect(A.windF); A.windF.connect(A.windG); A.windG.connect(A.cabin);
    // rumble (runway roll)
    A.rumble = src(noiseBuffer(ctx, 2, true));
    A.rumbleG = ctx.createGain(); A.rumbleG.gain.value = 0;
    const rf = ctx.createBiquadFilter(); rf.type = 'lowpass'; rf.frequency.value = 90;
    A.rumble.connect(rf); rf.connect(A.rumbleG); A.rumbleG.connect(A.master);
    // warning tone generator
    A.warn = ctx.createOscillator(); A.warn.type = 'square'; A.warnG = ctx.createGain(); A.warnG.gain.value = 0;
    const warnF = ctx.createBiquadFilter(); warnF.type = 'lowpass'; warnF.frequency.value = 1800;
    A.warn.connect(warnF); warnF.connect(A.warnG); A.warnG.connect(A.master); A.warn.start();
    A.lastCallout = 99999; A.calloutsDone = {};
  };

  function beep(freq, dur, vol, type) {
    if (!A.ctx) return;
    const ctx = A.ctx, o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type || 'sine'; o.frequency.value = freq;
    g.gain.setValueAtTime(0, ctx.currentTime);
    g.gain.linearRampToValueAtTime(vol, ctx.currentTime + 0.01);
    g.gain.linearRampToValueAtTime(0, ctx.currentTime + dur);
    o.connect(g); g.connect(A.master); o.start(); o.stop(ctx.currentTime + dur + 0.05);
  }
  A.click = () => beep(1800, 0.025, 0.25, 'square');
  function burst(dur, vol, freq) {
    if (!A.ctx) return;
    const ctx = A.ctx, s = ctx.createBufferSource(); s.buffer = noiseBuffer(ctx, dur, false);
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = 1.2;
    const g = ctx.createGain(); g.gain.setValueAtTime(vol, ctx.currentTime); g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
    s.connect(f); f.connect(g); g.connect(A.master); s.start();
  }

  A.say = function (txt) {
    if (!A.callouts || !window.speechSynthesis) return;
    try {
      const u = new SpeechSynthesisUtterance(txt); u.rate = 1.15; u.pitch = 0.9; u.volume = A.volume;
      speechSynthesis.cancel(); speechSynthesis.speak(u);
    } catch (e) { /* ignore */ }
  };

  A.update = function (ac, dt, view, time) {
    if (!A.ctx || !A.enabled) { ac.events.length = 0; return; }
    const ctx = A.ctx, t = ctx.currentTime, s = ac.sys, o = ac.out;
    const inside = view === 'cockpit';
    A.cabin.frequency.setTargetAtTime(inside ? 2200 : 9000, t, 0.1);
    const n1 = s.n1 / 100;
    A.whine.frequency.setTargetAtTime(180 + n1 * 2600, t, 0.05);
    A.whine2.frequency.setTargetAtTime(90 + n1 * 1300 + (s.starter ? 40 : 0), t, 0.05);
    A.whineF.frequency.setTargetAtTime(400 + n1 * 3000, t, 0.05);
    A.whineG.gain.setTargetAtTime(n1 > 0.02 ? 0.05 + n1 * 0.08 : 0, t, 0.1);
    A.roarF.frequency.setTargetAtTime(150 + n1 * n1 * 1200, t, 0.1);
    A.roarG.gain.setTargetAtTime((s.engineRunning ? 0.15 + Math.pow(Math.max(0, n1 - 0.5) * 2, 2) * 0.9 : s.lightOff ? 0.1 : 0) * (inside ? 0.7 : 1.2), t, 0.15);
    const v = o.tas / 400;
    A.windF.frequency.setTargetAtTime(300 + v * 1400 + s.airbrakePos * 300, t, 0.2);
    A.windG.gain.setTargetAtTime(Math.min(0.5, v * v * 0.5 + s.airbrakePos * v * 0.25 + (ac._stalled ? 0.1 : 0)), t, 0.15);
    A.rumbleG.gain.setTargetAtTime(ac.onGround ? Math.min(0.6, o.gs / 120) * (o.surface === 'grass' ? 1.8 : 1) : 0, t, 0.08);
    // warnings: stall = fast high beeps; gear horn = low steady; pull up = voice
    let wv = 0, wf = 0;
    const ph = time % 1;
    if (s.stallWarn) { wf = 900; wv = (time * 8) % 1 < 0.5 ? 0.12 : 0; }
    else if (s.gearHorn) { wf = 320; wv = ph < 0.6 ? 0.1 : 0; }
    else if (o.g > 7.8 && s.powered) { wf = 1200; wv = (time * 4) % 1 < 0.5 ? 0.08 : 0; }
    A.warn.frequency.setTargetAtTime(wf || 500, t, 0.01);
    A.warnG.gain.setTargetAtTime(wv, t, 0.01);
    // events
    while (ac.events.length) {
      const e = ac.events.shift();
      if (e === 'caution') { beep(1250, 0.12, 0.2); setTimeout(() => beep(1250, 0.12, 0.2), 180); }
      else if (e === 'starter') burst(0.6, 0.2, 400);
      else if (e === 'touchdown') burst(0.35, 0.5, 1500);
      else if (e === 'flare') burst(0.25, 0.35, 900);
      else if (e === 'flameout') { A.say('Engine flame out'); }
      else if (e === 'gearSafety') { /* silent */ }
      else if (e === 'engineStarted') beep(700, 0.05, 0.1);
    }
    // radar-altitude call-outs on approach (gear down, descending)
    const ra = o.agl * U.M2FT;
    if (s.gearPos > 0.9 && !ac.onGround && ac.vel.y < -0.5 && s.avionicsPowered) {
      [500, 100, 50, 30, 10].forEach((h) => {
        if (A.lastCallout > h && ra <= h && !A.calloutsDone[h]) { A.calloutsDone[h] = true; A.say(h === 500 ? 'Five hundred' : h === 100 ? 'One hundred' : String(h)); }
      });
    }
    if (ra > 700) A.calloutsDone = {};
    A.lastCallout = ra;
    if (SIM.hud.pullUp && (!A._pu || time - A._pu > 2.2)) { A._pu = time; A.say('Pull up'); }
  };
})(typeof window !== 'undefined' ? window : globalThis);
