/* ==========================================================================
 * env.js — sky, sun position (real solar geometry), lighting, sea, clouds
 * ========================================================================== */
(function (root) {
  'use strict';
  const SIM = root.SIM = root.SIM || {};
  const U = SIM.util;
  const E = SIM.env = {
    latitude: 32.0,     // degrees north (Mediterranean-like latitude)
    dayOfYear: 172,
    timeOfDay: 10.0,    // local solar hours
    sunDir: new THREE.Vector3(0, 1, 0),
    sunColor: new THREE.Color(1, 1, 1),
    skyAmb: new THREE.Color(), groundAmb: new THREE.Color(),
    fogColor: new THREE.Color(), zenith: new THREE.Color(), horizon: new THREE.Color(),
    fogDensity: 0.00003, night: 0, sunElev: 45
  };

  /** Sun direction from latitude, day of year and local solar time. */
  E.computeSun = function () {
    const lat = E.latitude * U.DEG;
    const decl = 23.44 * U.DEG * Math.sin(2 * Math.PI * (284 + E.dayOfYear) / 365);
    const H = (E.timeOfDay - 12) * 15 * U.DEG;
    const sinEl = Math.sin(lat) * Math.sin(decl) + Math.cos(lat) * Math.cos(decl) * Math.cos(H);
    const el = Math.asin(sinEl);
    let az = Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(lat) - Math.tan(decl) * Math.cos(lat)) + Math.PI;
    E.sunElev = el * U.RAD;
    E.sunAz = U.wrap360(az * U.RAD);
    E.sunDir.set(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el)).normalize();
  };

  E.updateColors = function () {
    const el = E.sunElev;
    const day = U.smoothstep(-6, 12, el);          // 0 night .. 1 day
    const golden = U.smoothstep(-4, 4, el) * (1 - U.smoothstep(4, 22, el));
    E.night = 1 - U.smoothstep(-8, 2, el);
    const cover = SIM.weather.cloudCover();
    const overcast = U.smoothstep(0.6, 1.0, cover);
    // sky colours
    E.zenith.setRGB(0.18, 0.38, 0.75).lerp(new THREE.Color(0.01, 0.02, 0.06), 1 - day);
    E.horizon.setRGB(0.68, 0.80, 0.93).lerp(new THREE.Color(0.95, 0.6, 0.35), golden * 0.7).lerp(new THREE.Color(0.02, 0.03, 0.07), 1 - day);
    E.zenith.lerp(new THREE.Color(0.55, 0.58, 0.62).multiplyScalar(0.3 + 0.7 * day), overcast * 0.8);
    E.horizon.lerp(new THREE.Color(0.66, 0.68, 0.70).multiplyScalar(0.3 + 0.7 * day), overcast * 0.8);
    // sun light
    E.sunColor.setRGB(1.0, 0.97, 0.9).lerp(new THREE.Color(1.0, 0.6, 0.3), golden).multiplyScalar(U.smoothstep(-3, 6, el) * 1.15 * (1 - overcast * 0.6));
    E.skyAmb.setRGB(0.36, 0.42, 0.52).multiplyScalar(0.08 + 0.92 * day);
    E.groundAmb.setRGB(0.22, 0.21, 0.17).multiplyScalar(0.08 + 0.92 * day);
    if (overcast > 0) { E.skyAmb.multiplyScalar(1 + overcast * 0.4); }
    E.fogColor.copy(E.horizon).lerp(new THREE.Color(0.75, 0.78, 0.82).multiplyScalar(day), 0.25);
    // visibility -> fog density (Koschmieder: ~ 3.0 / visibility for exp fog; exp2 equivalent)
    const visM = SIM.weather.visibilityKm * 1000;
    E.fogDensity = 1.6 / visM;
  };

  // ---------------- sky dome ------------------------------------------------
  const skyVert = `
    #include <common>
    #include <logdepthbuf_pars_vertex>
    varying vec3 vDir;
    void main(){ vDir = normalize(position); vec4 mv = modelViewMatrix * vec4(position,1.0); gl_Position = projectionMatrix * mv;
    #include <logdepthbuf_vertex>
    }`;
  const skyFrag = `
    #include <common>
    #include <logdepthbuf_pars_fragment>
    uniform vec3 uZenith; uniform vec3 uHorizon; uniform vec3 uSunDir; uniform vec3 uSunCol; uniform float uNight; uniform vec3 uGround;
    varying vec3 vDir;
    float hash(vec3 p){ p = fract(p*0.3183099+.1); p*=17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
    void main(){
      #include <logdepthbuf_fragment>
      vec3 d = normalize(vDir);
      float h = d.y;
      vec3 col = mix(uHorizon, uZenith, pow(clamp(h,0.0,1.0), 0.45));
      col = mix(col, uGround, smoothstep(0.0, -0.08, h));
      float s = max(dot(d, uSunDir), 0.0);
      col += uSunCol * (pow(s, 900.0) * 6.0 + pow(s, 40.0) * 0.25 + pow(s, 6.0) * 0.12);
      // stars
      if (uNight > 0.01 && h > 0.0) {
        vec3 q = floor(d * 400.0);
        float st = step(0.9985, hash(q));
        col += vec3(st) * uNight * 0.9 * smoothstep(0.0, 0.2, h);
      }
      gl_FragColor = vec4(col, 1.0);
    }`;

  // ---------------- sea ---------------------------------------------------
  const waterVert = `
    #include <common>
    #include <logdepthbuf_pars_vertex>
    varying vec3 vWorld; varying float vDist;
    void main(){ vec4 wp = modelMatrix*vec4(position,1.0); vWorld = wp.xyz; vec4 mv = viewMatrix*wp; vDist = length(mv.xyz); gl_Position = projectionMatrix*mv;
    #include <logdepthbuf_vertex>
    }`;
  const waterFrag = `
    #include <common>
    #include <logdepthbuf_pars_fragment>
    uniform sampler2D uNoise; uniform float uTime; uniform vec3 uSunDir; uniform vec3 uSunCol; uniform vec3 uZenith; uniform vec3 uHorizon;
    uniform vec3 uFogColor; uniform float uFogDensity; uniform vec3 uCam;
    varying vec3 vWorld; varying float vDist;
    void main(){
      #include <logdepthbuf_fragment>
      vec2 p = vWorld.xz;
      vec4 a = texture2D(uNoise, p/90.0 + vec2(uTime*0.004, uTime*0.002));
      vec4 b = texture2D(uNoise, p/23.0 - vec2(uTime*0.01, -uTime*0.006));
      vec4 c = texture2D(uNoise, p/700.0 + vec2(uTime*0.001, 0.0));
      float fade = 1.0 - smoothstep(800.0, 6000.0, vDist);
      vec3 n = normalize(vec3((a.r-0.5)*0.35*fade + (b.g-0.5)*0.25*fade + (c.r-0.5)*0.1, 1.0, (a.g-0.5)*0.35*fade + (b.r-0.5)*0.25*fade + (c.g-0.5)*0.1));
      vec3 v = normalize(uCam - vWorld);
      float fres = 0.02 + 0.98 * pow(1.0 - max(dot(n, v), 0.0), 5.0);
      vec3 r = reflect(-v, n);
      vec3 sky = mix(uHorizon, uZenith, pow(clamp(r.y,0.0,1.0),0.5));
      vec3 deep = vec3(0.02, 0.10, 0.16) * (0.3 + 0.7*length(uSunCol)/1.7);
      vec3 col = mix(deep, sky, fres);
      float spec = pow(max(dot(r, uSunDir), 0.0), 300.0) * 4.0 + pow(max(dot(r, uSunDir), 0.0), 30.0) * 0.15;
      col += uSunCol * spec;
      float f = 1.0 - exp(-uFogDensity*uFogDensity*vDist*vDist);
      gl_FragColor = vec4(mix(col, uFogColor, f), 1.0);
    }`;

  // ---------------- clouds (instanced billboards) ---------------------------
  const cloudVert = `
    #include <common>
    #include <logdepthbuf_pars_vertex>
    attribute vec4 aOffset; // xyz position, w size
    attribute float aShade;
    uniform vec3 uCam; uniform float uSpan;
    varying vec2 vUv; varying float vShade; varying float vDist; varying float vY;
    void main(){
      vec3 c = aOffset.xyz;
      c.xz = mod(c.xz - uCam.xz + uSpan*0.5, uSpan) - uSpan*0.5 + uCam.xz;
      vec4 mv = viewMatrix * vec4(c, 1.0);
      mv.xy += position.xy * aOffset.w;
      vUv = uv; vShade = aShade; vDist = length(mv.xyz); vY = position.y;
      gl_Position = projectionMatrix * mv;
      #include <logdepthbuf_vertex>
    }`;
  const cloudFrag = `
    #include <common>
    #include <logdepthbuf_pars_fragment>
    uniform sampler2D uTex; uniform vec3 uSunCol; uniform vec3 uAmb; uniform vec3 uFogColor; uniform float uFogDensity; uniform float uOpacity;
    varying vec2 vUv; varying float vShade; varying float vDist; varying float vY;
    void main(){
      #include <logdepthbuf_fragment>
      vec4 t = texture2D(uTex, vUv);
      float a = t.a * uOpacity * smoothstep(40.0, 400.0, vDist);
      if (a < 0.01) discard;
      float light = clamp(vShade + vY*0.25, 0.0, 1.0);
      vec3 col = mix(uAmb*1.1, uSunCol*0.95 + uAmb*0.5, light) * (0.85 + 0.15*t.r);
      float f = 1.0 - exp(-uFogDensity*uFogDensity*vDist*vDist*0.6);
      gl_FragColor = vec4(mix(col, uFogColor, f), a);
    }`;

  function cloudTexture() {
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const g = c.getContext('2d');
    const rnd = U.rng(9);
    for (let i = 0; i < 28; i++) {
      const x = 64 + (rnd() - 0.5) * 60, y = 64 + (rnd() - 0.5) * 50, r = 18 + rnd() * 26;
      const gr = g.createRadialGradient(x, y, 0, x, y, r);
      const b = 200 + rnd() * 55;
      gr.addColorStop(0, `rgba(${b},${b},${b},0.55)`); gr.addColorStop(1, `rgba(${b},${b},${b},0)`);
      g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
    }
    const t = new THREE.CanvasTexture(c);
    return t;
  }

  E.init = function (scene) {
    E.scene = scene;
    // sky
    E.skyMat = new THREE.ShaderMaterial({
      vertexShader: skyVert, fragmentShader: skyFrag, side: THREE.BackSide, depthWrite: false, depthTest: false,
      uniforms: { uZenith: { value: E.zenith }, uHorizon: { value: E.horizon }, uSunDir: { value: E.sunDir },
        uSunCol: { value: E.sunColor }, uNight: { value: 0 }, uGround: { value: new THREE.Color(0.2, 0.22, 0.2) } }
    });
    E.sky = new THREE.Mesh(new THREE.SphereGeometry(150000, 48, 24), E.skyMat);
    E.sky.renderOrder = -10; E.sky.frustumCulled = false;
    scene.add(E.sky);
    // lights for standard materials
    E.sun = new THREE.DirectionalLight(0xffffff, 1.0);
    E.sun.position.set(0, 1, 0);
    scene.add(E.sun); scene.add(E.sun.target);
    E.hemi = new THREE.HemisphereLight(0x8899aa, 0x443322, 0.6);
    scene.add(E.hemi);
    scene.fog = new THREE.FogExp2(0xaaccee, 0.00003);
    // sea
    E.waterMat = new THREE.ShaderMaterial({
      vertexShader: waterVert, fragmentShader: waterFrag,
      uniforms: { uNoise: { value: SIM.terrain.noiseTex }, uTime: { value: 0 }, uSunDir: { value: E.sunDir }, uSunCol: { value: E.sunColor },
        uZenith: { value: E.zenith }, uHorizon: { value: E.horizon }, uFogColor: { value: E.fogColor }, uFogDensity: { value: 0 }, uCam: { value: new THREE.Vector3() } }
    });
    const wg = new THREE.PlaneGeometry(320000, 320000, 1, 1); wg.rotateX(-Math.PI / 2);
    E.water = new THREE.Mesh(wg, E.waterMat);
    E.water.frustumCulled = false;
    scene.add(E.water);
    // clouds
    E.cloudSpan = 70000;
    E.buildClouds();
  };

  E.buildClouds = function () {
    if (E.clouds) { E.scene.remove(E.clouds); E.clouds.geometry.dispose(); }
    const cover = SIM.weather.cloudCover();
    const base = SIM.weather.cloudBase;
    const rnd = U.rng(31337);
    const clusters = Math.floor(cover * 520);
    const offs = [], shade = [];
    E.cloudClusters = [];
    for (let i = 0; i < clusters; i++) {
      const cx = (rnd() - 0.5) * E.cloudSpan, cz = (rnd() - 0.5) * E.cloudSpan;
      const w = 500 + rnd() * 1400 * (0.6 + cover), hgt = 250 + rnd() * 600 * (0.4 + cover);
      E.cloudClusters.push({ x: cx, z: cz, y: base + hgt * 0.5, r: w * 0.5, h: hgt * 0.5 });
      const puffs = 8 + Math.floor(rnd() * 14);
      for (let p = 0; p < puffs; p++) {
        const a = rnd() * Math.PI * 2, rr = Math.sqrt(rnd()) * w * 0.5;
        const y = base + Math.pow(rnd(), 1.5) * hgt;
        const size = 220 + rnd() * 380 * (1 - (y - base) / hgt * 0.5);
        offs.push(cx + Math.cos(a) * rr, y, cz + Math.sin(a) * rr * 0.7, size);
        shade.push(U.clamp((y - base) / hgt * 0.9 + 0.15, 0, 1));
      }
    }
    if (cover >= 0.9) { // overcast: add a continuous layer of flat puffs
      for (let i = 0; i < 2600; i++) {
        offs.push((rnd() - 0.5) * E.cloudSpan, base + 150 + rnd() * 250, (rnd() - 0.5) * E.cloudSpan, 1400 + rnd() * 900);
        shade.push(0.3 + rnd() * 0.3);
      }
      E.cloudClusters.push({ layer: true, y: base + 250, h: 280 });
    }
    const quad = new THREE.PlaneGeometry(1, 1);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = quad.index; geo.attributes.position = quad.attributes.position; geo.attributes.uv = quad.attributes.uv;
    geo.setAttribute('aOffset', new THREE.InstancedBufferAttribute(new Float32Array(offs), 4));
    geo.setAttribute('aShade', new THREE.InstancedBufferAttribute(new Float32Array(shade), 1));
    geo.instanceCount = offs.length / 4;
    if (!E.cloudMat) {
      E.cloudMat = new THREE.ShaderMaterial({
        vertexShader: cloudVert, fragmentShader: cloudFrag, transparent: true, depthWrite: false,
        uniforms: { uTex: { value: cloudTexture() }, uSunCol: { value: E.sunColor }, uAmb: { value: E.skyAmb }, uCam: { value: new THREE.Vector3() },
          uSpan: { value: E.cloudSpan }, uFogColor: { value: E.fogColor }, uFogDensity: { value: 0 }, uOpacity: { value: 0.9 } }
      });
    }
    E.clouds = new THREE.Mesh(geo, E.cloudMat);
    E.clouds.frustumCulled = false;
    E.clouds.renderOrder = 5;
    E.clouds.visible = offs.length > 0;
    E.scene.add(E.clouds);
  };

  /** 0..1: how deep inside a cloud the given point is (for fog/visibility). */
  E.cloudDensityAt = function (p) {
    let d = 0;
    const span = E.cloudSpan;
    for (const c of E.cloudClusters || []) {
      if (c.layer) { const dy = Math.abs(p.y - c.y); if (dy < c.h) d = Math.max(d, 1 - dy / c.h); continue; }
      let dx = ((c.x - p.x + span / 2) % span + span) % span - span / 2;
      let dz = ((c.z - p.z + span / 2) % span + span) % span - span / 2;
      const dy = (c.y - p.y) / c.h;
      const r = Math.sqrt((dx * dx + dz * dz) / (c.r * c.r) + dy * dy);
      if (r < 1) d = Math.max(d, 1 - r);
    }
    return U.clamp(d * 1.6, 0, 1);
  };

  E.update = function (camPos, time) {
    E.computeSun();
    E.updateColors();
    const inCloud = E.cloudDensityAt(camPos);
    E.inCloud = inCloud;
    let fogD = E.fogDensity;
    const fogCol = E.fogColor;
    if (inCloud > 0) { fogD = U.lerp(fogD, 1 / 60, inCloud); fogCol.lerp(new THREE.Color(0.8, 0.82, 0.85).multiplyScalar(0.25 + 0.75 * (1 - E.night)), inCloud); }
    E.fogDensityEff = fogD;
    E.sky.position.copy(camPos);
    E.skyMat.uniforms.uNight.value = E.night;
    E.sun.position.copy(E.sunDir).multiplyScalar(1000).add(camPos);
    E.sun.target.position.copy(camPos);
    E.sun.color.copy(E.sunColor);
    E.sun.intensity = 1.0;
    E.hemi.color.copy(E.skyAmb).multiplyScalar(1.6);
    E.hemi.groundColor.copy(E.groundAmb).multiplyScalar(1.6);
    E.hemi.intensity = 1.0;
    E.scene.fog.color.copy(fogCol);
    E.scene.fog.density = fogD;
    E.water.position.set(Math.round(camPos.x / 1000) * 1000, 0, Math.round(camPos.z / 1000) * 1000);
    E.water.updateMatrix();
    const wu = E.waterMat.uniforms;
    wu.uTime.value = time; wu.uFogDensity.value = fogD; wu.uCam.value.copy(camPos);
    const cu = E.cloudMat.uniforms;
    cu.uCam.value.copy(camPos); cu.uFogDensity.value = fogD;
    SIM.terrain.setLighting({ sunDir: E.sunDir, sunColor: E.sunColor, skyAmb: E.skyAmb, groundAmb: E.groundAmb, fogColor: fogCol, fogDensity: fogD, night: E.night });
  };
})(typeof window !== 'undefined' ? window : globalThis);
