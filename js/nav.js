/* ==========================================================================
 * nav.js — radio navigation: bearing/distance to stations, ILS deviations
 *
 * ILS (Instrument Landing System) in one paragraph: a LOCALIZER transmitter
 * at the far end of the runway tells you whether you are left or right of
 * the extended centreline; a GLIDE SLOPE transmitter beside the touchdown
 * zone tells you whether you are above or below a 3° descent path. Follow
 * both and you arrive at the runway's touchdown point — even in cloud.
 * ========================================================================== */
(function (root) {
  'use strict';
  const SIM = root.SIM = root.SIM || {};
  const U = SIM.util, W = SIM.world;
  const N = SIM.nav = { out: {} };

  N.selected = function (ac) { return W.navaids[((ac.sys.navIndex % W.navaids.length) + W.navaids.length) % W.navaids.length]; };

  /** When a new destination is selected, set a sensible course on the HSI. */
  N.autoCourse = function (ac) {
    const st = N.selected(ac);
    ac.sys.crsSel = st.type === 'ILS' ? st.course : Math.round(U.bearingTo(ac.pos.x, ac.pos.z, st.x, st.z));
  };

  N.update = function (ac) {
    const o = N.out, s = ac.sys;
    const st = N.selected(ac);
    o.station = st;
    const dx = st.x - ac.pos.x, dz = st.z - ac.pos.z;
    o.distM = Math.hypot(dx, dz, (st.elev || 0) - ac.pos.y);
    o.distNM = o.distM * U.M2NM;
    o.bearing = U.bearingTo(ac.pos.x, ac.pos.z, st.x, st.z);
    o.valid = s.avionicsPowered && o.distNM < 120;
    o.ils = false; o.gsValid = false;
    if (st.type === 'ILS') {
      // localizer: angle of aircraft from the extended centreline, seen from the antenna
      const bFromLoc = U.bearingTo(st.locX, st.locZ, ac.pos.x, ac.pos.z);
      const d = ((bFromLoc - U.wrap360(st.course + 180) + 540) % 360) - 180;
      o.locDevDeg = -d;           // + = aircraft is RIGHT of the centreline
      const inFront = Math.abs(d) < 35;
      o.ils = o.valid && inFront && o.distNM < 25;
      // glide slope
      const gd = Math.hypot(ac.pos.x - st.gsX, ac.pos.z - st.gsZ);
      const ang = Math.atan2(ac.pos.y - 1.5 - st.elev, gd) * U.RAD;
      o.gsDevDeg = ang - st.gsAngle;  // + = aircraft ABOVE the glide path
      o.gsValid = o.ils && Math.abs(d) < 10 && gd > 200;
      // CDI: full scale = 2.5° for the localizer
      o.cdi = U.clamp(-o.locDevDeg / 2.5, -1, 1);     // bar offset: -1 = centreline far left
      o.gs = U.clamp(-o.gsDevDeg / 0.7, -1, 1);       // pointer: -1 = glide path far below
      o.toFrom = 1;
      o.ident = st.id;
    } else {
      // VOR/TACAN-like course deviation, full scale 10°
      let dev = ((o.bearing - s.crsSel + 540) % 360) - 180;
      o.toFrom = Math.abs(dev) <= 90 ? 1 : -1;
      if (o.toFrom < 0) dev = ((dev + 360) % 360) - 180;
      o.cdi = U.clamp(dev / 10, -1, 1);
      o.ident = st.id;
    }
    // time to go
    const gs = Math.max(ac.out.gs, 1);
    o.eteMin = o.distNM / gs * 60;
    // glide-path target altitude for the selected airport (for HUD/instructor)
    return o;
  };
})(typeof window !== 'undefined' ? window : globalThis);
