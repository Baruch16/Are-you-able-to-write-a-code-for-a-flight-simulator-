/* ==========================================================================
 * aircraft.js — flight dynamics model (6 degrees of freedom) + systems
 *
 * The aircraft: "Kestrel T.2" — a fictional tandem-seat advanced jet trainer
 * of the type air forces use to teach pilots before front-line fighters.
 * Single turbofan, ~25 kN thrust, ~5.5 t, 9.4 m span. Numbers are typical of
 * that class so speeds, climb rates, turn rates and distances feel right.
 *
 * PHYSICS OVERVIEW (what really keeps an aeroplane in the air):
 *   Lift   = ½·ρ·V²·S·CL(α)   — grows with the square of speed and with
 *                               angle of attack α until the wing STALLS.
 *   Drag   = ½·ρ·V²·S·CD      — CD = CD0 + k·CL² (+ gear, flaps, airbrake)
 *   Thrust = from the engine, falls with air density.
 *   Weight = m·g, falls slowly as fuel burns.
 * Rotations come from aerodynamic MOMENTS: the tailplane keeps the nose
 * pointing into the airflow (stability), the controls add moments, and
 * damping terms resist rotation. Everything is integrated at 240 Hz.
 *
 * Body axes (three.js convention): +X right wing, +Y up, -Z forward (nose).
 * ========================================================================== */
