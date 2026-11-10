/* ==========================================================================
 * model.js — the aircraft's 3D model: cockpit interior + exterior airframe
 *
 * All coordinates are aircraft body axes in metres, origin at the centre of
 * gravity: +X right wing, +Y up, -Z toward the nose. The pilot's eye sits
 * 2.75 m ahead of the CG, about 1 m above the fuselage centreline.
 * ========================================================================== */
(function (root) {
  'use strict';
  const SIM = root.SIM = root.SIM || {};
  const U = SIM.util;
  const M = SIM.model = {};

  const EYE = SIM.acData.eye;
  // Panel placement (front instrument panel)
  M.PANEL = { cx: 0, cy: 0.615, cz: -3.50, w: 0.86, h: 0.43, tilt: -0.34 };
  M.LCON = { cx: -0.475, cy: 0.52, cz: -2.86, w: 0.22, l: 0.74, tilt: 0.22 };
  M.RCON = { cx: 0.475, cy: 0.52, cz: -2.86, w: 0.22, l: 0.74, tilt: -0.22 };
  M.HUD = { dist: 8, hFov: 22, vFov: 19, center: -1.5 }; // degrees

  function mat(color, opts) { return new THREE.MeshLambertMaterial(Object.assign({ color }, opts || {})); }

  function tube(points, r, material) {
    const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(p[0], p[1], p[2])));
    return new THREE.Mesh(new THREE.TubeGeometry(curve, 24, r, 6, false), material);
  }

  // ------------------------------------------------------------------------
  // EXTERIOR airframe (also used for parked aircraft and the chase view)
  // ------------------------------------------------------------------------
  function decalTexture(text, roundel) {
    const c = document.createElement('canvas'); c.width = 256; c.height = 128;
    const g = c.getContext('2d');
    g.clearRect(0, 0, 256, 128);
    if (roundel) {
      g.fillStyle = '#3d4650'; g.beginPath(); g.arc(128, 64, 60, 0, 7); g.fill();
      g.fillStyle = '#8c949c'; g.beginPath(); g.arc(128, 64, 40, 0, 7); g.fill();
      g.fillStyle = '#3d4650'; g.beginPath(); g.arc(128, 64, 18, 0, 7); g.fill();
    } else {
      g.fillStyle = '#2c333a'; g.font = 'bold 74px Arial'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(text, 128, 66);
    }
    return new THREE.CanvasTexture(c);
  }

  function buildExterior(parked) {
    const g = new THREE.Group();
    const paint = mat(0x9ea4a8), paintDark = mat(0x6d757b), black = mat(0x1d1f21), metal = mat(0x777b80);
    const parts = {};
    // fuselage: lathe profile (radius vs z)
    const prof = [[0, -6.7], [0.18, -6.4], [0.38, -5.8], [0.55, -4.9], [0.66, -3.9], [0.74, -2.6], [0.78, -1.0], [0.76, 1.0], [0.68, 3.0], [0.5, 4.8], [0.38, 5.7], [0.36, 5.9]];
    const lathe = new THREE.LatheGeometry(prof.map(([r, z]) => new THREE.Vector2(r, z)), 20);
    lathe.rotateX(Math.PI / 2); // lathe axis Y -> Z
    lathe.scale(0.9, 1, 1);
    // LatheGeometry after rotateX: y->z, so profile z along +Z? rotateX(+90°) maps +Y to +Z: OK.
    // fuselage material with the cockpit opening cut out (discard fragments inside the tub)
    const fusMat = mat(0x9ea4a8);
    fusMat.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vLocalP;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvLocalP = position;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vLocalP;')
        .replace('void main() {', 'void main() {\n if (abs(vLocalP.x) < 0.61 && vLocalP.y > 0.0 && vLocalP.z > -3.66 && vLocalP.z < -0.45) discard;');
    };
    const fus = new THREE.Mesh(lathe, fusMat);
    g.add(fus);
    // dorsal spine & canopy fairing
    const spine = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.35, 4.6), paint); spine.position.set(0, 0.62, 2.1); g.add(spine);
    // anti-glare panel ahead of the windscreen
    const ag = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.05, 1.2), mat(0x2a2d30)); ag.position.set(0, 0.70, -4.25); ag.rotation.x = 0.12; g.add(ag);
    // nose radome tip
    // intakes
    [-1, 1].forEach((s) => {
      const intake = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.62, 2.6), paint);
      intake.position.set(s * 0.78, -0.02, -0.7); g.add(intake);
      const lip = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.58, 0.05), black);
      lip.position.set(s * 0.78, -0.02, -2.01); g.add(lip);
    });
    // wings (low wing, swept leading edge)
    const wingShape = new THREE.Shape();
    wingShape.moveTo(0.6, -1.7); wingShape.lineTo(4.7, 0.35); wingShape.lineTo(4.7, 1.35); wingShape.lineTo(0.6, 1.35); wingShape.lineTo(0.6, -1.7);
    const wingGeoR = new THREE.ExtrudeGeometry(wingShape, { depth: 0.14, bevelEnabled: true, bevelThickness: 0.04, bevelSize: 0.04, bevelSegments: 1 });
    wingGeoR.rotateX(Math.PI / 2); // shape XY -> XZ
    const wingR = new THREE.Mesh(wingGeoR, paint); wingR.position.y = -0.28; g.add(wingR);
    const wingL = wingR.clone(); wingL.scale.x = -1; g.add(wingL);
    // wing roundels
    [-1, 1].forEach((s) => {
      const d = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.6), new THREE.MeshLambertMaterial({ map: decalTexture('', true), transparent: true, depthWrite: false }));
      d.rotation.x = -Math.PI / 2; d.position.set(s * 3.2, -0.26 + 0.07 + 0.001, 0.6); d.scale.set(1, 2, 1); g.add(d);
    });
    // ailerons & flaps (animated)
    const ail = new THREE.BoxGeometry(1.3, 0.06, 0.38).translate(0, 0, 0.19);
    parts.ailL = new THREE.Mesh(ail, paintDark); parts.ailL.position.set(-3.9, -0.21, 1.35); g.add(parts.ailL);
    parts.ailR = new THREE.Mesh(ail, paintDark); parts.ailR.position.set(3.9, -0.21, 1.35); g.add(parts.ailR);
    const flp = new THREE.BoxGeometry(2.4, 0.06, 0.45).translate(0, 0, 0.22);
    parts.flapL = new THREE.Mesh(flp, paintDark); parts.flapL.position.set(-1.95, -0.22, 1.35); g.add(parts.flapL);
    parts.flapR = new THREE.Mesh(flp, paintDark); parts.flapR.position.set(1.95, -0.22, 1.35); g.add(parts.flapR);
    // tail
    const finShape = new THREE.Shape();
    finShape.moveTo(0, 0); finShape.lineTo(2.4, 0); finShape.lineTo(2.5, 2.0); finShape.lineTo(1.6, 2.0); finShape.lineTo(0, 0);
    const finGeo = new THREE.ExtrudeGeometry(finShape, { depth: 0.12, bevelEnabled: false });
    finGeo.rotateY(-Math.PI / 2); // shape x -> -z ... adjust below
    const fin = new THREE.Mesh(finGeo, paint); fin.position.set(0.06, 0.55, 3.0); g.add(fin);
    const tailNo = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 0.7), new THREE.MeshLambertMaterial({ map: decalTexture('207'), transparent: true, depthWrite: false }));
    tailNo.position.set(0.075, 1.4, 4.3); tailNo.rotation.y = Math.PI / 2; g.add(tailNo);
    const tailNo2 = tailNo.clone(); tailNo2.position.x = -0.075; tailNo2.rotation.y = -Math.PI / 2; g.add(tailNo2);
    parts.rudder = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.6, 0.5).translate(0, 0.8, 0.25), paintDark);
    parts.rudder.position.set(0, 0.75, 5.45); g.add(parts.rudder);
    const tpShape = new THREE.Shape();
    tpShape.moveTo(0.3, -0.6); tpShape.lineTo(2.2, 0.4); tpShape.lineTo(2.2, 0.9); tpShape.lineTo(0.3, 0.9); tpShape.lineTo(0.3, -0.6);
    const tpGeo = new THREE.ExtrudeGeometry(tpShape, { depth: 0.08, bevelEnabled: false }); tpGeo.rotateX(Math.PI / 2);
    parts.stabR = new THREE.Mesh(tpGeo, paint); parts.stabR.position.set(0, 0.25, 4.5); g.add(parts.stabR);
    parts.stabL = parts.stabR.clone(); parts.stabL.scale.x = -1; g.add(parts.stabL);
    // airbrake (belly, aft)
    parts.airbrake = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.05, 1.0).translate(0, 0, -0.5), paintDark);
    parts.airbrake.position.set(0, -0.62, 2.9); g.add(parts.airbrake);
    // exhaust
    const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(0.33, 0.36, 0.4, 16, 1, true), black);
    nozzle.rotation.x = Math.PI / 2; nozzle.position.set(0, 0, 5.95); g.add(nozzle);
    parts.flame = new THREE.Mesh(new THREE.ConeGeometry(0.28, 1.4, 12, 1, true), new THREE.MeshBasicMaterial({ color: 0xffa040, transparent: true, opacity: 0.0, blending: THREE.AdditiveBlending, depthWrite: false }));
    parts.flame.rotation.x = -Math.PI / 2; parts.flame.position.set(0, 0, 6.8); g.add(parts.flame);
    // landing gear (legs + wheels)
    parts.gear = [];
    SIM.acData.gear.forEach((gd, i) => {
      const leg = new THREE.Group();
      leg.position.set(gd.x, -0.35, gd.z);
      const strut = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.0, 8).translate(0, -0.5, 0), metal);
      leg.add(strut);
      const wheel = new THREE.Mesh(new THREE.CylinderGeometry(i === 0 ? 0.22 : 0.3, i === 0 ? 0.22 : 0.3, i === 0 ? 0.14 : 0.18, 14), black);
      wheel.rotation.z = Math.PI / 2; wheel.position.set(0, -0.95 - 0.25 + (i === 0 ? 0.03 : 0), 0);
      leg.add(wheel);
      leg.userData.side = gd.x === 0 ? 0 : Math.sign(gd.x);
      g.add(leg); parts.gear.push(leg);
    });
    // lights: nav (red left, green right), strobe, landing light
    const navMat = (c) => new THREE.MeshBasicMaterial({ color: c });
    parts.navL = new THREE.Mesh(new THREE.SphereGeometry(0.06, 6, 4), navMat(0xff2020)); parts.navL.position.set(-4.75, -0.2, 0.6); g.add(parts.navL);
    parts.navR = new THREE.Mesh(new THREE.SphereGeometry(0.06, 6, 4), navMat(0x20ff40)); parts.navR.position.set(4.75, -0.2, 0.6); g.add(parts.navR);
    parts.strobe = new THREE.Mesh(new THREE.SphereGeometry(0.08, 6, 4), navMat(0xffffff)); parts.strobe.position.set(0, 2.6, 4.9); g.add(parts.strobe);
    // canopy (exterior glass)
    {
      const can = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshLambertMaterial({ color: 0x223040, transparent: true, opacity: 0.75 }));
      can.scale.set(0.6, 0.45, 2.0); can.position.set(0, 0.86, -2.0); g.add(can);
      parts.canopy = can;
    }
    g.userData.parts = parts;
    return g;
  }
  M.buildExterior = buildExterior;
  M.parkedAircraft = function () {
    if (!M._parkedProto) M._parkedProto = buildExterior(true);
    return M._parkedProto.clone();
  };

  // ------------------------------------------------------------------------
  // COCKPIT interior
  // ------------------------------------------------------------------------
  function buildCockpit() {
    const g = new THREE.Group();
    const tub = mat(0x3b3f43), tubDark = mat(0x26292c), frame = mat(0x4a4f54), black = mat(0x151617);
    const clickables = [];
    // floor & side walls
    const floor = new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.04, 2.2), tubDark); floor.position.set(0, 0.06, -2.6); g.add(floor);
    [-1, 1].forEach((s) => {
      const wall = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.72, 2.3), tub); wall.position.set(s * 0.6, 0.42, -2.55); g.add(wall);
      const sill = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.04, 2.3), frame); sill.position.set(s * 0.58, 0.785, -2.55); g.add(sill);
      // console bodies under the console faces
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.42, 0.78), tub); body.position.set(s * 0.475, 0.29, -2.86); g.add(body);
    });
    // panel body (behind the instrument face)
    const P = M.PANEL;
    const pbody = new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.6, 0.35), tubDark); pbody.position.set(0, 0.5, -3.75); g.add(pbody);
    // glareshield (hood over the panel)
    const gs = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.05, 0.36), black); gs.position.set(0, 0.835, -3.53); gs.rotation.x = 0.08; g.add(gs);
    const gsLip = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 1.0, 8), black); gsLip.rotation.z = Math.PI / 2; gsLip.position.set(0, 0.84, -3.36); g.add(gsLip);
    // HUD unit + combiner glass
    const hudBox = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.08, 0.2), black); hudBox.position.set(0, 0.88, -3.5); g.add(hudBox);
    const comb = new THREE.Mesh(new THREE.PlaneGeometry(0.27, 0.23), new THREE.MeshBasicMaterial({ color: 0x88ffaa, transparent: true, opacity: 0.06, depthWrite: false, side: THREE.DoubleSide }));
    comb.position.set(0, 1.0, -3.47); comb.rotation.x = -0.15; g.add(comb);
    const combFrame = tube([[-0.14, 0.9, -3.46], [-0.14, 1.12, -3.49], [0.14, 1.12, -3.49], [0.14, 0.9, -3.46]], 0.006, black);
    g.add(combFrame);
    // canopy frame: windscreen arch, side rails, mid & rear arches
    const arch = (z, y0, top, w) => tube([[-w, y0 - 0.08, z], [-w * 0.92, (y0 + top) / 2 + 0.07, z], [0, top, z], [w * 0.92, (y0 + top) / 2 + 0.07, z], [w, y0 - 0.08, z]], 0.017, frame);
    // windscreen: posts from the glareshield corners up to the canopy bow
    [-1, 1].forEach((s) => {
      g.add(tube([[s * 0.5, 0.86, -3.62], [s * 0.47, 1.05, -3.3], [s * 0.43, 1.2, -3.08]], 0.016, frame));
      g.add(tube([[s * 0.59, 0.80, -3.3], [s * 0.6, 0.81, -0.4]], 0.018, frame));
    });
    g.add(tube([[-0.5, 0.86, -3.62], [0, 0.85, -3.68], [0.5, 0.86, -3.62]], 0.016, frame));
    g.add(arch(-3.08, 0.88, 1.31, 0.58));   // windscreen bow
    g.add(arch(-1.75, 0.88, 1.34, 0.6));    // mid arch (behind your head)
    g.add(arch(-0.45, 0.88, 1.2, 0.6));     // rear
    // canopy glass (very faint, for a sense of being enclosed)
    const glassMat = new THREE.MeshBasicMaterial({ color: 0x9ab8d0, transparent: true, opacity: 0.045, depthWrite: false, side: THREE.DoubleSide });
    const glass = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, 3.2, 20, 1, true, -Math.PI / 2, Math.PI), glassMat);
    glass.rotation.x = Math.PI / 2; glass.scale.set(1, 1, 0.62); glass.position.set(0, 0.88, -1.95); g.add(glass);
    // seat + headrest + ejection handle
    const seat = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.9, 0.12), black); seat.position.set(0, 0.6, -2.38); g.add(seat);
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.3, 0.16), mat(0x31363a)); head.position.set(0, 1.12, -2.42); g.add(head);
    const pan = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.1, 0.5), black); pan.position.set(0, 0.3, -2.62); g.add(pan);
    const ejectTex = (() => { const c = document.createElement('canvas'); c.width = 64; c.height = 8; const x = c.getContext('2d'); for (let i = 0; i < 8; i++) { x.fillStyle = i % 2 ? '#111' : '#f0c020'; x.fillRect(i * 8, 0, 8, 8); } return new THREE.CanvasTexture(c); })();
    const eject = new THREE.Mesh(new THREE.TorusGeometry(0.07, 0.014, 6, 16, Math.PI), new THREE.MeshLambertMaterial({ map: ejectTex }));
    eject.position.set(0, 0.36, -2.88); eject.rotation.x = -0.4;
    eject.userData.click = { id: 'eject' };
    g.add(eject); clickables.push(eject);
    // seat safety pin lever (arming)
    const seatPin = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.08, 0.03), mat(0xd02020)); seatPin.position.set(0.2, 0.42, -2.86);
    seatPin.userData.click = { id: 'seatArmed' }; g.add(seatPin); clickables.push(seatPin);
    // instrument panel face (canvas texture from panel.js)
    const face = new THREE.Mesh(new THREE.PlaneGeometry(P.w, P.h), new THREE.MeshBasicMaterial({ map: SIM.panel.tex.front }));
    face.position.set(P.cx, P.cy, P.cz); face.rotation.x = P.tilt;
    face.userData.panel = 'front'; g.add(face); clickables.push(face);
    // side consoles
    [['left', M.LCON], ['right', M.RCON]].forEach(([name, C]) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(C.w, C.l), new THREE.MeshBasicMaterial({ map: SIM.panel.tex[name] }));
      m.rotation.order = 'ZXY';
      m.rotation.x = -Math.PI / 2; m.rotation.z = 0; m.rotation.y = 0;
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));
      const tiltQ = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), C.tilt);
      m.quaternion.copy(tiltQ.multiply(q));
      m.position.set(C.cx, C.cy, C.cz);
      m.userData.panel = name; g.add(m); clickables.push(m);
    });
    // control stick
    const stick = new THREE.Group(); stick.position.set(0, 0.16, -3.02);
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.018, 0.42, 8).translate(0, 0.21, 0), mat(0x222222)); stick.add(shaft);
    const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.025, 0.13, 10).translate(0, 0.48, 0), mat(0x2d2d2d)); grip.rotation.x = 0.15; stick.add(grip);
    const trigger = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.03, 0.02), mat(0x111111)); trigger.position.set(0, 0.47, -0.035); stick.add(trigger);
    const hat = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 0.01, 6), mat(0x444444)); hat.position.set(0, 0.55, 0.0); stick.add(hat);
    const boot = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.09, 0.12, 10), black); boot.position.set(0, 0.16, -3.02);
    g.add(boot); g.add(stick);
    // throttle lever on left console
    const thr = new THREE.Group(); thr.position.set(-0.43, 0.46, -2.78);
    const tarm = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.2, 0.02).translate(0, 0.1, 0), mat(0x333333)); thr.add(tarm);
    const tgrip = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.07, 0.09), mat(0x2a2a2a)); tgrip.position.set(-0.01, 0.21, 0); thr.add(tgrip);
    g.add(thr);
    // rudder pedals (seen if you look down into the footwell)
    const pedals = [];
    [-1, 1].forEach((s) => {
      const p = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.16, 0.03), mat(0x303336)); p.position.set(s * 0.17, 0.16, -3.6); p.rotation.x = -0.4;
      g.add(p); pedals.push(p);
    });
    g.userData = { stick, thr, pedals, clickables };
    return g;
  }

  // ------------------------------------------------------------------------
  // HUD plane: placed 8 m ahead of the eye in the aircraft frame so its
  // symbols overlay the outside world correctly (as a collimated HUD does).
  // ------------------------------------------------------------------------
  function buildHUD() {
    const H = M.HUD;
    const w = 2 * H.dist * Math.tan(H.hFov / 2 * U.DEG);
    const h = 2 * H.dist * Math.tan(H.vFov / 2 * U.DEG);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({
      map: SIM.hud.tex, transparent: true, depthWrite: false
    }));
    m.position.set(EYE.x, EYE.y + Math.tan(H.center * U.DEG) * H.dist, EYE.z - H.dist);
    m.renderOrder = 20;
    return m;
  }

  M.init = function (scene) {
    M.root = new THREE.Group();       // follows aircraft position/orientation
    scene.add(M.root);
    M.exterior = buildExterior(false);
    M.root.add(M.exterior);
    M.cockpit = buildCockpit();
    M.root.add(M.cockpit);
    M.hudMesh = buildHUD();
    M.root.add(M.hudMesh);
    M.clickables = M.cockpit.userData.clickables;
    // landing light: a real spotlight that lights the runway at night
    M.landingLight = new THREE.SpotLight(0xfff4e0, 0, 900, 0.32, 0.5, 1.2);
    M.landingLight.position.set(0, -0.6, -3.5);
    M.landingLight.target.position.set(0, -12, -80);
    M.root.add(M.landingLight); M.root.add(M.landingLight.target);
    // cockpit flood light so the panel is visible at night
    M.flood = new THREE.PointLight(0xffd9a0, 0, 2.5);
    M.flood.position.set(0, 1.35, -2.2);
    M.root.add(M.flood);
  };

  M.update = function (ac, viewMode, time) {
    M.root.position.copy(ac.pos);
    M.root.quaternion.copy(ac.quat);
    const p = M.exterior.userData.parts, s = ac.sys, c = ac.controls;
    // control surfaces follow the stick
    p.ailL.rotation.x = c.roll * 0.35; p.ailR.rotation.x = -c.roll * 0.35;
    p.stabL.rotation.x = p.stabR.rotation.x = -(c.pitch + c.trim * 0.45) * 0.2;
    p.rudder.rotation.y = -c.yaw * 0.4;
    p.flapL.rotation.x = p.flapR.rotation.x = s.flapPos * 0.85;
    p.airbrake.rotation.x = -s.airbrakePos * 0.9;
    // gear legs fold into the wings / nose
    p.gear.forEach((leg, i) => {
      const t = s.gearPos;
      leg.visible = t > 0.02;
      if (i === 0) leg.rotation.x = -(1 - t) * Math.PI / 2;
      else leg.rotation.z = leg.userData.side * (1 - t) * Math.PI / 2;
      const comp = ac.gearCompression[i] || 0;
      leg.children[1].position.y = -1.2 + Math.min(comp, 0.25) + (i === 0 ? 0.03 : 0);
    });
    // engine glow
    p.flame.material.opacity = s.engineRunning ? U.clamp((s.n1 - 85) / 15, 0, 1) * 0.5 : 0;
    p.flame.scale.set(1, 0.6 + (s.n1 / 100), 1);
    // lights
    p.navL.visible = p.navR.visible = s.navLights && s.powered;
    p.strobe.visible = s.strobe && s.powered && (time % 1.2) < 0.08;
    M.landingLight.intensity = s.landingLight && s.powered && s.gearPos > 0.9 ? 0.15 + 3.0 * SIM.env.night : 0;
    M.flood.intensity = s.powered ? SIM.env.night * 0.7 : 0;
    // cockpit visibility
    const inside = viewMode === 'cockpit';
    M.cockpit.visible = inside;
    M.hudMesh.visible = inside && s.avionicsPowered && SIM.hud.enabled;
    // stick & throttle animation
    const u = M.cockpit.userData;
    u.stick.rotation.x = c.pitch * 0.26;
    u.stick.rotation.z = -c.roll * 0.26;
    u.thr.rotation.x = 0.35 - c.throttle * 0.75;
    u.pedals[0].position.z = -3.55 + c.yaw * 0.05;
    u.pedals[1].position.z = -3.55 - c.yaw * 0.05;
  };
})(typeof window !== 'undefined' ? window : globalThis);
