/* ==========================================================================
 * input.js — keyboard, mouse, joystick/gamepad and the pilot's head (view)
 * ========================================================================== */
(function (root) {
  'use strict';
  const SIM = root.SIM = root.SIM || {};
  const U = SIM.util;
  const I = SIM.input = {
    keys: {}, mouseStick: false, mx: 0, my: 0, mouseX: 0.5, mouseY: 0.5,
    head: { yaw: 0, pitch: -3, tYaw: 0, tPitch: -3, fov: 75, tFov: 75 },
    view: 'cockpit', ext: { yaw: 200, pitch: 12, dist: 22 },
    stick: { pitch: 0, roll: 0, yaw: 0 }, padActive: false, invertPitch: false,
    joyThrottleInvert: true
  };

  // view presets: [yaw (+ = left), pitch (+ = up)]
  const VIEWS = {
    Digit1: [0, -3, 'Forward'], Digit2: [0, -27, 'Instrument panel'], Digit3: [70, -46, 'Left console'],
    Digit4: [-70, -46, 'Right console'], Digit5: [95, -12, 'Left wing'], Digit6: [-95, -12, 'Right wing'], Digit7: [165, 8, 'Look back']
  };

  I.init = function (canvas, ac) {
    I.canvas = canvas; I.ac = ac;
    window.addEventListener('keydown', (e) => onKey(e, true));
    window.addEventListener('keyup', (e) => onKey(e, false));
    window.addEventListener('blur', () => { I.keys = {}; });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mouseup', () => { I.drag = null; });
    window.addEventListener('mousemove', onMouseMove);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('gamepadconnected', (e) => SIM.ui && SIM.ui.toast('Controller connected: ' + e.gamepad.id.slice(0, 40)));
  };

  function onKey(e, down) {
    if (SIM.ui && SIM.ui.menuOpen && e.code !== 'Escape') { if (e.code === 'KeyU' && down && !e.repeat && e.target.tagName !== 'INPUT') SIM.ui.cycleMusic(); return; }
    const code = e.code;
    const was = I.keys[code];
    I.keys[code] = down;
    const ac = I.ac;
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'PageUp', 'PageDown', 'Tab', 'F1', 'Home', 'End'].includes(code)) e.preventDefault();
    if (!down || was) return; // only first press below
    const shift = e.shiftKey, ctrl = e.ctrlKey;
    switch (code) {
      case 'Escape': SIM.ui.togglePause(); break;
      case 'KeyG': ac.action('gear'); SIM.ui.toast('Gear lever ' + (ac.sys.gearLever ? 'DOWN' : 'UP')); break;
      case 'KeyF': ac.action(shift ? 'flapsUp' : 'flapsDown'); SIM.ui.toast('Flaps ' + ['UP', 'MID (25°)', 'DOWN (50°)'][Math.round(ac.sys.flapLever * 2)]); break;
      case 'KeyB': ac.action('airbrake'); SIM.ui.toast('Airbrake ' + (ac.sys.airbrakeSw ? 'OUT' : 'IN')); break;
      case 'KeyP': ac.action('parkingBrake'); SIM.ui.toast('Parking brake ' + (ac.sys.parkingBrake ? 'SET' : 'RELEASED')); break;
      case 'KeyL': ac.action('landingLight'); SIM.ui.toast('Landing light ' + (ac.sys.landingLight ? 'ON' : 'OFF')); break;
      case 'KeyN': ac.sys.navIndex += shift ? -1 : 1; SIM.nav.autoCourse(ac); SIM.ui.toast('NAV: ' + SIM.nav.selected(ac).name); break;
      case 'KeyH': SIM.hud.enabled = !SIM.hud.enabled; break;
      case 'KeyM': I.mouseStick = !I.mouseStick; SIM.ui.toast(I.mouseStick ? 'Mouse flying ON — move the mouse to fly, M to stop' : 'Mouse flying OFF'); break;
      case 'KeyQ': ac.action('flare'); break;
      case 'KeyI': SIM.ui.toggleInstructor(); break;
      case 'KeyE': if (ctrl) { e.preventDefault(); SIM.ui.autoStart(); } break;
      case 'KeyC': I.head.tYaw = 0; I.head.tPitch = -3; I.head.tFov = 75; break;
      case 'KeyT': {
        // transfer current stick pressure into trim
        const c = ac.controls; c.trim = U.clamp(c.trim + I.stick.pitch / 0.45, -1, 1);
        SIM.ui.toast('Trimmed'); break;
      }
      case 'KeyR': if (ctrl) { e.preventDefault(); SIM.ui.restart(); } break;
      case 'Digit0': case 'F2': I.view = I.view === 'cockpit' ? 'external' : 'cockpit'; SIM.ui.toast(I.view === 'cockpit' ? 'Cockpit view' : 'External view (0 to return)'); break;
      case 'F1': SIM.ui.toggleHelp(); break;
      case 'Home': ac.controls.throttle = 1; break;
      case 'End': ac.controls.throttle = 0; break;
      case 'KeyK': SIM.ui.cycleTimeScale(); break;
      case 'KeyU': SIM.ui.cycleMusic(); break;
      default:
        if (VIEWS[code]) {
          const v = VIEWS[code]; I.view = 'cockpit';
          I.head.tYaw = v[0]; I.head.tPitch = v[1];
          I.head.tFov = code === 'Digit2' ? 52 : code === 'Digit3' || code === 'Digit4' ? 60 : 75;
        }
    }
  }

  // ---------------- mouse: look (right-drag), click switches (left) ------
  function onMouseDown(e) {
    I.mouseX = e.clientX / innerWidth; I.mouseY = e.clientY / innerHeight;
    if (e.button === 2) { I.drag = { x: e.clientX, y: e.clientY }; return; }
    if (e.button === 1) { I.head.tYaw = 0; I.head.tPitch = -3; I.head.tFov = 75; e.preventDefault(); return; }
    if (e.button === 0) {
      const hit = SIM.main.pick(e.clientX, e.clientY);
      if (hit) {
        if (hit.panel) SIM.panel.click(I.ac, hit.panel, hit.cx, hit.cy, 'left', e.shiftKey);
        else if (hit.obj) SIM.main.clickObject(hit.obj);
      } else if (I.view === 'cockpit') {
        I.drag = { x: e.clientX, y: e.clientY }; // left-drag on empty sky also looks around
      }
    }
  }
  function onMouseMove(e) {
    I.mouseX = e.clientX / innerWidth; I.mouseY = e.clientY / innerHeight;
    I.mx = e.clientX; I.my = e.clientY;
    if (I.drag) {
      const dx = e.clientX - I.drag.x, dy = e.clientY - I.drag.y;
      I.drag.x = e.clientX; I.drag.y = e.clientY;
      const k = I.head.fov / 72 * 0.22;
      if (I.view === 'cockpit') {
        I.head.tYaw = U.clamp(I.head.tYaw + dx * k, -170, 170);
        I.head.tPitch = U.clamp(I.head.tPitch - dy * k, -75, 85);
        I.head.yaw = I.head.tYaw; I.head.pitch = I.head.tPitch;
      } else {
        I.ext.yaw -= dx * 0.3; I.ext.pitch = U.clamp(I.ext.pitch + dy * 0.3, -80, 85);
      }
    }
  }
  function onWheel(e) {
    e.preventDefault();
    const dir = e.deltaY < 0 ? 1 : -1;
    if (I.view === 'external') { I.ext.dist = U.clamp(I.ext.dist * (dir > 0 ? 0.9 : 1.1), 8, 400); return; }
    const hit = SIM.main.pick(e.clientX, e.clientY);
    if (hit && hit.panel) {
      const r = SIM.panel.hit(hit.panel, hit.cx, hit.cy);
      if (r && r.act && ['baro', 'hdgKnob', 'crsKnob'].includes(r.id)) { SIM.panel.click(I.ac, hit.panel, hit.cx, hit.cy, dir > 0 ? 'wheelUp' : 'wheelDown'); return; }
    }
    I.head.tFov = U.clamp(I.head.tFov * (dir > 0 ? 0.88 : 1.12), 22, 100);
  }

  // ---------------- per-frame update --------------------------------------
  const rate = (cur, target, dt, up, back) => U.moveToward(cur, target, (target === 0 || Math.sign(target) !== Math.sign(cur) ? back : up) * dt, 1);

  I.update = function (dt) {
    const k = I.keys, ac = I.ac, c = ac.controls, st = I.stick;
    const shiftLook = k.ShiftLeft || k.ShiftRight;
    // keyboard look (Shift + arrows) and numpad
    if (shiftLook) {
      if (k.ArrowLeft) I.head.tYaw = U.clamp(I.head.tYaw + 90 * dt, -170, 170);
      if (k.ArrowRight) I.head.tYaw = U.clamp(I.head.tYaw - 90 * dt, -170, 170);
      if (k.ArrowUp) I.head.tPitch = U.clamp(I.head.tPitch + 70 * dt, -75, 85);
      if (k.ArrowDown) I.head.tPitch = U.clamp(I.head.tPitch - 70 * dt, -75, 85);
    }
    // keyboard flying: keys give a target deflection; the "stick" moves toward it
    let tp = 0, tr = 0, ty = 0;
    if (!shiftLook) {
      if (k.ArrowDown || k.KeyS) tp += 1;
      if (k.ArrowUp || k.KeyW) tp -= 1;
      if (k.ArrowLeft || k.KeyA) tr -= 1;
      if (k.ArrowRight || k.KeyD) tr += 1;
    }
    if (k.KeyZ) ty -= 1;
    if (k.KeyX) ty += 1;
    const fine = k.ControlLeft || k.ControlRight ? 0.35 : 1;
    st.pitch = rate(st.pitch, tp * fine, dt, 1.6, 3.0);
    st.roll = rate(st.roll, tr * fine, dt, 2.2, 3.5);
    st.yaw = rate(st.yaw, ty, dt, 2.0, 3.0);
    let pitch = st.pitch, roll = st.roll, yaw = st.yaw;
    // mouse stick
    if (I.mouseStick && !I.drag) {
      const dzf = (v) => (Math.abs(v) < 0.03 ? 0 : (v - Math.sign(v) * 0.03) / 0.97);
      pitch = U.clamp(dzf((I.mouseY - 0.5) * 2.4), -1, 1);
      roll = U.clamp(dzf((I.mouseX - 0.5) * 2.4), -1, 1);
    }
    // gamepad / joystick
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const gp of pads) {
      if (!gp || !gp.connected) continue;
      const dz = (v) => (Math.abs(v) < 0.08 ? 0 : (v - Math.sign(v) * 0.08) / 0.92);
      const ax = gp.axes;
      const curve = (v) => Math.sign(v) * Math.pow(Math.abs(v), 1.6); // finer control near centre
      const pr = curve(dz(ax[0] || 0)), pp = curve(dz(ax[1] || 0)) * (I.invertPitch ? -1 : 1);
      if (Math.abs(pr) + Math.abs(pp) > 0 || I.padActive) { roll = pr; pitch = pp; I.padActive = true; }
      if (gp.mapping === 'standard') {
        // Xbox / PlayStation style: triggers = throttle down/up, bumpers = rudder, right stick = look
        const lt = gp.buttons[6] ? gp.buttons[6].value : 0, rt = gp.buttons[7] ? gp.buttons[7].value : 0;
        c.throttle = U.clamp(c.throttle + (rt - lt) * 0.5 * dt, 0, 1);
        const lb = gp.buttons[4] && gp.buttons[4].pressed, rb = gp.buttons[5] && gp.buttons[5].pressed;
        if (lb || rb) yaw = (rb ? 1 : 0) - (lb ? 1 : 0);
        const lx = dz(ax[2] || 0), ly = dz(ax[3] || 0);
        I.head.tYaw = U.clamp(I.head.tYaw - lx * 120 * dt, -170, 170);
        I.head.tPitch = U.clamp(I.head.tPitch - ly * 90 * dt, -75, 85);
        I._padBtns = I._padBtns || {};
        const press = (i, fn) => { const p = gp.buttons[i] && gp.buttons[i].pressed; if (p && !I._padBtns[i]) fn(); I._padBtns[i] = p; };
        press(1, () => ac.action('gear'));
        press(2, () => ac.action('flapsDown'));
        press(3, () => ac.action('flapsUp'));
        press(8, () => { I.view = I.view === 'cockpit' ? 'external' : 'cockpit'; });
        press(9, () => SIM.ui.togglePause());
        press(12, () => { c.trim = U.clamp(c.trim - 0.05, -1, 1); });
        press(13, () => { c.trim = U.clamp(c.trim + 0.05, -1, 1); });
        press(14, () => ac.action('airbrake'));
        if (gp.buttons[0] && gp.buttons[0].pressed) { c.brakeL = c.brakeR = 1; I._padBrake = true; } else I._padBrake = false;
      } else {
        // flight stick / HOTAS: axis 2 throttle, axis 5 or 3 = twist rudder
        if (ax.length > 2 && Math.abs(ax[2]) > 0.001) {
          const v = (ax[2] + 1) / 2;
          c.throttle = U.clamp(I.joyThrottleInvert ? 1 - v : v, 0, 1);
        }
        const rz = ax.length > 5 ? ax[5] : ax.length > 3 ? ax[3] : 0;
        if (Math.abs(dz(rz)) > 0) yaw = dz(rz);
        I._padBrake = gp.buttons[0] && gp.buttons[0].pressed;
        if (I._padBrake) c.brakeL = c.brakeR = 1;
      }
    }
    c.pitch = U.clamp(pitch, -1, 1);
    c.roll = U.clamp(roll, -1, 1);
    c.yaw = U.clamp(yaw, -1, 1);
    // throttle keys
    if (k.PageUp || k.Equal || k.NumpadAdd) c.throttle = U.clamp(c.throttle + 0.45 * dt, 0, 1);
    if (k.PageDown || k.Minus || k.NumpadSubtract) c.throttle = U.clamp(c.throttle - 0.45 * dt, 0, 1);
    // trim
    if (k.BracketLeft) c.trim = U.clamp(c.trim - 0.25 * dt, -1, 1);
    if (k.BracketRight) c.trim = U.clamp(c.trim + 0.25 * dt, -1, 1);
    // brakes (Space = both; comma/period = left/right differential)
    if (!I._padBrake) {
      const b = k.Space ? 1 : 0;
      c.brakeL = Math.max(b, k.Comma ? 1 : 0);
      c.brakeR = Math.max(b, k.Period ? 1 : 0);
    }
    // head smoothing
    const h = I.head;
    h.yaw = U.approach(h.yaw, h.tYaw, 0.12, dt);
    h.pitch = U.approach(h.pitch, h.tPitch, 0.12, dt);
    h.fov = U.approach(h.fov, h.tFov, 0.1, dt);
  };
})(typeof window !== 'undefined' ? window : globalThis);