(function (root) {
  'use strict';
  const SIM = root.SIM = root.SIM || {};
  const U = SIM.util;
  const THREE = root.THREE;

  // ---------------- airframe data ------------------------------------------
  const D = SIM.acData = {
    name: 'Kestrel T.2',
    emptyMass: 4100,            // kg (incl. pilot)
    fuelMax: 1300,              // kg internal fuel
    S: 17.0,                    // wing area m²
    b: 9.4,                     // span m
    c: 2.0,                     // mean aerodynamic chord m
    Ixx: 9500, Iyy: 32000, Izz: 38000, // roll, pitch, yaw inertia kg·m²
    thrustMax: 25000,           // N, sea level static
    idleN1: 54,
    // aerodynamics
    CL0: 0.12, CLa: 4.6,        // per radian
    alphaStall: 15.5 * U.DEG,   // clean stall AoA
    CD0: 0.019, k: 0.078,
    CDgear: 0.022, CDflap: [0, 0.012, 0.045], CLflap: [0, 0.28, 0.58], CDbrake: 0.06,
    flapAngles: [0, 25, 50],
    // speed limits (knots)
    Vne: 560, Vgear: 230, Vflap: [999, 230, 185], Vbrake: 999,
    gLimitPos: 8.0, gLimitNeg: -3.0,
    // gear contact points relative to CG (m): nose, left main, right main
    gear: [
      { x: 0, y: -1.55, z: -3.6, k: 90000, c: 9000, steer: true, name: 'NOSE' },
      { x: -1.75, y: -1.55, z: 0.42, k: 160000, c: 15000, steer: false, name: 'LEFT' },
      { x: 1.75, y: -1.55, z: 0.42, k: 160000, c: 15000, steer: false, name: 'RIGHT' }
    ],
    // points that must never touch the ground (fuselage, wing tips, tail)
    hardPoints: [
      { x: 0, y: -0.9, z: -6.2 }, { x: 0, y: -0.6, z: 4.0 }, { x: 0, y: -0.3, z: 5.6 },
      { x: -4.7, y: -0.25, z: 0.8 }, { x: 4.7, y: -0.25, z: 0.8 }, { x: 0, y: -1.05, z: 0 }
    ],
    eye: { x: 0, y: 0.98, z: -2.75 }
  };

  // scratch objects (avoid garbage)
  const v3 = () => new THREE.Vector3();
  const tmpQ = new THREE.Quaternion(), tmpQ2 = new THREE.Quaternion();
  const vA = v3(), vB = v3(), vC = v3(), vD = v3(), vE = v3(), vW = v3();
  const gA = v3(), gB = v3(), gC = v3(), gD = v3(), gE = v3();

  class Aircraft {
    constructor() {
      this.pos = v3();             // world position of CG (m)
      this.vel = v3();             // world velocity (m/s)
      this.quat = new THREE.Quaternion();
      this.omega = v3();           // body angular velocity (rad/s), three.js axes
      this.fuel = 900;
      this.controls = { pitch: 0, roll: 0, yaw: 0, throttle: 0, brakeL: 0, brakeR: 0, trim: 0 };
      this.sys = this._defaultSystems();
      this.out = {};               // derived values for instruments
      this.crashed = null;
      this.gearCompression = [0, 0, 0];
      this.onGround = false;
      this.gMax = 1; this.gMin = 1;
      this.events = [];            // transient sound/visual events
      this._accel = v3();
      this.computeOutputs(0);
    }

    _defaultSystems() {
      return {
        battery: false, generator: false, avionics: false, fuelPump: false, engineMaster: false,
        ignition: false, pitotHeat: false, navLights: false, strobe: false, landingLight: false,
        taxiLight: false, masterArm: false, cmdsArm: false, seatArmed: false, canopyClosed: true,
        antiSkid: true, yawDamper: true,
        // continuous states
        busVolts: 0, batteryCharge: 1, n1: 0, egt: 20, oilPress: 0, hydPress: 0,
        fuelFlow: 0, starter: false, startTimer: 0, engineRunning: false, lightOff: false,
        gearLever: 1, gearPos: 1, flapLever: 0, flapPos: 0, airbrakeSw: 0, airbrakePos: 0,
        parkingBrake: true, gyroSpin: 0, pitotIce: 0, flares: 30, qnhSet: 1013,
        hdgBug: 270, crsSel: 270, navIndex: 1, masterCaution: false, cautionsSeen: {},
        stallWarn: false, gearHorn: false
      };
    }

    // ---------------- set initial state ----------------
    reset(opts) {
      const s = this.sys;
      Object.assign(s, this._defaultSystems());
      this.crashed = null; this.gMax = 1; this.gMin = 1;
      this.fuel = opts.fuel !== undefined ? opts.fuel : 900;
      this.pos.set(opts.x, opts.y, opts.z);
      const hdg = opts.hdg * U.DEG, pitch = (opts.pitch || 0) * U.DEG;
      const e = new THREE.Euler(pitch, -hdg, 0, 'YXZ');
      this.quat.setFromEuler(e);
      const spd = opts.speed || 0;
      const f = vA.set(0, 0, -1).applyQuaternion(this.quat);
      this.vel.copy(f).multiplyScalar(spd);
      if (opts.vs) this.vel.y += opts.vs;
      this.omega.set(0, 0, 0);
      s.hdgBug = Math.round(opts.hdg); s.crsSel = Math.round(opts.hdg);
      s.qnhSet = opts.qnhSet || 1013;
      if (opts.running) {
        Object.assign(s, {
          battery: true, generator: true, avionics: true, fuelPump: true, engineMaster: true, ignition: false,
          navLights: true, strobe: true, pitotHeat: true, seatArmed: true, n1: s.idleN1 || D.idleN1,
          egt: 480, oilPress: 45, hydPress: 3000, engineRunning: true, lightOff: true, busVolts: 28,
          gyroSpin: 1, parkingBrake: false, qnhSet: SIM.weather.qnh, masterArm: false, landingLight: true
        });
      }
      if (opts.airborne) {
        s.gearLever = opts.gearDown ? 1 : 0; s.gearPos = s.gearLever;
        s.flapLever = opts.flaps || 0; s.flapPos = s.flapLever;
        s.parkingBrake = false; s.n1 = opts.n1 || 80; s.landingLight = !!opts.gearDown;
      }
      this.controls.throttle = opts.throttle !== undefined ? opts.throttle : 0;
      this.controls.trim = opts.trim || 0;
      if (opts.airborne) this.autoTrim(opts.hdg, spd, opts.y);
      this.computeOutputs(0);
    }

    /** Set pitch trim & attitude for 1 G level flight at the current speed
     *  (used for in-flight starts so the aircraft does not bob around). */
    autoTrim(hdgDeg, spd, alt) {
      const s = this.sys;
      const rho = SIM.atmo.at(alt).rho;
      const qbar = 0.5 * rho * spd * spd;
      const CLreq = this.mass * U.G / (qbar * D.S);
      const dCLflap = U.lerp(D.CLflap[Math.floor(s.flapPos * 2)], D.CLflap[Math.min(2, Math.floor(s.flapPos * 2) + 1)], s.flapPos * 2 % 1);
      const alpha = (CLreq - D.CL0 - dCLflap) / D.CLa;
      const trim = (0.72 * alpha - 0.025 + 0.05 * s.flapPos - 0.02 * s.airbrakePos + 0.012 * s.gearPos) / (0.27 * 0.45);
      this.controls.trim = U.clamp(trim, -1, 1);
      this.quat.setFromEuler(new THREE.Euler(alpha, -hdgDeg * U.DEG, 0, 'YXZ'));
      const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(new THREE.Quaternion().setFromEuler(new THREE.Euler(0, -hdgDeg * U.DEG, 0, 'YXZ')));
      this.vel.copy(dir).multiplyScalar(spd);
    }

    get mass() { return D.emptyMass + this.fuel; }

    // ---------------- systems (electrics, engine, hydraulics...) ----------
    updateSystems(dt) {
      const s = this.sys, o = this.out;
      // ---- electrical: battery feeds the bus; generator takes over above ~45% N1
      const genOnline = s.generator && s.n1 > 45;
      if (genOnline) { s.busVolts = U.approach(s.busVolts, 28, 0.3, dt); s.batteryCharge = Math.min(1, s.batteryCharge + dt * 0.002); }
      else if (s.battery && s.batteryCharge > 0) {
        const load = (s.avionics ? 1 : 0.2) + (s.starter ? 6 : 0) + (s.landingLight ? 0.6 : 0) + (s.fuelPump ? 0.4 : 0);
        s.batteryCharge = Math.max(0, s.batteryCharge - dt * 0.00012 * load);
        s.busVolts = U.approach(s.busVolts, 22 + 2.2 * s.batteryCharge - (s.starter ? 2.5 : 0), 0.3, dt);
      } else s.busVolts = U.approach(s.busVolts, 0, 0.2, dt);
      s.genOnline = genOnline;
      const power = s.busVolts > 18;
      s.powered = power;
      s.avionicsPowered = power && s.avionics;
      // gyros spin up/down (attitude & heading instruments need ~1 min in reality; sped up to 25 s)
      s.gyroSpin = U.moveToward(s.gyroSpin, s.avionicsPowered ? 1 : 0, s.avionicsPowered ? 1 / 25 : 1 / 60, dt);

      // ---- fuel: boost pump keeps pressure; without it the engine can still suction-feed low down
      const fuelAvail = this.fuel > 0.5 && s.engineMaster;
      const pumpOK = s.fuelPump && power;
      const suctionOK = this.pos.y < 6000;
      s.fuelPressOK = fuelAvail && (pumpOK || suctionOK);

      // ---- engine
      const throttle = this.controls.throttle;
      if (s.starter) {
        s.startTimer += dt;
        if (!power || s.busVolts < 19) s.starter = false;
      }
      let targetN1 = 0;
      if (s.engineRunning) {
        if (!s.fuelPressOK) { s.engineRunning = false; s.lightOff = false; this.events.push('flameout'); }
        else targetN1 = D.idleN1 + (100 - D.idleN1) * throttle;
      }
      if (!s.engineRunning) {
        if (s.starter) {
          targetN1 = 24; // starter can only spin the engine to ~24%
          if (s.n1 > 12 && s.fuelPressOK && (power) && throttle < 0.05) { s.lightOff = true; }
          if (s.lightOff && s.fuelPressOK) targetN1 = D.idleN1 + 2;
          if (s.lightOff && s.n1 > D.idleN1 - 1) { s.engineRunning = true; s.starter = false; this.events.push('engineStarted'); }
        } else if (s.lightOff && s.fuelPressOK && s.n1 > 30) {
          targetN1 = D.idleN1;
        } else {
          s.lightOff = false; targetN1 = 0;
        }
        // windmilling in flight
        targetN1 = Math.max(targetN1, Math.min(30, (o.ias || 0) * 0.12));
      }
      // turbine spool-up is slow at low rpm and quicker near the top (realistic lag!)
      const spoolRate = targetN1 > s.n1 ? (s.n1 < 60 ? 4.5 : 9 + (s.n1 - 60) * 0.25) : 12;
      s.n1 = U.moveToward(s.n1, targetN1, spoolRate * (s.starter && !s.lightOff ? 0.45 : 1), dt);
      // exhaust gas temperature: peaks during start, follows power
      let egtTarget = 20 + SIM.atmo.at(this.pos.y).oatC;
      if (s.lightOff || s.engineRunning) egtTarget = 380 + 3.2 * Math.max(0, s.n1 - 50) * 1.9 + (s.engineRunning ? 0 : 260 * U.smoothstep(15, 40, s.n1) * (1 - U.smoothstep(45, 54, s.n1)));
      s.egt = U.approach(s.egt, egtTarget, 2.2, dt);
      s.oilPress = U.approach(s.oilPress, s.n1 > 10 ? Math.min(55, s.n1 * 0.7) : 0, 1.5, dt);
      s.hydPress = U.approach(s.hydPress, s.n1 > 20 ? 3000 : Math.max(0, s.hydPress - 0), s.n1 > 20 ? 1.5 : 25, dt);
      if (s.n1 < 20) s.hydPress = Math.max(0, s.hydPress - dt * 15);
      // fuel flow (kg/h) ~ specific fuel consumption * thrust
      const thrustFrac = s.engineRunning ? this._thrustFraction(s.n1) : 0;
      s.fuelFlow = s.engineRunning ? 230 + 1950 * thrustFrac * Math.max(0.35, SIM.atmo.at(this.pos.y).sigma) : (s.lightOff ? 120 : 0);
      this.fuel = Math.max(0, this.fuel - s.fuelFlow / 3600 * dt);

      // ---- hydraulically powered services
      const hyd = s.hydPress > 1500;
      const wow = this.onGround && this.gearCompression[1] + this.gearCompression[2] > 0.02;
      if (wow && s.gearLever === 0) { s.gearLever = 1; this.events.push('gearSafety'); } // ground safety lock
      if (hyd) {
        s.gearPos = U.moveToward(s.gearPos, s.gearLever, 1 / 6, dt);
        s.flapPos = U.moveToward(s.flapPos, s.flapLever, 1 / 5, dt);
        s.airbrakePos = U.moveToward(s.airbrakePos, s.airbrakeSw, 1 / 2.5, dt);
      }
      // ---- pitot icing (an un-heated pitot tube freezes in cold air -> airspeed lies)
      const oat = SIM.atmo.at(this.pos.y, SIM.weather.tempOffset).oatC;
      if (oat < 2 && !(s.pitotHeat && power)) s.pitotIce = Math.min(1, s.pitotIce + dt / 150);
      else s.pitotIce = Math.max(0, s.pitotIce - dt / 20);

      // ---- warnings
      s.stallWarn = !this.onGround && o.aoa > 13.5 && power;
      const lowAndSlow = !this.onGround && s.gearPos < 0.99 && throttle < 0.25 && o.agl < 300 && o.ias < 210;
      s.gearHorn = lowAndSlow && power;
      const cautions = this.cautions();
      let newCaution = false;
      for (const k in cautions) {
        if (cautions[k] && !s.cautionsSeen[k]) { s.cautionsSeen[k] = true; newCaution = true; }
        if (!cautions[k]) s.cautionsSeen[k] = false;
      }
      if (newCaution && power) { s.masterCaution = true; this.events.push('caution'); }
      if (!power) s.masterCaution = false;
    }

    /** Active caution lights (the annunciator panel). */
    cautions() {
      const s = this.sys, o = this.out;
      return {
        'GEN': s.powered && !s.genOnline,
        'BATT': s.battery === false && s.powered,
        'FUEL PRESS': s.powered && !s.fuelPressOK,
        'FUEL LOW': s.powered && this.fuel < 180,
        'HYD': s.powered && s.hydPress < 1500,
        'OIL': s.powered && s.oilPress < 15,
        'PITOT HEAT': s.powered && !s.pitotHeat,
        'CANOPY': s.powered && !s.canopyClosed,
        'SEAT SAFE': s.powered && !s.seatArmed,
        'PARK BRK': s.powered && s.parkingBrake,
        'GEAR': s.powered && s.gearHorn,
        'OVER G': s.powered && (o.g > D.gLimitPos || o.g < D.gLimitNeg),
        'SPEED': s.powered && o.ias > 0 && (o.ias > D.Vne || (s.gearPos > 0.05 && o.ias > D.Vgear) || (s.flapPos > 0.05 && o.ias > D.Vflap[Math.ceil(s.flapPos * 2 - 0.01)])),
        'STALL': s.stallWarn,
        'AVIONICS': s.powered && !s.avionics,
        'ENG FIRE': false
      };
    }

    _thrustFraction(n1) {
      const t = U.clamp((n1 - D.idleN1) / (100 - D.idleN1), 0, 1);
      return 0.045 + 0.955 * Math.pow(t, 1.7);
    }

    // ---------------- the flight dynamics step ---------------------------
    step(dt) {
      if (this.crashed) return;
      const s = this.sys, c = this.controls;
      const q = this.quat;
      const mass = this.mass;
      const atm = SIM.atmo.at(this.pos.y, SIM.weather.tempOffset);
      const rho = atm.rho;

      // relative wind
      const hGround = SIM.world.height(this.pos.x, this.pos.z);
      const agl = this.pos.y - Math.max(hGround, 0);
      SIM.weather.wind(Math.max(1, agl), vW);
      if (this.onGround) vW.multiplyScalar(0.7);
      const qInv = tmpQ.copy(q).invert();
      const vAir = vA.copy(this.vel).sub(vW);              // world air-relative velocity
      const vb = vB.copy(vAir).applyQuaternion(qInv);      // body frame
      const V = Math.max(vb.length(), 0.01);
      const alpha = Math.atan2(-vb.y, -vb.z);
      const beta = Math.asin(U.clamp(vb.x / V, -1, 1));
      const qbar = 0.5 * rho * V * V;

      // angular rates in pilot convention: p roll right, qr pitch up, r yaw right
      const p = -this.omega.z, qr = this.omega.x, r = -this.omega.y;

      // ---- lift coefficient incl. stall
      const flapIdx = s.flapPos * 2;
      const fl0 = Math.floor(flapIdx), fl1 = Math.min(2, fl0 + 1), ft = flapIdx - fl0;
      const dCLflap = U.lerp(D.CLflap[fl0], D.CLflap[fl1], ft);
      const dCDflap = U.lerp(D.CDflap[fl0], D.CDflap[fl1], ft);
      const aStall = D.alphaStall - s.flapPos * 2.0 * U.DEG;
      const aAbs = Math.abs(alpha);
      let CL;
      const CLlin = D.CL0 + D.CLa * alpha + dCLflap;
      if (aAbs <= aStall) CL = CLlin;
      else {
        // beyond the critical angle the airflow separates: lift collapses
        const CLmax = D.CL0 + D.CLa * aStall * Math.sign(alpha) + dCLflap;
        const over = aAbs - aStall;
        const post = 0.85 * Math.sin(2 * alpha) * 1.05 + dCLflap * 0.5;
        const blend = U.smoothstep(0, 6 * U.DEG, over);
        CL = U.lerp(CLmax * (1 - 0.25 * blend), post, blend);
      }
      this._stalled = aAbs > aStall;
      let CD = D.CD0 + D.k * CL * CL + D.CDgear * s.gearPos + dCDflap + D.CDbrake * s.airbrakePos;
      if (aAbs > aStall) CD += 1.2 * Math.pow(Math.sin(aAbs), 2);
      // compressibility (transonic drag rise)
      const mach = V / atm.a;
      if (mach > 0.78) CD += 0.25 * Math.pow(mach - 0.78, 2) * 10;
      // ground effect: within ~1 wingspan of the ground induced drag falls
      if (agl < D.b) CD -= D.k * CL * CL * 0.4 * (1 - agl / D.b);
      const CY = -0.85 * beta;

      // ---- aerodynamic forces (body frame)
      const dir = vC.copy(vb).divideScalar(V);                    // airflow direction (body)
      const liftDir = vD.set(1, 0, 0).cross(dir).normalize();     // perpendicular to airflow
      const F = vE.set(0, 0, 0);
      F.addScaledVector(liftDir, qbar * D.S * CL);
      F.addScaledVector(dir, -qbar * D.S * CD);
      F.x += qbar * D.S * CY;
      // ---- thrust (along body -Z)
      let thrust = 0;
      if (s.engineRunning) {
        thrust = D.thrustMax * this._thrustFraction(s.n1) * Math.pow(atm.sigma, 0.75) * (1 + 0.15 * Math.min(mach, 0.9));
      }
      F.z -= thrust;
      this._thrust = thrust;

      // ---- moments (pilot convention: L roll, M pitch, N yaw)
      const V2 = Math.max(V, 15);
      const pitchIn = c.pitch;
      const rollIn = c.roll, yawIn = c.yaw;
      // Elevator = pilot input + trim. Artificial "q-feel": the stick gets heavy
      // at high speed, so full aft stick gives about +8 G (or just past the
      // stalling angle when slow) instead of instantly over-stressing the jet.
      const trimTerm = c.trim * 0.45;
      let eTot = trimTerm + pitchIn;
      if (qbar > 100) {
        const W = mass * U.G;
        const aPos = Math.min(aStall + 1.0 * U.DEG, (8.0 * W / (qbar * D.S) - D.CL0 - dCLflap) / D.CLa);
        const aNeg = Math.max(-aStall, (-3.2 * W / (qbar * D.S) - D.CL0 - dCLflap) / D.CLa);
        const ePos = (0.72 * aPos - 0.025 + 0.05) / 0.27;
        const eNeg = (0.72 * aNeg - 0.025 - 0.05) / 0.27;
        eTot = pitchIn >= 0 ? trimTerm + pitchIn * U.clamp(ePos - trimTerm, 0.05, 1)
                            : trimTerm + pitchIn * U.clamp(trimTerm - eNeg, 0.05, 1);
      }
      const Cm = 0.025 - 0.72 * (alpha - 0.0) + 0.27 * eTot
        - 40 * qr * D.c / (2 * V2) - 0.05 * s.flapPos + 0.02 * s.airbrakePos - 0.012 * s.gearPos
        - (aAbs > aStall ? 0.15 * Math.sign(alpha) * U.smoothstep(0, 0.2, aAbs - aStall) : 0);
      let Cl = 0.05 * rollIn - 0.48 * p * D.b / (2 * V2) - 0.07 * beta + 0.012 * r * D.b / (2 * V2);
      // wing drop at the stall: one wing stalls first
      if (this._stalled && !this.onGround) {
        this._wingDrop = this._wingDrop || (Math.random() < 0.5 ? -1 : 1);
        Cl += this._wingDrop * 0.02 * U.smoothstep(0, 0.12, aAbs - aStall);
      } else this._wingDrop = 0;
      let Cn = 0.13 * beta + 0.065 * yawIn - 0.17 * r * D.b / (2 * V2) - 0.006 * rollIn - 0.05 * p * D.b / (2 * V2) * CL;
      if (s.yawDamper && s.avionicsPowered) Cn -= 0.08 * r * D.b / (2 * V2);
      const Mx = qbar * D.S * D.c * Cm;      // pitch
      const Lr = qbar * D.S * D.b * Cl;      // roll
      const Ny = qbar * D.S * D.b * Cn;      // yaw
      // convert to three.js body axes: x = pitch(+up), y = yaw(+left), z = roll(+left)
      const torque = vW.set(Mx, -Ny, -Lr);

      // ---- landing gear & ground contact
      this._groundForces(dt, F, torque, qInv, hGround);

      // ---- integrate linear motion (world frame)
      const Fw = F.applyQuaternion(q);
      Fw.y -= mass * U.G;
      this._accel.copy(Fw).divideScalar(mass);
      this.vel.addScaledVector(this._accel, dt);
      this.pos.addScaledVector(this.vel, dt);

      // ---- integrate rotation (body frame, diagonal inertia + gyroscopic term)
      const I = [D.Iyy, D.Izz, D.Ixx]; // about x (pitch), y (yaw), z (roll)
      const w = this.omega;
      const wx = w.x, wy = w.y, wz = w.z;
      w.x += (torque.x - (I[2] - I[1]) * wy * wz) / I[0] * dt;
      w.y += (torque.y - (I[0] - I[2]) * wz * wx) / I[1] * dt;
      w.z += (torque.z - (I[1] - I[0]) * wx * wy) / I[2] * dt;
      // integrate quaternion
      const ang = w.length() * dt;
      if (ang > 1e-9) {
        tmpQ2.setFromAxisAngle(vD.copy(w).normalize(), ang);
        q.multiply(tmpQ2).normalize();
      }

      // ---- derived values for gauges
      this._alpha = alpha; this._beta = beta; this._V = V; this._qbar = qbar; this._mach = mach;
      this._rho = rho; this._agl = agl; this._hGround = hGround;
      this._checkCrash(hGround);
    }

    _groundForces(dt, F, torque, qInv, hGround) {
      const s = this.sys, c = this.controls;
      const q = this.quat;
      let anyContact = false;
            const surf = SIM.world.surface(this.pos.x, this.pos.z);
      this._surface = surf;
      const paved = surf !== 'grass';
      const rollMu = paved ? 0.018 : 0.06;
      const gearOut = s.gearPos > 0.98;
      for (let i = 0; i < 3; i++) {
        const g = D.gear[i];
        this.gearCompression[i] = 0;
        if (!gearOut) continue;
        // wheel contact point in world
        const pb = gB.set(g.x, g.y, g.z);
        const pw = gC.copy(pb).applyQuaternion(q).add(this.pos);
        const h = SIM.world.height(pw.x, pw.z);
        const comp = h - pw.y;
        if (comp <= 0) continue;
        anyContact = true;
        this.gearCompression[i] = comp;
        // velocity of contact point (world)
        const wWorld = gD.copy(this.omega).applyQuaternion(q);
        const rWorld = gE.copy(pb).applyQuaternion(q);
        const vp = new THREE.Vector3().crossVectors(wWorld, rWorld).add(this.vel);
        // normal force (spring + damper, never pulling)
        const N = Math.max(0, g.k * Math.min(comp, 0.6) - g.c * vp.y);
        // wheel rolling direction on ground plane
        let fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(q);
        if (g.steer) {
          const ias = this.out.ias || 0;
          const steerAng = -c.yaw * U.clamp(1 - ias / 60, 0, 1) * 40 * U.DEG; // nosewheel steering, fades with speed
          fwd.applyAxisAngle(new THREE.Vector3(0, 1, 0), steerAng);
        }
        fwd.y = 0; fwd.normalize();
        const side = new THREE.Vector3(-fwd.z, 0, fwd.x);
        const vF = vp.dot(fwd), vS = vp.dot(side);
        // braking (main wheels only). Parking brake = full brake.
        let brake = 0;
        if (!g.steer) brake = Math.max(i === 1 ? c.brakeL : c.brakeR, s.parkingBrake ? 1 : 0);
        if (s.hydPress < 500 && !s.parkingBrake) brake *= 0.5; // accumulator only
        const muBrake = paved ? 0.55 : 0.35;
        const mu = rollMu + brake * muBrake;
        const fLong = -Math.tanh(vF / 0.4) * mu * N;
        // tyre cornering force grows with the load on the tyre; the nose tyre is
        // softer (it partly castors) which keeps the tricycle gear directionally stable
        const fSide = -U.clamp(vS * (g.steer ? 0.8 : 2.5) * N, -0.75 * N, 0.75 * N);
        const fw = new THREE.Vector3(0, N, 0).addScaledVector(fwd, fLong).addScaledVector(side, fSide);
        // grass is bumpy
        if (!paved) fw.y += N * 0.08 * Math.sin(this.pos.x * 0.9 + this.pos.z * 1.3);
        // into body frame
        const fb = fw.applyQuaternion(qInv);
        F.add(fb);
        torque.add(new THREE.Vector3().crossVectors(pb, fb));
        // hard landing detection
        if (-vp.y > 4.2 && comp > 0.02) this._hardLanding = -vp.y;
      }
      this.onGround = anyContact;
      if (anyContact) {
        // strong angular damping on ground (tyre scrub) for stability
        this.omega.multiplyScalar(Math.exp(-dt * 1.2));
      }
    }

    _checkCrash(hGround) {
      if (this._hardLanding) {
        this.crashed = `Hard landing: touched down at ${Math.round(this._hardLanding * U.MS2FPM)} ft/min. ` +
          'The landing gear is designed for about 600-700 ft/min. Fly a stable approach and flare (raise the nose) just before touchdown.';
        this._hardLanding = 0;
        return;
      }
      const q = this.quat;
      for (const hp of D.hardPoints) {
        const pw = vC.set(hp.x, hp.y, hp.z).applyQuaternion(q).add(this.pos);
        const h = SIM.world.height(pw.x, pw.z);
        if (pw.y < Math.max(h, 0) - 0.05) {
          const vs = Math.round(-this.vel.y * U.MS2FPM);
          const surf = SIM.world.surface(pw.x, pw.z);
          if (h <= 0.3 && this.pos.y < 1.5) this.crashed = 'Ditched in the water.';
          else if (this.sys.gearPos < 0.98) this.crashed = this.sys.gearPos < 0.05
            ? 'Belly landing — the landing gear was UP. Always do the "three greens" check (GEAR DOWN, 3 green lights) on final.'
            : 'The landing gear was still in transit — lower it earlier.';
          else this.crashed = `Collision with the ground (${surf}) at ${Math.abs(vs)} ft/min, bank ${Math.round(this.out.roll)}°, pitch ${Math.round(this.out.pitch)}°. ` +
            'A wing tip, the nose or the tail touched the ground.';
          return;
        }
      }
      // tall buildings
      if (SIM.scenery && SIM.scenery.collide && SIM.scenery.collide(this.pos.x, this.pos.y, this.pos.z)) {
        this.crashed = 'Collision with a building.';
        return;
      }
      const o = this.out;
      if (o.g > 11 || o.g < -5) this.crashed = `Structural failure: ${o.g.toFixed(1)} G. The airframe limit is +${D.gLimitPos} / ${D.gLimitNeg} G.`;
      if (o.ias > 640) this.crashed = 'Structural failure: flutter beyond the never-exceed speed (Vne).';
    }

    // ---------------- outputs (what the instruments read) -----------------
    computeOutputs(dt) {
      const o = this.out, s = this.sys, q = this.quat;
      const e = new THREE.Euler().setFromQuaternion(q, 'YXZ');
      o.pitch = e.x * U.RAD;
      o.roll = -e.z * U.RAD;
      o.heading = U.wrap360(-e.y * U.RAD);
      const atm = SIM.atmo.at(this.pos.y, SIM.weather.tempOffset);
      const V = this._V || this.vel.length();
      // Indicated airspeed: what the pitot-static system "feels" = TAS·sqrt(σ)
      let ias = V * Math.sqrt(atm.sigma) * U.MS2KT;
      if (s.pitotIce > 0.3) ias *= 1 - U.smoothstep(0.3, 1, s.pitotIce);
      o.ias = ias;
      o.tas = V * U.MS2KT;
      o.gs = Math.hypot(this.vel.x, this.vel.z) * U.MS2KT;
      o.mach = V / atm.a;
      o.alt = this.pos.y * U.M2FT;
      // Altimeter reads pressure altitude corrected by the pilot's setting (Kollsman window)
      o.altInd = (this.pos.y + (s.qnhSet - SIM.weather.qnh) * 8.43) * U.M2FT;
      o.vs = this.vel.y * U.MS2FPM;
      o.aoa = (this._alpha || 0) * U.RAD;
      o.beta = (this._beta || 0) * U.RAD;
      o.hGround = this._hGround !== undefined ? this._hGround : SIM.world.height(this.pos.x, this.pos.z);
      o.agl = this.pos.y - Math.max(0, o.hGround) - 1.55;
      o.oat = atm.oatC;
      // load factor (G) along the body up axis
      const up = vA.set(0, 1, 0).applyQuaternion(q);
      const aWithG = vB.copy(this._accel).add(vC.set(0, U.G, 0));
      const gRaw = aWithG.dot(up) / U.G;
      o.g = dt > 0 ? U.approach(o.g === undefined ? 1 : o.g, gRaw, 0.08, dt) : 1;
      o.gLat = aWithG.dot(vD.set(1, 0, 0).applyQuaternion(q)) / U.G;
      this.gMax = Math.max(this.gMax, o.g); this.gMin = Math.min(this.gMin, o.g);
      // track: direction we actually move over the ground
      o.track = U.wrap360(Math.atan2(this.vel.x, -this.vel.z) * U.RAD);
      // flight path angle
      o.fpa = Math.atan2(this.vel.y, Math.hypot(this.vel.x, this.vel.z)) * U.RAD;
      // turn rate (deg/s, from yaw rate in world)
      const wWorld = vD.copy(this.omega).applyQuaternion(q);
      o.turnRate = -wWorld.y * U.RAD;
      o.thrust = this._thrust || 0;
      o.fuel = this.fuel;
      o.surface = this._surface;
    }

    // ---------------- user actions (switches) ----------------------------
    action(name, value) {
      const s = this.sys;
      switch (name) {
        case 'start':
          if (!s.engineRunning && s.powered && s.busVolts > 19) { s.starter = true; s.startTimer = 0; this.events.push('starter'); }
          break;
        case 'stopEngine': s.engineMaster = false; break;
        case 'gear': s.gearLever = value !== undefined ? value : 1 - s.gearLever; break;
        case 'flapsDown': s.flapLever = Math.min(1, Math.round(s.flapLever * 2 + 1) / 2); break;
        case 'flapsUp': s.flapLever = Math.max(0, Math.round(s.flapLever * 2 - 1) / 2); break;
        case 'flaps': s.flapLever = value; break;
        case 'airbrake': s.airbrakeSw = value !== undefined ? value : 1 - s.airbrakeSw; break;
        case 'parkingBrake': s.parkingBrake = !s.parkingBrake; break;
        case 'cautionReset': s.masterCaution = false; break;
        case 'gReset': this.gMax = 1; this.gMin = 1; break;
        case 'flare':
          if (s.cmdsArm && s.masterArm && s.powered && s.flares > 0 && !this.onGround) { s.flares -= 2; this.events.push('flare'); }
          break;
        default:
          if (name in s && typeof s[name] === 'boolean') s[name] = value !== undefined ? value : !s[name];
      }
    }
  }

  SIM.Aircraft = Aircraft;
})(typeof window !== 'undefined' ? window : globalThis);
