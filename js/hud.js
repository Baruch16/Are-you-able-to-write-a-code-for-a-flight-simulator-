/* ==========================================================================
 * hud.js — Head-Up Display symbology (military style)
 *
 * The HUD image is drawn on a canvas that is placed in the aircraft frame
 * 8 m in front of the pilot's eye, so every symbol lines up with the real
 * world (a "conformal" HUD): the horizon line sits on the real horizon, the
 * flight path marker sits on the point the aircraft is actually flying to.
 * ========================================================================== */
(function (root) {
  'use strict';
  const SIM = root.SIM = root.SIM || {};
  const U = SIM.util;
  const H = SIM.hud = { enabled: true };
  const GREEN = '#5dff7a';
  let W, Ht;

  H.init = function () {
    const hf = SIM.model ? null : null; void hf;
    W = 1024; Ht = Math.round(1024 * Math.tan(9.5 * U.DEG) / Math.tan(11 * U.DEG));
    H.canvas = document.createElement('canvas'); H.canvas.width = W; H.canvas.height = Ht;
    H.tex = new THREE.CanvasTexture(H.canvas);
    H.tex.minFilter = THREE.LinearFilter;
  };

  // angle (deg, relative to the aircraft's boresight) -> canvas pixel
  function px(azDeg, elDeg) {
    const cfg = SIM.model.HUD;
    const tx = Math.tan(azDeg * U.DEG) / Math.tan(cfg.hFov / 2 * U.DEG);
    const ty = (Math.tan(elDeg * U.DEG) - Math.tan(cfg.center * U.DEG)) / Math.tan(cfg.vFov / 2 * U.DEG);
    return [W / 2 + tx * W / 2, Ht / 2 - ty * Ht / 2];
  }
  H.px = px;

  function t(g, s, x, y, size, align) {
    g.font = 'bold ' + size + 'px "Courier New", monospace';
    g.textAlign = align || 'center'; g.textBaseline = 'middle';
    g.fillText(s, x, y);
  }

  const tmpV = new THREE.Vector3(), tmpQ = new THREE.Quaternion();

  H.draw = function (ac, time) {
    const g = H.canvas.getContext('2d');
    g.clearRect(0, 0, W, Ht);
    if (!H.enabled || !ac.sys.avionicsPowered) { H.tex.needsUpdate = true; return; }
    const o = ac.out, s = ac.sys, nv = SIM.nav.out;
    g.strokeStyle = GREEN; g.fillStyle = GREEN; g.lineWidth = 2.5;
    g.shadowColor = 'rgba(0,40,0,0.9)'; g.shadowBlur = 3;
    const ppd = (W / 2) / 11; // approx px per degree near the centre

    // --- boresight / waterline symbol
    const [bx, by] = px(0, 0);
    g.beginPath(); g.moveTo(bx - 34, by); g.lineTo(bx - 16, by); g.lineTo(bx - 8, by + 10); g.lineTo(bx, by); g.lineTo(bx + 8, by + 10); g.lineTo(bx + 16, by); g.lineTo(bx + 34, by); g.stroke();

    // --- flight path marker: where the aircraft is actually going
    tmpQ.copy(ac.quat).invert();
    tmpV.copy(ac.vel).applyQuaternion(tmpQ);
    let fpAz = 0, fpEl = 0;
    if (tmpV.length() > 8) { fpAz = Math.atan2(tmpV.x, -tmpV.z) * U.RAD; fpEl = Math.atan2(tmpV.y, -tmpV.z) * U.RAD; }
    fpAz = U.clamp(fpAz, -9, 9); fpEl = U.clamp(fpEl, -9, 7);
    const [fx, fy] = px(fpAz, fpEl);

    // --- pitch ladder (centred on the flight path marker, rotated by bank)
    g.save();
    g.beginPath(); g.rect(60, 60, W - 120, Ht - 120); g.clip();
    g.translate(fx, fy);
    g.rotate(-o.roll * U.DEG);
    const fpaOff = o.pitch + fpEl; // flight-path angle: ladder is referenced to the horizon
    for (let p = -90; p <= 90; p += 5) {
      const dy = -(p - fpaOff) * ppd;
      if (Math.abs(dy) > Ht) continue;
      g.lineWidth = 2.5;
      if (p === 0) {
        g.beginPath(); g.moveTo(-420, dy); g.lineTo(-60, dy); g.moveTo(60, dy); g.lineTo(420, dy); g.stroke();
        continue;
      }
      const w = 130, gap = 55;
      if (p < 0) g.setLineDash([14, 10]);
      g.beginPath();
      g.moveTo(-gap - w, dy + (p > 0 ? 12 : -12)); g.lineTo(-gap - w, dy); g.lineTo(-gap, dy);
      g.moveTo(gap, dy); g.lineTo(gap + w, dy); g.lineTo(gap + w, dy + (p > 0 ? 12 : -12));
      g.stroke(); g.setLineDash([]);
      t(g, String(Math.abs(p)), -gap - w - 26, dy, 20); t(g, String(Math.abs(p)), gap + w + 26, dy, 20);
    }
    // -3° glide-path reference line (put the FPM on it for a 3° approach)
    if (s.gearPos > 0.5) {
      const dy = -(-3 - fpaOff) * ppd;
      g.setLineDash([6, 8]); g.beginPath(); g.moveTo(-260, dy); g.lineTo(-90, dy); g.moveTo(90, dy); g.lineTo(260, dy); g.stroke(); g.setLineDash([]);
      t(g, '-3', 290, dy, 16);
    }
    g.restore();

    // FPM symbol
    g.lineWidth = 3;
    g.beginPath(); g.arc(fx, fy, 13, 0, 7); g.stroke();
    g.beginPath(); g.moveTo(fx - 13, fy); g.lineTo(fx - 34, fy); g.moveTo(fx + 13, fy); g.lineTo(fx + 34, fy); g.moveTo(fx, fy - 13); g.lineTo(fx, fy - 26); g.stroke();
    // AoA bracket on the FPM during approach: on-speed when FPM centred in the bracket
    if (s.gearPos > 0.9 && !ac.onGround) {
      const off = (o.aoa - 4.5) * 9;
      g.beginPath(); g.moveTo(fx - 52, fy - 22 + off); g.lineTo(fx - 58, fy - 22 + off); g.lineTo(fx - 58, fy + 22 + off); g.lineTo(fx - 52, fy + 22 + off); g.stroke();
    }

    // --- heading tape (top)
    const hy = 70;
    g.save(); g.beginPath(); g.rect(W / 2 - 230, hy - 40, 460, 80); g.clip();
    for (let d = Math.floor((o.heading - 30) / 5) * 5; d <= o.heading + 30; d += 5) {
      const xx = W / 2 + (d - o.heading) * 7.5;
      g.beginPath(); g.moveTo(xx, hy); g.lineTo(xx, hy + (d % 10 === 0 ? 16 : 8)); g.stroke();
      if (d % 10 === 0) t(g, U.pad(U.wrap360(d) / 10, 2), xx, hy - 14, 20);
    }
    // heading bug
    const hb = ((s.hdgBug - o.heading + 540) % 360) - 180;
    const hbx = W / 2 + U.clamp(hb, -30, 30) * 7.5;
    g.beginPath(); g.moveTo(hbx - 8, hy + 30); g.lineTo(hbx, hy + 20); g.lineTo(hbx + 8, hy + 30); g.stroke();
    g.restore();
    g.beginPath(); g.moveTo(W / 2, hy + 22); g.lineTo(W / 2 - 8, hy + 36); g.lineTo(W / 2 + 8, hy + 36); g.closePath(); g.stroke();

    // --- airspeed (left) and altitude (right) boxes
    const ly = Ht / 2;
    g.lineWidth = 2.5;
    g.strokeRect(120, ly - 22, 110, 44); t(g, String(Math.round(o.ias)), 175, ly, 30);
    t(g, 'M ' + o.mach.toFixed(2), 175, ly + 44, 20);
    t(g, 'G ' + o.g.toFixed(1), 175, ly + 74, 20);
    t(g, 'α ' + o.aoa.toFixed(1), 175, ly - 44, 20);
    g.strokeRect(W - 250, ly - 22, 140, 44);
    const altR = Math.round(o.altInd / 10) * 10;
    t(g, altR.toLocaleString('en-US'), W - 180, ly, 30);
    const raft = o.agl * U.M2FT;
    if (raft < 5000) t(g, 'R ' + String(Math.max(0, Math.round(raft / 10) * 10)).padStart(5, ' '), W - 180, ly + 44, 22);
    t(g, (o.vs >= 0 ? '+' : '') + Math.round(o.vs / 10) * 10, W - 180, ly - 44, 20);

    // --- bank scale (bottom)
    const bcx = W / 2, bcy = Ht - 150;
    [-45, -30, -20, -10, 0, 10, 20, 30, 45].forEach((b) => {
      const a = (b + 90) * U.DEG; const l = b % 30 === 0 ? 16 : 9;
      g.beginPath(); g.moveTo(bcx + Math.cos(a) * 90, bcy + Math.sin(a) * 90); g.lineTo(bcx + Math.cos(a) * (90 + l), bcy + Math.sin(a) * (90 + l)); g.stroke();
    });
    const ra = (U.clamp(-o.roll, -60, 60) + 90) * U.DEG;
    g.beginPath(); g.moveTo(bcx + Math.cos(ra) * 84, bcy + Math.sin(ra) * 84); g.lineTo(bcx + Math.cos(ra) * 70 - 6, bcy + Math.sin(ra) * 70); g.lineTo(bcx + Math.cos(ra) * 70 + 6, bcy + Math.sin(ra) * 70); g.closePath(); g.fill();

    // --- navigation / steering
    if (nv.station) {
      const rel = ((nv.bearing - o.heading + 540) % 360) - 180;
      t(g, nv.station.id + '  ' + nv.distNM.toFixed(1) + 'NM', W - 190, Ht - 110, 20);
      t(g, 'BRG ' + U.pad(nv.bearing, 3) + '  ' + (rel > 0 ? '→' : '←') + Math.abs(Math.round(rel)) + '°', W - 190, Ht - 82, 20);
      // destination diamond in the HUD if within view
      if (Math.abs(rel) < 10) {
        const st = nv.station;
        const elv = Math.atan2((st.elev || 0) - ac.pos.y, Math.max(1, nv.distM)) * U.RAD;
        tmpV.set(st.x - ac.pos.x, (st.elev || 0) - ac.pos.y, st.z - ac.pos.z).applyQuaternion(tmpQ);
        if (tmpV.z < 0) {
          const az = Math.atan2(tmpV.x, -tmpV.z) * U.RAD, el = Math.atan2(tmpV.y, -tmpV.z) * U.RAD;
          if (Math.abs(az) < 10 && el > -9 && el < 8) {
            const [dx, dy] = px(az, el);
            g.beginPath(); g.moveTo(dx, dy - 12); g.lineTo(dx + 12, dy); g.lineTo(dx, dy + 12); g.lineTo(dx - 12, dy); g.closePath(); g.stroke();
          }
        }
        void elv;
      }
      if (nv.ils) {
        t(g, 'ILS', 175, Ht - 110, 20);
        // small deviation scales
        const cx = W / 2, cy = Ht - 40;
        for (let k = -2; k <= 2; k++) { g.beginPath(); g.arc(cx + k * 30, cy, 3, 0, 7); g.stroke(); }
        g.fillRect(cx + nv.cdi * 60 - 3, cy - 14, 6, 28);
        if (nv.gsValid) {
          for (let k = -2; k <= 2; k++) { g.beginPath(); g.arc(W - 70, Ht / 2 + k * 30, 3, 0, 7); g.stroke(); }
          g.fillRect(W - 84, Ht / 2 - nv.gs * 60 - 3, 28, 6);
        }
      }
    }
    // --- configuration & warnings
    let msgY = Ht - 110;
    const msg = (m) => { t(g, m, 175, msgY + 30, 20); msgY += 28; };
    if (s.gearPos > 0.98) msg('GEAR'); else if (s.gearPos > 0.02) msg('GEAR ~');
    if (s.flapPos > 0.02) msg('FLAP ' + Math.round(s.flapPos * 50));
    if (s.airbrakePos > 0.05) msg('SPD BRK');
    if (s.parkingBrake) msg('PARK BRK');
    const flash = (time % 0.6) < 0.35;
    if (s.stallWarn && flash) t(g, 'STALL', W / 2, Ht / 2 + 120, 34);
    // ground proximity: time to impact
    const vsDown = -ac.vel.y;
    const tti = vsDown > 2 ? o.agl / vsDown : 99;
    const terrainAhead = SIM.world.height(ac.pos.x + ac.vel.x * 8, ac.pos.z + ac.vel.z * 8);
    const closing = ac.pos.y + ac.vel.y * 8 < terrainAhead + 30;
    H.pullUp = !ac.onGround && ((tti < 7 && !(s.gearPos > 0.9 && vsDown < 9)) || (closing && o.agl > 15 && s.gearPos < 0.9));
    if (H.pullUp && flash) {
      g.lineWidth = 4;
      t(g, 'PULL UP', W / 2, Ht / 2 - 90, 40);
      g.beginPath(); g.moveTo(W / 2 - 100, Ht / 2 - 60); g.lineTo(W / 2 + 100, Ht / 2 - 120); g.moveTo(W / 2 + 100, Ht / 2 - 60); g.lineTo(W / 2 - 100, Ht / 2 - 120); g.stroke();
    }
    if (o.g > 7.5 && flash) t(g, 'OVER G', W / 2, Ht / 2 + 160, 30);
    if (s.masterArm) t(g, 'ARM', 175, 120, 22);
    if (s.cmdsArm) t(g, 'FLR ' + s.flares, 175, 146, 20);
    H.tex.needsUpdate = true;
  };
})(typeof window !== 'undefined' ? window : globalThis);
