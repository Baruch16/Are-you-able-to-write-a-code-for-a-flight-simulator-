/* ==========================================================================
 * panel.js — draws every cockpit instrument & switch onto canvas textures,
 * and handles clicking/hovering on them.
 *
 * Three canvases: FRONT instrument panel (2048x1024 px = 0.86 x 0.43 m),
 * LEFT console (engine, throttle, flaps) and RIGHT console (electrics,
 * lights, systems, armament).
 * ========================================================================== */
(function (root) {
  'use strict';
  const SIM = root.SIM = root.SIM || {};
  const U = SIM.util;
  const P = SIM.panel = { tex: {}, regions: { front: [], left: [], right: [] }, mapRange: 10 };
  const RANGES = [2.5, 5, 10, 20, 40];

  const C = {
    panel: '#2a2e32', panelHi: '#353a3f', face: '#0b0c0d', white: '#eceae4', dim: '#8d9296', amber: '#ffb000',
    green: '#2ee05a', red: '#ff2d20', cyan: '#3ce6ff', magenta: '#ff40ff', yellow: '#ffe040', sky: '#2f7fd0', ground: '#7a4b22'
  };

  function mk(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }

  P.init = function () {
    P.cv = { front: mk(2048, 1024), left: mk(384, 1280), right: mk(384, 1280) };
    for (const k in P.cv) {
      const t = new THREE.CanvasTexture(P.cv[k]);
      t.anisotropy = 16; t.minFilter = THREE.LinearMipmapLinearFilter;
      P.tex[k] = t;
    }
    buildMapImage();
    defineRegions();
    P.frame = 0;
  };

  // ------------------------------------------------------------------------
  // drawing primitives
  // ------------------------------------------------------------------------
  function bezel(g, x, y, r, label) {
    g.save();
    const gr = g.createRadialGradient(x - r * 0.3, y - r * 0.3, r * 0.2, x, y, r + 14);
    gr.addColorStop(0, '#4b5157'); gr.addColorStop(1, '#16181a');
    g.fillStyle = gr; g.beginPath(); g.arc(x, y, r + 12, 0, 7); g.fill();
    g.fillStyle = C.face; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
    // screws
    g.fillStyle = '#5c6268';
    [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([a, b]) => { g.beginPath(); g.arc(x + a * (r + 5) * 0.86, y + b * (r + 5) * 0.86, 4, 0, 7); g.fill(); });
    if (label) { g.fillStyle = C.dim; g.font = 'bold 15px Arial'; g.textAlign = 'center'; g.fillText(label, x, y + r + 32); }
    g.restore();
  }
  function text(g, s, x, y, size, color, align, bold) {
    g.font = (bold === false ? '' : 'bold ') + size + 'px Arial';
    g.fillStyle = color || C.white; g.textAlign = align || 'center'; g.textBaseline = 'middle';
    g.fillText(s, x, y);
  }
  function needle(g, x, y, ang, len, w, color, tail) {
    g.save(); g.translate(x, y); g.rotate(ang);
    g.fillStyle = color || C.white;
    g.beginPath(); g.moveTo(-(tail || len * 0.15), -w); g.lineTo(len * 0.85, -w * 0.7); g.lineTo(len, 0); g.lineTo(len * 0.85, w * 0.7); g.lineTo(-(tail || len * 0.15), w); g.closePath(); g.fill();
    g.restore();
    g.fillStyle = '#333'; g.beginPath(); g.arc(x, y, w * 1.6, 0, 7); g.fill();
  }
  function ticks(g, x, y, r, a0, a1, n, len, w, color) {
    g.strokeStyle = color || C.white; g.lineWidth = w || 2;
    for (let i = 0; i <= n; i++) {
      const a = a0 + (a1 - a0) * i / n;
      g.beginPath(); g.moveTo(x + Math.cos(a) * r, y + Math.sin(a) * r); g.lineTo(x + Math.cos(a) * (r - len), y + Math.sin(a) * (r - len)); g.stroke();
    }
  }
  function arcBand(g, x, y, r, a0, a1, w, color) {
    g.strokeStyle = color; g.lineWidth = w; g.beginPath(); g.arc(x, y, r - w / 2, a0, a1); g.stroke();
  }
  function offFlag(g, x, y, label) {
    g.save(); g.translate(x, y); g.rotate(-0.3);
    g.fillStyle = '#d01818'; g.fillRect(-38, -16, 76, 32);
    text(g, label || 'OFF', 0, 1, 20, '#fff'); g.restore();
  }
  // generic round gauge with a 270° sweep
  function arcGauge(g, x, y, r, val, min, max, opt) {
    const a0 = Math.PI * 0.75, a1 = Math.PI * 2.25;
    const ang = (v) => a0 + (a1 - a0) * (U.clamp(v, min, max) - min) / (max - min);
    (opt.bands || []).forEach(([b0, b1, col]) => arcBand(g, x, y, r - 4, ang(b0), ang(b1), 9, col));
    ticks(g, x, y, r - 4, a0, a1, opt.major * (opt.minor || 1), 8, 1.5, C.dim);
    ticks(g, x, y, r - 4, a0, a1, opt.major, 16, 3, C.white);
    for (let i = 0; i <= opt.major; i++) {
      const v = min + (max - min) * i / opt.major;
      const a = ang(v);
      if (opt.labelEvery && i % opt.labelEvery) continue;
      text(g, opt.fmt ? opt.fmt(v) : String(v), x + Math.cos(a) * (r - 38), y + Math.sin(a) * (r - 38), Math.round(r * 0.2), C.white);
    }
    text(g, opt.title, x, y - r * 0.38, Math.round(r * 0.16), C.dim);
    if (opt.unit) text(g, opt.unit, x, y + r * 0.38, Math.round(r * 0.14), C.dim);
    if (opt.digital !== undefined) {
      g.fillStyle = '#000'; g.fillRect(x - r * 0.42, y + r * 0.5, r * 0.84, r * 0.3);
      g.strokeStyle = '#444'; g.strokeRect(x - r * 0.42, y + r * 0.5, r * 0.84, r * 0.3);
      text(g, opt.digital, x, y + r * 0.66, Math.round(r * 0.22), opt.powered === false ? '#222' : C.amber);
    }
    if (val !== null) needle(g, x, y, ang(val), r - 12, 4, C.white);
    if (opt.off) offFlag(g, x + r * 0.25, y - r * 0.05, 'OFF');
  }
  function lamp(g, x, y, w, h, label, on, color, small) {
    g.fillStyle = '#111'; g.fillRect(x - 3, y - 3, w + 6, h + 6);
    g.fillStyle = on ? color : '#24211c'; g.fillRect(x, y, w, h);
    if (on) { g.shadowColor = color; g.shadowBlur = 18; g.fillRect(x, y, w, h); g.shadowBlur = 0; }
    text(g, label, x + w / 2, y + h / 2 + 1, small ? 15 : 19, on ? '#140c00' : '#5b554a');
  }
  function knob(g, x, y, r, label) {
    const gr = g.createRadialGradient(x - r * 0.3, y - r * 0.3, 2, x, y, r);
    gr.addColorStop(0, '#6a7076'); gr.addColorStop(1, '#202326');
    g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
    g.strokeStyle = '#111'; g.lineWidth = 2; g.stroke();
    text(g, '−', x - r * 0.45, y, r * 0.8, '#ddd'); text(g, '+', x + r * 0.45, y, r * 0.8, '#ddd');
    if (label) text(g, label, x, y + r + 14, 14, C.dim);
  }
  function toggle(g, x, y, label, on, onTxt, offTxt, guard) {
    text(g, label, x, y - 62, 17, C.white);
    text(g, onTxt || 'ON', x, y - 40, 13, C.dim);
    text(g, offTxt || 'OFF', x, y + 44, 13, C.dim);
    g.fillStyle = '#16181a'; g.beginPath(); g.arc(x, y, 22, 0, 7); g.fill();
    g.fillStyle = '#7d8388'; g.beginPath(); g.arc(x, y, 13, 0, 7); g.fill();
    // lever (seen from above): points forward (up) when ON
    const dir = on ? -1 : 1;
    g.strokeStyle = '#d6d9dc'; g.lineWidth = 9; g.lineCap = 'round';
    g.beginPath(); g.moveTo(x, y); g.lineTo(x, y + dir * 26); g.stroke();
    g.fillStyle = '#eef0f2'; g.beginPath(); g.arc(x, y + dir * 28, 8, 0, 7); g.fill();
    g.lineCap = 'butt';
    if (guard) { g.strokeStyle = 'rgba(220,30,30,0.85)'; g.lineWidth = 4; g.strokeRect(x - 30, y - 38, 60, 76); }
  }
  function section(g, x, y, w, h, title) {
    g.strokeStyle = '#596067'; g.lineWidth = 2; g.strokeRect(x, y, w, h);
    g.fillStyle = C.panel; g.fillRect(x + 14, y - 10, title.length * 10 + 16, 20);
    text(g, title, x + 22 + title.length * 5, y, 15, '#c8ccd0');
  }
  function panelBg(g, w, h) {
    const gr = g.createLinearGradient(0, 0, 0, h);
    gr.addColorStop(0, C.panelHi); gr.addColorStop(1, C.panel);
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgba(255,255,255,0.025)';
    for (let i = 0; i < 40; i++) g.fillRect(0, i * h / 40, w, 1);
  }

  // ------------------------------------------------------------------------
  // moving-map background image (computed once from the terrain function)
  // ------------------------------------------------------------------------
  const MAP_SIZE = 512, MAP_SPAN = 140000; // metres covered by the image
  function buildMapImage() {
    const c = mk(MAP_SIZE, MAP_SIZE), g = c.getContext('2d');
    const img = g.createImageData(MAP_SIZE, MAP_SIZE);
    const W = SIM.world;
    for (let j = 0; j < MAP_SIZE; j++) for (let i = 0; i < MAP_SIZE; i++) {
      const x = (i / MAP_SIZE - 0.5) * MAP_SPAN, z = (j / MAP_SIZE - 0.5) * MAP_SPAN;
      const h = W.height(x, z);
      let r, gg, b;
      if (h < 0.5) { r = 18; gg = 48; b = 92; }
      else {
        const t = U.clamp(h / 1800, 0, 1);
        r = 52 + t * 120; gg = 78 + t * 70 - t * t * 40; b = 40 + t * 80;
        const f = W.forest(x, z, h); r -= f * 22; gg -= f * 10; b -= f * 12;
        const u = W.urban(x, z); r = U.lerp(r, 120, u); gg = U.lerp(gg, 118, u); b = U.lerp(b, 112, u);
        if (h > 1650) { r = gg = b = 210; }
        // hill shading
        const n = W.normal(x, z, 120); const sh = U.clamp(0.75 + (n.x * -0.6 + n.z * -0.6) * 1.6, 0.4, 1.3);
        r *= sh; gg *= sh; b *= sh;
      }
      const k = (j * MAP_SIZE + i) * 4;
      img.data[k] = r; img.data[k + 1] = gg; img.data[k + 2] = b; img.data[k + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    const toPx = (x) => (x / MAP_SPAN + 0.5) * MAP_SIZE;
    g.strokeStyle = 'rgba(240,210,120,0.8)'; g.lineWidth = 1.2;
    W.roads.forEach((r) => { g.beginPath(); g.moveTo(toPx(r.ax), toPx(r.az)); g.lineTo(toPx(r.bx), toPx(r.bz)); g.stroke(); });
    P.mapImg = c;
  }

  // ------------------------------------------------------------------------
  // FRONT PANEL
  // ------------------------------------------------------------------------
  const L = {
    asi: [640, 300, 112], adi: [920, 310, 150], alt: [1200, 300, 112],
    tc: [640, 640, 100], hsi: [920, 650, 150], vsi: [1200, 640, 100],
    mfd: [36, 130, 420, 420],
    aoa: [330, 700, 92], gm: [330, 915, 80],
    n1: [1450, 250, 96], egt: [1665, 250, 96], fuel: [1880, 250, 96],
    ff: [1450, 500, 82], oil: [1665, 500, 82], hyd: [1880, 500, 82],
    clock: [1450, 735, 82], radalt: [1665, 735, 82],
    caut: [480, 836, 860, 168]
  };
  P.layout = L;

  function drawASI(g, ac) {
    const [x, y, r] = L.asi;
    bezel(g, x, y, r, 'AIRSPEED');
    const ang = (kt) => -Math.PI / 2 + 330 * U.DEG * Math.sqrt(U.clamp(kt, 0, 600) / 600);
    // arcs: white flap range, green normal, red Vne
    arcBand(g, x, y, r - 2, ang(100), ang(185), 8, '#f0f0f0');
    arcBand(g, x, y, r - 12, ang(118), ang(530), 8, '#2db84c');
    arcBand(g, x, y, r - 2, ang(555), ang(565), 12, '#ff2a2a');
    [40, 60, 80, 100, 120, 140, 160, 180, 200, 250, 300, 350, 400, 450, 500, 550, 600].forEach((v) => {
      const a = ang(v);
      g.strokeStyle = C.white; g.lineWidth = 3;
      g.beginPath(); g.moveTo(x + Math.cos(a) * (r - 4), y + Math.sin(a) * (r - 4)); g.lineTo(x + Math.cos(a) * (r - 20), y + Math.sin(a) * (r - 20)); g.stroke();
      if ([60, 100, 140, 200, 300, 400, 500, 600].includes(v)) text(g, String(v), x + Math.cos(a) * (r - 38), y + Math.sin(a) * (r - 38), 19);
    });
    text(g, 'KNOTS', x, y - 38, 14, C.dim);
    g.fillStyle = '#000'; g.fillRect(x - 34, y + 22, 68, 28);
    text(g, 'M' + ac.out.mach.toFixed(2).slice(1), x, y + 37, 18, C.white);
    needle(g, x, y, ang(ac.out.ias), r - 10, 5, C.white);
  }

  function drawADI(g, ac) {
    const [x, y, r] = L.adi, o = ac.out, s = ac.sys;
    bezel(g, x, y, r, 'ATTITUDE');
    const spin = s.gyroSpin;
    // a spinning-down gyro wanders
    const pitch = spin > 0.6 ? o.pitch : o.pitch * spin + (1 - spin) * 25;
    const roll = spin > 0.6 ? o.roll : o.roll * spin + (1 - spin) * -40;
    const ppd = 4.2; // px per degree
    g.save(); g.beginPath(); g.arc(x, y, r - 2, 0, 7); g.clip();
    g.translate(x, y); g.rotate(-roll * U.DEG); g.translate(0, pitch * ppd);
    g.fillStyle = C.sky; g.fillRect(-400, -1000, 800, 1000);
    g.fillStyle = C.ground; g.fillRect(-400, 0, 800, 1000);
    g.strokeStyle = '#fff'; g.lineWidth = 3; g.beginPath(); g.moveTo(-400, 0); g.lineTo(400, 0); g.stroke();
    g.lineWidth = 2;
    for (let p = -90; p <= 90; p += 5) {
      if (!p) continue;
      const yy = -p * ppd, w = p % 10 === 0 ? 46 : 22;
      g.strokeStyle = '#fff'; g.beginPath(); g.moveTo(-w, yy); g.lineTo(w, yy); g.stroke();
      if (p % 10 === 0) { text(g, String(Math.abs(p)), -w - 18, yy, 15); text(g, String(Math.abs(p)), w + 18, yy, 15); }
    }
    g.restore();
    // bank scale
    g.save(); g.translate(x, y);
    g.strokeStyle = '#fff'; g.lineWidth = 3;
    [-60, -45, -30, -20, -10, 0, 10, 20, 30, 45, 60].forEach((b) => {
      const a = (b - 90) * U.DEG, l = b % 30 === 0 ? 18 : 10;
      g.beginPath(); g.moveTo(Math.cos(a) * (r - 4), Math.sin(a) * (r - 4)); g.lineTo(Math.cos(a) * (r - 4 - l), Math.sin(a) * (r - 4 - l)); g.stroke();
    });
    g.rotate(-roll * U.DEG);
    g.fillStyle = C.white; g.beginPath(); g.moveTo(0, -r + 24); g.lineTo(-9, -r + 40); g.lineTo(9, -r + 40); g.fill();
    g.restore();
    // fixed aircraft symbol
    g.strokeStyle = '#ff9a00'; g.lineWidth = 7; g.lineCap = 'round';
    g.beginPath(); g.moveTo(x - 80, y); g.lineTo(x - 30, y); g.lineTo(x - 15, y + 14); g.lineTo(x, y); g.lineTo(x + 15, y + 14); g.lineTo(x + 30, y); g.lineTo(x + 80, y); g.stroke();
    g.lineCap = 'butt';
    g.fillStyle = '#ff9a00'; g.beginPath(); g.arc(x, y, 5, 0, 7); g.fill();
    // ILS bars
    const nv = SIM.nav.out;
    if (nv.ils && spin > 0.9) {
      g.strokeStyle = C.magenta; g.lineWidth = 4;
      const lx = x + nv.cdi * 90; g.beginPath(); g.moveTo(lx, y - 90); g.lineTo(lx, y + 90); g.stroke();
      if (nv.gsValid) { const gy = y - nv.gs * 90; g.beginPath(); g.moveTo(x - 90, gy); g.lineTo(x + 90, gy); g.stroke(); }
    }
    // slip ball
    g.fillStyle = '#000'; g.fillRect(x - 46, y + r - 36, 92, 22);
    g.strokeStyle = '#888'; g.lineWidth = 1; g.strokeRect(x - 46, y + r - 36, 92, 22);
    g.strokeStyle = '#ccc'; g.beginPath(); g.moveTo(x - 12, y + r - 36); g.lineTo(x - 12, y + r - 14); g.moveTo(x + 12, y + r - 36); g.lineTo(x + 12, y + r - 14); g.stroke();
    const bx = x + U.clamp(-o.gLat * 140, -36, 36);
    g.fillStyle = '#fff'; g.beginPath(); g.arc(bx, y + r - 25, 9, 0, 7); g.fill();
    if (spin < 0.95) offFlag(g, x - 70, y - 60, 'OFF');
  }

  function drawALT(g, ac) {
    const [x, y, r] = L.alt, o = ac.out, s = ac.sys;
    bezel(g, x, y, r, 'ALTIMETER');
    for (let i = 0; i < 50; i++) {
      const a = -Math.PI / 2 + i / 50 * Math.PI * 2, big = i % 5 === 0;
      g.strokeStyle = C.white; g.lineWidth = big ? 3 : 1.5;
      g.beginPath(); g.moveTo(x + Math.cos(a) * (r - 4), y + Math.sin(a) * (r - 4)); g.lineTo(x + Math.cos(a) * (r - (big ? 20 : 11)), y + Math.sin(a) * (r - (big ? 20 : 11))); g.stroke();
      if (big) text(g, String(i / 5), x + Math.cos(a) * (r - 36), y + Math.sin(a) * (r - 36), 22);
    }
    const alt = o.altInd;
    // drum counter (thousands)
    g.fillStyle = '#000'; g.fillRect(x - 50, y - 26, 72, 34); g.strokeStyle = '#555'; g.strokeRect(x - 50, y - 26, 72, 34);
    const th = Math.floor(Math.max(alt, 0) / 1000);
    text(g, String(th).padStart(2, '0'), x - 14, y - 8, 26, alt < 0 ? '#f44' : C.white);
    text(g, 'FT', x + 38, y - 8, 12, C.dim);
    // Kollsman window
    g.fillStyle = '#000'; g.fillRect(x - 40, y + 34, 80, 24);
    text(g, String(Math.round(s.qnhSet)), x, y + 46, 18, C.white);
    text(g, 'hPa', x + 58, y + 46, 11, C.dim);
    // 10,000-ft pointer and hundreds needle
    needle(g, x, y, -Math.PI / 2 + (alt / 100000) * Math.PI * 2, r * 0.55, 3, '#cfcfcf');
    needle(g, x, y, -Math.PI / 2 + ((alt % 1000 + 1000) % 1000) / 1000 * Math.PI * 2, r - 12, 5, C.white);
  }

  function drawVSI(g, ac) {
    const [x, y, r] = L.vsi;
    bezel(g, x, y, r, 'VERTICAL SPEED');
    const ang = (v) => { const a = Math.abs(v), d = a <= 1000 ? a / 1000 * 60 : 60 + (Math.min(a, 6000) - 1000) / 5000 * 105; return Math.PI - Math.sign(v) * d * U.DEG * -1; };
    [0, 500, 1000, 2000, 3000, 4000, 6000].forEach((v) => [1, -1].forEach((sg) => {
      const a = ang(v * sg);
      g.strokeStyle = C.white; g.lineWidth = 3;
      g.beginPath(); g.moveTo(x + Math.cos(a) * (r - 4), y + Math.sin(a) * (r - 4)); g.lineTo(x + Math.cos(a) * (r - 18), y + Math.sin(a) * (r - 18)); g.stroke();
      if (v && v !== 500) text(g, String(v / 1000), x + Math.cos(a) * (r - 34), y + Math.sin(a) * (r - 34), 19);
    }));
    text(g, '0', x - r + 30, y, 19);
    text(g, 'UP', x - 10, y - 30, 13, C.dim); text(g, 'DN', x - 10, y + 30, 13, C.dim);
    text(g, '1000 FT/MIN', x + 18, y + 52, 11, C.dim);
    needle(g, x, y, ang(ac.out.vs), r - 10, 5, C.white);
  }

  function drawTC(g, ac) {
    const [x, y, r] = L.tc, o = ac.out, s = ac.sys;
    bezel(g, x, y, r, 'TURN COORDINATOR');
    const pw = s.avionicsPowered;
    g.strokeStyle = C.white; g.lineWidth = 4;
    [[-20, 'L'], [20, 'R']].forEach(([a, l]) => {
      const aa = a * U.DEG;
      g.save(); g.translate(x, y); g.rotate(aa);
      g.beginPath(); g.moveTo(-r + 6, 0); g.lineTo(-r + 26, 0); g.moveTo(r - 6, 0); g.lineTo(r - 26, 0); g.stroke();
      g.restore();
      text(g, l, x + (a < 0 ? -r + 30 : r - 30), y + 44, 20);
    });
    g.beginPath(); g.moveTo(x - r + 6, y); g.lineTo(x - r + 22, y); g.moveTo(x + r - 6, y); g.lineTo(x + r - 22, y); g.stroke();
    const rate = pw ? U.clamp(o.turnRate / 3 * 20, -40, 40) : 0;
    g.save(); g.translate(x, y); g.rotate(rate * U.DEG);
    g.strokeStyle = '#fff'; g.lineWidth = 7; g.lineCap = 'round';
    g.beginPath(); g.moveTo(-70, 0); g.lineTo(70, 0); g.moveTo(0, 0); g.lineTo(0, -18); g.stroke();
    g.fillStyle = '#fff'; g.beginPath(); g.arc(0, 0, 10, 0, 7); g.fill();
    g.restore(); g.lineCap = 'butt';
    text(g, '2 MIN', x, y - 52, 12, C.dim);
    // ball
    g.fillStyle = '#111'; g.fillRect(x - 54, y + 52, 108, 24);
    g.strokeStyle = '#ccc'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(x - 13, y + 52); g.lineTo(x - 13, y + 76); g.moveTo(x + 13, y + 52); g.lineTo(x + 13, y + 76); g.stroke();
    g.fillStyle = '#fff'; g.beginPath(); g.arc(x + U.clamp(-o.gLat * 150, -42, 42), y + 64, 10, 0, 7); g.fill();
    if (!pw) offFlag(g, x + 40, y - 20, 'OFF');
  }

  function drawHSI(g, ac) {
    const [x, y, r] = L.hsi, o = ac.out, s = ac.sys, nv = SIM.nav.out;
    bezel(g, x, y, r, 'HSI');
    const pw = s.gyroSpin > 0.9;
    const hdg = pw ? o.heading : 0;
    g.save(); g.translate(x, y); g.rotate(-hdg * U.DEG);
    for (let d = 0; d < 360; d += 5) {
      const a = (d - 90) * U.DEG, big = d % 10 === 0;
      g.strokeStyle = C.white; g.lineWidth = big ? 3 : 1.5;
      g.beginPath(); g.moveTo(Math.cos(a) * (r - 4), Math.sin(a) * (r - 4)); g.lineTo(Math.cos(a) * (r - (big ? 20 : 12)), Math.sin(a) * (r - (big ? 20 : 12))); g.stroke();
      if (d % 30 === 0) {
        const lbl = { 0: 'N', 90: 'E', 180: 'S', 270: 'W' }[d] || String(d / 10);
        g.save(); g.rotate((d) * U.DEG); text(g, lbl, 0, -r + 38, d % 90 === 0 ? 26 : 21, d % 90 === 0 ? C.yellow : C.white); g.restore();
      }
    }
    // heading bug
    g.save(); g.rotate(s.hdgBug * U.DEG); g.fillStyle = '#ff8c00';
    g.fillRect(-12, -r + 2, 8, 12); g.fillRect(4, -r + 2, 8, 12); g.restore();
    // bearing pointer
    if (nv.valid) {
      g.save(); g.rotate(nv.bearing * U.DEG); g.strokeStyle = C.cyan; g.lineWidth = 4;
      g.beginPath(); g.moveTo(0, r - 26); g.lineTo(0, -r + 26); g.stroke();
      g.fillStyle = C.cyan; g.beginPath(); g.moveTo(0, -r + 22); g.lineTo(-10, -r + 42); g.lineTo(10, -r + 42); g.fill();
      g.restore();
    }
    // course arrow & deviation bar
    g.save(); g.rotate(s.crsSel * U.DEG);
    g.strokeStyle = C.yellow; g.fillStyle = C.yellow; g.lineWidth = 6;
    g.beginPath(); g.moveTo(0, -r + 48); g.lineTo(0, -70); g.moveTo(0, 70); g.lineTo(0, r - 48); g.stroke();
    g.beginPath(); g.moveTo(0, -r + 40); g.lineTo(-12, -r + 62); g.lineTo(12, -r + 62); g.fill();
    for (let k = -2; k <= 2; k++) { if (!k) continue; g.strokeStyle = '#fff'; g.lineWidth = 2; g.beginPath(); g.arc(k * 28, 0, 5, 0, 7); g.stroke(); }
    if (nv.valid) {
      const dx = nv.cdi * 56;
      g.strokeStyle = C.yellow; g.lineWidth = 6; g.beginPath(); g.moveTo(dx, -64); g.lineTo(dx, 64); g.stroke();
      // to/from triangle
      g.fillStyle = '#fff'; g.beginPath();
      if (nv.toFrom > 0) { g.moveTo(26, -40); g.lineTo(18, -26); g.lineTo(34, -26); }
      else { g.moveTo(26, 40); g.lineTo(18, 26); g.lineTo(34, 26); }
      g.fill();
    }
    g.restore();
    g.restore();
    // fixed aircraft symbol & lubber line
    g.fillStyle = '#ff9a00'; g.beginPath(); g.moveTo(x, y - r + 2); g.lineTo(x - 8, y - r - 10); g.lineTo(x + 8, y - r - 10); g.fill();
    g.strokeStyle = '#fff'; g.lineWidth = 4;
    g.beginPath(); g.moveTo(x, y - 18); g.lineTo(x, y + 26); g.moveTo(x - 22, y); g.lineTo(x + 22, y); g.moveTo(x - 9, y + 22); g.lineTo(x + 9, y + 22); g.stroke();
    // glide slope scale on the right
    if (nv.gsValid) {
      for (let k = -2; k <= 2; k++) { g.strokeStyle = '#fff'; g.lineWidth = 2; g.beginPath(); g.arc(x + r - 22, y + k * 22, 4, 0, 7); g.stroke(); }
      g.fillStyle = C.magenta; g.beginPath(); const gy = y - nv.gs * 44; g.moveTo(x + r - 34, gy); g.lineTo(x + r - 22, gy - 9); g.lineTo(x + r - 10, gy); g.lineTo(x + r - 22, gy + 9); g.fill();
    }
    // readouts
    g.fillStyle = 'rgba(0,0,0,0.75)'; g.fillRect(x - r - 10, y - r - 10, 92, 46); g.fillRect(x + r - 82, y - r - 10, 92, 46);
    text(g, nv.valid ? nv.distNM.toFixed(1) : '---', x - r + 36, y - r + 2, 20, C.white);
    text(g, 'NM', x - r + 36, y - r + 24, 12, C.dim);
    text(g, nv.ident || '', x + r - 36, y - r + 2, 17, nv.ils ? C.green : C.cyan);
    text(g, 'CRS ' + U.pad(s.crsSel, 3), x + r - 36, y - r + 24, 13, C.yellow);
    if (!pw) offFlag(g, x - 60, y + 50, 'HDG');
  }

  function drawMFD(g, ac) {
    const [x0, y0, w, h] = L.mfd, s = ac.sys, o = ac.out;
    g.fillStyle = '#111316'; g.fillRect(x0 - 16, y0 - 16, w + 32, h + 92);
    g.fillStyle = '#000'; g.fillRect(x0, y0, w, h);
    // bezel buttons
    const btn = (bx, by, lbl) => { g.fillStyle = '#2b2f33'; g.fillRect(bx, by, 80, 40); g.strokeStyle = '#555'; g.strokeRect(bx, by, 80, 40); text(g, lbl, bx + 40, by + 21, 15, '#cfd3d6'); };
    btn(x0, y0 + h + 14, 'RNG −'); btn(x0 + 96, y0 + h + 14, 'RNG +'); btn(x0 + w - 176, y0 + h + 14, 'NAV ▸'); btn(x0 + w - 80, y0 + h + 14, 'HUD');
    if (!s.avionicsPowered) return;
    const cx = x0 + w / 2, cy = y0 + h * 0.62;
    const rangeNM = P.mapRange;
    const pxPerM = (h * 0.55) / (rangeNM * U.NM2M);
    g.save(); g.beginPath(); g.rect(x0, y0, w, h); g.clip();
    g.translate(cx, cy); g.rotate(-o.heading * U.DEG);
    const imgScale = MAP_SPAN / MAP_SIZE * pxPerM;
    g.imageSmoothingEnabled = true;
    g.drawImage(P.mapImg, (-MAP_SPAN / 2 - ac.pos.x) * pxPerM, (-MAP_SPAN / 2 - ac.pos.z) * pxPerM, MAP_SIZE * imgScale, MAP_SIZE * imgScale);
    const W = SIM.world;
    const toS = (wx, wz) => [(wx - ac.pos.x) * pxPerM, (wz - ac.pos.z) * pxPerM];
    // airfields
    W.airports.forEach((ap) => {
      const [a, b] = toS(ap.thr1.x, ap.thr1.z), [c2, d] = toS(ap.thr2.x, ap.thr2.z);
      g.strokeStyle = '#fff'; g.lineWidth = Math.max(3, ap.wid * pxPerM); g.beginPath(); g.moveTo(a, b); g.lineTo(c2, d); g.stroke();
      const [px, py] = toS(ap.x, ap.z);
      g.save(); g.translate(px, py); g.rotate(o.heading * U.DEG); text(g, ap.id, 0, -18, 14, C.cyan); g.restore();
    });
    // towns
    g.fillStyle = '#ddd';
    [W.city].concat(W.towns).forEach((t) => {
      const [px, py] = toS(t.x, t.z);
      if (Math.abs(px) > w || Math.abs(py) > h) return;
      g.save(); g.translate(px, py); g.rotate(o.heading * U.DEG); text(g, t.name, 0, 0, t === W.city ? 15 : 12, '#e8e8e8', 'center', t === W.city); g.restore();
    });
    // route line to nav destination
    const st = SIM.nav.selected(ac);
    const [sx, sy] = toS(st.x, st.z);
    g.strokeStyle = C.magenta; g.lineWidth = 3; g.setLineDash([12, 8]);
    g.beginPath(); g.moveTo(0, 0); g.lineTo(sx, sy); g.stroke(); g.setLineDash([]);
    g.restore();
    // range ring & own aircraft
    g.strokeStyle = 'rgba(255,255,255,0.5)'; g.lineWidth = 1.5;
    g.beginPath(); g.arc(cx, cy, h * 0.55 / 2, Math.PI, 2 * Math.PI); g.stroke();
    text(g, (rangeNM / 2) + '', cx + h * 0.275 + 14, cy - 8, 13, '#fff');
    g.fillStyle = C.yellow; g.beginPath(); g.moveTo(cx, cy - 16); g.lineTo(cx - 11, cy + 12); g.lineTo(cx, cy + 6); g.lineTo(cx + 11, cy + 12); g.fill();
    // header
    g.fillStyle = 'rgba(0,0,0,0.6)'; g.fillRect(x0, y0, w, 30);
    text(g, 'HDG ' + U.pad(o.heading, 3) + '°', x0 + 70, y0 + 15, 17, C.green);
    text(g, 'GS ' + Math.round(o.gs) + ' KT', x0 + 210, y0 + 15, 17, C.green);
    text(g, 'RNG ' + rangeNM + ' NM', x0 + 345, y0 + 15, 17, C.green);
    g.fillStyle = 'rgba(0,0,0,0.6)'; g.fillRect(x0, y0 + h - 30, w, 30);
    const nv = SIM.nav.out;
    text(g, '→ ' + st.id + '  ' + U.pad(nv.bearing, 3) + '°  ' + nv.distNM.toFixed(1) + ' NM  ' + (nv.eteMin < 600 ? Math.floor(nv.eteMin) + ':' + U.pad(nv.eteMin % 1 * 60, 2) : '--:--'), x0 + w / 2, y0 + h - 15, 17, C.magenta);
  }

  function drawGearPanel(g, ac) {
    const s = ac.sys;
    const x = 40, y = 600;
    section(g, x, y, 190, 400, 'LDG GEAR');
    // lights
    const lights = [['NOSE', 0], ['LEFT', 1], ['RIGHT', 2]];
    lights.forEach(([lbl], i) => {
      const lx = x + 22 + i * 52, ly = y + 30;
      const down = s.gearPos > 0.99, transit = s.gearPos > 0.01 && s.gearPos < 0.99;
      const pw = s.powered;
      g.fillStyle = '#111'; g.beginPath(); g.arc(lx + 20, ly + 20, 22, 0, 7); g.fill();
      g.fillStyle = !pw ? '#1c1c1c' : down ? C.green : transit ? C.red : '#1c1c1c';
      if (pw && (down || transit)) { g.shadowColor = g.fillStyle; g.shadowBlur = 16; }
      g.beginPath(); g.arc(lx + 20, ly + 20, 17, 0, 7); g.fill(); g.shadowBlur = 0;
      text(g, lbl, lx + 20, ly + 56, 12, C.dim);
    });
    // lever slot
    g.fillStyle = '#111'; g.fillRect(x + 80, y + 110, 30, 170);
    text(g, 'UP', x + 140, y + 125, 15); text(g, 'DN', x + 140, y + 265, 15);
    const ly = s.gearLever ? y + 255 : y + 135;
    g.fillStyle = '#c8c8c8'; g.fillRect(x + 89, Math.min(ly, y + 195), 12, Math.abs(ly - (y + 195)) + 4);
    // wheel-shaped knob
    g.fillStyle = '#e8e8e8'; g.beginPath(); g.arc(x + 95, ly, 22, 0, 7); g.fill();
    g.fillStyle = '#333'; g.beginPath(); g.arc(x + 95, ly, 9, 0, 7); g.fill();
    // flap & trim indicators
    text(g, 'FLAPS', x + 50, y + 305, 13, C.dim);
    g.fillStyle = '#000'; g.fillRect(x + 15, y + 318, 70, 34);
    text(g, s.flapPos < 0.02 ? 'UP' : Math.round(s.flapPos * 50) + '°', x + 50, y + 336, 19, s.powered ? C.white : '#222');
    text(g, 'TRIM', x + 140, y + 305, 13, C.dim);
    g.fillStyle = '#000'; g.fillRect(x + 110, y + 318, 60, 70);
    g.strokeStyle = '#666'; g.beginPath(); g.moveTo(x + 115, y + 353); g.lineTo(x + 165, y + 353); g.stroke();
    const ty = y + 353 - ac.controls.trim * 30;
    g.fillStyle = C.white; g.beginPath(); g.moveTo(x + 115, ty); g.lineTo(x + 135, ty - 7); g.lineTo(x + 135, ty + 7); g.fill();
    text(g, 'UP', x + 152, y + 328, 11, C.dim); text(g, 'DN', x + 152, y + 380, 11, C.dim);
    text(g, 'BRK ' + (s.parkingBrake ? 'PARK' : ''), x + 50, y + 380, 13, s.parkingBrake && s.powered ? C.amber : '#444');
  }

  function drawCautions(g, ac) {
    const [x, y, w, h] = L.caut;
    g.fillStyle = '#0d0e0f'; g.fillRect(x - 6, y - 6, w + 12, h + 12);
    const c = ac.cautions();
    const keys = Object.keys(c);
    const cols = 4, rows = Math.ceil(keys.length / cols);
    const cw = w / cols, ch = h / rows;
    const test = P.lampTest;
    keys.forEach((k, i) => {
      const cx = x + (i % cols) * cw, cy = y + Math.floor(i / cols) * ch;
      const warn = k === 'OVER G' || k === 'STALL' || k === 'ENG FIRE';
      lamp(g, cx + 4, cy + 4, cw - 8, ch - 8, k, test || c[k], warn ? '#ff3b2b' : '#ffb000', true);
    });
  }

  function drawTopStrip(g, ac) {
    const s = ac.sys, pw = s.powered;
    lamp(g, 480, 26, 150, 70, 'MASTER', pw && s.masterCaution && (P.frame % 30 < 20), C.amber);
    text(g, 'CAUTION', 555, 80, 14, pw && s.masterCaution ? '#140c00' : '#5b554a');
    lamp(g, 650, 26, 110, 70, 'FIRE', false, C.red);
    lamp(g, 780, 26, 110, 70, 'STALL', pw && s.stallWarn && P.frame % 16 < 10, C.red);
    lamp(g, 910, 26, 110, 70, 'GEAR', pw && s.gearHorn, C.red);
    // AoA indexer (right of HUD)
    const aoa = ac.out.aoa;
    const on = s.avionicsPowered && s.gearPos > 0.9 && !ac.onGround;
    const slow = on && aoa > 5.5, ok = on && aoa >= 3.5 && aoa <= 5.5, fast = on && aoa < 3.5;
    const ix = 1060, iy = 26;
    g.fillStyle = '#111'; g.fillRect(ix, iy, 230, 70);
    // ▼ slow
    g.fillStyle = slow ? '#33ff55' : '#1f2a1f'; g.beginPath(); g.moveTo(ix + 15, iy + 15); g.lineTo(ix + 65, iy + 15); g.lineTo(ix + 40, iy + 58); g.fill();
    g.strokeStyle = ok ? '#ffcc22' : '#2a2a1f'; g.lineWidth = 10; g.beginPath(); g.arc(ix + 115, iy + 35, 20, 0, 7); g.stroke();
    g.fillStyle = fast ? '#ff3322' : '#2a1f1f'; g.beginPath(); g.moveTo(ix + 165, iy + 58); g.lineTo(ix + 215, iy + 58); g.lineTo(ix + 190, iy + 15); g.fill();
    // armament / CMDS
    lamp(g, 1320, 26, 120, 70, 'ARM', pw && s.masterArm, '#ff3b2b');
    g.fillStyle = '#000'; g.fillRect(1460, 26, 140, 70);
    text(g, 'FLR ' + (pw ? U.pad(s.flares, 2) : '--'), 1530, 52, 22, pw && s.cmdsArm ? C.green : '#2a3a2a');
    text(g, 'CMDS', 1530, 82, 12, C.dim);
    // volts
    g.fillStyle = '#000'; g.fillRect(1620, 26, 140, 70);
    text(g, s.busVolts.toFixed(1) + ' V', 1690, 52, 22, s.busVolts > 1 ? C.amber : '#332');
    text(g, 'DC BUS', 1690, 82, 12, C.dim);
    // OAT
    g.fillStyle = '#000'; g.fillRect(1780, 26, 140, 70);
    text(g, (s.powered ? Math.round(ac.out.oat) + '°C' : '--'), 1850, 52, 22, s.powered ? C.amber : '#332');
    text(g, 'OAT', 1850, 82, 12, C.dim);
  }

  function drawFront(ac) {
    const g = P.cv.front.getContext('2d');
    panelBg(g, 2048, 1024);
    // glareshield shadow along the top
    const sh = g.createLinearGradient(0, 0, 0, 40); sh.addColorStop(0, 'rgba(0,0,0,0.6)'); sh.addColorStop(1, 'rgba(0,0,0,0)');
    const s = ac.sys, o = ac.out, pw = s.avionicsPowered;
    drawTopStrip(g, ac);
    drawMFD(g, ac);
    drawASI(g, ac); drawADI(g, ac); drawALT(g, ac);
    drawTC(g, ac); drawHSI(g, ac); drawVSI(g, ac);
    // knobs
    knob(g, L.alt[0] + 92, L.alt[1] + 112, 24, 'BARO');
    knob(g, L.hsi[0] - 150, L.hsi[1] + 140, 24, 'HDG');
    knob(g, L.hsi[0] + 150, L.hsi[1] + 140, 24, 'CRS');
    // AoA & G
    bezel(g, L.aoa[0], L.aoa[1], L.aoa[2], 'ANGLE OF ATTACK');
    arcGauge(g, L.aoa[0], L.aoa[1], L.aoa[2], pw ? o.aoa : null, -5, 25, { major: 6, minor: 5, title: 'AOA', unit: 'DEG', bands: [[3.5, 5.5, "#2db84c"], [13.5, 25, '#ff2a2a']], off: !pw });
    bezel(g, L.gm[0], L.gm[1], L.gm[2], 'G-METER (click reset)');
    const gm = L.gm;
    arcGauge(g, gm[0], gm[1], gm[2], null, -4, 10, { major: 7, minor: 2, title: 'G', bands: [[8, 10, '#ff2a2a'], [-4, -3, '#ff2a2a']] });
    const ga = (v) => Math.PI * 0.75 + Math.PI * 1.5 * (U.clamp(v, -4, 10) + 4) / 14;
    needle(g, gm[0], gm[1], ga(ac.gMax), gm[2] - 22, 2, '#9fa6ad');
    needle(g, gm[0], gm[1], ga(ac.gMin), gm[2] - 22, 2, '#9fa6ad');
    needle(g, gm[0], gm[1], ga(o.g), gm[2] - 12, 4, C.white);
    drawGearPanel(g, ac);
    // engine
    const epw = s.powered;
    bezel(g, L.n1[0], L.n1[1], L.n1[2], 'ENGINE RPM');
    arcGauge(g, L.n1[0], L.n1[1], L.n1[2], epw ? s.n1 : 0, 0, 110, { major: 11, minor: 2, labelEvery: 2, title: 'N1', unit: '%', bands: [[54, 100, '#2db84c'], [102, 110, '#ff2a2a']], digital: epw ? s.n1.toFixed(1) : '', powered: epw });
    bezel(g, L.egt[0], L.egt[1], L.egt[2], 'EXHAUST TEMP');
    arcGauge(g, L.egt[0], L.egt[1], L.egt[2], epw ? s.egt : 0, 0, 1000, { major: 10, labelEvery: 2, fmt: (v) => v / 100, title: 'EGT', unit: '°C x100', bands: [[350, 700, '#2db84c'], [700, 750, '#ffb000'], [750, 1000, '#ff2a2a']], digital: epw ? Math.round(s.egt) + '' : '', powered: epw });
    bezel(g, L.fuel[0], L.fuel[1], L.fuel[2], 'FUEL QTY');
    arcGauge(g, L.fuel[0], L.fuel[1], L.fuel[2], epw ? ac.fuel : 0, 0, 1400, { major: 7, labelEvery: 1, fmt: (v) => v / 100, title: 'FUEL', unit: 'KG x100', bands: [[0, 180, '#ff2a2a'], [180, 350, '#ffb000']], digital: epw ? Math.round(ac.fuel) + '' : '', powered: epw });
    bezel(g, L.ff[0], L.ff[1], L.ff[2], 'FUEL FLOW');
    arcGauge(g, L.ff[0], L.ff[1], L.ff[2], epw ? s.fuelFlow : 0, 0, 3000, { major: 6, fmt: (v) => v / 1000, title: 'FF', unit: 'KG/H x1000', digital: epw ? Math.round(s.fuelFlow) + '' : '', powered: epw });
    bezel(g, L.oil[0], L.oil[1], L.oil[2], 'OIL PRESS');
    arcGauge(g, L.oil[0], L.oil[1], L.oil[2], epw ? s.oilPress : 0, 0, 100, { major: 5, title: 'OIL', unit: 'PSI', bands: [[0, 15, '#ff2a2a'], [25, 60, '#2db84c']] });
    bezel(g, L.hyd[0], L.hyd[1], L.hyd[2], 'HYD PRESS');
    arcGauge(g, L.hyd[0], L.hyd[1], L.hyd[2], epw ? s.hydPress : 0, 0, 4000, { major: 4, fmt: (v) => v / 1000, title: 'HYD', unit: 'PSI x1000', bands: [[2800, 3200, '#2db84c'], [0, 1500, '#ff2a2a']] });
    // clock
    const [cx, cy, cr] = L.clock;
    bezel(g, cx, cy, cr, 'CLOCK');
    for (let i = 0; i < 60; i++) { const a = i / 60 * Math.PI * 2; g.strokeStyle = C.white; g.lineWidth = i % 5 ? 1 : 3; g.beginPath(); g.moveTo(cx + Math.cos(a) * (cr - 4), cy + Math.sin(a) * (cr - 4)); g.lineTo(cx + Math.cos(a) * (cr - (i % 5 ? 9 : 16)), cy + Math.sin(a) * (cr - (i % 5 ? 9 : 16))); g.stroke(); }
    for (let i = 1; i <= 12; i++) { const a = i / 12 * Math.PI * 2 - Math.PI / 2; text(g, String(i), cx + Math.cos(a) * (cr - 28), cy + Math.sin(a) * (cr - 28), 16); }
    const tod = SIM.env.timeOfDay * 3600;
    needle(g, cx, cy, (tod / 43200) * Math.PI * 2 - Math.PI / 2, cr * 0.5, 4, C.white);
    needle(g, cx, cy, (tod / 3600) * Math.PI * 2 - Math.PI / 2, cr * 0.8, 3, C.white);
    needle(g, cx, cy, (tod % 60) / 60 * Math.PI * 2 - Math.PI / 2, cr * 0.85, 1.5, '#ff5030');
    // radar altimeter
    const [rx, ry, rr] = L.radalt;
    bezel(g, rx, ry, rr, 'RADAR ALT');
    const ra = o.agl * U.M2FT;
    const raOK = pw && ra < 5000;
    const rang = (f) => -Math.PI / 2 + 330 * U.DEG * (f <= 1000 ? f / 1000 * 0.6 : 0.6 + (Math.min(f, 5000) - 1000) / 4000 * 0.4);
    [0, 200, 400, 600, 800, 1000, 2000, 3000, 5000].forEach((f) => {
      const a = rang(f); g.strokeStyle = C.white; g.lineWidth = 2.5;
      g.beginPath(); g.moveTo(rx + Math.cos(a) * (rr - 4), ry + Math.sin(a) * (rr - 4)); g.lineTo(rx + Math.cos(a) * (rr - 16), ry + Math.sin(a) * (rr - 16)); g.stroke();
      if ([0, 400, 1000, 2000, 5000].includes(f)) text(g, f >= 1000 ? f / 1000 + 'k' : String(f), rx + Math.cos(a) * (rr - 32), ry + Math.sin(a) * (rr - 32), 15);
    });
    g.fillStyle = '#000'; g.fillRect(rx - 34, ry + 18, 68, 26);
    text(g, raOK ? String(Math.max(0, Math.round(ra / 10) * 10)) : '----', rx, ry + 31, 17, C.amber);
    needle(g, rx, ry, rang(raOK ? Math.max(0, ra) : 5000), rr - 10, 4, C.white);
    if (!raOK) offFlag(g, rx + 25, ry - 25, 'OFF');
    drawCautions(g, ac);
    // labels
    text(g, 'KESTREL T.2', 1880, 735, 22, '#7c8288');
    text(g, 'ADVANCED JET TRAINER', 1880, 765, 13, '#6c7278');
    text(g, 'Hover any item for an explanation', 1880, 800, 12, '#6c7278');
    P.tex.front.needsUpdate = true;
  }

  // ------------------------------------------------------------------------
  // CONSOLES
  // ------------------------------------------------------------------------
  function drawLeft(ac) {
    const g = P.cv.left.getContext('2d'), s = ac.sys;
    panelBg(g, 384, 1280);
    section(g, 12, 40, 360, 400, 'ENGINE');
    toggle(g, 95, 140, 'ENG MASTER', s.engineMaster, 'ON', 'OFF', true);
    toggle(g, 280, 140, 'FUEL PUMP', s.fuelPump);
    toggle(g, 95, 330, 'IGNITION', s.ignition, 'CONT', 'NORM');
    // start button
    const sx = 280, sy = 330;
    text(g, 'START', sx, sy - 62, 17);
    g.fillStyle = '#111'; g.beginPath(); g.arc(sx, sy, 34, 0, 7); g.fill();
    const lit = s.starter && s.powered;
    g.fillStyle = lit ? '#3dff6a' : '#1b4d27'; if (lit) { g.shadowColor = '#3dff6a'; g.shadowBlur = 20; }
    g.beginPath(); g.arc(sx, sy, 26, 0, 7); g.fill(); g.shadowBlur = 0;
    text(g, 'PUSH', sx, sy + 1, 14, lit ? '#022' : '#7fa88a');
    text(g, s.engineRunning ? 'RUNNING' : s.lightOff ? 'LIGHT-OFF' : s.starter ? 'CRANKING' : '', sx, sy + 52, 13, C.green);
    // throttle quadrant
    section(g, 190, 480, 170, 470, 'THROTTLE');
    g.fillStyle = '#0c0c0c'; g.fillRect(262, 520, 18, 400);
    text(g, 'MIL', 320, 540, 15); text(g, '100%', 320, 560, 12, C.dim);
    text(g, 'IDLE', 320, 880, 15); text(g, 'OFF→', 320, 905, 11, C.dim);
    const ty = 900 - ac.controls.throttle * 360;
    g.fillStyle = '#ffd040'; g.fillRect(250, ty - 3, 42, 6);
    text(g, Math.round(ac.controls.throttle * 100) + '%', 230, ty, 14, C.amber, 'right');
    // flaps lever
    section(g, 12, 480, 160, 330, 'FLAPS');
    g.fillStyle = '#0c0c0c'; g.fillRect(80, 520, 16, 250);
    ['UP', 'MID', 'DN'].forEach((l, i) => text(g, l, 135, 535 + i * 110, 16));
    const fy = 535 + s.flapLever * 220;
    g.fillStyle = '#e0e0e0'; g.fillRect(52, fy - 14, 72, 28);
    g.fillStyle = '#555'; g.fillRect(56, fy - 3, 64, 6);
    // airbrake & parking brake
    toggle(g, 95, 920, 'AIRBRAKE', s.airbrakeSw > 0.5, 'OUT', 'IN');
    section(g, 12, 1030, 360, 220, 'BRAKES');
    // parking brake T-handle
    const py = s.parkingBrake ? 1150 : 1110;
    g.fillStyle = '#111'; g.fillRect(70, 1090, 50, 100);
    g.fillStyle = '#d8b030'; g.fillRect(55, py - 12, 80, 24); g.fillRect(88, py, 14, 1190 - py);
    text(g, 'PARK BRAKE', 95, 1215, 14); text(g, s.parkingBrake ? 'SET' : 'OFF', 95, 1236, 13, s.parkingBrake ? C.amber : C.dim);
    toggle(g, 280, 1150, 'ANTI-SKID', s.antiSkid);
    P.tex.left.needsUpdate = true;
  }

  function drawRight(ac) {
    const g = P.cv.right.getContext('2d'), s = ac.sys;
    panelBg(g, 384, 1280);
    section(g, 12, 40, 360, 380, 'ELECTRICAL');
    toggle(g, 95, 140, 'BATTERY', s.battery);
    toggle(g, 280, 140, 'GENERATOR', s.generator);
    toggle(g, 95, 320, 'AVIONICS', s.avionics);
    // voltmeter
    g.fillStyle = '#000'; g.fillRect(215, 290, 130, 60);
    text(g, s.busVolts.toFixed(1) + ' V', 280, 320, 24, s.busVolts > 1 ? C.amber : '#332');
    text(g, s.genOnline ? 'GEN' : s.powered ? 'BATT' : '', 280, 368, 13, C.dim);
    section(g, 12, 450, 360, 320, 'LIGHTS');
    toggle(g, 95, 545, 'NAV', s.navLights);
    toggle(g, 280, 545, 'STROBE', s.strobe);
    toggle(g, 95, 705, 'LANDING', s.landingLight);
    toggle(g, 280, 705, 'TAXI', s.taxiLight);
    section(g, 12, 800, 360, 220, 'SYSTEMS');
    toggle(g, 95, 905, 'PITOT HEAT', s.pitotHeat);
    toggle(g, 280, 905, 'YAW DAMPER', s.yawDamper);
    section(g, 12, 1050, 360, 215, 'ARMAMENT');
    toggle(g, 95, 1160, 'MASTER ARM', s.masterArm, 'ARM', 'SAFE', true);
    toggle(g, 280, 1160, 'CMDS', s.cmdsArm, 'ARM', 'OFF');
    P.tex.right.needsUpdate = true;
  }

  // ------------------------------------------------------------------------
  // regions (clickable / hoverable)
  // ------------------------------------------------------------------------
  function defineRegions() {
    const R = P.regions;
    const circ = (panel, id, x, y, r, act) => R[panel].push({ id, x: x - r, y: y - r, w: 2 * r, h: 2 * r, act });
    const rect = (panel, id, x, y, w, h, act) => R[panel].push({ id, x, y, w, h, act });
    const tg = (name) => (ac) => ac.action(name);
    // front
    circ('front', 'asi', ...L.asi); circ('front', 'adi', ...L.adi); circ('front', 'alt', ...L.alt);
    circ('front', 'tc', ...L.tc); circ('front', 'hsi', ...L.hsi); circ('front', 'vsi', ...L.vsi);
    circ('front', 'aoa', ...L.aoa); circ('front', 'gmeter', L.gm[0], L.gm[1], L.gm[2], (ac) => ac.action('gReset'));
    circ('front', 'n1', ...L.n1); circ('front', 'egt', ...L.egt); circ('front', 'fuel', ...L.fuel);
    circ('front', 'ff', ...L.ff); circ('front', 'oil', ...L.oil); circ('front', 'hyd', ...L.hyd);
    circ('front', 'clock', ...L.clock); circ('front', 'radalt', ...L.radalt);
    rect('front', 'cautions', ...L.caut, (ac) => { P.lampTest = true; setTimeout(() => (P.lampTest = false), 1500); });
    rect('front', 'masterCaution', 480, 26, 150, 70, (ac) => ac.action('cautionReset'));
    rect('front', 'indexer', 1060, 26, 230, 70);
    rect('front', 'masterArm', 1320, 26, 120, 70);
    rect('front', 'flareCount', 1460, 26, 140, 70);
    rect('front', 'volts', 1620, 26, 140, 70);
    rect('front', 'gearLever', 40, 600, 190, 300, (ac) => ac.action('gear'));
    rect('front', 'flaps', 40, 900, 100, 90);
    const [mx, my, mw, mh] = L.mfd;
    rect('front', 'mfd', mx, my, mw, mh);
    rect('front', 'rngBtn', mx, my + mh + 14, 80, 40, () => { P.mapRange = RANGES[Math.max(0, RANGES.indexOf(P.mapRange) - 1)]; });
    rect('front', 'rngBtn', mx + 96, my + mh + 14, 80, 40, () => { P.mapRange = RANGES[Math.min(RANGES.length - 1, RANGES.indexOf(P.mapRange) + 1)]; });
    rect('front', 'navBtn', mx + mw - 176, my + mh + 14, 80, 40, (ac) => { ac.sys.navIndex++; SIM.nav.autoCourse(ac); });
    rect('front', 'hud', mx + mw - 80, my + mh + 14, 80, 40, () => { SIM.hud.enabled = !SIM.hud.enabled; });
    const kn = (id, x, y, fn) => rect('front', id, x - 26, y - 26, 52, 52, fn);
    kn('baro', L.alt[0] + 92, L.alt[1] + 112, (ac, dir) => { ac.sys.qnhSet = U.clamp(ac.sys.qnhSet + dir, 950, 1050); });
    kn('hdgKnob', L.hsi[0] - 150, L.hsi[1] + 140, (ac, dir, shift) => { ac.sys.hdgBug = shift ? Math.round(ac.out.heading) : U.wrap360(ac.sys.hdgBug + dir * 5); });
    kn('crsKnob', L.hsi[0] + 150, L.hsi[1] + 140, (ac, dir, shift) => { ac.sys.crsSel = shift ? Math.round(SIM.nav.out.bearing) : U.wrap360(ac.sys.crsSel + dir * 5); });
    // left console
    const sw = (panel, id, x, y) => rect(panel, id, x - 50, y - 70, 100, 130, tg(id));
    sw('left', 'engineMaster', 95, 140); sw('left', 'fuelPump', 280, 140); sw('left', 'ignition', 95, 330);
    rect('left', 'start', 230, 260, 100, 120, (ac) => ac.action('start'));
    rect('left', 'throttle', 190, 480, 170, 470);
    rect('left', 'flaps', 12, 480, 160, 330, (ac, dir, shift, cy) => {
      const pos = U.clamp(Math.round((cy - 535) / 110), 0, 2) / 2; ac.action('flaps', pos);
    });
    rect('left', 'airbrake', 45, 850, 100, 130, (ac) => ac.action('airbrake'));
    rect('left', 'parkingBrake', 12, 1060, 170, 190, (ac) => ac.action('parkingBrake'));
    sw('left', 'antiSkid', 280, 1150);
    // right console
    sw('right', 'battery', 95, 140); sw('right', 'generator', 280, 140); sw('right', 'avionics', 95, 320);
    rect('right', 'volts', 215, 290, 130, 60);
    sw('right', 'navLights', 95, 545); sw('right', 'strobe', 280, 545); sw('right', 'landingLight', 95, 705); sw('right', 'taxiLight', 280, 705);
    sw('right', 'pitotHeat', 95, 905); sw('right', 'yawDamper', 280, 905);
    sw('right', 'masterArm', 95, 1160); sw('right', 'cmdsArm', 280, 1160);
  }

  /** Find the region under canvas coordinates. */
  P.hit = function (panel, cx, cy) {
    const list = P.regions[panel];
    // smaller regions win (buttons sit on top of bigger areas)
    let best = null;
    for (const r of list) {
      if (cx >= r.x && cx <= r.x + r.w && cy >= r.y && cy <= r.y + r.h) {
        if (!best || r.w * r.h < best.w * best.h) best = r;
      }
    }
    return best;
  };

  P.click = function (ac, panel, cx, cy, button, shift) {
    const r = P.hit(panel, cx, cy);
    if (!r || !r.act) return r;
    let dir = cx > r.x + r.w / 2 ? 1 : -1;
    if (button === 'wheelUp') dir = 1; else if (button === 'wheelDown') dir = -1;
    r.act(ac, dir, shift, cy);
    SIM.audio && SIM.audio.click();
    return r;
  };

  P.draw = function (ac) {
    P.frame++;
    drawFront(ac);
    if (P.frame % 2 === 0) { drawLeft(ac); drawRight(ac); }
  };
})(typeof window !== 'undefined' ? window : globalThis);
