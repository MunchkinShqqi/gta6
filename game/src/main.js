// Boot and the one loop: input is read every frame, the world advances in fixed
// 1/60 s steps (several in a slow frame, none in a fast one), and the renderer
// paints what is there. The game moves between six screens: title, play, paused,
// busted, mission complete and story complete. Progress saves to localStorage
// (cash, health, position, mission) on every job done, every bust and every
// ten seconds of play.
//
// ?seed=N fixes the city and the traffic. ?shot=start|play|mission|end (with
// &seed=N) stages that scene instead of running the loop, paints it twice and
// sets window.__shotReady for a screenshot. ?selftest=1 runs a scripted
// headless play-through (steal a car, finish two jobs, outrun the cops, fire
// the pistol, save and load) and writes PASS/FAIL into the page title and the
// status line, for automated verification.
import { BEST_KEY, MISSIONS, PLACES, PLAYER, SAVE_KEY, STEP, VIEW, WORLD } from './config.js';
import { createRandom } from './random.js';
import {
  createWorld, EVENT_BUSTED, EVENT_COIN, EVENT_CRASH, EVENT_FAIL, EVENT_HEALTH,
  EVENT_MISSION, EVENT_SHOT, EVENT_STEP, EVENT_STORY,
} from './world.js';
import { ACTION_CONFIRM, ACTION_INTERACT, ACTION_MUTE, ACTION_PAUSE, createInput } from './input.js';
import { createAudio } from './audio.js';
import {
  createRenderer, SCREEN_BUSTED, SCREEN_MISSION, SCREEN_PAUSED, SCREEN_PLAY,
  SCREEN_STORY, SCREEN_TITLE,
} from './render.js';
import { stageShot } from './shots.js';
import { driveControl, routeJunctions, walkControl } from './pilot.js';

const MAX_FRAME = 0.25;
const AUTOSAVE_SECONDS = 10;

const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const selftest = params.get('selftest') === '1';
const seedParam = Number.parseInt(params.get('seed') ?? '', 10);
const seed = Number.isInteger(seedParam) ? seedParam : Math.floor(Math.random() * 4294967296);

const canvas = document.getElementById('game');
const status = document.getElementById('status');
const world = createWorld(createRandom(seed));
const renderer = createRenderer(canvas);
const audio = createAudio();

function readJson(key) {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeJson(key, value) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage can be off (private windows): progress then lasts this visit only.
  }
}

function readBest() {
  const saved = readJson(BEST_KEY);
  return typeof saved === 'number' ? saved : 0;
}

function saveAll() {
  writeJson(SAVE_KEY, world.makeSave());
  writeJson(BEST_KEY, Math.max(readBest(), world.state.bestCash));
}

// ---- screenshot scenes ----
// Painted synchronously: headless --screenshot can capture before the first
// requestAnimationFrame fires, and canvas 2D needs no async font/layout step.
if (shot) {
  const scene = stageShot(shot, world);
  const ui = uiFor(world, scene.screen, readBest(), false, null);
  renderer.draw(world.state, scene.screen, ui);
  window.__shotReady = true;
  status.textContent = `shot:${shot} screen:${scene.screen} cash:${world.state.cash} mission:${world.state.missionIndex}`;
} else if (selftest) {
  runSelftest();
} else {
  runGame();
}

function uiFor(world, screen, best, hasSave, toast) {
  const st = world.state;
  const step = world.currentStep();
  const mission = world.currentMission();
  let objective = '';
  if (st.storyComplete) objective = 'Free roam — Neon Bay is yours. (Missions done: 5/5)';
  else if (mission && step) objective = `${mission.title}: ${step.text}`;
  let timer = null;
  if (mission && mission.timeLimit && st.missionTimer > 0) timer = st.missionTimer;
  let holdProgress = 0;
  if (step && step.type === 'hold' && step.seconds) holdProgress = st.holdProgress / step.seconds;
  return {
    best,
    hasSave,
    stars: world.stars(),
    objective,
    timer,
    holdProgress,
    toast,
    muted: audio.isMuted(),
    bustedText: st.message,
    missionText: st.message,
  };
}

