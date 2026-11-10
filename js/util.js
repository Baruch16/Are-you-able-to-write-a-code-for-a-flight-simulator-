/* ==========================================================================
 * util.js — math helpers, seeded noise, unit conversions
 * Everything in the simulator uses SI units internally (metres, seconds,
 * kilograms, newtons, radians). Aviation units (knots, feet, ft/min, NM)
 * are only used for display, exactly like a real aircraft's instruments.
 * ========================================================================== */
(function (root) {
  'use strict';
  const SIM = root.SIM = root.SIM || {};

  const U = SIM.util = {};

  // ---- unit conversions --------------------------------------------------
  U.M2FT = 3.28084;
  U.FT2M = 1 / U.M2FT;
  U.MS2KT = 1.943844;
  U.KT2MS = 1 / U.MS2KT;
  U.MS2FPM = 196.8504;
  U.M2NM = 1 / 1852;
  U.NM2M = 1852;
  U.DEG = Math.PI / 180;
  U.RAD = 180 / Math.PI;
  U.G = 9.80665;

  U.clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  U.lerp = (a, b, t) => a + (b - a) * t;
  U.smoothstep = (e0, e1, x) => {
    const t = U.clamp((x - e0) / (e1 - e0), 0, 1);
    return t * t * (3 - 2 * t);
  };
  U.wrap360 = (d) => ((d % 360) + 360) % 360;
  U.wrapPi = (a) => {
    while (a > Math.PI) a -= 2 * Math.PI;
    while (a < -Math.PI) a += 2 * Math.PI;
    return a;
  };
  // Exponential approach: moves `cur` toward `target` with time constant tau.
  U.approach = (cur, target, tau, dt) => cur + (target - cur) * (1 - Math.exp(-dt / Math.max(1e-4, tau)));
  // Move toward target at a fixed maximum rate (units / second).
  U.moveToward = (cur, target, rate, dt) => {
    const d = target - cur, m = rate * dt;
    return Math.abs(d) <= m ? target : cur + Math.sign(d) * m;
  };

  // ---- seeded RNG (mulberry32) ------------------------------------------
  U.rng = function (seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };
  // Integer hash of two ints -> [0,1)
  U.hash2 = function (x, y, seed) {
    let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(seed | 0, 2147483647)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  };

  // ---- 2D simplex noise (seeded) -----------------------------------------
  function makeSimplex(seed) {
    const rand = U.rng(seed);
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    for (let i = 255; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      const t = p[i]; p[i] = p[j]; p[j] = t;
    }
    const perm = new Uint8Array(512), permMod12 = new Uint8Array(512);
    for (let i = 0; i < 512; i++) { perm[i] = p[i & 255]; permMod12[i] = perm[i] % 12; }
    const grad3 = new Float32Array([1, 1, -1, 1, 1, -1, -1, -1, 1, 0, -1, 0, 1, 0, -1, 0, 0, 1, 0, -1, 0, 1, 0, -1]);
    const F2 = 0.5 * (Math.sqrt(3) - 1), G2 = (3 - Math.sqrt(3)) / 6;
    return function (xin, yin) {
      let n0 = 0, n1 = 0, n2 = 0;
      const s = (xin + yin) * F2;
      const i = Math.floor(xin + s), j = Math.floor(yin + s);
      const t = (i + j) * G2;
      const x0 = xin - (i - t), y0 = yin - (j - t);
      let i1, j1;
      if (x0 > y0) { i1 = 1; j1 = 0; } else { i1 = 0; j1 = 1; }
      const x1 = x0 - i1 + G2, y1 = y0 - j1 + G2;
      const x2 = x0 - 1 + 2 * G2, y2 = y0 - 1 + 2 * G2;
      const ii = i & 255, jj = j & 255;
      let t0 = 0.5 - x0 * x0 - y0 * y0;
      if (t0 >= 0) { const g = permMod12[ii + perm[jj]] * 2; t0 *= t0; n0 = t0 * t0 * (grad3[g] * x0 + grad3[g + 1] * y0); }
      let t1 = 0.5 - x1 * x1 - y1 * y1;
      if (t1 >= 0) { const g = permMod12[ii + i1 + perm[jj + j1]] * 2; t1 *= t1; n1 = t1 * t1 * (grad3[g] * x1 + grad3[g + 1] * y1); }
      let t2 = 0.5 - x2 * x2 - y2 * y2;
      if (t2 >= 0) { const g = permMod12[ii + 1 + perm[jj + 1]] * 2; t2 *= t2; n2 = t2 * t2 * (grad3[g] * x2 + grad3[g + 1] * y2); }
      return 70 * (n0 + n1 + n2); // ~[-1,1]
    };
  }
  U.makeSimplex = makeSimplex;

  U.fbm = function (noise, x, y, oct, lac, gain) {
    lac = lac || 2.0; gain = gain || 0.5;
    let a = 1, f = 1, s = 0, n = 0;
    for (let i = 0; i < oct; i++) { s += a * noise(x * f, y * f); n += a; a *= gain; f *= lac; }
    return s / n;
  };
  U.ridged = function (noise, x, y, oct) {
    let a = 1, f = 1, s = 0, n = 0, w = 1;
    for (let i = 0; i < oct; i++) {
      let v = 1 - Math.abs(noise(x * f, y * f));
      v *= v; v *= w; w = U.clamp(v * 1.6, 0, 1);
      s += a * v; n += a; a *= 0.5; f *= 2.05;
    }
    return s / n; // [0,1]
  };

  // distance from point to segment (2D) -> {d, t}
  U.segDist = function (px, pz, ax, az, bx, bz) {
    const dx = bx - ax, dz = bz - az;
    const l2 = dx * dx + dz * dz;
    let t = l2 > 0 ? ((px - ax) * dx + (pz - az) * dz) / l2 : 0;
    t = U.clamp(t, 0, 1);
    const cx = ax + dx * t - px, cz = az + dz * t - pz;
    return Math.sqrt(cx * cx + cz * cz);
  };

  // Heading convention: 0° = north = -Z, 90° = east = +X (world: X east, Y up, Z south)
  U.headingVec = function (hdgDeg) {
    const h = hdgDeg * U.DEG;
    return { x: Math.sin(h), z: -Math.cos(h) };
  };
  U.bearingTo = function (fx, fz, tx, tz) {
    return U.wrap360(Math.atan2(tx - fx, -(tz - fz)) * U.RAD);
  };

  U.pad = (n, w) => String(Math.round(n)).padStart(w, '0');
})(typeof window !== 'undefined' ? window : globalThis);
