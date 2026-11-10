/* ==========================================================================
 * world.js — the geography of the simulated region (pure math, no graphics)
 *
 * The world is built at REAL SCALE: 1 unit = 1 metre. The playable region is
 * roughly 120 km x 120 km (and terrain continues procedurally beyond it).
 * Coordinates: X = east, Y = up, Z = south (so north is -Z).
 *
 * Everything here is deterministic, so the physics (which asks "how high is
 * the ground under my wheels?") and the graphics (which draw the terrain mesh)
 * always agree.
 * ========================================================================== */
(function (root) {
  'use strict';
  const SIM = root.SIM = root.SIM || {};
  const U = SIM.util;
  const W = SIM.world = {};

  const SEED = 20261;
  const nA = U.makeSimplex(SEED + 1);   // continental shape
  const nB = U.makeSimplex(SEED + 2);   // rolling hills
  const nC = U.makeSimplex(SEED + 3);   // mountains
  const nD = U.makeSimplex(SEED + 4);   // coastline
  const nF = U.makeSimplex(SEED + 5);   // forests
  const nG = U.makeSimplex(SEED + 6);   // misc variation
  W.noise = { nA, nB, nC, nD, nF, nG };

  // ------------------------------------------------------------------------
  // Airfields. hdg = true heading of the primary runway direction.
  // Runway designator = heading / 10 (e.g. heading 270° -> runway "27").
  // ------------------------------------------------------------------------
  W.airports = [
    { id: 'LFAB', name: 'Falcon Air Base', short: 'FALCON AB', military: true,
      x: 0, z: 0, hdg: 270, len: 3000, wid: 45, ils: true, taxiSide: 1 },
    { id: 'LMRD', name: 'Meridian International', short: 'MERIDIAN', military: false,
      x: 11500, z: 9500, hdg: 340, len: 2600, wid: 45, ils: true, taxiSide: -1 },
    { id: 'LHGH', name: 'Highland Field', short: 'HIGHLAND', military: false,
      x: -15000, z: -23500, hdg: 20, len: 1500, wid: 30, ils: false, taxiSide: 1 }
  ];

  // Towns (radius in metres). The big city is handled separately.
  W.city = { name: 'Port Meridian', x: 19500, z: -2500, r: 3800 };
  W.towns = [
    { name: 'Ashby', x: -7500, z: -5200, r: 700 },
    { name: 'Brookvale', x: 6200, z: -9800, r: 650 },
    { name: 'Cedar Hill', x: -11800, z: 7400, r: 800 },
    { name: 'Dunmore', x: 3800, z: 14800, r: 600 },
    { name: 'Eastwick', x: 15500, z: 18500, r: 900 },
    { name: 'Fairhaven', x: -20500, z: -3500, r: 750 },
    { name: 'Glenrock', x: -9500, z: -17500, r: 550 },
    { name: 'Harlow', x: 9000, z: -20000, r: 700 },
    { name: 'Ivydale', x: -24000, z: 15000, r: 650 },
    { name: 'Juniper', x: 600, z: 26000, r: 700 },
    { name: 'Kingsbridge', x: 21000, z: -15500, r: 1000 },
    { name: 'Linden', x: -2500, z: -30500, r: 500 },
    { name: 'Millbrook', x: 12500, z: 32000, r: 500 }
  ];

  // ------------------------------------------------------------------------
  // Coastline: the sea lies to the EAST of this line.
  // ------------------------------------------------------------------------
  W.coastX = function (z) {
    return 24500 + 2600 * nD(z / 8000, 0.5) + 900 * nD(z / 2200, 3.7);
  };
  W.SEA_LEVEL = 0;

  // ------------------------------------------------------------------------
  // Natural terrain height (before airports / towns are flattened)
  // ------------------------------------------------------------------------
  function naturalHeight(x, z) {
    // gently rolling inland plains 40..260 m
    let land = 120 + 95 * U.fbm(nA, x / 16000, z / 16000, 3) + 32 * U.fbm(nB, x / 2600, z / 2600, 4);
    // western hills
    const west = U.smoothstep(-14000, -34000, x);
    if (west > 0) land += west * 420 * U.ridged(nC, x / 7000 + 11, z / 7000, 4);
    // northern mountain range (up to ~2.4 km)
    const northMask = U.smoothstep(-17000, -34000, z);
    if (northMask > 0) {
      const var1 = 0.55 + 0.45 * nG(x / 15000, 7.3);
      land += northMask * var1 * 2300 * U.ridged(nC, x / 9000, z / 9000, 5);
    }
    // coastal plain and sea floor
    const d = W.coastX(z) - x; // >0 inland
    if (d >= 0) {
      const k = U.smoothstep(0, 9000, d);
      return 2 + (land - 2) * k;
    }
    return Math.max(-90, 2 - 0.03 * (-d));
  }
  W.naturalHeight = naturalHeight;

  // ---------------- airports: local frame helpers ---------------------------
  W.airports.forEach((ap) => {
    const f = U.headingVec(ap.hdg);
    ap.fx = f.x; ap.fz = f.z;          // unit vector along primary heading
    ap.rx = -f.z; ap.rz = f.x;         // unit vector to the right of it
    ap.elev = Math.max(4, naturalHeight(ap.x, ap.z));
    ap.ident1 = U.pad(Math.round(ap.hdg / 10) || 36, 2);
    ap.ident2 = U.pad(Math.round(U.wrap360(ap.hdg + 180) / 10) || 36, 2);
    ap.recip = U.wrap360(ap.hdg + 180);
    const tv = ap.taxiSide * (ap.military ? 170 : 160);
    ap.taxiV = tv;
    // paved rectangles in local (u along runway, v to the right) coordinates
    const L = ap.len / 2, Wd = ap.wid / 2;
    const s = ap.taxiSide;
    ap.paved = [
      { u0: -L, u1: L, v0: -Wd, v1: Wd, kind: 'runway' },
      { u0: -L + 40, u1: L - 40, v0: tv - 11.5, v1: tv + 11.5, kind: 'taxi' },
    ];
    [-L + 55, 0, L - 55].forEach((u) => {
      ap.paved.push({ u0: u - 12, u1: u + 12, v0: Math.min(s * Wd, tv), v1: Math.max(s * Wd, tv), kind: 'taxi' });
    });
    const apronLen = ap.len > 2000 ? 360 : 160;
    const a0 = tv + s * 11.5, a1 = tv + s * (ap.military ? 200 : 170);
    ap.paved.push({ u0: -apronLen, u1: apronLen, v0: Math.min(a0, a1), v1: Math.max(a0, a1), kind: 'apron' });
    ap.apron = { u0: -apronLen, u1: apronLen, v0: Math.min(a0, a1), v1: Math.max(a0, a1) };
    // runway thresholds (landing on primary direction lands at threshold1)
    ap.thr1 = { x: ap.x - ap.fx * L, z: ap.z - ap.fz * L, hdg: ap.hdg, ident: ap.ident1 };
    ap.thr2 = { x: ap.x + ap.fx * L, z: ap.z + ap.fz * L, hdg: ap.recip, ident: ap.ident2 };
  });

  W.toLocal = function (ap, x, z) {
    const dx = x - ap.x, dz = z - ap.z;
    return { u: dx * ap.fx + dz * ap.fz, v: dx * ap.rx + dz * ap.rz };
  };
  W.fromLocal = function (ap, u, v) {
    return { x: ap.x + ap.fx * u + ap.rx * v, z: ap.z + ap.fz * u + ap.rz * v };
  };

  // signed distance from local point to rectangle
  function rectDist(u, v, u0, u1, v0, v1) {
    const du = Math.max(u0 - u, 0, u - u1);
    const dv = Math.max(v0 - v, 0, v - v1);
    return Math.sqrt(du * du + dv * dv);
  }

  // Flattening zones: returns blended height
  function flatten(x, z, h) {
    for (let i = 0; i < W.airports.length; i++) {
      const ap = W.airports[i];
      const dx = x - ap.x, dz = z - ap.z;
      if (Math.abs(dx) > ap.len + 2500 || Math.abs(dz) > ap.len + 2500) continue;
      const p = W.toLocal(ap, x, z);
      const vmin = Math.min(-120, ap.taxiV - 350), vmax = Math.max(120, ap.taxiV + 350);
      const d = rectDist(p.u, p.v, -ap.len / 2 - 350, ap.len / 2 + 350, vmin, vmax);
      const w = 1 - U.smoothstep(0, 1400, d);
      if (w > 0) h = U.lerp(h, ap.elev, w);
    }
    // city: flatten and keep it just above sea level
    {
      const c = W.city, dx = x - c.x, dz = z - c.z;
      const dist = Math.sqrt(dx * dx + dz * dz);
      if (dist < c.r * 1.8) {
        const w = 1 - U.smoothstep(c.r * 0.7, c.r * 1.8, dist);
        const target = Math.max(6, Math.min(h, 14 + 25 * U.smoothstep(0, c.r, dist)));
        if (h > 1) h = U.lerp(h, target, w * 0.9);
      }
    }
    for (let i = 0; i < W.towns.length; i++) {
      const t = W.towns[i];
      const dx = x - t.x, dz = z - t.z;
      if (Math.abs(dx) > t.r * 2.5 || Math.abs(dz) > t.r * 2.5) continue;
      if (t.elev === undefined) t.elev = naturalHeight(t.x, t.z);
      const dist = Math.sqrt(dx * dx + dz * dz);
      const w = (1 - U.smoothstep(t.r * 0.6, t.r * 2.5, dist)) * 0.75;
      if (w > 0) h = U.lerp(h, t.elev, w);
    }
    return h;
  }

  /** Terrain height in metres above mean sea level at world (x, z). */
  W.height = function (x, z) {
    return flatten(x, z, naturalHeight(x, z));
  };

  W.normal = function (x, z, e) {
    e = e || 4;
    const hL = W.height(x - e, z), hR = W.height(x + e, z);
    const hD = W.height(x, z - e), hU = W.height(x, z + e);
    const nx = hL - hR, ny = 2 * e, nz = hD - hU;
    const l = Math.hypot(nx, ny, nz);
    return { x: nx / l, y: ny / l, z: nz / l };
  };

  // ---------------- urban / forest density masks ----------------------------
  W.urban = function (x, z) {
    let u = 0;
    const c = W.city, dx = x - c.x, dz = z - c.z;
    const dc = Math.sqrt(dx * dx + dz * dz);
    if (dc < c.r) u = 1 - U.smoothstep(c.r * 0.55, c.r, dc);
    for (let i = 0; i < W.towns.length; i++) {
      const t = W.towns[i];
      const ddx = x - t.x, ddz = z - t.z;
      if (Math.abs(ddx) > t.r || Math.abs(ddz) > t.r) continue;
      const d = Math.sqrt(ddx * ddx + ddz * ddz);
      u = Math.max(u, 1 - U.smoothstep(t.r * 0.45, t.r, d));
    }
    return u;
  };

  W.nearAirport = function (x, z, margin) {
    for (let i = 0; i < W.airports.length; i++) {
      const ap = W.airports[i];
      const p = W.toLocal(ap, x, z);
      const vmin = Math.min(-90, ap.taxiV - 300), vmax = Math.max(90, ap.taxiV + 300);
      if (rectDist(p.u, p.v, -ap.len / 2 - 300, ap.len / 2 + 300, vmin, vmax) < margin) return ap;
    }
    return null;
  };

  /** 0..1 forest density. Used by BOTH the terrain colouring and tree placement. */
  W.forest = function (x, z, h) {
    if (h === undefined) h = W.height(x, z);
    if (h < 4) return 0;
    let f = U.fbm(nF, x / 4200, z / 4200, 4) + 0.12;
    f += 0.25 * U.smoothstep(300, 900, h);           // hills are more wooded
    let d = U.smoothstep(0.08, 0.32, f);
    d *= 1 - U.smoothstep(1700, 2100, h);              // tree line
    if (d <= 0) return 0;
    d *= 1 - W.urban(x, z);
    if (d > 0 && W.nearAirport(x, z, 150)) d = 0;
    return d;
  };

  // ---------------- ground surface for the landing gear -------------------
  /** Returns 'runway' | 'taxi' | 'apron' | 'grass' | 'water' */
  W.surface = function (x, z) {
    for (let i = 0; i < W.airports.length; i++) {
      const ap = W.airports[i];
      const p = W.toLocal(ap, x, z);
      if (Math.abs(p.u) > ap.len) continue;
      for (let k = 0; k < ap.paved.length; k++) {
        const r = ap.paved[k];
        if (p.u >= r.u0 && p.u <= r.u1 && p.v >= r.v0 && p.v <= r.v1) return r.kind;
      }
    }
    if (W.height(x, z) < 0.3) return 'water';
    return 'grass';
  };

  // ---------------- road network --------------------------------------------
  W.roads = [];
  (function buildRoads() {
    const nodes = [];
    W.airports.forEach((ap) => {
      // road starts at the landward edge of the apron
      const p = W.fromLocal(ap, 0, ap.taxiV + ap.taxiSide * 330);
      nodes.push({ x: p.x, z: p.z, major: true, name: ap.id });
    });
    nodes.push({ x: W.city.x, z: W.city.z, major: true, name: 'city' });
    W.towns.forEach((t) => nodes.push({ x: t.x, z: t.z, major: false, name: t.name }));
    // highways between major nodes
    const majors = nodes.filter((n) => n.major);
    const link = (a, b, w) => W.roads.push({ ax: a.x, az: a.z, bx: b.x, bz: b.z, w: w });
    link(majors[0], majors[3], 14); // airbase - city
    link(majors[0], majors[1], 14); // airbase - Meridian
    link(majors[1], majors[3], 14); // Meridian - city
    link(majors[0], majors[2], 10); // airbase - Highland
    // each town connects to the nearest already-connected node (spanning tree)
    const connected = majors.slice();
    const pending = nodes.filter((n) => !n.major);
    while (pending.length) {
      let best = null, bi = -1, bd = 1e12;
      pending.forEach((p, i) => connected.forEach((c) => {
        const d = Math.hypot(p.x - c.x, p.z - c.z);
        if (d < bd) { bd = d; best = [p, c]; bi = i; }
      }));
      link(best[0], best[1], 9);
      connected.push(best[0]);
      pending.splice(bi, 1);
    }
    // cut roads at the coastline (no roads in the sea)
    W.roads = W.roads.filter((r) => W.naturalHeight((r.ax + r.bx) / 2, (r.az + r.bz) / 2) > -5);
  })();

  W.nearRoad = function (x, z, margin) {
    for (let i = 0; i < W.roads.length; i++) {
      const r = W.roads[i];
      if (U.segDist(x, z, r.ax, r.az, r.bx, r.bz) < r.w / 2 + margin) return true;
    }
    return false;
  };

  // ---------------- navigation aids -----------------------------------------
  // Each airport with ils:true gets an ILS on its primary runway direction:
  // localizer aligned with the runway, 3.0° glide slope, antenna 300 m past
  // the threshold (where the aiming-point markings are).
  W.navaids = [];
  W.airports.forEach((ap) => {
    W.navaids.push({ type: 'AIRPORT', id: ap.id, name: ap.name, x: ap.x, z: ap.z, elev: ap.elev, ap: ap });
    if (ap.ils) {
      const gs = { x: ap.thr1.x + ap.fx * 300, z: ap.thr1.z + ap.fz * 300 };
      W.navaids.push({
        type: 'ILS', id: 'I-' + ap.id.slice(1) + ap.ident1, name: ap.short + ' ILS RWY ' + ap.ident1,
        x: ap.thr1.x, z: ap.thr1.z, elev: ap.elev, course: ap.hdg, gsAngle: 3.0,
        gsX: gs.x, gsZ: gs.z, locX: ap.thr2.x + ap.fx * 300, locZ: ap.thr2.z + ap.fz * 300, ap: ap
      });
    }
  });
  W.navaids.push({ type: 'CITY', id: 'PMER', name: 'Port Meridian (city)', x: W.city.x, z: W.city.z, elev: 10 });
  W.navaids.push({ type: 'FIX', id: 'NPASS', name: 'North Pass (mountains)', x: -6000, z: -38000, elev: 0 });
  W.navaids.push({ type: 'FIX', id: 'CAPE', name: 'Cape Light (coast)', x: 26000, z: 22000, elev: 0 });

  // Pattern / start positions helpers
  W.mainBase = W.airports[0];
})(typeof window !== 'undefined' ? window : globalThis);
