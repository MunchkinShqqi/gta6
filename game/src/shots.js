// The screenshot scenes behind ?shot=start|play|mission|end. Each one plays the
// real rules forward from a fresh world for a fixed number of steps, steered by
// the autopilot (walk to a car, steal it, drive the road grid), so the frame is
// what a short game really looks like and the same seed always gives the same
// frame. No mockups: every screenshot is the game running.
import { PLACES, STEP } from './config.js';
import { EVENT_BUSTED, EVENT_MISSION } from './world.js';
import { SCREEN_MISSION, SCREEN_PLAY, SCREEN_TITLE } from './render.js';
import { driveControl, routeJunctions, walkControl } from './pilot.js';

const START_SECONDS = 6;
const PLAY_SECONDS = 26;
const MISSION_SECONDS = 20;
const END_LIMIT_SECONDS = 240;

function nearestCar(world, x, y, kinds) {
  let best = null;
  let bestD = Infinity;
  for (const car of world.state.cars) {
    if (kinds && !kinds.includes(car.kind)) continue;
    const d = Math.hypot(car.x - x, car.y - y);
    if (d < bestD) {
      bestD = d;
      best = car;
    }
  }
  return { car: best, dist: bestD };
}

/** Drive the player's car along a junction route to (tx, ty). Returns true on arrival. */
function driveRoute(world, tx, ty, seconds) {
  const p = world.state.player;
  const stuck = { time: 0, reverseUntil: -1 };
  let route = routeJunctions(p.inCar.x, p.inCar.y, tx, ty);
  let wp = 0;
  const steps = Math.floor(seconds / STEP);
  for (let i = 0; i < steps; i += 1) {
    const car = p.inCar;
    if (!car) return false;
    const target = route[Math.min(wp, route.length - 1)];
    if (Math.hypot(target.x - car.x, target.y - car.y) < 55 && wp < route.length - 1) wp += 1;
    const ctl = driveControl(car, route[Math.min(wp, route.length - 1)], stuck, world.state.time);
    const ev = world.step(STEP, { vx: ctl.vx, vy: ctl.vy, sprint: ctl.sprint, interact: false, shootHeld: false, aimAngle: null });
    if (ev & EVENT_BUSTED) return false;
    if (ev & EVENT_MISSION) return true;
    if (Math.hypot(tx - car.x, ty - car.y) < 60) return true;
    // Re-route occasionally: the route was planned from the start point.
    if (i % 360 === 0 && i > 0) {
      route = routeJunctions(car.x, car.y, tx, ty);
      wp = 0;
    }
  }
  return Math.hypot(tx - p.inCar.x, ty - p.inCar.y) < 80;
}

/** Walk the player to the nearest stealable car and steal it. */
function stealNearestCar(world, seconds) {
  const steps = Math.floor(seconds / STEP);
  for (let i = 0; i < steps; i += 1) {
    const p = world.state.player;
    if (p.inCar) return true;
    const { car, dist } = nearestCar(world, p.x, p.y, ['parked', 'traffic']);
    if (!car) return false;
    const ctl = walkControl(p.x, p.y, car.x, car.y);
    const interact = dist < 60;
    world.step(STEP, { vx: ctl.vx, vy: ctl.vy, sprint: true, interact, shootHeld: false, aimAngle: null });
  }
  return !!world.state.player.inCar;
}

/**
 * Set `world` to the named scene and return the screen to draw over it and the
 * best score to show. Names: start (title), play (driving with heat), mission
 * (getaway chase), end (mission complete).
 */
export function stageShot(name, world) {
  world.reset();
  if (name !== 'play' && name !== 'mission' && name !== 'end') {
    for (let i = 0; i < START_SECONDS / STEP; i += 1) {
      world.step(STEP, { vx: 0, vy: 0, sprint: false, interact: false, shootHeld: false, aimAngle: null });
    }
    return { screen: SCREEN_TITLE, best: world.state.bestCash };
  }

  if (name === 'play') {
    stealNearestCar(world, 20);
    // Two stars of heat so police chase the player through traffic.
    world.state.heat = 40;
    if (world.state.player.inCar) {
      driveRoute(world, 2800, 350, PLAY_SECONDS);
    } else {
      for (let i = 0; i < PLAY_SECONDS / STEP; i += 1) {
        world.step(STEP, { vx: 0, vy: 0, sprint: false, interact: false, shootHeld: false, aimAngle: null });
      }
    }
    return { screen: SCREEN_PLAY, best: world.state.bestCash };
  }

  if (name === 'mission') {
    world.startMission(2); // Hot Pursuit: 90 s to the safehouse, 2 stars.
    stealNearestCar(world, 20);
    if (world.state.player.inCar) {
      // Drive across town toward the north-east corner for a fixed time: the
      // frame is the getaway in progress, not the arrival at the safehouse.
      driveRoute(world, 3100, 300, MISSION_SECONDS);
    }
    return { screen: SCREEN_PLAY, best: world.state.bestCash };
  }

  // end: finish mission 1 for real, so the frame is the JOB DONE panel.
  stealNearestCar(world, 20);
  let done = false;
  if (world.state.player.inCar) {
    const p = world.state.player;
    const stuck = { time: 0, reverseUntil: -1 };
    let route = routeJunctions(p.inCar.x, p.inCar.y, PLACES.garage.x, PLACES.garage.y);
    let wp = 0;
    for (let i = 0; i < END_LIMIT_SECONDS / STEP; i += 1) {
      const car = world.state.player.inCar;
      if (!car) break;
      const target = route[Math.min(wp, route.length - 1)];
      if (Math.hypot(target.x - car.x, target.y - car.y) < 55 && wp < route.length - 1) wp += 1;
      const ctl = driveControl(car, route[Math.min(wp, route.length - 1)], stuck, world.state.time);
      const ev = world.step(STEP, { vx: ctl.vx, vy: ctl.vy, sprint: ctl.sprint, interact: false, shootHeld: false, aimAngle: null });
      if (ev & EVENT_MISSION) {
        done = true;
        break;
      }
      if (ev & EVENT_BUSTED) break;
      if (i % 360 === 0 && i > 0) {
        route = routeJunctions(car.x, car.y, PLACES.garage.x, PLACES.garage.y);
        wp = 0;
      }
    }
  }
  // The panel should name the job just finished, not the next one: the world
  // already advanced the mission, so say it plainly here.
  if (done) world.state.message = 'Mission 1 — Wheels Up complete! +$300';
  return { screen: done ? SCREEN_MISSION : SCREEN_PLAY, best: world.state.bestCash };
}
