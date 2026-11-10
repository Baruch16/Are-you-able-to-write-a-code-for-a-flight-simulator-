/* ==========================================================================
 * terrain.js — real-scale terrain with level-of-detail (quadtree)
 *
 * The ground is a 160 x 160 km area around the aircraft, built from tiles.
 * Tiles near the aircraft are dense (8 m between vertices); far ones are
 * coarse. As you fly, tiles split/merge automatically. Each vertex stores
 * forest and urban density so the shader can paint forests, farm fields,
 * towns, beaches, rock and snow — consistent with the 3D trees & houses.
 * ========================================================================== */
(function (root) {
  'use strict';
  const SIM = root.SIM = root.SIM || {};
  const U = SIM.util, W = SIM.world;

  const T = SIM.terrain = {};
  const N = 32;                 // segments per tile side
  const ROOT = 32768;           // root tile size (m)
  const MIN = 256;              // smallest tile (m)
  const SPLIT = 1.75;           // split when distance < size * SPLIT

  // ---------------- procedural detail textures ----------------------------
  function makeNoiseTexture(size) {
    // tileable value noise, 4 channels at different frequencies
    const data = new Uint8Array(size * size * 4);
    const rnd = U.rng(77);
    const grids = [8, 16, 32, 64].map((g) => { const a = new Float32Array(g * g); for (let i = 0; i < a.length; i++) a[i] = rnd(); return { g, a }; });
    const sample = (gr, x, y) => {
      const g = gr.g, fx = x * g, fy = y * g;
      const x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0;
      const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
      const v = (i, j) => gr.a[((j % g + g) % g) * g + ((i % g + g) % g)];
      return U.lerp(U.lerp(v(x0, y0), v(x0 + 1, y0), sx), U.lerp(v(x0, y0 + 1), v(x0 + 1, y0 + 1), sx), sy);
    };
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const u = x / size, v = y / size, i = (y * size + x) * 4;
      const a = sample(grids[0], u, v) * 0.5 + sample(grids[1], u, v) * 0.3 + sample(grids[2], u, v) * 0.2;
      const b = sample(grids[2], u, v) * 0.6 + sample(grids[3], u, v) * 0.4;
      data[i] = a * 255; data[i + 1] = b * 255; data[i + 2] = sample(grids[1], u + 0.37, v + 0.11) * 255; data[i + 3] = rnd() * 255;
    }
    const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.magFilter = THREE.LinearFilter; tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.generateMipmaps = true; tex.needsUpdate = true;
    return tex;
  }

  function makeFieldTexture(size) {
    // patchwork of farm fields: R = field id, G = row direction, B = hedge/border
    const c = document.createElement('canvas'); c.width = c.height = size;
    const g = c.getContext('2d');
    const rnd = U.rng(4242);
    g.fillStyle = 'rgb(0,0,255)'; g.fillRect(0, 0, size, size);
    const split = (x, y, w, h, depth) => {
      if (depth > 6 || (w < 40 && h < 40) || (depth > 3 && rnd() < 0.18)) {
        g.fillStyle = `rgb(${Math.floor(rnd() * 255)},${rnd() < 0.5 ? 0 : 255},0)`;
        g.fillRect(x + 1, y + 1, w - 2, h - 2); // 1px border = hedges / tracks
        return;
      }
      if (w > h) { const s = Math.floor(w * (0.3 + rnd() * 0.4)); split(x, y, s, h, depth + 1); split(x + s, y, w - s, h, depth + 1); }
      else { const s = Math.floor(h * (0.3 + rnd() * 0.4)); split(x, y, w, s, depth + 1); split(x, y + s, w, h - s, depth + 1); }
    };
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) split(i * size / 4, j * size / 4, size / 4, size / 4, 0);
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.magFilter = THREE.NearestFilter; tex.minFilter = THREE.NearestMipmapLinearFilter;
    return tex;
  }

  // ---------------- shader ---------------------------------------------------
  const vert = `
    #include <common>
    #include <logdepthbuf_pars_vertex>
    attribute vec2 aMask;
    varying vec3 vWorld; varying vec3 vNormal; varying vec2 vMask; varying float vDist;
    void main() {
      vec4 wp = modelMatrix * vec4(position, 1.0);
      vWorld = wp.xyz; vNormal = normal; vMask = aMask;
      vec4 mv = viewMatrix * wp;
      vDist = length(mv.xyz);
      gl_Position = projectionMatrix * mv;
      #include <logdepthbuf_vertex>
    }`;
  const frag = `
    #include <common>
    #include <logdepthbuf_pars_fragment>
    uniform sampler2D uNoise; uniform sampler2D uFields;
    uniform vec3 uSunDir; uniform vec3 uSunColor; uniform vec3 uSkyAmb; uniform vec3 uGroundAmb;
    uniform vec3 uFogColor; uniform float uFogDensity; uniform float uNight; uniform vec3 uCamPos;
    varying vec3 vWorld; varying vec3 vNormal; varying vec2 vMask; varying float vDist;
    vec3 fieldColor(float id, float n) {
      if (id < 0.18) return vec3(0.60, 0.53, 0.30);      // ripe wheat
      if (id < 0.36) return vec3(0.30, 0.42, 0.15);      // green crop
      if (id < 0.50) return vec3(0.38, 0.30, 0.21);      // ploughed soil
      if (id < 0.64) return vec3(0.48, 0.47, 0.27);      // dry grass / hay
      if (id < 0.80) return vec3(0.24, 0.35, 0.13);      // pasture
      if (id < 0.90) return vec3(0.45, 0.40, 0.25);      // stubble
      return vec3(0.34, 0.40, 0.20);
    }
    void main() {
      #include <logdepthbuf_fragment>
      vec3 n = normalize(vNormal);
      float h = vWorld.y;
      vec2 p = vWorld.xz;
      float slope = 1.0 - n.y;
      vec4 nz1 = texture2D(uNoise, p / 2400.0);
      vec4 nz2 = texture2D(uNoise, p / 310.0);
      vec4 nz3 = texture2D(uNoise, p / 37.0);
      float detail = mix(nz3.g, 0.5, smoothstep(600.0, 3000.0, vDist));
      float forest = vMask.x, urban = vMask.y;

      // base: meadow / scrub
      vec3 grass = mix(vec3(0.27, 0.36, 0.15), vec3(0.40, 0.43, 0.22), nz1.r);
      grass = mix(grass, vec3(0.45, 0.42, 0.26), smoothstep(0.55, 0.8, nz2.b) * 0.5);
      vec3 col = grass;
      // farmland patchwork in the lowlands
      vec4 fld = texture2D(uFields, p / 3800.0 + vec2(0.13, 0.71));
      vec4 fld2 = texture2D(uFields, p / 2300.0 + vec2(0.5, 0.2));
      float useAlt = step(0.5, nz1.b);
      float fid = mix(fld.r, fld2.r, useAlt);
      float border = mix(fld.b, fld2.b, useAlt);
      float rows = mix(fld.g, fld2.g, useAlt);
      float farm = (1.0 - smoothstep(500.0, 800.0, h)) * (1.0 - smoothstep(0.12, 0.25, slope)) * smoothstep(0.30, 0.45, nz1.g + 0.15);
      vec3 fc = fieldColor(fid, detail);
      // crop rows (only visible close up)
      float rowPat = 0.5 + 0.5 * sin((rows > 0.5 ? p.x : p.y) * 2.4);
      fc *= 1.0 - 0.08 * rowPat * (1.0 - smoothstep(200.0, 900.0, vDist));
      fc = mix(fc, vec3(0.20, 0.28, 0.12), border * 0.85); // hedgerows
      col = mix(col, fc, farm * 0.92);
      // forest canopy
      vec3 fcol = mix(vec3(0.10, 0.17, 0.07), vec3(0.18, 0.25, 0.10), nz2.r);
      fcol = mix(fcol, vec3(0.16, 0.20, 0.09), nz3.r * 0.4);
      col = mix(col, fcol, smoothstep(0.05, 0.55, forest));
      // towns: roofs, streets, gardens
      vec3 ucol = mix(vec3(0.42, 0.41, 0.39), vec3(0.52, 0.36, 0.30), step(0.62, nz3.a / 255.0 * 255.0 * nz3.b));
      ucol = mix(ucol, vec3(0.30, 0.36, 0.20), smoothstep(0.55, 0.75, nz2.g) * 0.6);
      col = mix(col, ucol, urban * 0.85);
      // rock on steep slopes and high ground
      float rock = smoothstep(0.28, 0.45, slope + nz2.r * 0.12) + smoothstep(1500.0, 1900.0, h + nz1.r * 200.0) * 0.7;
      vec3 rcol = mix(vec3(0.38, 0.35, 0.31), vec3(0.50, 0.47, 0.43), nz2.g);
      col = mix(col, rcol, clamp(rock, 0.0, 1.0));
      // snow above ~1650 m on gentler slopes
      float snow = smoothstep(1600.0, 1800.0, h + nz1.g * 250.0) * (1.0 - smoothstep(0.45, 0.65, slope));
      col = mix(col, vec3(0.92, 0.93, 0.96), snow);
      // beaches and wet sand
      float beach = 1.0 - smoothstep(1.5, 5.0, h + nz2.r * 2.0);
      col = mix(col, vec3(0.74, 0.68, 0.50), beach);
      col = mix(col, vec3(0.45, 0.42, 0.33), 1.0 - smoothstep(-1.0, 0.8, h));
      col *= 0.82 + 0.36 * detail;

      // lighting: sun + sky/ground ambient
      float diff = max(dot(n, uSunDir), 0.0);
      vec3 amb = mix(uGroundAmb, uSkyAmb, n.y * 0.5 + 0.5);
      vec3 lit = col * (diff * uSunColor + amb);
      // a few lit windows in towns at night
      lit += urban * uNight * step(0.82, nz3.a) * vec3(1.0, 0.75, 0.4) * 0.6;
      // aerial perspective / haze
      float f = 1.0 - exp(-uFogDensity * uFogDensity * vDist * vDist);
      gl_FragColor = vec4(mix(lit, uFogColor, f), 1.0);
    }`;

  // ---------------- tile mesh building ------------------------------------
  function buildTile(cx, cz, size) {
    const step = size / N;
    const G = N + 3; // grid with 1-sample border for normals
    const hs = new Float32Array(G * G);
    const x0 = cx - size / 2 - step, z0 = cz - size / 2 - step;
    for (let j = 0; j < G; j++) for (let i = 0; i < G; i++) hs[j * G + i] = W.height(x0 + i * step, z0 + j * step);
    const vcount = (N + 1) * (N + 1) + 4 * (N + 1);
    const pos = new Float32Array(vcount * 3), nor = new Float32Array(vcount * 3), mask = new Float32Array(vcount * 2);
    let k = 0;
    for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) {
      const gi = i + 1, gj = j + 1;
      const h = hs[gj * G + gi];
      const lx = -size / 2 + i * step, lz = -size / 2 + j * step;
      pos[k * 3] = lx; pos[k * 3 + 1] = h; pos[k * 3 + 2] = lz;
      const dx = hs[gj * G + gi - 1] - hs[gj * G + gi + 1];
      const dz = hs[(gj - 1) * G + gi] - hs[(gj + 1) * G + gi];
      const l = Math.hypot(dx, 2 * step, dz);
      nor[k * 3] = dx / l; nor[k * 3 + 1] = 2 * step / l; nor[k * 3 + 2] = dz / l;
      const wx = cx + lx, wz = cz + lz;
      mask[k * 2] = W.forest(wx, wz, h);
      mask[k * 2 + 1] = W.urban(wx, wz);
      k++;
    }
    // skirts hide cracks between tiles of different detail
    const skirt = size * 0.02 + 6;
    const edge = [];
    for (let i = 0; i <= N; i++) edge.push([i, 0]);
    for (let j = 0; j <= N; j++) edge.push([N, j]);
    for (let i = N; i >= 0; i--) edge.push([i, N]);
    for (let j = N; j >= 0; j--) edge.push([0, j]);
    const skirtStart = k;
    const sidx = {};
    const edgeKeys = [];
    edge.forEach(([i, j]) => {
      const key = i + ',' + j;
      if (sidx[key] !== undefined) { edgeKeys.push(key); return; }
      const src = j * (N + 1) + i;
      pos[k * 3] = pos[src * 3]; pos[k * 3 + 1] = pos[src * 3 + 1] - skirt; pos[k * 3 + 2] = pos[src * 3 + 2];
      nor[k * 3] = nor[src * 3]; nor[k * 3 + 1] = nor[src * 3 + 1]; nor[k * 3 + 2] = nor[src * 3 + 2];
      mask[k * 2] = mask[src * 2]; mask[k * 2 + 1] = mask[src * 2 + 1];
      sidx[key] = k++;
      edgeKeys.push(key);
    });
    const idx = [];
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const a = j * (N + 1) + i, b = a + 1, c = a + N + 1, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
    for (let e = 0; e < edge.length - 1; e++) {
      const [i0, j0] = edge[e], [i1, j1] = edge[e + 1];
      if (i0 === i1 && j0 === j1) continue;
      const a = j0 * (N + 1) + i0, b = j1 * (N + 1) + i1;
      const sa = sidx[i0 + ',' + j0], sb = sidx[i1 + ',' + j1];
      idx.push(a, sa, b, b, sa, sb, a, b, sa, b, sb, sa); // both windings
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos.subarray(0, k * 3), 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nor.subarray(0, k * 3), 3));
    geo.setAttribute('aMask', new THREE.BufferAttribute(mask.subarray(0, k * 2), 2));
    geo.setIndex(idx);
    geo.computeBoundingSphere();
    return geo;
  }

  // ---------------- quadtree management -----------------------------------
  T.init = function (scene) {
    T.noiseTex = makeNoiseTexture(256);
    T.fieldTex = makeFieldTexture(1024);
    T.material = new THREE.ShaderMaterial({
      vertexShader: vert, fragmentShader: frag,
      uniforms: {
        uNoise: { value: T.noiseTex }, uFields: { value: T.fieldTex },
        uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uSunColor: { value: new THREE.Color(1, 1, 1) },
        uSkyAmb: { value: new THREE.Color(0.4, 0.45, 0.5) }, uGroundAmb: { value: new THREE.Color(0.2, 0.2, 0.15) },
        uFogColor: { value: new THREE.Color(0.7, 0.8, 0.9) }, uFogDensity: { value: 0.00003 },
        uNight: { value: 0 }, uCamPos: { value: new THREE.Vector3() }
      }
    });
    T.group = new THREE.Group();
    scene.add(T.group);
    T.cache = new Map();   // key -> {mesh, lastUsed}
    T.queue = [];
    T.frame = 0;
  };

  function key(level, ix, iz) { return level + ':' + ix + ':' + iz; }

  function getTile(level, ix, iz, size, build) {
    const k = key(level, ix, iz);
    let t = T.cache.get(k);
    if (t) { t.used = T.frame; return t; }
    if (!build) return null;
    const cx = (ix + 0.5) * size, cz = (iz + 0.5) * size;
    const geo = buildTile(cx, cz, size);
    const mesh = new THREE.Mesh(geo, T.material);
    mesh.position.set(cx, 0, cz);
    mesh.matrixAutoUpdate = false; mesh.updateMatrix();
    mesh.frustumCulled = true;
    t = { mesh, used: T.frame, size };
    T.cache.set(k, t);
    return t;
  }

  /** Called every frame with the camera position. budgetMs limits tile building. */
  T.update = function (cam, budgetMs, force) {
    T.frame++;
    const visible = [];
    const wanted = [];
    const camX = cam.x, camY = cam.y, camZ = cam.z;
    const hGround = Math.max(0, W.height(camX, camZ));
    const rIx = Math.floor(camX / ROOT), rIz = Math.floor(camZ / ROOT);
    const R = 2;
    const visit = (level, ix, iz, size) => {
      const cx = (ix + 0.5) * size, cz = (iz + 0.5) * size;
      const dx = Math.max(Math.abs(camX - cx) - size / 2, 0), dz = Math.max(Math.abs(camZ - cz) - size / 2, 0);
      const dy = Math.max(0, camY - hGround - 50);
      const d = Math.sqrt(dx * dx + dz * dz + dy * dy);
      const tile = getTile(level, ix, iz, size, level === 0);
      if (!tile) return false;
      if (size > MIN && d < size * SPLIT * 0.5 + size * 0.25) {
        const half = size / 2;
        const kids = [];
        let ready = true;
        for (let c = 0; c < 4; c++) {
          const kx = ix * 2 + (c & 1), kz = iz * 2 + (c >> 1);
          const kt = getTile(level + 1, kx, kz, half, false);
          kids.push([kx, kz]);
          if (!kt) { ready = false; wanted.push({ level: level + 1, ix: kx, iz: kz, size: half, d }); }
        }
        if (ready) { kids.forEach(([kx, kz]) => visit(level + 1, kx, kz, half)); return true; }
      }
      visible.push(tile.mesh);
      return true;
    };
    for (let j = -R; j <= R; j++) for (let i = -R; i <= R; i++) visit(0, rIx + i, rIz + j, ROOT);

    // build wanted tiles, closest first, within the time budget
    wanted.sort((a, b) => a.d - b.d || a.size - b.size);
    const t0 = performance.now();
    for (let i = 0; i < wanted.length; i++) {
      const w = wanted[i];
      getTile(w.level, w.ix, w.iz, w.size, true);
      if (!force && performance.now() - t0 > budgetMs) break;
    }
    // swap visible set
    T.group.children.length = 0;
    visible.forEach((m) => { T.group.children.push(m); m.parent = T.group; });
    // evict old tiles
    if (T.frame % 120 === 0 && T.cache.size > 900) {
      for (const [k, t] of T.cache) {
        if (T.frame - t.used > 600 && !k.startsWith('0:')) { t.mesh.geometry.dispose(); T.cache.delete(k); }
      }
    }
    T.pending = wanted.length;
    return wanted.length;
  };

  T.setLighting = function (env) {
    const u = T.material.uniforms;
    u.uSunDir.value.copy(env.sunDir);
    u.uSunColor.value.copy(env.sunColor);
    u.uSkyAmb.value.copy(env.skyAmb);
    u.uGroundAmb.value.copy(env.groundAmb);
    u.uFogColor.value.copy(env.fogColor);
    u.uFogDensity.value = env.fogDensity;
    u.uNight.value = env.night;
  };
})(typeof window !== 'undefined' ? window : globalThis);