// ---- headless self-test ----
function runSelftest() {
  const results = [];
  const check = (name, ok, detail) => results.push({ name, ok: !!ok, detail: detail ?? '' });
  const S = world.state;
  const IDLE = { vx: 0, vy: 0, sprint: false, interact: false, shootHeld: false, aimAngle: null };
  let busts = 0;
  let policeSeen = false;

  const distTo = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);

  function angleDiff(a, b) {
    let d = a - b;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    return d;
  }

  function stepWorld(ctl) {
    const ev = world.step(STEP, ctl);
    if (ev & EVENT_BUSTED) busts += 1;
    if (S.cars.some((c) => c.kind === 'police')) policeSeen = true;
    return ev;
  }

  /** Walk the road grid to (tx, ty): junction to junction, so buildings never block the way. */
  function walkRoute(tx, ty, maxSeconds = 60, arriveRadius = 40) {
    const steps = Math.floor(maxSeconds / STEP);
    let route = routeJunctions(S.player.x, S.player.y, tx, ty);
    let wp = 0;
    for (let i = 0; i < steps; i += 1) {
      const p = S.player;
      if (p.inCar) return false;
      if (distTo(tx, ty, p.x, p.y) < arriveRadius) return true;
      const target = wp < route.length - 1 ? route[wp] : { x: tx, y: ty };
      if (wp < route.length - 1 && distTo(route[wp].x, route[wp].y, p.x, p.y) < 30) wp += 1;
      const ctl = walkControl(p.x, p.y, target.x, target.y);
      const ev = stepWorld({ vx: ctl.vx, vy: ctl.vy, sprint: true, interact: false, shootHeld: false, aimAngle: null });
      if (ev & EVENT_BUSTED) return false;
      if (i % 360 === 0 && i > 0) {
        route = routeJunctions(p.x, p.y, tx, ty);
        wp = 0;
      }
    }
    return distTo(tx, ty, S.player.x, S.player.y) < arriveRadius + 20;
  }

  /** Nearest car the player can get into: a parked one (no heat) or their own
   *  stopped car (also no heat). Traffic cars are not listed here. */
  function nearestSpareCar() {
    let best = null;
    let bestD = Infinity;
    for (const car of S.cars) {
      if (car.kind !== 'parked' && car.kind !== 'player') continue;
      const d = distTo(car.x, car.y, S.player.x, S.player.y);
      if (d < bestD) {
        bestD = d;
        best = car;
      }
    }
    return { car: best, dist: bestD };
  }

  function stealCar(maxSeconds = 30) {
    const { car } = nearestSpareCar();
    if (car) {
      if (!walkRoute(car.x, car.y, maxSeconds, 50)) return false;
      // One interact press gets in; a second would get back out again.
      for (let i = 0; i < 3 / STEP; i += 1) {
        if (S.player.inCar) return true;
        stepWorld({ ...IDLE, interact: i === 0 });
      }
      return !!S.player.inCar;
    }
    // No parked car left anywhere: jack the nearest driven one (costs heat).
    const steps = Math.floor(maxSeconds / STEP);
    for (let i = 0; i < steps; i += 1) {
      const p = S.player;
      if (p.inCar) return true;
      let moving = null;
      let bestD = Infinity;
      for (const c of S.cars) {
        if (c.kind !== 'traffic') continue;
        const d = distTo(c.x, c.y, p.x, p.y);
        if (d < bestD) {
          bestD = d;
          moving = c;
        }
      }
      if (!moving) return false;
      const ctl = walkControl(p.x, p.y, moving.x, moving.y);
      stepWorld({ vx: ctl.vx, vy: ctl.vy, sprint: true, interact: bestD < 60, shootHeld: false, aimAngle: null });
      if (S.player.inCar) return true;
    }
    return !!S.player.inCar;
  }

  function ensureCar(minHealth = 40) {
    const p = S.player;
    if (p.inCar && p.inCar.health >= minHealth) return true;
    if (p.inCar && S.heat > 0 && p.inCar.health >= 25) {
      // Cops are about: getting out to swap means standing on foot next to
      // them. Keep the battered-but-drivable car; the caller retries once the
      // heat clears.
      return true;
    }
    if (p.inCar) {
      // Drive up to a parked car first, so the swap is a quick hop, not a walk
      // across town with the cops on the player's heels.
      const { car } = nearestSpareCar();
      if (car) driveTo(car.x, car.y, 20, 70);
      if (S.player.inCar) stepWorld({ ...IDLE, interact: true });
    }
    return stealCar(40);
  }

  /** 34 px to the right of the direction from -> to (axis-aligned legs): the
   *  right-hand lane. Peds and traffic drive the centre line; 34 px clears
   *  both hit radii (25 px for a ped, 32 px between cars). */
  function lanePoint(from, to) {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    if (Math.abs(dx) >= Math.abs(dy)) {
      return { x: to.x, y: to.y + (dx > 0 ? 34 : -34) };
    }
    return { x: to.x + (dy > 0 ? -34 : 34), y: to.y };
  }

  /** Drive the player's car to (tx, ty), in the right-hand lane. */
  function driveTo(tx, ty, maxSeconds = 120, arriveRadius = 60) {
    const stuck = { time: 0, reverseUntil: -1 };
    let route = routeJunctions(S.player.inCar.x, S.player.inCar.y, tx, ty);
    let wp = 0;
    let from = { x: S.player.inCar.x, y: S.player.inCar.y };
    const steps = Math.floor(maxSeconds / STEP);
    for (let i = 0; i < steps; i += 1) {
      const car = S.player.inCar;
      if (!car) return { arrived: false, wrecked: true };
      const raw = route[Math.min(wp, route.length - 1)];
      const target = lanePoint(from, raw);
      if (distTo(target.x, target.y, car.x, car.y) < 55 && wp < route.length - 1) {
        from = raw;
        wp += 1;
        continue;
      }
      const ctl = driveControl(car, target, stuck, S.time);
      const ev = stepWorld({ vx: ctl.vx, vy: ctl.vy, sprint: ctl.sprint, interact: false, shootHeld: false, aimAngle: null });
      if (ev & EVENT_BUSTED) return { arrived: false, busted: true };
      if (ev & EVENT_MISSION) return { arrived: true, mission: true };
      if (ev & EVENT_FAIL) return { arrived: false, failed: true };
      if (distTo(tx, ty, car.x, car.y) < arriveRadius) return { arrived: true };
      if (i % 360 === 0 && i > 0) {
        route = routeJunctions(car.x, car.y, tx, ty);
        wp = 0;
        from = { x: car.x, y: car.y };
      }
    }
    const car = S.player.inCar;
    return { arrived: car ? distTo(tx, ty, car.x, car.y) < arriveRadius + 20 : false, timeout: true };
  }

  /** Ensure a car and drive to a target; retries wrecks and timeouts. */
  function driveLeg(tx, ty, maxSeconds = 120) {
    for (let i = 0; i < 3; i += 1) {
      if (!ensureCar(40)) return 'fail';
      const r = driveTo(tx, ty, maxSeconds, 60);
      if (r.mission) return 'mission';
      if (r.busted) return 'busted';
      if (r.failed) return 'failed';
      if (r.arrived) return 'arrived';
    }
    return 'fail';
  }

  /**
   * Lose the heat: loop the map-edge roads in a lane 34 px off the centre line
   * (peds and traffic drive the centre line; 34 px clears both hit radii),
   * easing off for corners so the car takes the turn instead of the wall.
   * Returns true when the heat is gone.
   */
  function fleeLoop(maxSeconds = 60) {
    const loop = [
      { x: 3116, y: 1084 }, { x: 3116, y: 3116 }, { x: 34, y: 3116 },
      { x: 34, y: 34 }, { x: 3116, y: 34 }, { x: 3116, y: 1084 },
    ];
    const stuck = { time: 0, reverseUntil: -1 };
    if (!S.player.inCar && !stealCar(30)) return false;
    // Get onto the loop via the roads first.
    let wp = 0;
    let bestD = Infinity;
    for (let i = 0; i < loop.length; i += 1) {
      const d = distTo(loop[i].x, loop[i].y, S.player.inCar.x, S.player.inCar.y);
      if (d < bestD) {
        bestD = d;
        wp = i;
      }
    }
    const approach = driveTo(loop[wp].x, loop[wp].y, 30, 90);
    if (approach.busted || approach.wrecked) return false;
    if (approach.mission) return true;
    const deadline = S.time + maxSeconds;
    while (S.time < deadline) {
      if (S.heat <= 0) return true;
      const car = S.player.inCar;
      if (!car) return false;
      const target = loop[wp];
      if (distTo(target.x, target.y, car.x, car.y) < 90) wp = (wp + 1) % loop.length;
      const ctl = driveControl(car, loop[wp], stuck, S.time);
      const want = Math.atan2(loop[wp].y - car.y, loop[wp].x - car.x);
      if (Math.abs(angleDiff(want, car.angle)) > 0.9) ctl.vy = -0.35;
      const ev = stepWorld({ vx: ctl.vx, vy: ctl.vy, sprint: ctl.sprint, interact: false, shootHeld: false, aimAngle: null });
      if (ev & EVENT_BUSTED) return false;
      if (ev & EVENT_MISSION) return true;
    }
    return S.heat <= 0;
  }

  /** Stand still (heat must be 0) until the player heals up. */
  function healUp(maxSeconds = 25, targetHp = 80) {
    const steps = Math.floor(maxSeconds / STEP);
    for (let i = 0; i < steps; i += 1) {
      if (S.player.health >= targetHp) return true;
      if (!S.player.inCar) return false;
      if (S.heat > 0) return false;
      stepWorld(IDLE);
    }
    return S.player.health >= targetHp;
  }

  /** Would a shot right now be seen (same rule the engine uses for heat)? */
  function witnessed() {
    const p = S.player;
    for (const c of S.cars) {
      if (c.kind === 'police' && distTo(c.x, c.y, p.x, p.y) < 500) return true;
    }
    for (const ped of S.peds) {
      if (ped.state !== 'down' && distTo(ped.x, ped.y, p.x, p.y) < 300) return true;
    }
    return false;
  }

  /**
   * Mission 4: run the courier down and shoot his car until it stops.
   * The courier flees at 430 and the player car tops 560, so the chase closes
   * in; rear-end taps deal no damage (closing speed under 220), so the test
   * bails out close behind and shoots point-blank with intercept aim — only
   * when no witness is near, so firing adds no heat and no police come.
   * True when the briefcase is on the ground.
   */
  function huntCourier(maxSeconds = 300) {
    const stuck = { time: 0, reverseUntil: -1 };
    const steps = Math.floor(maxSeconds / STEP);
    let mode = 'chase';
    let exitCar = null;
    let shootUntil = 0;
    for (let i = 0; i < steps; i += 1) {
      if (!S.courier && S.briefcase) return true;
      const p = S.player;
      if (mode === 'chase') {
        if (!p.inCar) {
          if (!stealCar(30)) return false;
          continue;
        }
        const c = S.courier;
        if (!c) {
          stepWorld(IDLE); // a bust cleared the courier; the chase step respawns it
          continue;
        }
        const d = distTo(c.x, c.y, p.inCar.x, p.inCar.y);
        if (d < 260) {
          exitCar = p.inCar;
          stepWorld({ ...IDLE, interact: true });
          mode = 'shoot';
          shootUntil = S.time + 4;
          continue;
        }
        const ctl = driveControl(p.inCar, { x: c.x, y: c.y }, stuck, S.time);
        const ev = stepWorld({ vx: ctl.vx, vy: ctl.vy, sprint: ctl.sprint, interact: false, shootHeld: false, aimAngle: null });
        if (ev & EVENT_BUSTED) {
          mode = 'chase';
          exitCar = null;
        }
      } else if (mode === 'shoot') {
        const c = S.courier;
        if (!c) {
          mode = 'recover';
          continue;
        }
        const d = distTo(c.x, c.y, p.x, p.y);
        const copNear = S.cars.some((car) => car.kind === 'police' && distTo(car.x, car.y, p.x, p.y) < 200);
        if (S.time > shootUntil || d > 750 || p.health < 40 || copNear) {
          mode = 'recover';
          continue;
        }
        // Intercept aim: two passes of time-of-flight against the courier's motion.
        let t = d / PLAYER.bulletSpeed;
        let ax = c.x + Math.cos(c.angle) * c.speed * t;
        let ay = c.y + Math.sin(c.angle) * c.speed * t;
        t = distTo(ax, ay, p.x, p.y) / PLAYER.bulletSpeed;
        ax = c.x + Math.cos(c.angle) * c.speed * t;
        ay = c.y + Math.sin(c.angle) * c.speed * t;
        const aim = Math.atan2(ay - p.y, ax - p.x);
        const wc = walkControl(p.x, p.y, c.x, c.y);
        stepWorld({ vx: wc.vx, vy: wc.vy, sprint: true, interact: false, shootHeld: !witnessed(), aimAngle: aim });
      } else {
        // Recover: get back in the car we bailed out of, or steal a closer one.
        if (p.inCar) {
          mode = 'chase';
          continue;
        }
        const target = exitCar && S.cars.includes(exitCar) ? exitCar : null;
        if (target && distTo(target.x, target.y, p.x, p.y) <= 600) {
          if (distTo(target.x, target.y, p.x, p.y) < 60) {
            stepWorld({ ...IDLE, interact: true });
            mode = 'chase';
            continue;
          }
          const wc = walkControl(p.x, p.y, target.x, target.y);
          stepWorld({ vx: wc.vx, vy: wc.vy, sprint: true, interact: false, shootHeld: false, aimAngle: null });
        } else if (stealCar(30)) {
          mode = 'chase';
        } else {
          return false;
        }
      }
    }
    return !!S.briefcase;
  }

  function runMission2() {
    if (!ensureCar(80)) return false;
    const busts0 = busts;
    for (let guard = 0; guard < 12 && S.missionIndex === 1 && busts - busts0 < 3; guard += 1) {
      const step = world.currentStep();
      if (!step) break;
      const leg = step.at === 'docks'
        ? driveLeg(PLACES.docks.x, PLACES.docks.y, 150)
        : step.at === 'motel'
          ? driveLeg(PLACES.motel.x, PLACES.motel.y, 150)
          : 'fail';
      if (leg === 'mission') return true;
      if (leg === 'busted' || leg === 'failed') continue;
      if (leg === 'fail') return false;
      // 'arrived': the next step is up
    }
    return S.missionIndex > 1;
  }

  function runMission3() {
    if (!ensureCar(80)) return false;
    const busts0 = busts;
    for (let guard = 0; guard < 8 && S.missionIndex === 2 && busts - busts0 < 3; guard += 1) {
      if (!world.currentStep()) break;
      const leg = driveLeg(PLACES.safehouse.x, PLACES.safehouse.y, 80);
      if (leg === 'mission') return true;
      if (leg === 'busted' || leg === 'failed') continue;
      if (leg === 'fail') return false;
    }
    return S.missionIndex > 2;
  }

  function runMission4() {
    const busts0 = busts;
    for (let guard = 0; guard < 20 && S.missionIndex === 3 && busts - busts0 < 4; guard += 1) {
      const step = world.currentStep();
      if (!step) break;
      if (step.type === 'chase') {
        // Lose the heat on the loop first, while still rolling (swapping or
        // shooting with the cops glued on gets the player busted), then a
        // fresh car, healed up, before the takedown.
        fleeLoop(60);
        if (!ensureCar(80)) return false;
        healUp(25, 80);
        if (!huntCourier(300)) return false;
        continue;
      }
      if (step.type === 'goto' && step.at === 'briefcase') {
        const b = S.briefcase;
        if (!b) {
          stepWorld(IDLE);
          continue;
        }
        let leg;
        if (S.player.inCar) leg = driveLeg(b.x, b.y, 90);
        else if (walkRoute(b.x, b.y, 60, 40)) leg = 'arrived';
        else leg = 'fail';
        if (leg === 'mission') return true;
        if (leg === 'busted' || leg === 'failed') continue;
        if (leg === 'fail') {
          if (!S.player.inCar && !ensureCar(40)) return false;
          leg = driveLeg(b.x, b.y, 90);
          if (leg === 'mission') return true;
          if (leg === 'fail') return false;
          continue;
        }
        continue;
      }
      if (step.type === 'goto' && step.at === 'garage') {
        const leg = driveLeg(PLACES.garage.x, PLACES.garage.y, 150);
        if (leg === 'mission') return true;
        if (leg === 'busted' || leg === 'failed') continue;
        if (leg === 'fail') return false;
        continue;
      }
      break;
    }
    return S.missionIndex > 3;
  }

  /**
   * Hold still at the bank vault for the 8-second drill. Stopping a car
   * precisely inside the radius is fiddly (it overshoots and the progress
   * decays), so the test bails out at the vault door and holds on foot:
   * standing still is exact. The car stops dead on exit, right there for the
   * escape.
   */
  function holdAtBank(maxSeconds = 30) {
    const stuck = { time: 0, reverseUntil: -1 };
    const steps = Math.floor(maxSeconds / STEP);
    let onFoot = false;
    for (let i = 0; i < steps; i += 1) {
      const p = S.player;
      if (p.inCar) {
        const car = p.inCar;
        const d = distTo(PLACES.bank.x, PLACES.bank.y, car.x, car.y);
        if (d < 50) {
          stepWorld({ ...IDLE, interact: true });
          onFoot = true;
          continue;
        }
        const ctl = driveControl(car, PLACES.bank, stuck, S.time);
        const ev = stepWorld({ vx: ctl.vx, vy: ctl.vy, sprint: ctl.sprint, interact: false, shootHeld: false, aimAngle: null });
        if (ev & EVENT_BUSTED) return 'busted';
        if (ev & EVENT_FAIL) return 'failed';
        if (ev & EVENT_STEP) return 'arrived';
        if (ev & EVENT_MISSION) return 'mission';
      } else if (onFoot) {
        // On foot at the bank: get within 40 px, then stand still.
        const d = distTo(PLACES.bank.x, PLACES.bank.y, p.x, p.y);
        let ctl = IDLE;
        if (d > 40) {
          const wc = walkControl(p.x, p.y, PLACES.bank.x, PLACES.bank.y);
          ctl = { vx: wc.vx, vy: wc.vy, sprint: false, interact: false, shootHeld: false, aimAngle: null };
        }
        const ev = stepWorld(ctl);
        if (ev & EVENT_BUSTED) return 'busted';
        if (ev & EVENT_FAIL) return 'failed';
        if (ev & EVENT_STEP) return 'arrived';
        if (ev & EVENT_MISSION) return 'mission';
      } else {
        return 'fail';
      }
    }
    return 'fail';
  }

  function runMission5() {
    const busts0 = busts;
    let prepped = false;
    for (let guard = 0; guard < 12 && S.missionIndex === 4 && busts - busts0 < 3; guard += 1) {
      const step = world.currentStep();
      if (!step) break;
      if (step.type === 'goto' && step.at === 'bank' && !prepped) {
        prepped = true;
        fleeLoop(60);
        if (!ensureCar(80)) return false;
        healUp(25, 80);
        continue;
      }
      if (step.type === 'goto' && step.at === 'bank') {
        const leg = driveLeg(PLACES.bank.x, PLACES.bank.y, 150);
        if (leg === 'mission') return true;
        if (leg === 'busted' || leg === 'failed') continue;
        if (leg === 'fail') return false;
        continue;
      }
      if (step.type === 'hold') {
        const leg = holdAtBank(30);
        if (leg === 'mission') return true;
        if (leg === 'busted' || leg === 'failed') continue;
        if (leg === 'fail') return false;
        continue;
      }
      if (step.type === 'goto' && step.at === 'safehouse') {
        const leg = driveLeg(PLACES.safehouse.x, PLACES.safehouse.y, 150);
        if (leg === 'mission') return true;
        if (leg === 'busted' || leg === 'failed') continue;
        if (leg === 'fail') return false;
        continue;
      }
      break;
    }
    return S.storyComplete;
  }

  try {
    world.reset();
    // 1. Walk to the nearest parked car and steal it.
    const stole = stealCar(20);
    check('steal car', stole, stole ? 'in a car' : 'never got in');
    // 2. Mission 1 — Wheels Up: drive to the garage (+$300).
    let cash0 = S.cash;
    let busts0 = busts;
    let m1 = false;
    if (stole) {
      const leg = driveLeg(PLACES.garage.x, PLACES.garage.y, 180);
      m1 = S.missionIndex > 0;
      check('mission 1 completes', m1, `missionIndex=${S.missionIndex} cash=$${S.cash}`);
      check('mission 1 pays $300', S.cash >= cash0 + 300 - 200 * (busts - busts0), `cash=$${S.cash} busts=${busts - busts0}`);
    } else {
      check('mission 1 completes', false, 'no car stolen');
      check('mission 1 pays $300', false, 'no car stolen');
    }
    // 3. Mission 2 — The Pickup: docks, then the motel (+$600).
    cash0 = S.cash;
    busts0 = busts;
    const m2 = m1 && runMission2();
    check('mission 2 completes', m2, `missionIndex=${S.missionIndex} cash=$${S.cash}`);
    check('mission 2 pays $600', m2 && S.cash >= cash0 + 600 - 200 * (busts - busts0), `cash=$${S.cash} busts=${busts - busts0}`);
    // 4. Mission 3 — Hot Pursuit: 90 s to the safehouse under 2 stars (+$900).
    cash0 = S.cash;
    busts0 = busts;
    const m3 = m2 && runMission3();
    check('mission 3 completes', m3, `missionIndex=${S.missionIndex} cash=$${S.cash}`);
    check('mission 3 pays $900', m3 && S.cash >= cash0 + 900 - 200 * (busts - busts0), `cash=$${S.cash} busts=${busts - busts0}`);
    check('police spawn at 2 stars', policeSeen, `stars=${world.stars()} heat=${Math.round(S.heat)}`);
    // 5. Mission 4 — Courier Takedown: stop the courier, grab the briefcase (+$1500).
    cash0 = S.cash;
    busts0 = busts;
    const m4 = m3 && runMission4();
    check('mission 4 completes', m4, `missionIndex=${S.missionIndex} cash=$${S.cash} briefcase=${!!S.briefcase}`);
    check('mission 4 pays $1500', m4 && S.cash >= cash0 + 1500 - 200 * (busts - busts0), `cash=$${S.cash} busts=${busts - busts0}`);
    // 6. Pistol check, while the heat is still low: exit the car, fire, bullets must fly.
    if (S.player.inCar) {
      stepWorld({ ...IDLE, interact: true });
    }
    const bulletsBefore = S.shotsFired;
    stepWorld({ ...IDLE, shootHeld: true, aimAngle: 0 });
    const fired = S.shotsFired > bulletsBefore;
    for (let i = 0; i < 2 / STEP; i += 1) {
      stepWorld(IDLE);
    }
    check('pistol fires', fired, `shotsFired=${S.shotsFired}`);
    // Back in the car: the next mission's prep flees first and needs one.
    stepWorld({ ...IDLE, interact: true });
    // 7. Mission 5 — The Big Score: vault hold, then a 3-star escape (+$2500).
    cash0 = S.cash;
    busts0 = busts;
    const m5 = m4 && runMission5();
    check('mission 5 completes', m5, `storyComplete=${S.storyComplete} cash=$${S.cash}`);
    check('mission 5 pays $2500', m5 && S.cash >= cash0 + 2500 - 200 * (busts - busts0), `cash=$${S.cash} busts=${busts - busts0}`);
    check('story complete', S.storyComplete === true, `missionIndex=${S.missionIndex}`);
    check('all payouts land', S.cash >= 500 + 300 + 600 + 900 + 1500 + 2500 - 200 * busts, `cash=$${S.cash} busts=${busts}`);
    // 8. Save / load round-trip, including the story flag.
    const save = world.makeSave();
    const cashBefore = S.cash;
    world.reset();
    world.applySave(save);
    check('save/load', S.cash === cashBefore && S.storyComplete === true && S.missionIndex === MISSIONS.length, `cash=$${S.cash} story=${S.storyComplete} missionIndex=${S.missionIndex}`);
    // 9. The save the real game writes: localStorage round-trip.
    writeJson(SAVE_KEY, world.makeSave());
    const stored = readJson(SAVE_KEY);
    check('save in localStorage', stored !== null && stored.cash === S.cash && stored.storyComplete === true, stored ? `stored cash=$${stored.cash} story=${stored.storyComplete}` : 'nothing stored');
    // 10. The player is alive and the world is sane.
    check('player alive', S.player.health > 0, `hp=${Math.round(S.player.health)}`);
    check('traffic present', S.cars.filter((c) => c.kind === 'traffic').length >= 8, `traffic=${S.cars.filter((c) => c.kind === 'traffic').length}`);
    check('peds present', S.peds.length >= 10, `peds=${S.peds.length}`);
  } catch (err) {
    results.push({ name: 'exception', ok: false, detail: String(err && err.stack ? err.stack : err) });
  }
  const failed = results.filter((r) => !r.ok);
  const summary = results.map((r) => `${r.ok ? 'PASS' : 'FAIL'} ${r.name} (${r.detail})`).join(' | ');
  window.__selftest = { ok: failed.length === 0, results };
  document.title = `SELFTEST ${failed.length === 0 ? 'PASS' : 'FAIL'} — ${failed.length} failed`;
  status.textContent = `SELFTEST ${failed.length === 0 ? 'PASS' : 'FAIL'}: ${summary}`;
  // Paint one frame so a screenshot shows the game too.
  const ui = uiFor(world, SCREEN_PLAY, readBest(), false, null);
  renderer.draw(world.state, SCREEN_PLAY, ui);
  window.__shotReady = true;
}

