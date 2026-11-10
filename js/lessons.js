/* ==========================================================================
 * lessons.js — the built-in flight instructor
 *
 * Each lesson is a list of steps. A step says WHAT to do and WHY, and the
 * instructor watches the aircraft to know when you have done it. These are
 * simplified versions of the procedures real pilots follow from checklists.
 * ========================================================================== */
(function (root) {
  'use strict';
  const SIM = root.SIM = root.SIM || {};
  const U = SIM.util;
  const ft = (m) => m * U.M2FT;

  SIM.lessons = [
    {
      id: 'start', title: '1. Cockpit & Engine Start', start: 'apron_cold',
      intro: 'You are sitting in a cold, dark jet on the apron of Falcon Air Base. Real pilots start every flight with checklists — they never rely on memory. Follow the steps; hover the mouse over anything to learn what it is. Tip: press 3 / 4 to look at the left / right consoles, 2 for the instrument panel, 1 to look forward.',
      steps: [
        { t: 'Look at the RIGHT console (press 4) and switch the BATTERY ON.', y: 'The battery is the only source of electricity before the engine runs. Watch the DC BUS voltmeter: about 24 V.', d: (a) => a.sys.battery },
        { t: 'Press MASTER CAUTION (amber light, top-left of the panel) to acknowledge the cautions.', y: 'With power on, the caution panel shows everything not yet ready. MASTER CAUTION is just the attention-getter; reading the caption is what matters.', d: (a) => !a.sys.masterCaution },
        { t: 'LEFT console (press 3): FUEL PUMP → ON.', y: 'The boost pump pushes fuel from the tank to the engine. "FUEL PRESS" caution goes out once the master is on too.', d: (a) => a.sys.fuelPump },
        { t: 'ENGINE MASTER → ON (red-guarded switch).', y: 'Opens the fuel shut-off valve. It is guarded so it cannot be switched off by accident in flight.', d: (a) => a.sys.engineMaster },
        { t: 'Throttle at IDLE (End key). Then press the green START button.', y: 'The starter spins the engine. At ~12% N1 fuel and igniters "light" it; you will see EGT jump. The engine then accelerates by itself to idle (~54%). Takes ~30 s.', d: (a) => a.sys.starter || a.sys.engineRunning },
        { t: 'Monitor N1 and EGT on the right of the main panel (press 2). Wait for idle.', y: 'If EGT went above ~750 °C in a real start you would abort (hot start). Here, it peaks around 600 °C.', d: (a) => a.sys.engineRunning },
        { t: 'GENERATOR → ON (right console).', y: 'The engine now drives the generator: 28 V, and the battery is charged. GEN caution goes out.', d: (a) => a.sys.generator && a.sys.genOnline },
        { t: 'AVIONICS → ON. Watch the attitude indicator: its red OFF flag disappears when the gyro is up to speed.', y: 'Avionics are switched on AFTER the start to protect them from voltage spikes. Gyros need time to spin up.', d: (a) => a.sys.avionics && a.sys.gyroSpin > 0.97 },
        { t: 'PITOT HEAT → ON, NAV lights ON, STROBE ON.', y: 'Pitot heat prevents the airspeed indicator from icing. Lights make you visible.', d: (a) => a.sys.pitotHeat && a.sys.navLights && a.sys.strobe },
        { t: 'Arm the ejection seat: click the small RED lever to the right of the seat pan (look down: press 2 and drag the view lower).', y: 'Seats are kept SAFE on the ground so maintenance crews are never injured. ARMED before taxi.', d: (a) => a.sys.seatArmed },
        { t: 'Set the altimeter: click the BARO knob until the window shows the actual QNH (given in the top-left info box).', y: 'The altimeter is a barometer. Wrong setting = wrong altitude (≈27 ft per hPa).', d: (a) => Math.abs(a.sys.qnhSet - SIM.weather.qnh) < 0.6 },
        { t: 'Done! The jet is ready. Next: release the parking brake (P), add a little power and taxi to runway 27 (west) using rudder keys Z / X to steer the nose wheel. Or choose lesson 2 which starts on the runway.', y: 'Taxi at walking-to-jogging speed (≤ 20 kt). Brake with SPACE.', d: () => false }
      ]
    },
    {
      id: 'takeoff', title: '2. Take-off & Climb', start: 'runway',
      intro: 'Lined up on runway 27 at Falcon Air Base, engine running. Take-off: full power, keep the centreline, rotate at 130 kt, raise the gear once climbing, clean up the flaps, climb to 5,000 ft.',
      steps: [
        { t: 'Set FLAPS to MID (press F once).', y: 'Take-off flap adds lift so you can leave the ground at a lower speed and use less runway.', d: (a) => Math.abs(a.sys.flapPos - 0.5) < 0.05 },
        { t: 'Check the parking brake is OFF (no PARK BRK caution). Press P if needed.', y: 'Taking off against the brakes is impossible — and burns the tyres.', d: (a) => !a.sys.parkingBrake },
        { t: 'Full power: hold PageUp (or Home) until 100% N1. Keep straight with small rudder inputs (Z / X).', y: 'The jet engine takes several seconds to spool up. Watch N1 reach 100% and EGT stabilise.', d: (a) => a.sys.n1 > 96 },
        { t: 'At 130 kt gently pull back (Down arrow) to raise the nose to 8–10° on the HUD pitch ladder.', y: '"Rotate" — the wing reaches its lift-off angle of attack. Too early = drag and a long run; more than ~12° = tail strike!', d: (a) => !a.onGround && a.out.agl > 10 },
        { t: 'Positive rate of climb on the VSI → GEAR UP (G).', y: 'Never raise the gear until you are sure you are climbing: if you settle back down it would collapse onto the runway.', d: (a) => a.sys.gearLever === 0 && a.out.vs > 100 },
        { t: 'Accelerate; above 200 kt raise the flaps (Shift+F).', y: 'Flap limit speed is 230 kt (MID). Clean configuration has the least drag.', d: (a) => a.sys.flapLever === 0 && a.out.ias > 180 },
        { t: 'Climb at about 300 kt to 5,000 ft. Use trim ([ and ], or T) to take the pressure off the stick.', y: 'Trimming means the aircraft holds the attitude by itself. A well-trimmed aircraft is relaxing; an untrimmed one is exhausting.', d: (a) => a.out.altInd > 4800 },
        { t: 'Level off: lower the nose to the horizon BEFORE reaching 5,000 ft and reduce power to ~80% N1.', y: 'Lead the level-off by about 10% of your climb rate (3,000 ft/min → start 300 ft early).', hold: 8, d: (a) => Math.abs(a.out.vs) < 300 && Math.abs(a.out.altInd - 5000) < 400 },
        { t: 'Well done! Explore the area, or press Esc and pick another lesson.', y: '', d: () => false }
      ]
    },
    {
      id: 'handling', title: '3. Basic Handling: turns, climbs, stalls', start: 'air',
      intro: 'In flight at 6,000 ft, 280 kt. Learn the four basic manoeuvres: straight & level, turns, climbs/descents — and how a wing stalls.',
      steps: [
        { t: 'Fly straight and level for 10 seconds: wings level, VSI near zero.', y: 'Attitude flying: pick a pitch attitude on the ADI/HUD, hold it, then confirm with the instruments ("attitude – check – adjust").', hold: 10, d: (a) => Math.abs(a.out.vs) < 400 && Math.abs(a.out.roll) < 8 },
        { t: 'Turn left with 30° of bank (A / Left arrow, then centre the stick) and pull gently to keep altitude. Turn 90°.', y: 'In a bank, part of the lift points sideways and turns you; you must pull a little more to keep the vertical part = weight. At 30° bank you feel 1.15 G.', d: (a, L) => { if (L.hdg0 === undefined) L.hdg0 = a.out.heading; return Math.abs(((a.out.heading - L.hdg0 + 540) % 360) - 180) > 80; } },
        { t: 'Roll out wings level.', y: 'Start rolling out ~10° before the desired heading (about half the bank angle).', hold: 3, d: (a) => Math.abs(a.out.roll) < 6 },
        { t: 'Steep turn: 60° bank, keep altitude. Look at the G-meter: 2 G.', y: 'Load factor = 1 / cos(bank). 60° → 2 G: you weigh twice as much, and stall speed rises by 41%!', hold: 5, d: (a) => Math.abs(a.out.roll) > 52 && Math.abs(a.out.vs) < 1500 },
        { t: 'Roll level. Now climb at 2,000 ft/min for 1,000 ft.', y: 'Raise the nose ~5° and watch the VSI. Speed will decay unless you add power.', d: (a, L) => { if (L.alt0 === undefined) L.alt0 = a.out.altInd; return a.out.altInd > L.alt0 + 1000; } },
        { t: 'STALL PRACTICE: throttle IDLE (End), keep the nose up and wings level as speed decays...', y: 'Watch the AoA gauge climb. At ~13.5° the stall warning sounds; at ~15.5° the wing stalls: buffet, a wing drops, the nose falls.', d: (a) => a.out.aoa > 14 },
        { t: 'RECOVER: push the stick forward to reduce AoA, wings level, FULL POWER (Home). Then ease out of the dive.', y: 'The ONLY cure for a stall is reducing the angle of attack. Pulling harder makes it worse — many fatal accidents happen exactly like that.', d: (a) => a.out.aoa < 8 && a.sys.n1 > 90 && a.out.vs > -500 },
        { t: 'Excellent. Try loops (start at 400 kt, pull 4–5 G) and rolls — watch the G-meter and keep within +8 G.', y: '', d: () => false }
      ]
    },
    {
      id: 'landing', title: '4. ILS Approach & Landing', start: 'final',
      intro: '7 NM final for runway 27 at Falcon Air Base, gear down, full flaps, ILS tuned. Fly the magenta ILS bars on the ADI (or the HUD deviation marks), keep 125–135 kt / AoA 4.5°, and land.',
      steps: [
        { t: 'Stabilise: 125–135 kt, AoA indexer showing the yellow ● (on speed). Adjust power for speed.', y: 'On approach: PITCH controls the flight path, POWER controls the speed/AoA. A stable approach is the foundation of every good landing.', hold: 4, d: (a) => a.out.ias > 118 && a.out.ias < 145 },
        { t: 'Follow the localizer (vertical bar) and glide slope (horizontal bar). Fly TOWARD the bars. Descent ≈ 650 ft/min.', y: 'The ILS works in cloud: localizer from the far end of the runway, glide slope beside the touchdown zone. "Chase the needles small."', d: (a) => a.out.agl * U.M2FT < 1000 },
        { t: 'Look outside: the PAPI lights left of the runway — 2 white + 2 red = on the glide path. Put the HUD flight path marker on the runway numbers.', y: 'PAPI: all white = too high, all red = too low ("red over red, you\'re dead"). The FPM shows exactly where you will hit the ground.', d: (a) => a.out.agl * U.M2FT < 200 },
        { t: 'Check: THREE GREENS (gear down), flaps DOWN. Continue.', y: 'Pilots say it aloud on every landing: "Gear down, three greens".', d: (a) => a.out.agl * U.M2FT < 60 },
        { t: 'At ~30 ft: throttle IDLE and raise the nose slightly (flare) to reduce the descent to a gentle touchdown.', y: 'The flare turns ~700 ft/min into ~150 ft/min. Look at the far end of the runway, not over the nose.', d: (a) => a.onGround },
        { t: 'On the ground: lower the nose wheel, airbrake OUT (B), brakes (hold SPACE). Keep the centreline with rudder.', y: 'Brakes work best once all weight is on the wheels. Below 60 kt you can brake firmly.', d: (a) => a.onGround && a.out.gs < 10 },
        { t: 'Landed! Your touchdown rate is shown in the message. Below 300 ft/min is good, below 150 is a "greaser".', y: '', d: () => false }
      ]
    },
    {
      id: 'nav', title: '5. Navigation: fly to Meridian International', start: 'air_nav',
      intro: 'Airborne near Falcon AB. Navigate to Meridian International (LMRD) ~8 NM south-east and land on runway 34 using its ILS. Use the HSI (cyan needle points to the station) and the moving map.',
      steps: [
        { t: 'Press N until the HSI shows I-MRD34 (Meridian ILS RWY 34). The cyan bearing pointer now points to it.', y: 'Radio navigation: the needle always points TO the station. Turn until it is at the top of the HSI.', d: (a) => SIM.nav.selected(a).id === 'I-MRD34' },
        { t: 'Turn to put the bearing pointer at the top and fly toward the station at 250 kt, 3,000 ft.', y: 'Plan your descent: 3 NM per 1,000 ft to lose (the "3-to-1 rule").', d: () => SIM.nav.out.distNM < 9 },
        { t: 'Intercept the localizer: fly a heading ~30° off course 340 until the course bar starts moving, then turn onto 340.', y: 'An intercept angle of 20–45° lets you join the centreline smoothly.', d: () => SIM.nav.out.ils && Math.abs(SIM.nav.out.cdi) < 0.5 },
        { t: 'Gear DOWN, flaps DOWN, slow to 130 kt. Follow the glide slope down and land.', y: 'Same technique as lesson 4.', d: (a) => a.onGround && a.out.gs < 10 },
        { t: 'Welcome to Meridian!', y: '', d: () => false }
      ]
    },
    {
      id: 'free', title: '6. Free flight', start: 'runway', intro: 'No instructor. Fly anywhere: the city of Port Meridian lies on the coast to the east, mountains to the north (Highland Field is in a valley there). Press I to hide this box.', steps: []
    }
  ];

  // ---------------- instructor runtime ----------------
  const L = SIM.instructor = { lesson: null, step: 0, holdT: 0, mem: {}, doneT: 0 };

  L.begin = function (lesson) {
    L.lesson = lesson; L.step = 0; L.holdT = 0; L.mem = {}; L.doneT = 0;
  };

  L.update = function (ac, dt) {
    const ls = L.lesson;
    if (!ls || !ls.steps.length) return;
    const st = ls.steps[L.step];
    if (!st) return;
    let ok = false;
    try { ok = st.d(ac, L.mem); } catch (e) { ok = false; }
    if (ok) L.holdT += dt; else L.holdT = 0;
    if (ok && L.holdT >= (st.hold || 0)) {
      L.doneT += dt;
      if (L.doneT > 1.2 && L.step < ls.steps.length - 1) { L.step++; L.holdT = 0; L.doneT = 0; L.mem = {}; SIM.audio && SIM.audio.click(); }
    } else L.doneT = 0;
  };

  L.skip = function () { if (L.lesson && L.step < L.lesson.steps.length - 1) { L.step++; L.holdT = 0; L.mem = {}; } };
  L.back = function () { if (L.lesson && L.step > 0) { L.step--; L.holdT = 0; L.mem = {}; } };
})(typeof window !== 'undefined' ? window : globalThis);
