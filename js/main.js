/* ==========================================================================
 * main.js — boots the simulator, runs the real-time loop, user interface
 * ========================================================================== */
(function (root) {
  'use strict';
  const SIM = root.SIM;
  const U = SIM.util, W = SIM.world;
  const $ = (id) => document.getElementById(id);

  const MAIN = SIM.main = { timeScale: 1, paused: true, started: false, simTime: 0 };
  const UI = SIM.ui = { menuOpen: true, instructorOn: true };
  let renderer, scene, camera, ac, raycaster;
  const H = 1 / 240; // physics step: 240 Hz

  // ------------------------------------------------------------------------
  // start positions
  // ------------------------------------------------------------------------
  const START = {
    apron_cold: { name: 'Cold & dark on the apron (Falcon AB)', desc: 'Engine off, every switch off. Learn the full start-up.' },
    runway: { name: 'Lined up on runway 27 (Falcon AB)', desc: 'Engine running, ready for take-off.' },
    air: { name: 'In flight, 6,000 ft', desc: '280 kt over the countryside, heading east.' },
    final: { name: '7 NM final, ILS runway 27', desc: 'Gear down, full flap, 130 kt. Practise landing.' },
    air_nav: { name: 'Departing Falcon AB, 3,000 ft', desc: 'For the navigation lesson to Meridian.' },
    highland: { name: 'Highland Field, runway 02', desc: 'Short mountain strip, engine running.' }
  };
  MAIN.START = START;

  function startState(key) {
    const ap = W.airports[0];
    const D = SIM.acData;
    const gearY = -D.gear[1].y + 0.13;
    switch (key) {
      case 'apron_cold': {
        const p = W.fromLocal(ap, 250, 230);
        return { x: p.x, y: W.height(p.x, p.z) + gearY, z: p.z, hdg: U.wrap360(ap.hdg - 90), running: false, fuel: 1100, trim: 0.1 };
      }
      case 'runway': {
        const t = ap.thr1;
        return { x: t.x + ap.fx * 90, y: ap.elev + gearY, z: t.z + ap.fz * 90, hdg: ap.hdg, running: true, fuel: 1100, trim: 0.1 };
      }
      case 'highland': {
        const h = W.airports[2], t = h.thr1;
        return { x: t.x + h.fx * 60, y: h.elev + gearY, z: t.z + h.fz * 60, hdg: h.hdg, running: true, fuel: 1000, trim: 0.1 };
      }
      case 'air':
        return { x: -12000, y: 1830, z: 4000, hdg: 90, running: true, airborne: true, speed: 150, throttle: 0.72, fuel: 950 };
      case 'air_nav':
        return { x: -3000, y: 915, z: -2500, hdg: 90, running: true, airborne: true, speed: 132, throttle: 0.65, fuel: 950, nav: 2 };
      case 'final': {
        const t = ap.thr1, d = 7 * U.NM2M;
        return { x: t.x - ap.fx * d, y: ap.elev + 15 + (d + 300) * Math.tan(3 * U.DEG), z: t.z - ap.fz * d, hdg: ap.hdg, running: true, airborne: true,
          gearDown: true, flaps: 1, speed: 70, throttle: 0.5, fuel: 600, nav: 1 };
      }
    }
  }

  // ------------------------------------------------------------------------
  // boot
  // ------------------------------------------------------------------------
  MAIN.boot = function () {
    const canvas = $('c');
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, logarithmicDepthBuffer: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    renderer.setSize(innerWidth, innerHeight);
    MAIN.renderer = renderer;
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(72, innerWidth / innerHeight, 0.03, 200000);
    camera.rotation.order = 'YXZ';
    MAIN.camera = camera;
    raycaster = new THREE.Raycaster();
    addEventListener('resize', () => { renderer.setSize(innerWidth, innerHeight); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); });

    SIM.terrain.init(scene);
    SIM.env.init(scene);
    SIM.panel.init();
    SIM.hud.init();
    SIM.model.init(scene);
    SIM.scenery.init(scene);
    SIM.scenery.camera = camera;
    ac = MAIN.ac = new SIM.Aircraft();
    SIM.input.init(canvas, ac);
    // flares
    MAIN.flares = [];
    MAIN.flareTex = (() => { const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d'); const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, 'rgba(255,255,240,1)'); gr.addColorStop(0.25, 'rgba(255,220,120,0.8)'); gr.addColorStop(1, 'rgba(255,150,40,0)'); g.fillStyle = gr; g.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(c); })();
    buildMenu();
    $('loading').style.display = 'none';
    requestAnimationFrame(frame);
  };

  MAIN.begin = function (startKey, lesson) {
    MAIN.startKey = startKey; MAIN.lesson = lesson;
    readMenuSettings();
    const st = startState(startKey);
    ac.reset(st);
    if (st.nav !== undefined) ac.sys.navIndex = st.nav;
    else ac.sys.navIndex = 1;
    SIM.nav.autoCourse(ac);
    if (startKey !== 'apron_cold') ac.sys.qnhSet = SIM.weather.qnh;
    ac.gMax = 1; ac.gMin = 1;
    SIM.instructor.begin(lesson);
    SIM.env.buildClouds();
    MAIN.gStress = 0; MAIN.wasOnGround = ac.onGround; MAIN.crashShown = false;
    MAIN.flares.forEach((f) => scene.remove(f.s)); MAIN.flares = [];
    // view
    const I = SIM.input;
    I.view = 'cockpit';
    I.head.tYaw = I.head.yaw = 0;
    I.head.tPitch = I.head.pitch = startKey === 'apron_cold' ? -27 : -3;
    I.head.tFov = I.head.fov = startKey === 'apron_cold' ? 52 : 75;
    // pre-build the terrain around the start point so it does not pop in
    const cam = new THREE.Vector3(st.x, st.y + 1, st.z);
    $('loading').style.display = 'flex'; $('loading').textContent = 'Building terrain…';
    setTimeout(() => {
      for (let i = 0; i < 14; i++) if (!SIM.terrain.update(cam, 1e9, true)) break;
      SIM.scenery.update(cam, 1e9, true);
      $('loading').style.display = 'none';
      SIM.audio.init();
      SIM.music.setTheme('flight');
      UI.closeMenus();
      MAIN.paused = false; MAIN.started = true;
      UI.toast(lesson.title.replace(/^\d\.\s*/, ''));
      updateInstructorPanel(true);
    }, 30);
  };

  // ------------------------------------------------------------------------
  // picking: which cockpit control is under the mouse?
  // ------------------------------------------------------------------------
  const ndc = new THREE.Vector2();
  MAIN.pick = function (sx, sy) {
    if (SIM.input.view !== 'cockpit' || !MAIN.started) return null;
    ndc.set(sx / innerWidth * 2 - 1, -(sy / innerHeight) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    const hits = raycaster.intersectObjects(SIM.model.clickables, false);
    if (!hits.length) return null;
    const h = hits[0], o = h.object;
    if (o.userData.panel) {
      const cv = SIM.panel.cv[o.userData.panel];
      return { panel: o.userData.panel, cx: h.uv.x * cv.width, cy: (1 - h.uv.y) * cv.height };
    }
    return { obj: o };
  };
  MAIN.clickObject = function (o) {
    const id = o.userData.click && o.userData.click.id;
    if (id === 'seatArmed') { ac.action('seatArmed'); UI.toast('Ejection seat ' + (ac.sys.seatArmed ? 'ARMED' : 'SAFE')); SIM.audio.click(); }
    if (id === 'eject') {
      if (!ac.sys.seatArmed) { UI.toast('Seat is SAFE — arm it first (red lever)'); return; }
      ac.crashed = 'EJECTED. The seat fired, your parachute opened. In real life: sit up straight, elbows in, pull the handle with both hands — the seat does the rest.';
      ac._ejected = true;
    }
  };

  // ------------------------------------------------------------------------
  // camera: pilot's head (cockpit) or chase view (external)
  // ------------------------------------------------------------------------
  const eyeV = new THREE.Vector3(), headQ = new THREE.Quaternion(), headE = new THREE.Euler(0, 0, 0, 'YXZ');
  function updateCamera(dt, time) {
    const I = SIM.input, h = I.head;
    if (I.view === 'cockpit') {
      const E = SIM.acData.eye;
      // lean: look over the side / toward the panel like a real pilot
      const yawR = h.yaw * U.DEG, pitR = h.pitch * U.DEG;
      const side = U.clamp(Math.sin(yawR), -1, 1);
      const leanSide = Math.abs(h.yaw) > 40 ? side * 0.12 * U.smoothstep(40, 90, Math.abs(h.yaw)) : 0;
      const leanFwd = pitR < -0.35 ? U.clamp((-pitR - 0.35) * 0.12, 0, 0.08) : 0;
      // G pushes the head down; buffet & runway shake it
      const g = ac.out.g || 1;
      let shake = 0;
      if (ac._stalled && !ac.onGround) shake += 0.004 * U.clamp((ac.out.aoa - 14) / 4, 0, 1);
      if (ac.onGround) shake += Math.min(ac.out.gs / 150, 1) * (ac._surface === 'grass' ? 0.006 : 0.0015);
      if (ac.sys.stallWarn) shake += 0.0015;
      const sx = (Math.random() - 0.5) * shake, sy = (Math.random() - 0.5) * shake;
      eyeV.set(E.x - leanSide + sx, E.y - U.clamp((g - 1) * 0.008, -0.03, 0.06) + sy, E.z - leanFwd);
      eyeV.applyQuaternion(ac.quat).add(ac.pos);
      camera.position.copy(eyeV);
      headE.set(pitR, yawR, 0, 'YXZ');
      headQ.setFromEuler(headE);
      camera.quaternion.copy(ac.quat).multiply(headQ);
      camera.near = 0.03;
    } else {
      const e = I.ext;
      const hdg = ac.out.heading * U.DEG;
      const yaw = -hdg + e.yaw * U.DEG, pit = e.pitch * U.DEG;
      const off = new THREE.Vector3(Math.sin(yaw) * Math.cos(pit), Math.sin(pit), Math.cos(yaw) * Math.cos(pit)).multiplyScalar(e.dist);
      camera.position.copy(ac.pos).add(off);
      const gh = W.height(camera.position.x, camera.position.z);
      if (camera.position.y < gh + 2) camera.position.y = gh + 2;
      camera.lookAt(ac.pos);
      camera.near = 0.5;
    }
    if (Math.abs(camera.fov - h.fov) > 0.01 || camera._near !== camera.near) { camera.fov = I.view === 'cockpit' ? h.fov : 60; camera._near = camera.near; camera.updateProjectionMatrix(); }
  }

  // ------------------------------------------------------------------------
  // the loop
  // ------------------------------------------------------------------------
  let last = performance.now(), acc = 0, frameN = 0, fpsT = 0, fpsN = 0, fps = 60, hoverT = 0;
  function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.min((now - last) / 1000, 0.1);
    last = now; frameN++;
    fpsT += dt; fpsN++; if (fpsT > 1) { fps = fpsN / fpsT; fpsT = 0; fpsN = 0; }
    if (!MAIN.started) { renderer.render(scene, camera); return; }
    const time = now / 1000;
    if (!MAIN.paused) {
      SIM.input.update(dt);
      const simDt = dt * MAIN.timeScale;
      acc += simDt;
      let n = 0;
      while (acc >= H && n < 240 * 4) {
        SIM.weather.update(H, ac.out.agl);
        ac.updateSystems(H);
        ac.step(H);
        ac.computeOutputs(H);
        acc -= H; n++;
      }
      MAIN.simTime += simDt;
      SIM.env.timeOfDay = (SIM.env.timeOfDay + simDt / 3600) % 24;
      if (!MAIN.wasOnGround && ac.onGround && !ac.crashed) {
        const vs = Math.round(-ac.vel.y * U.MS2FPM);
        ac._tdVS = vs;
        ac.events.push('touchdown');
        if (MAIN.simTime > 3 && vs < 350 && SIM.music) setTimeout(() => { if (!ac.crashed) SIM.music.stinger('landing'); }, 600);
        if (MAIN.simTime > 3) UI.toast(`Touchdown: ${vs} ft/min — ${vs < 150 ? 'a greaser!' : vs < 300 ? 'good landing' : vs < 500 ? 'firm' : 'HARD'}`, 5000);
      }
      MAIN.wasOnGround = ac.onGround;
      SIM.instructor.update(ac, dt);
      updateEffects(dt);
      updateFlares(dt);
    }
    SIM.nav.update(ac);
    updateCamera(dt, time);
    const camPos = camera.position;
    SIM.terrain.update(camPos, 5);
    SIM.scenery.update(camPos, 3);
    SIM.env.update(camPos, time);
    SIM.model.update(ac, SIM.input.view, time);
    if (frameN % 2 === 0) SIM.panel.draw(ac);
    SIM.hud.draw(ac, time);
    SIM.audio.update(ac, dt, SIM.input.view, time);
    if (frameN % 6 === 0) { updateInfoBox(fps); updateInstructorPanel(); }
    hoverT += dt;
    if (hoverT > 0.08) { hoverT = 0; updateTooltip(); }
    if (ac.crashed && !MAIN.crashShown) showCrash();
    renderer.render(scene, camera);
  }

  // ------------------------------------------------------------------------
  // effects: G-induced vision loss, cloud white-out, flares
  // ------------------------------------------------------------------------
  function updateEffects(dt) {
    const g = ac.out.g;
    // blood pressure model: sustained high G drains the eyes' blood supply
    if (g > 4.5) MAIN.gStress += (g - 4.5) * dt * 0.22;
    else if (g < -2) MAIN.gStress -= (-2 - g) * dt * 0.4;
    else MAIN.gStress = U.moveToward(MAIN.gStress, 0, 0.35 * dt, 1);
    MAIN.gStress = U.clamp(MAIN.gStress, -1.2, 1.3);
    const el = $('gfx');
    const s = MAIN.gStress;
    if (s > 0.05) {
      const a = U.clamp(s, 0, 1);
      el.style.background = `radial-gradient(ellipse at center, rgba(0,0,0,${a * a * 0.85}) ${Math.round(60 - a * 55)}%, rgba(0,0,0,${0.4 + a * 0.6}) 100%)`;
      el.style.opacity = 1;
      if (s > 1.15) el.style.background = 'rgba(0,0,0,0.97)';
    } else if (s < -0.05) {
      el.style.background = `rgba(160,0,0,${U.clamp(-s, 0, 1) * 0.6})`; el.style.opacity = 1;
    } else el.style.opacity = 0;
    const cl = SIM.env.inCloud || 0;
    $('cloudfx').style.opacity = U.clamp(cl * 0.85, 0, 0.85) * (SIM.input.view === 'cockpit' ? 1 : 0.5);
  }

  function updateFlares(dt) {
    if (ac.events.includes('flare')) {
      for (let k = 0; k < 2; k++) {
        const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: MAIN.flareTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
        s.scale.set(6, 6, 1);
        const side = new THREE.Vector3(k ? 1 : -1, -1.2, 0.5).applyQuaternion(ac.quat).multiplyScalar(18);
        s.position.copy(ac.pos).add(new THREE.Vector3(0, -0.6, 3).applyQuaternion(ac.quat));
        scene.add(s);
        MAIN.flares.push({ s, v: ac.vel.clone().add(side), t: 0 });
      }
    }
    MAIN.flares = MAIN.flares.filter((f) => {
      f.t += dt;
      f.v.y -= 9.8 * dt; f.v.multiplyScalar(Math.exp(-dt * 0.8));
      f.s.position.addScaledVector(f.v, dt);
      const k = Math.max(0, 1 - f.t / 4.5);
      f.s.material.opacity = k; f.s.scale.setScalar(4 + 10 * k * (0.8 + Math.random() * 0.4));
      if (f.t > 4.5) { scene.remove(f.s); f.s.material.dispose(); return false; }
      return true;
    });
  }

  // ------------------------------------------------------------------------
  // UI
  // ------------------------------------------------------------------------
  UI.toast = function (msg, ms) {
    const el = $('toast');
    el.textContent = msg; el.style.opacity = 1;
    clearTimeout(UI._tt); UI._tt = setTimeout(() => (el.style.opacity = 0), ms || 2200);
  };

  function updateInfoBox(fps) {
    const o = ac.out, wx = SIM.weather, env = SIM.env;
    const hh = Math.floor(env.timeOfDay), mm = Math.floor((env.timeOfDay % 1) * 60);
    const near = W.airports.map((a) => ({ a, d: Math.hypot(a.x - ac.pos.x, a.z - ac.pos.z) })).sort((p, q) => p.d - q.d)[0];
    $('info').innerHTML =
      `<b>${U.pad(hh, 2)}:${U.pad(mm, 2)}</b> local · QNH <b>${wx.qnh}</b> hPa · Wind <b>${U.pad(wx.windDir, 3)}°/${wx.windSpeedKt} kt</b><br>` +
      `${near.a.id} ${(near.d * U.M2NM).toFixed(1)} NM · ${MAIN.timeScale !== 1 ? '<b style="color:#fc6">SIM ×' + MAIN.timeScale + '</b> · ' : ''}${Math.round(fps)} fps<br>` +
      `<span class="dim">F1 keys · I instructor · Esc menu · hover = explain</span>`;
  }

  function updateInstructorPanel(force) {
    const box = $('instr');
    const L = SIM.instructor, ls = L.lesson;
    if (!ls || !UI.instructorOn) { box.style.display = 'none'; return; }
    box.style.display = 'block';
    // move out of the way when the pilot looks at the right console
    box.classList.toggle('left', SIM.input.head.yaw < -25 && SIM.input.view === 'cockpit');
    const key = ls.id + ':' + L.step + ':' + (L.doneT > 0 ? 1 : 0);
    if (!force && key === UI._ik) return;
    UI._ik = key;
    if (!ls.steps.length) { box.innerHTML = `<div class="ititle">${ls.title}</div><p>${ls.intro}</p>`; return; }
    const st = ls.steps[L.step];
    const list = ls.steps.map((s, i) => `<span class="dot ${i < L.step ? 'done' : i === L.step ? 'cur' : ''}"></span>`).join('');
    box.innerHTML = `<div class="ititle">${ls.title}</div>` +
      (L.step === 0 ? `<p class="intro">${ls.intro}</p>` : '') +
      `<div class="dots">${list}</div>` +
      `<div class="step ${L.doneT > 0 ? 'ok' : ''}"><b>Step ${L.step + 1}/${ls.steps.length}:</b> ${st.t}</div>` +
      (st.y ? `<div class="why"><b>Why:</b> ${st.y}</div>` : '') +
      `<div class="ibtns"><button onclick="SIM.instructor.back()">◀ Back</button><button onclick="SIM.instructor.skip()">Skip ▶</button><button onclick="SIM.ui.toggleInstructor()">Hide (I)</button></div>`;
  }

  function updateTooltip() {
    const tip = $('tip');
    const I = SIM.input;
    if (!MAIN.started || MAIN.paused || I.drag || I.mouseStick) { tip.style.display = 'none'; return; }
    const hit = MAIN.pick(I.mx, I.my);
    let id = null;
    if (hit && hit.panel) { const r = SIM.panel.hit(hit.panel, hit.cx, hit.cy); id = r && r.id; }
    else if (hit && hit.obj) id = hit.obj.userData.click.id;
    if (!id) {
      // HUD area?
      if (I.view === 'cockpit' && SIM.hud.enabled && Math.abs(I.head.yaw) < 8 && I.head.pitch > -10) {
        const dx = I.mx - innerWidth / 2, dy = I.my - innerHeight / 2;
        if (Math.abs(dx) < 70 && Math.abs(dy) < 50) id = 'hud';
      }
    }
    const info = id && SIM.info[id];
    if (!info) { tip.style.display = 'none'; I.canvas.style.cursor = 'default'; return; }
    I.canvas.style.cursor = 'pointer';
    tip.style.display = 'block';
    tip.innerHTML = `<div class="tt">${info.t}</div><div>${info.w}</div>` + (info.h ? `<div><b>How it works:</b> ${info.h}</div>` : '') +
      (info.y ? `<div><b>Why it matters:</b> ${info.y}</div>` : '') + (info.u ? `<div><b>Use:</b> ${info.u}</div>` : '');
    const x = I.mx + 18, y = I.my + 18;
    tip.style.left = Math.min(x, innerWidth - 400) + 'px';
    tip.style.top = Math.min(y, innerHeight - tip.offsetHeight - 10) + 'px';
  }

  function showCrash() {
    MAIN.crashShown = true;
    MAIN.paused = true;
    $('crashTitle').textContent = ac._ejected ? 'EJECTED' : 'CRASH';
    $('crashMsg').textContent = ac.crashed;
    $('crash').style.display = 'flex';
    UI.menuOpen = true;
  }

  UI.closeMenus = function () {
    ['menu', 'pause', 'crash', 'help', 'handbook'].forEach((k) => ($(k).style.display = 'none'));
    UI.menuOpen = false;
  };
  UI.togglePause = function () {
    if (!MAIN.started) return;
    if ($('help').style.display === 'flex' || $('handbook').style.display === 'flex') { $('help').style.display = 'none'; $('handbook').style.display = 'none'; if (!MAIN.paused) UI.menuOpen = false; return; }
    if (MAIN.crashShown) return;
    MAIN.paused = !MAIN.paused;
    $('pause').style.display = MAIN.paused ? 'flex' : 'none';
    UI.menuOpen = MAIN.paused;
  };
  UI.toggleHelp = function () { const h = $('help'); h.style.display = h.style.display === 'flex' ? 'none' : 'flex'; };
  UI.toggleInstructor = function () { UI.instructorOn = !UI.instructorOn; updateInstructorPanel(true); };
  UI.restart = function () { UI.closeMenus(); MAIN.begin(MAIN.startKey, MAIN.lesson); };
  UI.mainMenu = function () { UI.closeMenus(); MAIN.paused = true; $('menu').style.display = 'flex'; UI.menuOpen = true; SIM.music.setTheme('menu'); };
  UI.cycleMusic = function () {
    const modes = ['adaptive', 'calm', 'off'];
    const m = modes[(modes.indexOf(SIM.music.mode) + 1) % modes.length];
    SIM.music.setMode(m);
    if (m !== 'off') SIM.music.setTheme(MAIN.started && !$('menu').style.display.includes('flex') ? 'flight' : 'menu');
    const sel = $('sMusicMode'); if (sel) sel.value = m;
    UI.toast('Music: ' + { adaptive: 'adaptive soundtrack', calm: 'calm', off: 'off' }[m] + ' (U)');
  };
  UI.cycleTimeScale = function () {
    const opts = [1, 2, 4, 0.5];
    MAIN.timeScale = opts[(opts.indexOf(MAIN.timeScale) + 1) % opts.length];
    UI.toast(MAIN.timeScale === 1 ? 'Real time (1×)' : 'Simulation speed ×' + MAIN.timeScale + ' (K to change)');
  };
  UI.autoStart = function () {
    const s = ac.sys;
    Object.assign(s, { battery: true, fuelPump: true, engineMaster: true, generator: true, avionics: true, pitotHeat: true, navLights: true, strobe: true, seatArmed: true });
    if (!s.engineRunning) ac.action('start');
    s.qnhSet = SIM.weather.qnh;
    UI.toast('Auto start: switches set, starter engaged (≈30 s)');
  };
  UI.openHandbook = function () { $('handbook').style.display = 'flex'; UI.menuOpen = true; };

  function readMenuSettings() {
    const wx = SIM.weather;
    wx.windDir = +$('sWindDir').value; wx.windSpeedKt = +$('sWindSpd').value;
    wx.clouds = $('sClouds').value; wx.visibilityKm = +$('sVis').value;
    wx.qnh = +$('sQnh').value; wx.turbulence = +$('sTurb').value / 100;
    wx.tempOffset = +$('sTemp').value;
    wx.cloudBase = +$('sBase').value * U.FT2M;
    const tod = $('sTime').value;
    if (tod === 'real') { const d = new Date(); SIM.env.timeOfDay = d.getHours() + d.getMinutes() / 60; }
    else SIM.env.timeOfDay = +tod;
    const d = new Date(); SIM.env.dayOfYear = Math.floor((d - new Date(d.getFullYear(), 0, 0)) / 864e5);
    SIM.audio.callouts = $('sCallouts').checked;
    readAudioSettings();
    SIM.input.invertPitch = $('sInvert').checked;
    SIM.input.joyThrottleInvert = !$('sThrInv').checked;
    const q = $('sQuality').value;
    renderer.setPixelRatio(q === 'high' ? Math.min(devicePixelRatio, 2) : q === 'low' ? 0.75 : Math.min(devicePixelRatio, 1.25));
  }

  function readAudioSettings() {
    const A = SIM.audio;
    A.vol.master = +$('sVolMaster').value / 100;
    A.vol.sfx = +$('sVolSfx').value / 100;
    A.vol.music = +$('sVolMusic').value / 100;
    A.breathing = $('sBreath').checked;
    SIM.music.setMode($('sMusicMode').value);
    A.applyVolumes();
  }

  function buildMenu() {
    // audio settings apply live
    ['sVolMaster', 'sVolSfx', 'sVolMusic', 'sBreath', 'sMusicMode'].forEach((id) => $(id).addEventListener('input', () => {
      readAudioSettings();
      if (SIM.music.mode !== 'off' && !MAIN.started) SIM.music.setTheme('menu');
      if (SIM.music.mode === 'off') SIM.music.setTheme(null);
    }));
    // browsers only allow sound after the first click / key press
    const unlock = () => {
      SIM.audio.init(); readAudioSettings();
      if (!MAIN.started) SIM.music.setTheme('menu');
      removeEventListener('pointerdown', unlock); removeEventListener('keydown', unlock);
    };
    addEventListener('pointerdown', unlock); addEventListener('keydown', unlock);
    const ls = $('lessonList');
    SIM.lessons.forEach((l) => {
      const b = document.createElement('button');
      b.className = 'lesson';
      b.innerHTML = `<b>${l.title}</b><span>${START[l.start].name}</span>`;
      b.onclick = () => MAIN.begin(l.start, l);
      ls.appendChild(b);
    });
    const sl = $('startList');
    Object.keys(START).forEach((k) => {
      const b = document.createElement('button');
      b.className = 'lesson';
      b.innerHTML = `<b>${START[k].name}</b><span>${START[k].desc}</span>`;
      b.onclick = () => MAIN.begin(k, SIM.lessons[SIM.lessons.length - 1]);
      sl.appendChild(b);
    });
    // a realistic, slightly non-standard pressure so you have to set the altimeter
    $('sQnh').value = 1004 + Math.floor(Math.random() * 18);
  }

  window.addEventListener('load', () => {
    try { MAIN.boot(); }
    catch (e) { $('loading').textContent = 'Error starting the simulator: ' + e.message + ' — WebGL is required (use a current Chrome, Edge or Firefox).'; throw e; }
  });
})(window);
