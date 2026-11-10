/* ==========================================================================
 * scenery.js — trees, houses, the city, roads and airfields (real sizes)
 *
 * Sizes are real: a runway is 45 m wide and 3,000 m long, a house is
 * ~10 m across, a tree 8–22 m tall, an office tower up to 180 m. This lets
 * you learn real visual cues: how big a runway looks on a 3° approach, how
 * high 500 ft over a town looks, etc.
 * ========================================================================== */
(function (root) {
  'use strict';
  const SIM = root.SIM = root.SIM || {};
  const U = SIM.util, W = SIM.world;
  const S = SIM.scenery = {};

  // ---------------- helpers --------------------------------------------------
  /** Pull a surface slightly toward the camera in view space so flat decals
   *  (runways, roads, markings) never flicker against the terrain. */
  function depthBias(mat, bias) {
    mat.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader.replace('#include <project_vertex>',
        `#include <project_vertex>
         mvPosition.xyz *= ${(1 - bias).toFixed(6)};
         gl_Position = projectionMatrix * mvPosition;`);
    };
    mat.customProgramCacheKey = () => 'bias' + bias;
    return mat;
  }
  S.depthBias = depthBias;

  /** Lambert material with procedural windows (works on instanced boxes). */
  function windowMaterial() {
    const m = new THREE.MeshLambertMaterial({ color: 0xffffff });
    m.onBeforeCompile = (sh) => {
      sh.uniforms.uNight = S.nightUniform;
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vWP; varying vec3 vWN; varying float vH;')
        .replace('#include <project_vertex>', `#include <project_vertex>
          vec4 wp4 = vec4(transformed, 1.0);
          vec3 wn = objectNormal;
          #ifdef USE_INSTANCING
            wp4 = instanceMatrix * wp4;
            wn = mat3(instanceMatrix) * wn;
            vH = instanceMatrix[1][1];
          #else
            vH = 10.0;
          #endif
          wp4 = modelMatrix * wp4;
          vWP = wp4.xyz; vWN = normalize(mat3(modelMatrix) * wn);`);
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vWP; varying vec3 vWN; varying float vH; uniform float uNight;')
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
          float isWall = 1.0 - step(0.5, abs(vWN.y));
          float along = abs(vWN.x) > abs(vWN.z) ? vWP.z : vWP.x;
          float floorH = 3.3;
          float fy = fract(vWP.y / floorH);
          float fx = fract(along / 2.8);
          float win = step(0.30, fy) * step(fy, 0.80) * step(0.18, fx) * step(fx, 0.82) * isWall;
          float flo = floor(vWP.y / floorH) + floor(along / 2.8) * 7.0;
          float rnd = fract(sin(flo * 12.9898 + floor(vWP.x*0.05) * 78.233) * 43758.5453);
          vec3 glass = vec3(0.16, 0.22, 0.30) + vec3(0.25) * step(0.7, rnd) * (1.0 - uNight);
          diffuseColor.rgb = mix(diffuseColor.rgb, glass, win * 0.85);
          totalEmissiveRadiance += win * uNight * step(0.45, rnd) * vec3(1.0, 0.82, 0.55) * 0.9;`);
    };
    return m;
  }

  // ---------------- trees (streamed in 500 m cells) -----------------------
  const CELL = 500, TREE_R = 3600;
  function treeGeometries() {
    // conifer: trunk + 2 stacked cones; deciduous: trunk + low-poly blob
    const merge = (parts) => {
      let pos = [], col = [], nor = [];
      parts.forEach(([g, c]) => {
        if (g.index) g = g.toNonIndexed();
        const p = g.attributes.position.array, n = g.attributes.normal.array;
        for (let i = 0; i < p.length; i += 3) { pos.push(p[i], p[i + 1], p[i + 2]); nor.push(n[i], n[i + 1], n[i + 2]); col.push(c.r, c.g, c.b); }
      });
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
      g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
      return g;
    };
    const trunkC = new THREE.Color(0.32, 0.24, 0.16);
    const t1 = new THREE.CylinderGeometry(0.03, 0.05, 0.3, 5).translate(0, 0.15, 0);
    const c1 = new THREE.ConeGeometry(0.33, 0.55, 7).translate(0, 0.45, 0);
    const c2 = new THREE.ConeGeometry(0.24, 0.42, 7).translate(0, 0.78, 0);
    const conifer = merge([[t1, trunkC], [c1, new THREE.Color(0.16, 0.27, 0.13)], [c2, new THREE.Color(0.18, 0.30, 0.14)]]);
    const t2 = new THREE.CylinderGeometry(0.035, 0.06, 0.45, 5).translate(0, 0.22, 0);
    const b1 = new THREE.IcosahedronGeometry(0.36, 0).scale(1, 0.85, 1).translate(0, 0.62, 0);
    const b2 = new THREE.IcosahedronGeometry(0.22, 0).translate(0.12, 0.82, 0.05);
    const decid = merge([[t2, trunkC], [b1, new THREE.Color(0.25, 0.36, 0.14)], [b2, new THREE.Color(0.30, 0.40, 0.16)]]);
    return [conifer, decid];
  }

  function buildTreeCell(ci, cj) {
    const rnd = U.rng((ci * 73856093) ^ (cj * 19349663) ^ 12345);
    const x0 = ci * CELL, z0 = cj * CELL;
    const sp = 13;
    const lists = [[], []];
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), p = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    for (let j = 0; j < CELL / sp; j++) for (let i = 0; i < CELL / sp; i++) {
      const x = x0 + (i + rnd()) * sp, z = z0 + (j + rnd()) * sp;
      const r = rnd();
      const h = W.height(x, z);
      if (h < 3) continue;
      const f = W.forest(x, z, h);
      let keep = r < f * 0.85;
      if (!keep && r < 0.012 && f === 0 && W.urban(x, z) < 0.6 && !W.nearAirport(x, z, 120)) keep = true; // lone trees / hedgerows
      if (!keep) continue;
      if (W.nearRoad(x, z, 6)) continue;
      const type = h > 700 || rnd() < 0.35 ? 0 : 1;
      const s = (type === 0 ? 14 : 12) * (0.6 + rnd() * 0.75);
      p.set(x, h - 0.6, z);
      q.setFromAxisAngle(up, rnd() * 6.28);
      sc.set(s * (0.8 + rnd() * 0.4), s, s * (0.8 + rnd() * 0.4));
      m.compose(p, q, sc);
      lists[type].push(m.clone(), 0.75 + rnd() * 0.45);
    }
    const group = [];
    lists.forEach((L, type) => {
      const n = L.length / 2;
      if (!n) return;
      const im = new THREE.InstancedMesh(S.treeGeo[type], S.treeMat, n);
      const col = new THREE.Color();
      for (let k = 0; k < n; k++) {
        im.setMatrixAt(k, L[k * 2]);
        const b = L[k * 2 + 1];
        im.setColorAt(k, col.setRGB(b, b * (0.95 + 0.1 * Math.sin(k)), b * 0.9));
      }
      im.instanceMatrix.needsUpdate = true;
      im.frustumCulled = false; // culled per cell in S.update (r149 has no instanced bounds)
      group.push(im);
    });
    return group;
  }

  // ---------------- buildings (towns & city, built once) ------------------
  function buildBuildings(scene) {
    const boxes = [];  // {x,z,y,w,d,h,rot,color}
    const roofs = [];
    const rnd = U.rng(555);
    S.tallGrid = new Map();
    const wallColors = [[0.86, 0.82, 0.74], [0.78, 0.74, 0.66], [0.92, 0.9, 0.86], [0.72, 0.62, 0.52], [0.84, 0.78, 0.62]];
    const roofColors = [[0.55, 0.25, 0.18], [0.45, 0.22, 0.17], [0.35, 0.33, 0.33], [0.6, 0.32, 0.2]];
    const addHouse = (x, z, rot) => {
      const h0 = W.height(x, z);
      if (h0 < 1.5) return;
      const w = 8 + rnd() * 6, d = 7 + rnd() * 5, hh = 3 + Math.floor(rnd() * 2) * 2.8;
      const wc = wallColors[Math.floor(rnd() * wallColors.length)];
      boxes.push({ x, z, y: h0 - 1, w, d, h: hh + 1, rot, c: wc });
      const rc = roofColors[Math.floor(rnd() * roofColors.length)];
      roofs.push({ x, z, y: h0 + hh, w: w + 0.8, d: d + 0.8, h: 2.5 + rnd() * 1.5, rot, c: rc });
    };
    const addBlock = (x, z, w, d, h, rot) => {
      const h0 = W.height(x, z);
      if (h0 < 1.5) return;
      const g = 0.55 + rnd() * 0.35;
      const tint = rnd();
      const c = tint < 0.3 ? [g, g, g * 1.04] : tint < 0.6 ? [g * 1.05, g, g * 0.9] : [g * 0.85, g * 0.92, g];
      boxes.push({ x, z, y: h0 - 2, w, d, h: h + 2, rot, c });
      if (h > 35) {
        const k = Math.floor(x / 200) + ',' + Math.floor(z / 200);
        if (!S.tallGrid.has(k)) S.tallGrid.set(k, []);
        S.tallGrid.get(k).push({ x, z, r: Math.max(w, d) * 0.6, top: h0 + h });
      }
    };
    S.streets = [];
    // towns: streets in a grid around the centre
    W.towns.forEach((t) => {
      const rot = rnd() * Math.PI;
      const ca = Math.cos(rot), sa = Math.sin(rot);
      const sp = 70;
      const n = Math.ceil(t.r / sp);
      for (let a = -n; a <= n; a++) {
        // streets (two directions)
        const L = Math.sqrt(Math.max(0, t.r * t.r - (a * sp) * (a * sp))) * 0.9;
        if (L > 60) {
          S.streets.push({ ax: t.x + ca * a * sp - sa * -L, az: t.z + sa * a * sp + ca * -L, bx: t.x + ca * a * sp - sa * L, bz: t.z + sa * a * sp + ca * L, w: 7 });
          S.streets.push({ ax: t.x + ca * -L - sa * a * sp, az: t.z + sa * -L + ca * a * sp, bx: t.x + ca * L - sa * a * sp, bz: t.z + sa * L + ca * a * sp, w: 7 });
        }
        for (let b = -n; b <= n; b++) {
          // houses along both sides of each street segment in this block
          for (let k = 0; k < 6; k++) {
            const lu = a * sp + 14 + (k % 3) * 18 + (rnd() - 0.5) * 3;
            const lv = b * sp + (k < 3 ? 14 : sp - 14);
            const x = t.x + ca * lu - sa * lv, z = t.z + sa * lu + ca * lv;
            const d = Math.hypot(x - t.x, z - t.z);
            if (d > t.r || rnd() > 1.15 - d / t.r * 0.6) continue;
            if (W.nearRoad(x, z, 8)) continue;
            addHouse(x, z, rot);
          }
        }
      }
    });
    // the city: towers in the centre, mid-rise, then suburbs
    const c = W.city;
    const crot = 12 * U.DEG, ca = Math.cos(crot), sa = Math.sin(crot);
    const bs = 110;
    const n = Math.ceil(c.r / bs);
    for (let a = -n; a <= n; a++) {
      const L = c.r;
      S.streets.push({ ax: c.x + ca * a * bs - sa * -L, az: c.z + sa * a * bs + ca * -L, bx: c.x + ca * a * bs - sa * L, bz: c.z + sa * a * bs + ca * L, w: 12, city: true });
      S.streets.push({ ax: c.x + ca * -L - sa * a * bs, az: c.z + sa * -L + ca * a * bs, bx: c.x + ca * L - sa * a * bs, bz: c.z + sa * L + ca * a * bs, w: 12, city: true });
      for (let b = -n; b <= n; b++) {
        const bu = (a + 0.5) * bs, bv = (b + 0.5) * bs;
        const x = c.x + ca * bu - sa * bv, z = c.z + sa * bu + ca * bv;
        const d = Math.hypot(x - c.x, z - c.z);
        if (d > c.r || W.height(x, z) < 2) continue;
        if (W.nearRoad(x, z, 30)) continue;
        const core = 1 - U.smoothstep(0, 1300, d);
        const mid = 1 - U.smoothstep(900, 2600, d);
        if (rnd() < 0.06) continue; // parks
        if (mid > 0.2) {
          // 1-4 large buildings per block
          const cnt = 1 + Math.floor(rnd() * 4);
          for (let k = 0; k < cnt; k++) {
            const ou = (rnd() - 0.5) * 50, ov = (rnd() - 0.5) * 50;
            const w = 18 + rnd() * 26, dd = 18 + rnd() * 26;
            let h = 12 + rnd() * 30 * mid + Math.pow(rnd(), 2.2) * 170 * core;
            const bx = x + ca * ou - sa * ov, bz = z + sa * ou + ca * ov;
            addBlock(bx, bz, cnt > 2 ? w * 0.6 : w, cnt > 2 ? dd * 0.6 : dd, h, crot);
          }
        } else {
          for (let k = 0; k < 8; k++) {
            const ou = -38 + (k % 4) * 25, ov = k < 4 ? -30 : 30;
            const hx = x + ca * ou - sa * ov, hz = z + sa * ou + ca * ov;
            if (rnd() < 0.85) addHouse(hx, hz, crot);
          }
        }
      }
    }
    // instanced meshes
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), sc = new THREE.Vector3(), col = new THREE.Color();
    const up = new THREE.Vector3(0, 1, 0);
    const boxGeo = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
    const boxMesh = new THREE.InstancedMesh(boxGeo, windowMaterial(), boxes.length);
    boxes.forEach((b, i) => {
      p.set(b.x, b.y, b.z); q.setFromAxisAngle(up, -b.rot); sc.set(b.w, b.h, b.d);
      m.compose(p, q, sc); boxMesh.setMatrixAt(i, m); boxMesh.setColorAt(i, col.setRGB(b.c[0], b.c[1], b.c[2]));
    });
    boxMesh.frustumCulled = false;
    scene.add(boxMesh);
    // gable roof prism
    const rg = new THREE.BufferGeometry();
    const v = [-0.5, 0, -0.5, 0.5, 0, -0.5, 0, 1, -0.5, -0.5, 0, 0.5, 0.5, 0, 0.5, 0, 1, 0.5];
    rg.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
    rg.setIndex([0, 2, 1, 3, 4, 5, 0, 3, 5, 0, 5, 2, 1, 2, 5, 1, 5, 4, 0, 1, 4, 0, 4, 3]);
    const rgn = rg.toNonIndexed(); rgn.computeVertexNormals();
    const roofMesh = new THREE.InstancedMesh(rgn, new THREE.MeshLambertMaterial({ color: 0xffffff }), roofs.length);
    roofs.forEach((b, i) => {
      p.set(b.x, b.y, b.z); q.setFromAxisAngle(up, -b.rot); sc.set(b.w, b.h, b.d);
      m.compose(p, q, sc); roofMesh.setMatrixAt(i, m); roofMesh.setColorAt(i, col.setRGB(b.c[0], b.c[1], b.c[2]));
    });
    roofMesh.frustumCulled = false;
    scene.add(roofMesh);
    S.buildingCount = boxes.length;
  }

  S.collide = function (x, y, z) {
    if (!S.tallGrid) return false;
    const L = S.tallGrid.get(Math.floor(x / 200) + ',' + Math.floor(z / 200));
    if (!L) return false;
    for (const b of L) if (y < b.top && Math.hypot(x - b.x, z - b.z) < b.r) return true;
    return false;
  };

  // ---------------- roads (ribbons draped on terrain) ------------------------
  function ribbon(list, step, lift) {
    const pos = [], idx = [], uv = [];
    list.forEach((r) => {
      const dx = r.bx - r.ax, dz = r.bz - r.az, L = Math.hypot(dx, dz);
      if (L < 1) return;
      const nx = -dz / L * r.w / 2, nz = dx / L * r.w / 2;
      const segs = Math.max(1, Math.ceil(L / step));
      const base = pos.length / 3;
      let valid = 0;
      for (let i = 0; i <= segs; i++) {
        const t = i / segs, x = r.ax + dx * t, z = r.az + dz * t;
        const h = Math.max(W.height(x, z), 0.5) + lift;
        pos.push(x + nx, h, z + nz, x - nx, h, z - nz);
        uv.push(0, t * L / 10, 1, t * L / 10);
        if (i > 0) { const a = base + (i - 1) * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
        valid++;
      }
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  }

  function roadTexture() {
    const c = document.createElement('canvas'); c.width = 64; c.height = 256;
    const g = c.getContext('2d');
    g.fillStyle = '#4a4a4c'; g.fillRect(0, 0, 64, 256);
    for (let i = 0; i < 1500; i++) { const v = 60 + Math.random() * 30; g.fillStyle = `rgb(${v},${v},${v})`; g.fillRect(Math.random() * 64, Math.random() * 256, 1, 1); }
    g.fillStyle = '#ddd'; g.fillRect(2, 0, 2, 256); g.fillRect(60, 0, 2, 256);
    g.fillStyle = '#e8d070'; g.fillRect(31, 0, 2, 128);
    const t = new THREE.CanvasTexture(c); t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8;
    return t;
  }

  // ---------------- airfields ---------------------------------------------
  function canvasTex(w, h, draw, repeat) {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    draw(c.getContext('2d'), w, h);
    const t = new THREE.CanvasTexture(c);
    t.anisotropy = 16;
    if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; }
    return t;
  }

  function asphalt(g, w, h, base) {
    g.fillStyle = base; g.fillRect(0, 0, w, h);
    for (let i = 0; i < w * h / 6; i++) {
      const v = 45 + Math.random() * 45;
      g.fillStyle = `rgba(${v},${v},${v},0.5)`;
      g.fillRect(Math.random() * w, Math.random() * h, 1, 1);
    }
  }

  function buildAirport(scene, ap) {
    const grp = new THREE.Group();
    grp.position.set(ap.x, ap.elev, ap.z);
    grp.rotation.y = -ap.hdg * U.DEG;  // local -Z = runway primary direction
    scene.add(grp);
    // In this local frame: forward along heading = -Z, right = +X.
    // world-local mapping used by W.toLocal: u (along) = -z_local, v (right) = x_local
    const L = ap.len, Wd = ap.wid;
    const asphaltTex = canvasTex(256, 256, (g, w, h) => asphalt(g, w, h, '#3a3a3c'), true);
    const concreteTex = canvasTex(256, 256, (g, w, h) => { asphalt(g, w, h, '#77746e'); g.strokeStyle = 'rgba(40,40,40,0.5)'; g.strokeRect(0, 0, w, h); }, true);
    const matRwy = depthBias(new THREE.MeshLambertMaterial({ map: asphaltTex }), 0.0012);
    const matTaxi = depthBias(new THREE.MeshLambertMaterial({ map: concreteTex, color: 0xbbbbbb }), 0.0010);
    const matPaint = depthBias(new THREE.MeshLambertMaterial({ color: 0xf2f2f2 }), 0.0020);
    const matYellow = depthBias(new THREE.MeshLambertMaterial({ color: 0xe6c020 }), 0.0018);
    const flat = (w, l, mat, x, z, y, rep) => {
      const g = new THREE.PlaneGeometry(w, l); g.rotateX(-Math.PI / 2);
      if (rep) { const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * w / rep, uv.getY(i) * l / rep); }
      const m = new THREE.Mesh(g, mat); m.position.set(x, y || 0.05, z); grp.add(m); return m;
    };
    // paved areas
    ap.paved.forEach((r) => {
      const w = r.v1 - r.v0, l = r.u1 - r.u0;
      flat(w, l, r.kind === 'runway' ? matRwy : matTaxi, (r.v0 + r.v1) / 2, -(r.u0 + r.u1) / 2, r.kind === 'runway' ? 0.08 : 0.06, r.kind === 'runway' ? 40 : 25);
    });
    // runway markings (ICAO-style): threshold "piano keys", designators,
    // centreline, touchdown-zone and aiming-point markings, edge lines
    const ends = [{ s: 1, ident: ap.ident1 }, { s: -1, ident: ap.ident2 }];
    ends.forEach(({ s, ident }) => {
      // s=1: threshold at u=-L/2 (landing toward +u)
      const uThr = -s * L / 2;
      const zAt = (du) => -(uThr + s * du); // local z for distance du past threshold
      const keys = Wd >= 45 ? 16 : 12;
      const kw = 1.8, gap = (Wd - 6) / keys;
      for (let k = 0; k < keys; k++) {
        const x = -Wd / 2 + 3 + gap * (k + 0.5);
        if (Math.abs(x) < 2.5) continue;
        flat(kw, 30, matPaint, x, zAt(6 + 15), 0.12);
      }
      // designator numbers
      const tex = canvasTex(256, 512, (g, w, h) => {
        g.clearRect(0, 0, w, h); g.fillStyle = '#f2f2f2';
        g.font = 'bold 380px Arial Narrow, Arial'; g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillText(ident, w / 2, h / 2 + 10);
      });
      const nm = new THREE.MeshLambertMaterial({ map: tex, transparent: true, alphaTest: 0.4 });
      const numMesh = flat(Wd > 40 ? 16 : 12, 30, depthBias(nm, 0.002), 0, zAt(70), 0.12);
      numMesh.rotation.y = s > 0 ? 0 : Math.PI;
      // aiming point (300 m) & touchdown zone markings
      [-1, 1].forEach((side) => {
        flat(8, 50, matPaint, side * (Wd / 2 - 9), zAt(300 + 25), 0.12);
        [150, 450, 600].forEach((du, j) => {
          const bars = j === 0 ? 3 : j === 1 ? 2 : 1;
          for (let b = 0; b < bars; b++) flat(1.8, 22, matPaint, side * (Wd / 2 - 6 - b * 3), zAt(du + 11), 0.12);
        });
      });
    });
    // centreline: 30 m stripes, 20 m gaps
    for (let u = -L / 2 + 120; u < L / 2 - 120; u += 50) flat(0.9, 30, matPaint, 0, -(u + 15), 0.12);
    // edge lines
    [-1, 1].forEach((side) => flat(0.9, L - 20, matPaint, side * (Wd / 2 - 1), 0, 0.11));
    // taxiway centrelines (yellow)
    flat(0.3, L - 100, matYellow, ap.taxiV, 0, 0.1);
    [-L / 2 + 55, 0, L / 2 - 55].forEach((u) => flat(0.3, Math.abs(ap.taxiV) - Wd / 2, matYellow, (ap.taxiV + ap.taxiSide * Wd / 2) / 2, -u, 0.1).rotation.y = Math.PI / 2);
    // hold-short bars at connectors
    // runway edge lights + threshold/end lights
    const lightGeo = new THREE.SphereGeometry(0.35, 6, 4);
    const mk = (color) => new THREE.MeshBasicMaterial({ color });
    const whiteL = new THREE.InstancedMesh(lightGeo, mk(0xfff6d8), Math.ceil(L / 60) * 2 + 2);
    let wi = 0; const m4 = new THREE.Matrix4();
    for (let u = -L / 2; u <= L / 2; u += 60) [-1, 1].forEach((side) => { m4.makeTranslation(side * (Wd / 2 + 1.5), 0.4, -u); whiteL.setMatrixAt(wi++, m4); });
    whiteL.count = wi; grp.add(whiteL);
    const thrL = new THREE.InstancedMesh(lightGeo, mk(0x30ff60), 24), endL = new THREE.InstancedMesh(lightGeo, mk(0xff3020), 24);
    let gi = 0, ri = 0;
    for (let k = 0; k < 12; k++) {
      const x = -Wd / 2 + k * Wd / 11;
      m4.makeTranslation(x, 0.4, L / 2 + 2); thrL.setMatrixAt(gi++, m4);   // threshold of primary runway (u=-L/2 → z=+L/2)
      m4.makeTranslation(x, 0.4, -L / 2 - 2); endL.setMatrixAt(ri++, m4);
    }
    grp.add(thrL); grp.add(endL);
    S.lightMats.push(whiteL.material, thrL.material, endL.material);
    // approach lights (900 m line with cross bar) for ILS runways
    if (ap.ils) {
      const apl = new THREE.InstancedMesh(lightGeo, mk(0xfff3c0), 200);
      let k = 0;
      for (let d = 60; d <= 900; d += 30) {
        for (let x = -2; x <= 2; x += 1) { m4.makeTranslation(x * 1.2, 0.8, L / 2 + d); apl.setMatrixAt(k++, m4); }
      }
      for (let x = -15; x <= 15; x += 2) { m4.makeTranslation(x, 0.8, L / 2 + 300); apl.setMatrixAt(k++, m4); }
      apl.count = k; grp.add(apl); S.lightMats.push(apl.material);
    }
    // PAPI: 4 boxes left of the runway, 300 m past the threshold
    const papi = [];
    for (let k = 0; k < 4; k++) {
      const box = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.8, 0.6), new THREE.MeshBasicMaterial({ color: 0xffffff }));
      box.position.set(-Wd / 2 - 15 - k * 9, 0.6, L / 2 - 300);
      grp.add(box); papi.push(box);
    }
    S.papis.push({ ap, boxes: papi, angles: [3.5, 3.17, 2.83, 2.5] });

    // buildings: tower, hangars, shelters, fuel tanks
    const bmat = new THREE.MeshLambertMaterial({ color: 0x9a9c94 });
    const dark = new THREE.MeshLambertMaterial({ color: 0x55585a });
    const s = ap.taxiSide;
    const vBack = ap.apron.v0 + ap.apron.v1 > 0 ? ap.apron.v1 : ap.apron.v0; // far side of apron
    const box = (w, h, d, x, z, mat) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, h / 2, z); grp.add(m); return m; };
    // control tower
    const tx = vBack + s * 40, tz = -(-ap.apron.u1 * 0.2);
    box(8, 24, 8, tx, tz - 380 * 0, bmat);
    const cab = box(12, 5, 12, tx, tz, new THREE.MeshLambertMaterial({ color: 0x223344 })); cab.position.y = 26.5;
    box(13, 1, 13, tx, tz, dark).position.y = 29.5;
    // hangars
    const nh = ap.military ? 4 : 3;
    for (let k = 0; k < nh; k++) {
      const u = -ap.apron.u1 + 60 + k * ((ap.apron.u1 * 2 - 120) / Math.max(1, nh - 1));
      const hg = new THREE.Mesh(new THREE.CylinderGeometry(24, 24, 50, 16, 1, false, 0, Math.PI), new THREE.MeshLambertMaterial({ color: ap.military ? 0x6e7466 : 0xb8bcc0 }));
      hg.rotation.z = Math.PI / 2; hg.rotation.y = Math.PI / 2;
      hg.position.set(vBack + s * 60, 0, -u);
      hg.scale.set(1, 1, 0.55);
      grp.add(hg);
    }
    if (ap.military) {
      // hardened aircraft shelters near the runway ends
      [-1, 1].forEach((e) => {
        for (let k = 0; k < 3; k++) {
          const sh = new THREE.Mesh(new THREE.CylinderGeometry(13, 13, 32, 14, 1, false, 0, Math.PI), new THREE.MeshLambertMaterial({ color: 0x8a8670 }));
          sh.rotation.z = Math.PI / 2; sh.rotation.y = 0;
          sh.position.set(ap.taxiV + s * (70 + k * 0), 0, -(e * (L / 2 - 250 - k * 80)));
          sh.rotation.set(0, 0, 0);
          sh.rotation.x = -Math.PI / 2; sh.rotation.z = Math.PI / 2;
          sh.scale.set(1, 1, 0.7);
          sh.position.y = 0;
          grp.add(sh);
        }
      });
      // fuel tanks
      for (let k = 0; k < 3; k++) {
        const tk = new THREE.Mesh(new THREE.CylinderGeometry(9, 9, 10, 16), new THREE.MeshLambertMaterial({ color: 0xc8c8b8 }));
        tk.position.set(vBack + s * 130, 5, -(ap.apron.u1 + 120 + k * 25)); grp.add(tk);
      }
    }
    // parked aircraft on the apron (simple silhouettes of the same trainer)
    if (SIM.model && SIM.model.parkedAircraft) {
      const n = ap.military ? 6 : 3;
      for (let k = 0; k < n; k++) {
        const pa = SIM.model.parkedAircraft(ap.military);
        const u = -ap.apron.u1 + 40 + k * 32;
        pa.position.set((ap.apron.v0 + ap.apron.v1) / 2 + s * 30, 1.55, -u);
        pa.rotation.y = s > 0 ? -Math.PI / 2 : Math.PI / 2;
        grp.add(pa);
      }
    }
    // windsock
    const pole = box(0.2, 6, 0.2, -Wd / 2 - 60, L / 2 - 150, dark);
    const sock = new THREE.Mesh(new THREE.ConeGeometry(0.6, 4, 8, 1, true), new THREE.MeshLambertMaterial({ color: 0xff6a00, side: THREE.DoubleSide }));
    sock.position.set(-Wd / 2 - 60, 5.6, L / 2 - 150);
    grp.add(sock);
    grp.traverse((o) => { if (o.isInstancedMesh) o.frustumCulled = false; });
    S.windsocks.push({ mesh: sock, grp, base: new THREE.Vector3(-Wd / 2 - 60, 5.6, L / 2 - 150) });
  }

  // ---------------- init / update -------------------------------------------
  S.init = function (scene) {
    S.scene = scene;
    S.nightUniform = { value: 0 };
    S.lightMats = []; S.papis = []; S.windsocks = [];
    S.treeGeo = treeGeometries();
    S.treeMat = new THREE.MeshLambertMaterial({ vertexColors: true });
    S.treeCells = new Map();
    S.treeGroup = new THREE.Group(); scene.add(S.treeGroup);
    // roads
    const roadMat = depthBias(new THREE.MeshLambertMaterial({ map: roadTexture() }), 0.0015);
    scene.add(new THREE.Mesh(ribbon(W.roads, 40, 0.35), roadMat));
    buildBuildings(scene);
    const streetMat = depthBias(new THREE.MeshLambertMaterial({ color: 0x555558 }), 0.0013);
    scene.add(new THREE.Mesh(ribbon(S.streets, 40, 0.3), streetMat));
    W.airports.forEach((ap) => buildAirport(scene, ap));
  };

  S.update = function (camPos, budgetMs, force) {
    // stream tree cells around the camera
    const ci0 = Math.floor(camPos.x / CELL), cj0 = Math.floor(camPos.z / CELL);
    const hAGL = camPos.y - Math.max(0, W.height(camPos.x, camPos.z));
    const R = hAGL > 3000 ? 2 : Math.ceil(TREE_R / CELL);
    const need = [];
    const keep = new Set();
    for (let j = -R; j <= R; j++) for (let i = -R; i <= R; i++) {
      const cx = (ci0 + i + 0.5) * CELL, cz = (cj0 + j + 0.5) * CELL;
      const d = Math.hypot(cx - camPos.x, cz - camPos.z);
      if (d > TREE_R + CELL) continue;
      const k = (ci0 + i) + ',' + (cj0 + j);
      keep.add(k);
      if (!S.treeCells.has(k)) need.push({ k, i: ci0 + i, j: cj0 + j, d });
    }
    need.sort((a, b) => a.d - b.d);
    const t0 = performance.now();
    for (const n of need) {
      const meshes = buildTreeCell(n.i, n.j);
      meshes.forEach((m) => S.treeGroup.add(m));
      meshes.sphere = new THREE.Sphere(new THREE.Vector3((n.i + 0.5) * CELL, W.height((n.i + 0.5) * CELL, (n.j + 0.5) * CELL) + 20, (n.j + 0.5) * CELL), CELL * 0.75 + 60);
      S.treeCells.set(n.k, meshes);
      if (!force && performance.now() - t0 > budgetMs) break;
    }
    for (const [k, meshes] of S.treeCells) {
      if (!keep.has(k)) { meshes.forEach((m) => { S.treeGroup.remove(m); m.dispose(); }); S.treeCells.delete(k); }
    }
    S.pending = need.length;
    // frustum culling per cell
    if (S.camera) {
      S.camera.updateMatrixWorld();
      S._pm = S._pm || new THREE.Matrix4(); S._fr = S._fr || new THREE.Frustum();
      S._pm.multiplyMatrices(S.camera.projectionMatrix, S.camera.matrixWorldInverse);
      S._fr.setFromProjectionMatrix(S._pm);
      for (const [, meshes] of S.treeCells) { const v = S._fr.intersectsSphere(meshes.sphere); meshes.forEach((m) => (m.visible = v)); }
    }
    // night lighting
    const night = SIM.env.night;
    S.nightUniform.value = night;
    S.lightMats.forEach((m) => { m.visible = true; m.opacity = 1; });
    // PAPI: each unit shows white if you are above its angle, red if below
    S.papis.forEach((pp) => {
      const ap = pp.ap;
      pp.boxes.forEach((b, k) => {
        const wp = b.getWorldPosition(new THREE.Vector3());
        const d = Math.hypot(camPos.x - wp.x, camPos.z - wp.z);
        const ang = Math.atan2(camPos.y - wp.y, d) * U.RAD;
        b.material.color.setHex(ang > pp.angles[k] ? 0xffffff : 0xff2010);
      });
    });
    // windsocks point downwind (they droop in light wind)
    const wdir = SIM.weather.windDir, ws = SIM.weather.windSpeedKt;
    const dv = U.headingVec(wdir + 180);
    const droop = 1 - U.clamp(ws / 15, 0.1, 1);
    S.windsocks.forEach((w) => {
      const dir = new THREE.Vector3(dv.x, -droop * 1.5, dv.z).normalize();
      dir.applyQuaternion(w.grp.quaternion.clone().invert());
      w.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
      w.mesh.position.copy(w.base).addScaledVector(dir, 2);
    });
  };
})(typeof window !== 'undefined' ? window : globalThis);
