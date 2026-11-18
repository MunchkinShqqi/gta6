// Autopilot helpers: road-grid navigation for the screenshot scenes and the
// headless self-test. The city is a grid, so a route is a BFS over junctions
// (road-line crossings); the car steers from one junction centre to the next,
// which keeps it on the roads instead of ploughing through buildings.
import { GRID_LINES, PITCH } from './config.js';

function clamp(value, min, max) {
  return value < min ? min : value > max ? max : value;
}

function angleDiff(a, b) {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

export function nearestJunction(x, y) {
  return {
    ix: clamp(Math.round(x / PITCH), 0, GRID_LINES - 1),
    iy: clamp(Math.round(y / PITCH), 0, GRID_LINES - 1),
  };
}

/** BFS over the junction grid: centres to drive through, from (fx,fy) to (tx,ty). */
export function routeJunctions(fx, fy, tx, ty) {
  const start = nearestJunction(fx, fy);
  const goal = nearestJunction(tx, ty);
  const key = (ix, iy) => iy * GRID_LINES + ix;
  const prev = new Map();
  const queue = [start];
  prev.set(key(start.ix, start.iy), null);
  while (queue.length > 0) {
    const cur = queue.shift();
    if (cur.ix === goal.ix && cur.iy === goal.iy) break;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = cur.ix + dx;
      const ny = cur.iy + dy;
      if (nx < 0 || ny < 0 || nx >= GRID_LINES || ny >= GRID_LINES) continue;
      if (prev.has(key(nx, ny))) continue;
      prev.set(key(nx, ny), cur);
      queue.push({ ix: nx, iy: ny });
    }
  }
  const path = [];
  let cur = goal;
  while (cur) {
    path.unshift({ x: cur.ix * PITCH, y: cur.iy * PITCH });
    cur = prev.get(key(cur.ix, cur.iy));
  }
  return path;
}

/**
 * Steering for a car toward a point: {vx, vy, sprint}. Reverses when the point
 * is far behind the car. `stuck` is mutable state the caller keeps: {time, reverseUntil}.
 */
export function driveControl(car, target, stuck, now) {
  const dx = target.x - car.x;
  const dy = target.y - car.y;
  const want = Math.atan2(dy, dx);
  const diff = angleDiff(want, car.angle);
  const speed = Math.abs(car.speed);
  if (stuck.reverseUntil > now) {
    return { vx: -clamp(diff * 2, -1, 1), vy: 1, sprint: false };
  }
  if (speed < 15 && Math.hypot(dx, dy) > 60) {
    stuck.time += 1 / 60;
    if (stuck.time > 2) {
      stuck.time = 0;
      stuck.reverseUntil = now + 0.9;
      return { vx: 0, vy: 1, sprint: false };
    }
  } else {
    stuck.time = 0;
  }
  if (Math.abs(diff) > 2.4) {
    // Too far around: back up and swing round.
    return { vx: -clamp(diff * 2, -1, 1), vy: 1, sprint: false };
  }
  return { vx: clamp(diff * 2.2, -1, 1), vy: -1, sprint: false };
}

/** Steering for a pedestrian toward a point: {vx, vy}. */
export function walkControl(px, py, tx, ty) {
  const dx = tx - px;
  const dy = ty - py;
  const d = Math.hypot(dx, dy);
  if (d < 8) return { vx: 0, vy: 0 };
  return { vx: dx / d, vy: dy / d };
}
