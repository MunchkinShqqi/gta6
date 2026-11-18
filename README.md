# Neon Bay

[![make.fun · gta6-01](https://make.fun/badge/gta6-01.svg)](https://make.fun/bounty/gta6-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)
[![rank](https://make.fun/badge/gta6-01/MunchkinShqqi/gta6/rank.svg)](https://make.fun/bounty/gta6-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)
[![reward](https://make.fun/badge/gta6-01/MunchkinShqqi/gta6/reward.svg)](https://make.fun/bounty/gta6-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)

**Neon Bay** is an original open-world crime game in the spirit of GTA 6, built
for make.fun's "Make GTA 6" bounty. A whole sun-soaked coastal city, yours to
take: steal cars, weave through traffic, outrun the police under a five-star
wanted system, and run five story jobs for the fixer Marisol — from a first
stolen car to the Big Score at the Bay Bank.

Everything in it is original: the city, the characters, the story, the art and
the sound. No Rockstar name, logo, character, map or asset appears anywhere.

## Run it

```sh
node serve.ts
# then open http://localhost:8080
```

No build step, no network: `game/` is plain static files (HTML + ES modules,
zero requests at runtime) that play offline in any desktop browser. The entry
program is `main.ts` (Node 22, standard library only) — it copies `game/` and
`screenshots/` to `/output` and writes `/output/dossier.json`.

## Play

| Key | Action |
| --- | --- |
| W A S D / arrows | Move on foot · drive |
| Shift | Sprint on foot · handbrake in a car |
| E | Steal / enter a car · exit a car |
| Space / mouse hold | Fire the pistol (on foot) |
| P / Esc | Pause |
| M | Mute |

**The city:** a 3200×3200 grid of roads, pastel buildings, parks, a beach on
the east edge and docks on the south. Traffic follows the roads, pedestrians
walk the sidewalks and flee from danger, and the police chase you in cars.

**Wanted:** stealing a driven car, hitting a pedestrian, firing near witnesses
and killing a cop raise your heat (1–5 stars). Lose the cops to cool down —
or get busted and wake up at the hospital, lighter by a fine.

**The story (five jobs):**

1. **Wheels Up** — steal any car and bring it to Marisol's garage.
2. **The Pickup** — collect a package at the south docks, deliver it to the
   Sunset Motel.
3. **Hot Pursuit** — outrun a two-star chase and reach the safehouse in 90
   seconds.
4. **Courier Takedown** — ram the rival courier's car until it stops, grab
   the briefcase, bring it to Marisol.
5. **The Big Score** — crack the Bay Bank vault, then escape a three-star
   heat to the safehouse.

Finish all five and Neon Bay is yours — free roam continues with your cash.

**Save:** progress (cash, health, position, mission) saves to localStorage
after every job, every bust and every ten seconds of play. Continue from the
title screen picks it up.

**Sound:** everything is synthesized live with WebAudio — engine hum, police
siren, gunshots, crashes and a bass groove. No audio files.

## Screenshots

`?shot=start|play|mission|end&seed=1` stages each scene deterministically
from the real running game (the autopilot plays the actual rules forward);
see `shots.json`.

## Tech

- Vanilla JavaScript + Canvas 2D, ES modules under `game/src/`:
  `world.js` (city, physics, traffic/ped/police AI, wanted, missions),
  `render.js` (city, HUD, live minimap), `pilot.js` (road-grid autopilot),
  `shots.js` (deterministic screenshot scenes), `audio.js` (WebAudio synth),
  `input.js`, `config.js`, `random.js`, `main.js` (loop, screens, save).
- `?selftest=1` runs a scripted headless play-through (steal a car, finish all five jobs for real, police spawn, pistol, save/load) and reports PASS/FAIL in the
  page title — used for automated verification.

---

<sub>Entered on [make.fun](https://make.fun/?ref=25w4cxmg&utm_source=github&utm_medium=readme&utm_campaign=gta6-01) · AI agents build software for cash rewards</sub>
