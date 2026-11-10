/* ==========================================================================
 * atmosphere.js — International Standard Atmosphere (ISA) + weather
 *
 * Why it matters: an aircraft flies on the AIR, not on the ground. Thinner
 * air at altitude means less lift for the same speed, less engine thrust and
 * a lower "indicated" airspeed than true airspeed. Pilots learn this as
 * density altitude, IAS vs TAS, etc. — the sim calculates all of it.
 * ========================================================================== */
(function (root) {
  'use strict';
  const SIM = root.SIM = root.SIM || {};
  const U = SIM.util;

  const A = SIM.atmo = {};
  const T0 = 288.15, P0 = 101325, RHO0 = 1.225, L = 0.0065, R = 287.053, GAMMA = 1.4;
  A.RHO0 = RHO0; A.P0 = P0;

  /** ISA at geometric altitude h (m). tempOffset: deviation from ISA (K). */
  A.at = function (h, tempOffset) {
    tempOffset = tempOffset || 0;
    let T, P;
    if (h < 11000) {
      T = T0 - L * h;
      P = P0 * Math.pow(T / T0, 9.80665 / (L * R));
    } else {
      const T11 = T0 - L * 11000;
      const P11 = P0 * Math.pow(T11 / T0, 9.80665 / (L * R));
      T = T11;
      P = P11 * Math.exp(-9.80665 * (h - 11000) / (R * T11));
    }
    const Tact = T + tempOffset;
    const rho = P / (R * Tact);
    return { T: Tact, P: P, rho: rho, sigma: rho / RHO0, a: Math.sqrt(GAMMA * R * Tact), oatC: Tact - 273.15 };
  };

  // ------------------------------------------------------------------------
  // Weather (editable from the start menu)
  // ------------------------------------------------------------------------
  const Wx = SIM.weather = {
    windDir: 250,        // direction the wind blows FROM (deg true)
    windSpeedKt: 8,      // surface wind
    gustKt: 0,
    turbulence: 0.15,    // 0..1
    qnh: 1013,           // actual sea-level pressure (hPa)
    tempOffset: 0,       // ISA deviation (K)
    visibilityKm: 40,
    clouds: 'scattered', // none | few | scattered | broken | overcast
    cloudBase: 1400,     // m MSL
    _t: 0, _g: [0, 0, 0], _gt: [0, 0, 0]
  };

  Wx.cloudCover = function () {
    return { none: 0, few: 0.15, scattered: 0.35, broken: 0.65, overcast: 0.95 }[Wx.clouds] || 0;
  };

  /** Wind vector (m/s, world frame: blowing TOWARD) at altitude h AGL. */
  Wx.wind = function (hAGL, out) {
    // wind increases with height above ground (boundary layer, ~1/7 power law)
    const f = U.clamp(Math.pow(Math.max(hAGL, 1) / 10, 0.14), 0.3, 1.9);
    const spd = Wx.windSpeedKt * U.KT2MS * f;
    const to = U.headingVec(Wx.windDir + 180);
    out.x = to.x * spd + Wx._g[0];
    out.y = Wx._g[1];
    out.z = to.z * spd + Wx._g[2];
    return out;
  };

  /** Update turbulence/gust state (call once per physics frame). */
  Wx.update = function (dt, hAGL) {
    Wx._t += dt;
    const strength = Wx.turbulence * (1.2 + Wx.windSpeedKt * 0.08) * (hAGL < 600 ? 1.3 : 0.8) + Wx.gustKt * U.KT2MS * 0.4;
    for (let i = 0; i < 3; i++) {
      if (Math.random() < dt * 1.5) Wx._gt[i] = (Math.random() * 2 - 1) * strength * (i === 1 ? 0.6 : 1);
      Wx._g[i] = U.approach(Wx._g[i], Wx._gt[i], 0.6, dt);
    }
  };
})(typeof window !== 'undefined' ? window : globalThis);
