# Kestrel Flight Trainer — a cockpit flight simulator you can learn from

A 3D flight simulator of a **semi-military advanced jet trainer** (the fictional *Kestrel T.2*) flown **from inside the cockpit**, in a **real-scale world** (1 unit = 1 metre) and in **real time** (1 second = 1 second). It runs in your web browser on an ordinary home computer — no installation, no internet needed.

Every switch and instrument in the cockpit works, and **hovering the mouse over any of them explains what it is, how it works, why it matters and how pilots use it in real life**. A built-in instructor walks you through lessons, and a full **Pilot's Handbook** (`handbook.html`) teaches the theory.

## How to run it

1. Download the repository (green **Code** button → **Download ZIP**) and unzip it, or `git clone` it.
2. Double-click **`index.html`**. It opens in your browser (Chrome, Edge or Firefox recommended).
3. Pick a lesson (start with **1. Cockpit & Engine Start**) or a free-flight start position.

> If your browser refuses to open local files, run a tiny local server in the folder instead:
> `python -m http.server 8000` and open http://localhost:8000

A joystick/HOTAS or gamepad is supported but not required — everything works with keyboard + mouse.

## What's in it

**Cockpit (the main view)**
- 3D cockpit: instrument panel, left & right consoles, control stick and throttle that move, canopy frame, ejection seat, rudder pedals, HUD combiner glass. Wings visible when you look out to the side.
- **Look anywhere**: right-drag the mouse (or Shift + arrows, or a gamepad's right stick) — up through the canopy, down to the panel, sideways at the wing, back over your shoulder. The head leans when you look to the side or down at the panel. Mouse wheel zooms so you can read small gauges. Keys 1–7 snap to views (forward, panel, left console, right console, left wing, right wing, behind).
- Working instruments: airspeed (with Mach), attitude (with ILS bars & slip ball), altimeter (with QNH setting), VSI, turn coordinator, HSI (heading bug, course, bearing pointer, DME), AoA, G-meter with max/min memory, radar altimeter, clock, engine RPM, EGT, fuel flow, fuel quantity, oil & hydraulic pressure, volt-meter, gear lights, flap & trim indicators, 16-light caution panel with MASTER CAUTION, AoA indexer, and a **moving-map display**.
- Working switches: battery, generator, avionics, fuel pump, engine master, ignition, START, pitot heat, nav/strobe/landing/taxi lights, yaw damper, anti-skid, master arm, countermeasures (flares), gear lever, flaps lever, airbrake, parking brake, seat arming lever, ejection handle, altimeter/heading/course knobs, map range, NAV select.
- **Military-style HUD**: flight path marker, pitch ladder, heading tape, speed/altitude/radar altitude, G, Mach, AoA, −3° glide-path line, AoA approach bracket, ILS deviation, waypoint steering, STALL / PULL UP / OVER G warnings.

**Physics (real equations, 240 Hz)**
- 6-degree-of-freedom flight model: lift and drag from angle of attack, real stall with wing drop, flaps/gear/airbrake drag, ground effect, transonic drag rise, stability and damping, inertia.
- International Standard Atmosphere: air density, temperature and pressure change with altitude → thrust, lift and IAS vs TAS behave realistically.
- Jet engine with realistic spool-up lag, start sequence (starter → light-off → idle), EGT, fuel burn; electrical, fuel, and hydraulic systems; pitot icing if you forget the pitot heat.
- Landing gear with springs, dampers, tyre friction, differential braking and nose-wheel steering; hard landings, belly landings and crashes are detected and explained.
- Wind with altitude gradient, gusts and turbulence; the windsocks show it.
- G-effects on the pilot: grey-out / tunnel vision / black-out under sustained high G, red-out under negative G.

**The world (real scale, ~140 × 140 km)**
- Terrain with plains, hills, a mountain range with snow caps, a coastline with beaches and sea.
- Forests with tens of thousands of individual trees, farmland patchwork, hedgerows.
- 13 towns with houses and streets, and the coastal city of **Port Meridian** with skyscrapers (lit windows at night).
- Highways connecting everything.
- 3 airfields: **Falcon Air Base** (military: 3 km runway, ILS, PAPI, approach lights, hardened aircraft shelters, hangars, tower, parked jets), **Meridian International** (ILS), and **Highland Field** (short strip in the hills).
- Real sun position for your chosen time of day (dawn, day, sunset, night with stars and lights), clouds you can fly through, visibility/haze.

**Learning**
- Instructor lessons: (1) cockpit & engine start, (2) take-off & climb, (3) turns, climbs & stalls, (4) ILS approach & landing, (5) navigation to another airport, (6) free flight. Each step says **what** to do and **why**, and detects when you've done it.
- Hover explanations for every control and instrument.
- `handbook.html` — the Pilot's Handbook: four forces, angle of attack & stall, controls, IAS/TAS/Mach, instruments and the scan, the HUD, the jet engine, systems, checklists, the traffic pattern, ILS, navigation, G-forces, emergencies, limits, and a practice plan.
- Voice call-outs on approach (500, 100, 50, 30, 10 ft) and "PULL UP" warnings.

## Controls (summary — press F1 in the simulator for the full list)

| Action | Keys |
|---|---|
| Pitch (pull / push) | ↓ / ↑ or S / W |
| Roll | ← / → or A / D |
| Rudder / nose-wheel steering | Z / X |
| Throttle | PageUp / PageDown or + / − ; Home = full, End = idle |
| Trim | [ / ] ; T = trim to current stick |
| Gear / Flaps / Airbrake | G / F, Shift+F / B |
| Wheel brakes / parking brake | Space (hold), `,` `.` differential / P |
| Look around | Right-drag mouse, Shift+arrows, keys 1–7, wheel = zoom, C = centre |
| Outside view | 0 or F2 |
| Click switches | Left mouse; knobs: left half −, right half +, or mouse wheel |
| Mouse flying | M |
| NAV destination | N |
| Flares | Q (needs MASTER ARM + CMDS) |
| Auto start-up | Ctrl+E |
| Pause / menu | Esc |
| Sim speed | K (1×, 2×, 4×, ½×) |

## Files

```
index.html        the simulator page
handbook.html     the Pilot's Handbook
css/style.css     user interface styles
lib/three.min.js  three.js r149 3D engine (MIT licence, bundled so it works offline)
js/util.js        maths, noise, unit conversions
js/world.js       geography: terrain height, airports, towns, roads, navaids
js/atmosphere.js  standard atmosphere and weather
js/aircraft.js    flight dynamics model and aircraft systems
js/nav.js         radio navigation and ILS
js/terrain.js     level-of-detail terrain rendering
js/env.js         sun, sky, sea, clouds
js/scenery.js     trees, buildings, city, roads, airfields, PAPI lights
js/model.js       3D aircraft and cockpit
js/panel.js       instrument and console drawing, clickable controls
js/hud.js         head-up display
js/info.js        explanations shown on hover
js/input.js       keyboard, mouse, joystick, gamepad, head movement
js/audio.js       synthesized engine, wind, warnings, call-outs
js/lessons.js     instructor lessons
js/main.js        main loop and user interface
```

## Performance tips

Choose **Graphics: Low** in the menu on older laptops. A dedicated graphics card gives the smoothest experience; on integrated graphics expect 30–60 fps at Medium.

## A note on realism

The Kestrel is a fictional aircraft with numbers typical of real advanced jet trainers, and its flight model is built from real aerodynamic equations. Procedures (checklists, ILS, traffic pattern, stall recovery) follow real-world practice in simplified form. A simulator is a great way to understand **how and why** an aircraft works and to practise procedures and instrument flying — but it is not a substitute for training with a qualified flight instructor.