// ---- the real game ----
function runGame() {
  const input = createInput(canvas);
  let screen = SCREEN_TITLE;
  let best = readBest();
  let hasSave = readJson(SAVE_KEY) !== null;
  let accumulator = 0;
  let last = performance.now();
  let lastMessage = '';
  let toast = null;
  let toastUntil = 0;
  let autosaveAt = 0;
  let missionText = '';

  function announce(message) {
    status.textContent = message;
  }

  function startGame(continueSave) {
    audio.unlock();
    if (continueSave) {
      const save = readJson(SAVE_KEY);
      world.applySave(save);
    } else {
      world.reset();
    }
    screen = SCREEN_PLAY;
    toast = null;
    autosaveAt = world.state.time + AUTOSAVE_SECONDS;
    announce(`Playing. ${world.currentMission() ? world.currentMission().title : 'Free roam.'}`);
  }

  function endMissionInterstitial(text) {
    missionText = text;
    screen = SCREEN_MISSION;
    saveAll();
    announce(text);
  }

  function handleEvents(events) {
    if (events & EVENT_SHOT) audio.shoot();
    if (events & EVENT_COIN) audio.pickup();
    if (events & EVENT_HEALTH) audio.pickup();
    if (events & EVENT_CRASH) audio.crash(0.6);
    if (events & EVENT_FAIL) announce(world.state.message);
    if (events & EVENT_MISSION) {
      audio.mission();
      const pay = MISSIONS[Math.max(0, world.state.missionIndex - 1)]?.pay ?? 0;
      best = Math.max(best, world.state.bestCash);
      if (events & EVENT_STORY) {
        screen = SCREEN_STORY;
        saveAll();
        announce('Story complete — Neon Bay is yours.');
      } else {
        endMissionInterstitial(`Job done! +$${pay}. Next: ${world.currentMission().title}`);
      }
    }
    if (events & EVENT_BUSTED) {
      audio.bust();
      screen = SCREEN_BUSTED;
      saveAll();
      announce(world.state.message);
    }
    if (events & EVENT_STEP) announce(world.state.message);
  }

  function stepWorld(dt, ctl) {
    const events = world.step(dt, ctl);
    if (world.state.message !== lastMessage) {
      lastMessage = world.state.message;
      toast = world.state.message;
      toastUntil = world.state.time + 4;
    }
    if (toast && world.state.time > toastUntil) toast = null;
    if (screen === SCREEN_PLAY && world.state.time >= autosaveAt) {
      saveAll();
      autosaveAt = world.state.time + AUTOSAVE_SECONDS;
    }
    handleEvents(events);
  }

  function aimAngle() {
    const pointer = input.pointer();
    if (!pointer) return null;
    return Math.atan2(pointer.y - window.innerHeight / 2, pointer.x - window.innerWidth / 2);
  }

  function frame(now) {
    requestAnimationFrame(frame);
    accumulator += Math.min((now - last) / 1000, MAX_FRAME);
    last = now;
    const actions = input.takeActions();
    if (actions & ACTION_MUTE) audio.toggleMute();

    if (screen === SCREEN_TITLE) {
      if (actions & ACTION_CONFIRM) {
        audio.click();
        startGame(hasSave);
      }
      // Title backdrop: the city lives while you decide.
      while (accumulator >= STEP) {
        world.step(STEP, { vx: 0, vy: 0, sprint: false, interact: false, shootHeld: false, aimAngle: null });
        accumulator -= STEP;
      }
    } else if (screen === SCREEN_PLAY) {
      if (actions & ACTION_PAUSE) {
        screen = SCREEN_PAUSED;
        announce('Paused.');
      } else {
        const vec = input.vector();
        const p = world.state.player;
        const shootOnce = !!(actions & ACTION_CONFIRM) && !p.inCar;
        const ctl = {
          vx: vec.x,
          vy: vec.y,
          sprint: input.sprint(),
          interact: !!(actions & ACTION_INTERACT),
          shootHeld: input.firing() || shootOnce,
          aimAngle: aimAngle(),
        };
        while (accumulator >= STEP && screen === SCREEN_PLAY) {
          stepWorld(STEP, ctl);
          accumulator -= STEP;
          // A bust or a finished job can change the screen mid-frame.
          if (screen !== SCREEN_PLAY) break;
        }
        // Engine hum + siren follow the game.
        const car = world.state.player.inCar;
        audio.update(car ? Math.abs(car.speed) / 560 : 0, world.stars());
      }
    } else if (screen === SCREEN_PAUSED) {
      if (actions & (ACTION_PAUSE | ACTION_CONFIRM)) {
        screen = SCREEN_PLAY;
        announce('Playing.');
      }
      accumulator = 0;
    } else if (screen === SCREEN_BUSTED || screen === SCREEN_MISSION || screen === SCREEN_STORY) {
      if (actions & ACTION_CONFIRM) {
        audio.click();
        screen = SCREEN_PLAY;
        toast = null;
        announce('Playing.');
      }
      accumulator = 0;
    }

    const ui = uiFor(world, screen, best, hasSave, toast);
    if (screen === SCREEN_MISSION) ui.missionText = missionText;
    renderer.draw(world.state, screen, ui);
  }

  // N starts a fresh game from the title screen.
  window.addEventListener('keydown', (event) => {
    if (screen === SCREEN_TITLE && event.code === 'KeyN') {
      audio.click();
      hasSave = false;
      startGame(false);
    }
  });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden && screen === SCREEN_PLAY) {
      screen = SCREEN_PAUSED;
      saveAll();
      announce('Paused.');
    }
  });

  announce('Neon Bay. Press Space or click to start.');
  // Debug / verification hook: the live world and screen, read-only.
  window.__game = { world, get screen() { return screen; } };
  requestAnimationFrame(frame);
}
