// The game's rules and state, with no drawing and no browser in it: the city, the
// player on foot and in cars, traffic, pedestrians, police, the wanted system and
// the five-mission story. step() advances one fixed step and returns what happened
// as bit flags, so the caller can react (sounds, save) without the world knowing
// about screens or audio. The city is generated from a seeded RNG, so the same
// seed always gives the same Neon Bay.
import {
  BLOCK, CAR, CAR_COLORS, GRID_LINES, MISSIONS, PALETTE, PICKUP_COUNT, PED_COUNT,
  PITCH, PLACES, PLAYER, POLICE, ROAD_W, TRAFFIC_COUNT, WANTED, WORLD,
} from './config.js';

export const EVENT_COIN = 1;
export const EVENT_SHOT = 2;
export const EVENT_CRASH = 4;
export const EVENT_MISSION = 8;
export const EVENT_BUSTED = 16;
export const EVENT_STORY = 32;
export const EVENT_STEP = 64;
export const EVENT_HEALTH = 128;
export const EVENT_FAIL = 256;

const TAU = Math.PI * 2;

function clamp(value, min, max) {
  return value < min ? min : value > max ? max : value;
}

function dist(ax, ay, bx, by) {
  const dx = ax - bx;
  const dy = ay - by;
  return Math.sqrt(dx * dx + dy * dy);
}

function angleTo(ax, ay, bx, by) {
  return Math.atan2(by - ay, bx - ax);
}

function angleDiff(a, b) {
  let d = a - b;
  while (d > Math.PI) d -= TAU;
  while (d < -Math.PI) d += TAU;
  return d;
}

/** Is (x, y) on a road band (within half the road width of a grid line)? */
export function onRoad(x, y) {
  const rx = x % PITCH;
  const ry = y % PITCH;
  const nearX = Math.min(rx, PITCH - rx) <= ROAD_W / 2;
  const nearY = Math.min(ry, PITCH - ry) <= ROAD_W / 2;
  return nearX || nearY;
}

/** Nearest grid-line coordinate to v (a road centre). */
function roadLine(v) {
  return Math.round(v / PITCH) * PITCH;
}

export function createWorld(random) {
  // ---- city generation (seeded) ----
  const buildings = []; // {x, y, w, h, color, hgt} — x,y are the top-left corner
  const trees = []; // {x, y, r}
  const containers = []; // {x, y, w, h, color}
  const buildingsByBlock = new Map();
  const blockKey = (bx, by) => by * GRID_LINES + bx;

  function addBuilding(bx, by, b) {
    buildings.push(b);
    const key = blockKey(bx, by);
    if (!buildingsByBlock.has(key)) buildingsByBlock.set(key, []);
    buildingsByBlock.get(key).push(b);
  }

  for (let bx = 0; bx < GRID_LINES - 1; bx += 1) {
    for (let by = 0; by < GRID_LINES - 1; by += 1) {
      const x0 = bx * PITCH + ROAD_W / 2;
      const y0 = by * PITCH + ROAD_W / 2;
      if (bx === GRID_LINES - 2) {
        // Beach column: sand, palms, no buildings.
        for (let i = 0; i < 5; i += 1) {
          trees.push({ x: x0 + 20 + random() * (BLOCK - 40), y: y0 + 20 + random() * (BLOCK - 40), r: 12 + random() * 6 });
        }
        continue;
      }
      if (by === GRID_LINES - 2) {
        // Docks row: concrete and shipping containers.
        for (let i = 0; i < 4; i += 1) {
          containers.push({
            x: x0 + 10 + random() * (BLOCK - 90),
            y: y0 + 10 + random() * (BLOCK - 50),
            w: 70 + random() * 30,
            h: 26 + random() * 10,
            color: PALETTE.container[Math.floor(random() * PALETTE.container.length)],
          });
        }
        continue;
      }
      const roll = random();
      if (roll < 0.14) {
        // Park: grass and trees.
        for (let i = 0; i < 9; i += 1) {
          trees.push({ x: x0 + 16 + random() * (BLOCK - 32), y: y0 + 16 + random() * (BLOCK - 32), r: 10 + random() * 8 });
        }
        continue;
      }
      if (roll < 0.28) {
        // Parking lot: a couple of low buildings and parked cars (spawned later).
        addBuilding(bx, by, {
          x: x0 + 20, y: y0 + 20, w: 90, h: 70,
          color: PALETTE.buildingRoof[Math.floor(random() * PALETTE.buildingRoof.length)], hgt: 8,
        });
        continue;
      }
      // Built-up block: up to four buildings on a 2x2 sub-grid.
      for (let sx = 0; sx < 2; sx += 1) {
        for (let sy = 0; sy < 2; sy += 1) {
          if (random() < 0.3) continue;
          const w = 78 + random() * 42;
          const h = 78 + random() * 42;
          addBuilding(bx, by, {
            x: x0 + sx * (BLOCK / 2) + 8 + random() * 8,
            y: y0 + sy * (BLOCK / 2) + 8 + random() * 8,
            w, h,
            color: PALETTE.buildingRoof[Math.floor(random() * PALETTE.buildingRoof.length)],
            hgt: 10 + random() * 22,
          });
        }
      }
    }
  }

  // ---- entities ----
  const state = {
    time: 0,
    cash: 500,
    bestCash: 500,
    health: PLAYER.health,
    heat: 0, // 0..100; stars = 1 + floor(heat/20) while heat > 0
    missionIndex: 0,
    stepIndex: 0,
    missionTimer: 0,
    holdProgress: 0,
    storyComplete: false,
    busted: false,
    bustTimer: 0,
    message: '',
    marker: null,
    buildings,
    trees,
    containers,
    player: null,
    cars: [],
    peds: [],
    bullets: [],
    pickups: [],
    courier: null,
    briefcase: null,
    shotsFired: 0,
    policeSpawnTimer: 0,
    respawnTimer: 0,
    shake: 0,
  };

  function stars() {
    return state.heat <= 0 ? 0 : Math.min(WANTED.maxStars, 1 + Math.floor(state.heat / WANTED.heatPerStar));
  }

  function randomRoadPoint() {
    // A random point on a road centre line, away from the map edge.
    const line = (1 + Math.floor(random() * (GRID_LINES - 2))) * PITCH;
    const along = 100 + random() * (WORLD - 200);
    return random() < 0.5 ? { x: line, y: along } : { x: along, y: line };
  }

  function makeCar(x, y, angle, kind, color) {
    return {
      x, y, angle, speed: 0, color,
      kind, // 'traffic' | 'parked' | 'police' | 'courier' | 'player'
      health: kind === 'police' ? 60 : CAR.health,
      driven: false,
      driver: kind === 'traffic',
      dir: 0, // traffic: heading in radians (multiple of PI/2)
      targetSpeed: 120 + random() * 50,
      lastJunction: '',
      crashCooldown: 0,
      flee: false,
    };
  }

  function spawnTrafficCar() {
    const p = randomRoadPoint();
    const dir = Math.floor(random() * 4) * (Math.PI / 2);
    const car = makeCar(p.x, p.y, dir, 'traffic', CAR_COLORS[Math.floor(random() * CAR_COLORS.length)]);
    car.dir = dir;
    car.speed = car.targetSpeed;
    state.cars.push(car);
    return car;
  }

  function spawnParkedCar() {
    // Parked along a road edge, parallel to the road.
    const p = randomRoadPoint();
    const alongRoad = random() < 0.5;
    const off = (ROAD_W / 2 - 16) * (random() < 0.5 ? -1 : 1);
    const angle = alongRoad ? (random() < 0.5 ? 0 : Math.PI) : (random() < 0.5 ? Math.PI / 2 : -Math.PI / 2);
    const x = alongRoad ? p.x + off : p.x;
    const y = alongRoad ? p.y : p.y + off;
    const car = makeCar(x, y, angle, 'parked', CAR_COLORS[Math.floor(random() * CAR_COLORS.length)]);
    state.cars.push(car);
    return car;
  }

  function spawnPed() {
    const p = randomRoadPoint();
    const ped = {
      x: p.x, y: p.y, angle: random() * TAU, speed: 50 + random() * 25,
      tx: p.x, ty: p.y, state: 'walk', timer: 0, downTimer: 0,
      color: PALETTE.ped[Math.floor(random() * PALETTE.ped.length)],
    };
    state.peds.push(ped);
    return ped;
  }

  function spawnPickup(kind) {
    const p = randomRoadPoint();
    state.pickups.push({ x: p.x, y: p.y, kind, amount: kind === 'cash' ? 50 : 30, timer: 0 });
  }

  function spawnPoliceCar() {
    // On a road 600-900 px from the player.
    for (let tries = 0; tries < 12; tries += 1) {
      const p = randomRoadPoint();
      if (dist(p.x, p.y, state.player.x, state.player.y) > 550) {
        const car = makeCar(p.x, p.y, angleTo(p.x, p.y, state.player.x, state.player.y), 'police', '#2f6fd8');
        car.speed = POLICE.carSpeed * 0.7;
        state.cars.push(car);
        return car;
      }
    }
    return null;
  }

  function currentMission() {
    return MISSIONS[state.missionIndex] ?? null;
  }

  function currentStep() {
    const m = currentMission();
    return m ? m.steps[state.stepIndex] ?? null : null;
  }

  function stepTarget() {
    const step = currentStep();
    if (!step) return null;
    if (step.type === 'chase') return state.courier ? { x: state.courier.x, y: state.courier.y, label: 'Courier' } : null;
    if (step.at === 'briefcase') return state.briefcase ? { x: state.briefcase.x, y: state.briefcase.y, label: 'Briefcase' } : null;
    const place = PLACES[step.at];
    return place ? { x: place.x, y: place.y, label: place.label } : null;
  }

  function startMission(index) {
    state.missionIndex = index;
    state.stepIndex = 0;
    state.holdProgress = 0;
    const m = MISSIONS[index];
    state.missionTimer = m.timeLimit ?? 0;
    if (m.startWanted) state.heat = Math.max(state.heat, m.startWanted * WANTED.heatPerStar);
    if (m.id === 'courier') spawnCourier();
    state.message = m.title;
  }

  function spawnCourier() {
    const p = randomRoadPoint();
    const car = makeCar(p.x, p.y, random() * TAU, 'courier', '#ff7ab8');
    car.speed = 300;
    car.dir = 0;
    state.courier = car;
    state.cars.push(car);
  }

  function failMission() {
    state.message = 'Too slow — the job fell through. Marisol gives you one more shot.';
    startMission(state.missionIndex);
    return EVENT_FAIL;
  }

  function completeMission() {
    const m = currentMission();
    state.cash += m.pay;
    state.bestCash = Math.max(state.bestCash, state.cash);
    let events = EVENT_MISSION;
    if (state.missionIndex + 1 >= MISSIONS.length) {
      state.storyComplete = true;
      state.missionIndex = MISSIONS.length;
      state.message = 'Story complete — Neon Bay is yours.';
      events |= EVENT_STORY;
    } else {
      startMission(state.missionIndex + 1);
    }
    return events;
  }

  function advanceStep() {
    state.stepIndex += 1;
    state.holdProgress = 0;
    return EVENT_STEP;
  }

  // ---- collision helpers ----
  function nearbyBuildings(x, y) {
    const bx = clamp(Math.floor(x / PITCH), 0, GRID_LINES - 2);
    const by = clamp(Math.floor(y / PITCH), 0, GRID_LINES - 2);
    const out = [];
    for (let ox = -1; ox <= 1; ox += 1) {
      for (let oy = -1; oy <= 1; oy += 1) {
        const list = buildingsByBlock.get(blockKey(clamp(bx + ox, 0, GRID_LINES - 2), clamp(by + oy, 0, GRID_LINES - 2)));
        if (list) out.push(...list);
      }
    }
    return out;
  }

  /** Push a circle out of buildings; returns the penetration depth resolved (0 = free). */
  function resolveBuildings(e, r) {
    let hit = 0;
    for (const b of nearbyBuildings(e.x, e.y)) {
      const cx = clamp(e.x, b.x, b.x + b.w);
      const cy = clamp(e.y, b.y, b.y + b.h);
      const dx = e.x - cx;
      const dy = e.y - cy;
      const d2 = dx * dx + dy * dy;
      if (d2 >= r * r) continue;
      const d = Math.sqrt(d2) || 0.001;
      const push = r - d;
      e.x += (dx / d) * push;
      e.y += (dy / d) * push;
      hit = Math.max(hit, push);
    }
    return hit;
  }

  function hitBuilding(e, r) {
    for (const b of nearbyBuildings(e.x, e.y)) {
      const cx = clamp(e.x, b.x, b.x + b.w);
      const cy = clamp(e.y, b.y, b.y + b.h);
      const dx = e.x - cx;
      const dy = e.y - cy;
      if (dx * dx + dy * dy < r * r) return true;
    }
    return false;
  }

  // ---- reset / spawn ----
  function reset() {
    state.time = 0;
    state.cash = 500;
    state.bestCash = 500;
    state.health = PLAYER.health;
    state.heat = 0;
    state.missionIndex = 0;
    state.stepIndex = 0;
    state.missionTimer = 0;
    state.holdProgress = 0;
    state.storyComplete = false;
    state.busted = false;
    state.bustTimer = 0;
    state.cars.length = 0;
    state.peds.length = 0;
    state.bullets.length = 0;
    state.pickups.length = 0;
    state.courier = null;
    state.briefcase = null;
    state.shotsFired = 0;
    state.shake = 0;
    state.player = {
      x: PLACES.start.x, y: PLACES.start.y, angle: -Math.PI / 2,
      health: PLAYER.health, inCar: null, fireTimer: 0, speed: 0,
    };
    for (let i = 0; i < TRAFFIC_COUNT; i += 1) spawnTrafficCar();
    for (let i = 0; i < 10; i += 1) spawnParkedCar();
    for (let i = 0; i < PED_COUNT; i += 1) spawnPed();
    for (let i = 0; i < PICKUP_COUNT; i += 1) spawnPickup(i % 3 === 2 ? 'health' : 'cash');
    startMission(0);
    state.message = MISSIONS[0].title;
  }

  function applySave(save) {
    reset();
    if (!save) return;
    state.cash = save.cash ?? 500;
    state.bestCash = Math.max(state.bestCash, save.cash ?? 0);
    state.health = save.health ?? PLAYER.health;
    state.player.health = state.health;
    if (typeof save.x === 'number' && typeof save.y === 'number') {
      state.player.x = clamp(save.x, 0, WORLD);
      state.player.y = clamp(save.y, 0, WORLD);
    }
    if (save.storyComplete) {
      // Finished the story: stay in free roam instead of replaying the last job.
      state.storyComplete = true;
      state.missionIndex = MISSIONS.length;
    } else if (typeof save.missionIndex === 'number' && save.missionIndex >= 0 && save.missionIndex < MISSIONS.length) {
      startMission(save.missionIndex);
    }
  }

  function makeSave() {
    return {
      cash: state.cash,
      health: state.player.health,
      x: Math.round(state.player.x),
      y: Math.round(state.player.y),
      missionIndex: Math.min(state.missionIndex, MISSIONS.length - 1),
      storyComplete: state.storyComplete,
      savedAt: Date.now(),
    };
  }

  // ---- police ----
  function policeCount() {
    let n = 0;
    for (const c of state.cars) if (c.kind === 'police') n += 1;
    return n;
  }

  function wantedPoliceCount() {
    const s = stars();
    if (s === 0) return 0;
    return s >= 4 ? 3 : s >= 2 ? 2 : 1;
  }

  // ---- main step ----
  /**
   * One fixed step. `ctl` is {vx, vy, sprint, interact, shootHeld, aimAngle}.
   * vx/vy: -1..1 steering (up is -y). aimAngle: radians, where the pistol points.
   */
  function step(dt, ctl) {
    let events = 0;
    state.time += dt;
    const p = state.player;
    p.fireTimer = Math.max(0, p.fireTimer - dt);
    if (state.shake > 0) state.shake = Math.max(0, state.shake - dt * 3);

    // --- mission timer (mission 3) ---
    const mission = currentMission();
    if (mission && mission.timeLimit && state.missionTimer > 0) {
      state.missionTimer -= dt;
      if (state.missionTimer <= 0) {
        state.missionTimer = 0;
        return failMission();
      }
    }

    // --- interact: enter / exit a car ---
    if (ctl.interact) {
      if (p.inCar) {
        const car = p.inCar;
        car.driven = false;
        car.speed = 0;
        const side = car.angle + Math.PI / 2;
        p.x = clamp(car.x + Math.cos(side) * 34, 0, WORLD);
        p.y = clamp(car.y + Math.sin(side) * 34, 0, WORLD);
        resolveBuildings(p, PLAYER.radius);
        p.inCar = null;
      } else {
        let best = null;
        let bestD = 78;
        for (const car of state.cars) {
          if (car.kind === 'police' || car.kind === 'courier') continue;
          const d = dist(p.x, p.y, car.x, car.y);
          if (d < bestD) {
            bestD = d;
            best = car;
          }
        }
        if (best) {
          if (best.driver) {
            // Jacking a driven car: the driver runs off, and it draws heat.
            best.driver = false;
            state.heat = Math.min(100, state.heat + WANTED.jackOccupied);
            state.message = 'You jacked a car! The heat is on.';
            const ped = spawnPed();
            ped.x = best.x;
            ped.y = best.y;
            ped.state = 'flee';
            ped.timer = 2.5;
          }
          best.driven = true;
          best.kind = 'player';
          p.inCar = best;
          p.angle = best.angle;
        }
      }
    }

    // --- player movement ---
    if (p.inCar) {
      driveCar(p.inCar, ctl, dt);
    } else {
      const speed = ctl.sprint ? PLAYER.sprintSpeed : PLAYER.walkSpeed;
      const len = Math.hypot(ctl.vx, ctl.vy);
      if (len > 0.01) {
        const nx = (ctl.vx / Math.max(1, len)) * speed * dt;
        const ny = (ctl.vy / Math.max(1, len)) * speed * dt;
        p.x = clamp(p.x + nx, 0, WORLD);
        p.y = clamp(p.y + ny, 0, WORLD);
        resolveBuildings(p, PLAYER.radius);
        p.angle = Math.atan2(ctl.vy, ctl.vx);
        p.speed = speed;
      } else {
        p.speed = 0;
      }
      // Aim follows the mouse when there is one, else the walk direction.
      if (ctl.aimAngle !== null && ctl.aimAngle !== undefined) p.angle = ctl.aimAngle;
      // Shooting on foot.
      if (ctl.shootHeld && p.fireTimer <= 0) {
        p.fireTimer = PLAYER.fireRate;
        state.shotsFired += 1;
        state.bullets.push({
          x: p.x + Math.cos(p.angle) * 20,
          y: p.y + Math.sin(p.angle) * 20,
          vx: Math.cos(p.angle) * PLAYER.bulletSpeed,
          vy: Math.sin(p.angle) * PLAYER.bulletSpeed,
          life: 0.9,
          from: 'player',
        });
        events |= EVENT_SHOT;
        let witness = false;
        for (const c of state.cars) {
          if (c.kind === 'police' && dist(p.x, p.y, c.x, c.y) < 500) witness = true;
        }
        for (const ped of state.peds) {
          if (ped.state !== 'down' && dist(p.x, p.y, ped.x, ped.y) < 300) witness = true;
        }
        if (witness) state.heat = Math.min(100, state.heat + WANTED.shotFired);
      }
    }

    // --- traffic, police, courier ---
    for (const car of state.cars) {
      if (car.driven) continue;
      if (car.kind === 'traffic') stepTraffic(car, dt);
      else if (car.kind === 'police') stepPolice(car, dt);
      else if (car.kind === 'courier') stepCourier(car, dt);
      else if (car.speed !== 0) {
        car.speed *= Math.exp(-2 * dt);
        if (Math.abs(car.speed) < 2) car.speed = 0;
        car.x += Math.cos(car.angle) * car.speed * dt;
        car.y += Math.sin(car.angle) * car.speed * dt;
        resolveBuildings(car, CAR.radius);
      }
      if (car.crashCooldown > 0) car.crashCooldown -= dt;
    }

    // --- car-car collisions ---
    for (let i = 0; i < state.cars.length; i += 1) {
      for (let j = i + 1; j < state.cars.length; j += 1) {
        const a = state.cars[i];
        const b = state.cars[j];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const d = Math.hypot(dx, dy);
        const min = CAR.radius * 2 - 2;
        if (d >= min || d === 0) continue;
        const nx = dx / d;
        const ny = dy / d;
        const push = (min - d) / 2;
        a.x -= nx * push;
        a.y -= ny * push;
        b.x += nx * push;
        b.y += ny * push;
        const closing = Math.abs(a.speed - b.speed);
        if (closing > 220) {
          const dmg = Math.min(22, (closing - 220) / 18);
          a.health -= dmg;
          b.health -= dmg;
          a.speed *= 0.55;
          b.speed *= 0.55;
          if ((a.driven || b.driven) && a.crashCooldown <= 0 && b.crashCooldown <= 0) {
            events |= EVENT_CRASH;
            state.shake = 0.5;
            a.crashCooldown = 0.6;
            b.crashCooldown = 0.6;
          }
        }
      }
    }

    // --- player car vs peds / player on foot vs cars ---
    for (const ped of state.peds) {
      if (ped.state === 'down') continue;
      const car = p.inCar;
      if (car && dist(car.x, car.y, ped.x, ped.y) < CAR.radius + 8 && Math.abs(car.speed) > 120) {
        ped.state = 'down';
        ped.downTimer = 3.5;
        state.heat = Math.min(100, state.heat + WANTED.hitPed);
        state.message = 'You hit a pedestrian! The heat is on.';
        state.shake = 0.4;
        events |= EVENT_CRASH;
      }
    }
    if (!p.inCar) {
      for (const car of state.cars) {
        if (car.kind === 'parked' || car.speed === 0) continue;
        if (dist(car.x, car.y, p.x, p.y) < CAR.radius + PLAYER.radius && Math.abs(car.speed) > 150) {
          p.health -= 25;
          state.health = p.health;
          const a = angleTo(car.x, car.y, p.x, p.y);
          p.x = clamp(p.x + Math.cos(a) * 40, 0, WORLD);
          p.y = clamp(p.y + Math.sin(a) * 40, 0, WORLD);
          state.shake = 0.5;
          events |= EVENT_CRASH;
          break;
        }
      }
    }

    // --- police: rams, busts, spawning ---
    const s = stars();
    if (s > 0) {
      state.policeSpawnTimer -= dt;
      if (policeCount() < wantedPoliceCount() && state.policeSpawnTimer <= 0) {
        spawnPoliceCar();
        state.policeSpawnTimer = 4;
      }
    } else if (policeCount() > 0) {
      state.cars = state.cars.filter((c) => c.kind !== 'police');
    }
    // Heat decay: slower while police are close.
    let nearCop = false;
    for (const c of state.cars) {
      if (c.kind === 'police' && dist(c.x, c.y, p.x, p.y) < 450) nearCop = true;
    }
    if (state.heat > 0) {
      state.heat = Math.max(0, state.heat - (nearCop ? WANTED.decayNear : WANTED.decayFar) * dt);
    }
    // Bust: a cop car touching the player on foot holds them.
    let touching = false;
    for (const c of state.cars) {
      if (c.kind !== 'police') continue;
      if (p.inCar) {
        if (dist(c.x, c.y, p.inCar.x, p.inCar.y) < CAR.radius * 2 && c.crashCooldown <= 0) {
          c.crashCooldown = 1.0;
          p.inCar.health -= POLICE.ramDamage;
          p.inCar.speed *= 0.85;
          state.shake = 0.5;
          events |= EVENT_CRASH;
        }
      } else if (dist(c.x, c.y, p.x, p.y) < CAR.radius + PLAYER.radius + 4) {
        touching = true;
      }
    }
    if (touching && !p.inCar) {
      state.bustTimer += dt;
      if (state.bustTimer >= POLICE.bustHold) {
        return bust();
      }
    } else {
      state.bustTimer = Math.max(0, state.bustTimer - dt * 2);
    }

    // --- destroyed cars ---
    for (let i = state.cars.length - 1; i >= 0; i -= 1) {
      const car = state.cars[i];
      if (car.health > 0) continue;
      const wasPlayer = car.driven;
      const wasPolice = car.kind === 'police';
      const wasCourier = car.kind === 'courier';
      state.cars.splice(i, 1);
      state.shake = 0.8;
      events |= EVENT_CRASH;
      if (wasPlayer) {
        p.inCar = null;
        p.health -= 35;
        state.health = p.health;
        p.x = clamp(car.x + 40, 0, WORLD);
        p.y = clamp(car.y, 0, WORLD);
        state.message = 'Your car is wrecked!';
      }
      if (wasPolice) {
        state.heat = Math.min(100, state.heat + WANTED.killCop);
      }
      if (wasCourier) {
        state.briefcase = { x: car.x, y: car.y };
        state.courier = null;
      }
    }
    // Replace a stolen traffic car so the streets stay busy.
    state.respawnTimer -= dt;
    if (state.respawnTimer <= 0) {
      const traffic = state.cars.filter((c) => c.kind === 'traffic').length;
      if (traffic < TRAFFIC_COUNT) {
        spawnTrafficCar();
        state.respawnTimer = 2;
      }
    }

    // --- peds ---
    for (const ped of state.peds) {
      if (ped.state === 'down') {
        ped.downTimer -= dt;
        if (ped.downTimer <= 0) {
          const q = randomRoadPoint();
          ped.x = q.x;
          ped.y = q.y;
          ped.state = 'walk';
        }
        continue;
      }
      // Flee from a fast player car or a nearby gunshot.
      let threat = null;
      if (p.inCar && Math.abs(p.inCar.speed) > 220 && dist(p.inCar.x, p.inCar.y, ped.x, ped.y) < 150) {
        threat = p.inCar;
      }
      if (threat) {
        ped.state = 'flee';
        ped.timer = 1.2;
      }
      if (ped.state === 'flee') {
        ped.timer -= dt;
        const a = threat ? angleTo(threat.x, threat.y, ped.x, ped.y) : ped.angle;
        ped.angle = a;
        ped.x = clamp(ped.x + Math.cos(a) * 150 * dt, 0, WORLD);
        ped.y = clamp(ped.y + Math.sin(a) * 150 * dt, 0, WORLD);
        resolveBuildings(ped, 8);
        if (ped.timer <= 0) ped.state = 'walk';
        continue;
      }
      // Walk an L-shaped path along the roads to the waypoint.
      const dx = ped.tx - ped.x;
      const dy = ped.ty - ped.y;
      if (Math.abs(dx) > 6) {
        const mv = Math.sign(dx) * ped.speed * dt;
        ped.x = clamp(ped.x + mv, 0, WORLD);
        ped.angle = mv > 0 ? 0 : Math.PI;
      } else if (Math.abs(dy) > 6) {
        const mv = Math.sign(dy) * ped.speed * dt;
        ped.y = clamp(ped.y + mv, 0, WORLD);
        ped.angle = mv > 0 ? Math.PI / 2 : -Math.PI / 2;
      } else {
        const q = randomRoadPoint();
        ped.tx = q.x;
        ped.ty = q.y;
      }
    }

    // --- bullets ---
    for (let i = state.bullets.length - 1; i >= 0; i -= 1) {
      const b = state.bullets[i];
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.life -= dt;
      let dead = b.life <= 0 || b.x < 0 || b.y < 0 || b.x > WORLD || b.y > WORLD || hitBuilding(b, 2);
      if (!dead) {
        for (const car of state.cars) {
          if (dist(b.x, b.y, car.x, car.y) < CAR.radius + 4) {
            car.health -= PLAYER.bulletDamage;
            dead = true;
            if (car.kind === 'courier') state.message = 'You hit the courier’s car!';
            break;
          }
        }
      }
      if (!dead) {
        for (const ped of state.peds) {
          if (ped.state !== 'down' && dist(b.x, b.y, ped.x, ped.y) < 12) {
            ped.state = 'down';
            ped.downTimer = 3.5;
            state.heat = Math.min(100, state.heat + WANTED.hitPed);
            dead = true;
            break;
          }
        }
      }
      if (dead) state.bullets.splice(i, 1);
    }

    // --- pickups ---
    for (let i = state.pickups.length - 1; i >= 0; i -= 1) {
      const pk = state.pickups[i];
      pk.timer += dt;
      const reach = p.inCar ? CAR.radius + 14 : PLAYER.radius + 14;
      const px = p.inCar ? p.inCar.x : p.x;
      const py = p.inCar ? p.inCar.y : p.y;
      if (dist(pk.x, pk.y, px, py) < reach) {
        if (pk.kind === 'cash') {
          state.cash += pk.amount;
          state.bestCash = Math.max(state.bestCash, state.cash);
          events |= EVENT_COIN;
        } else {
          p.health = Math.min(PLAYER.health, p.health + pk.amount);
          state.health = p.health;
          events |= EVENT_HEALTH;
        }
        state.pickups.splice(i, 1);
        spawnPickup(pk.kind);
      } else if (pk.timer > 45) {
        state.pickups.splice(i, 1);
        spawnPickup(pk.kind);
      }
    }

    // --- health regen (slow, only when safe) ---
    if (state.heat === 0 && p.health > 0 && p.health < PLAYER.health) {
      p.health = Math.min(PLAYER.health, p.health + 2 * dt);
      state.health = p.health;
    }
    if (p.health <= 0) return bust();

    // --- mission steps ---
    const stepEv = stepMission(dt);
    events |= stepEv;

    return events;
  }

  function stepMission(dt) {
    const mission = currentMission();
    if (!mission) return 0;
    const step = currentStep();
    if (!step) return 0;
    const p = state.player;
    const px = p.inCar ? p.inCar.x : p.x;
    const py = p.inCar ? p.inCar.y : p.y;

    if (step.type === 'steal') {
      if (p.inCar) return advanceStep();
      return 0;
    }
    if (step.type === 'chase') {
      if (!state.courier) {
        // Courier destroyed: the briefcase is the next step. Courier lost any
        // other way (e.g. a bust clears it and restarts the mission): send a
        // fresh courier out instead of stalling on a target that never comes.
        if (state.briefcase) return advanceStep();
        spawnCourier();
        return 0;
      }
      return 0;
    }
    if (step.type === 'hold') {
      const target = stepTarget();
      if (!target) return 0;
      if (dist(px, py, target.x, target.y) < step.radius) {
        state.holdProgress += dt;
        if (state.holdProgress >= step.seconds) {
          if (mission.id === 'score') state.heat = Math.max(state.heat, 3 * WANTED.heatPerStar);
          return advanceStep();
        }
      } else {
        state.holdProgress = Math.max(0, state.holdProgress - dt * 2);
      }
      return 0;
    }
    // 'goto'
    const target = stepTarget();
    if (!target) return 0;
    if (dist(px, py, target.x, target.y) < step.radius) {
      if (state.stepIndex + 1 >= mission.steps.length) return completeMission();
      return advanceStep();
    }
    return 0;
  }

  function bust() {
    const fine = Math.min(WANTED.bustFine, Math.floor(state.cash * 0.1));
    state.cash = Math.max(0, state.cash - fine);
    state.heat = 0;
    state.bustTimer = 0;
    state.cars = state.cars.filter((c) => c.kind !== 'police' && c.kind !== 'courier');
    for (const c of state.cars) c.driven = false;
    state.courier = null;
    state.player.inCar = null;
    state.player.health = PLAYER.health;
    state.health = PLAYER.health;
    state.player.x = PLACES.hospital.x;
    state.player.y = PLACES.hospital.y;
    state.message = `Busted! You paid $${fine} and woke up at the hospital.`;
    // The current mission restarts from its first step.
    const m = currentMission();
    if (m) {
      state.stepIndex = 0;
      state.holdProgress = 0;
      state.missionTimer = m.timeLimit ?? 0;
    }
    return EVENT_BUSTED;
  }

  // --- driving ---
  function driveCar(car, ctl, dt) {
    const forward = ctl.vy < 0;
    const backward = ctl.vy > 0;
    const steer = ctl.vx;
    const handbrake = ctl.sprint;
    if (forward) car.speed += CAR.accel * dt;
    else if (backward) {
      car.speed += car.speed > 5 ? -CAR.brake * dt : -CAR.reverseAccel * dt;
    }
    if (handbrake) {
      car.speed -= Math.sign(car.speed) * CAR.brake * dt;
      if (Math.abs(car.speed) < 30) car.speed = 0;
    }
    // Drag + off-road slowdown.
    car.speed *= Math.exp(-CAR.drag * dt);
    if (!onRoad(car.x, car.y)) car.speed *= Math.exp(-1.1 * dt);
    car.speed = clamp(car.speed, -CAR.maxReverse, CAR.maxSpeed);
    const spd = Math.abs(car.speed);
    if (spd > 8 && steer !== 0) {
      const turn = CAR.turnRate * (handbrake ? 1.5 : 1) * clamp(spd / 240, 0.35, 1);
      car.angle += steer * turn * dt * Math.sign(car.speed);
    }
    const nx = car.x + Math.cos(car.angle) * car.speed * dt;
    const ny = car.y + Math.sin(car.angle) * car.speed * dt;
    const before = car.speed;
    car.x = clamp(nx, 0, WORLD);
    car.y = clamp(ny, 0, WORLD);
    const pen = resolveBuildings(car, CAR.radius);
    if (pen > 0 && Math.abs(before) > 200 && car.crashCooldown <= 0) {
      car.health -= Math.min(18, (Math.abs(before) - 200) / 22);
      car.speed *= -0.25;
      car.crashCooldown = 0.5;
      state.shake = 0.45;
    }
    if (car.health <= 0) {
      // Handled by the destroyed-cars pass in step().
    }
  }

  function stepTraffic(car, dt) {
    // Follow the road grid; at a junction pick a new direction (never reverse).
    const jx = roadLine(car.x);
    const jy = roadLine(car.y);
    const along = Math.abs(Math.cos(car.dir)) > 0.5 ? car.x : car.y;
    const centre = Math.abs(Math.cos(car.dir)) > 0.5 ? jx : jy;
    const key = `${jx},${jy}`;
    if (Math.abs(along - centre) < 7 && car.lastJunction !== key) {
      car.lastJunction = key;
      const roll = random();
      let turn = 0;
      if (roll < 0.22) turn = Math.PI / 2;
      else if (roll < 0.44) turn = -Math.PI / 2;
      if (turn !== 0) {
        car.dir += turn;
        car.angle = car.dir;
        if (Math.abs(Math.cos(car.dir)) > 0.5) car.y = jy;
        else car.x = jx;
      }
    }
    // Keep a gap to the car ahead on the same road.
    let blocked = false;
    for (const other of state.cars) {
      if (other === car || other.kind === 'parked') continue;
      const dx = other.x - car.x;
      const dy = other.y - car.y;
      const ahead = dx * Math.cos(car.dir) + dy * Math.sin(car.dir);
      const side = Math.abs(-dx * Math.sin(car.dir) + dy * Math.cos(car.dir));
      if (ahead > 0 && ahead < 70 && side < 30) {
        blocked = true;
        break;
      }
    }
    const target = blocked ? 0 : car.targetSpeed;
    car.speed += clamp(target - car.speed, -260 * dt, 160 * dt);
    car.x += Math.cos(car.dir) * car.speed * dt;
    car.y += Math.sin(car.dir) * car.speed * dt;
    car.x = clamp(car.x, 0, WORLD);
    car.y = clamp(car.y, 0, WORLD);
    car.angle = car.dir;
    resolveBuildings(car, CAR.radius);
  }

  function stepPolice(car, dt) {
    const p = state.player;
    const tx = p.inCar ? p.inCar.x : p.x;
    const ty = p.inCar ? p.inCar.y : p.y;
    const d = dist(car.x, car.y, tx, ty);
    if (d < 240) {
      // Close in: drive straight at the player.
      const want = angleTo(car.x, car.y, tx, ty);
      car.angle += clamp(angleDiff(want, car.angle), -3.2 * dt, 3.2 * dt);
      car.speed = Math.min(POLICE.carSpeed, car.speed + 420 * dt);
    } else {
      // Road pursuit: at a junction pick the direction that closes the gap.
      const jx = roadLine(car.x);
      const jy = roadLine(car.y);
      const along = Math.abs(Math.cos(car.dir)) > 0.5 ? car.x : car.y;
      const centre = Math.abs(Math.cos(car.dir)) > 0.5 ? jx : jy;
      const key = `${jx},${jy}`;
      if (Math.abs(along - centre) < 8 && car.lastJunction !== key) {
        car.lastJunction = key;
        const options = [0, Math.PI / 2, Math.PI, -Math.PI / 2];
        let bestDir = car.dir;
        let bestScore = Infinity;
        for (const o of options) {
          if (Math.abs(angleDiff(o, car.dir)) > Math.PI * 0.75) continue; // no reversing
          const nx = car.x + Math.cos(o) * 100;
          const ny = car.y + Math.sin(o) * 100;
          const score = Math.abs(nx - tx) + Math.abs(ny - ty);
          if (score < bestScore) {
            bestScore = score;
            bestDir = o;
          }
        }
        car.dir = bestDir;
        car.angle = car.dir;
        if (Math.abs(Math.cos(car.dir)) > 0.5) car.y = jy;
        else car.x = jx;
      }
      car.speed += clamp(POLICE.carSpeed * 0.9 - car.speed, -300 * dt, 260 * dt);
    }
    car.x += Math.cos(car.angle) * car.speed * dt;
    car.y += Math.sin(car.angle) * car.speed * dt;
    car.x = clamp(car.x, 0, WORLD);
    car.y = clamp(car.y, 0, WORLD);
    car.dir = car.angle;
    resolveBuildings(car, CAR.radius);
  }

  function stepCourier(car, dt) {
    // Flees from the player along the road grid, fast but catchable.
    const p = state.player;
    const tx = p.inCar ? p.inCar.x : p.x;
    const ty = p.inCar ? p.inCar.y : p.y;
    const jx = roadLine(car.x);
    const jy = roadLine(car.y);
    const along = Math.abs(Math.cos(car.dir)) > 0.5 ? car.x : car.y;
    const centre = Math.abs(Math.cos(car.dir)) > 0.5 ? jx : jy;
    const key = `${jx},${jy}`;
    if (Math.abs(along - centre) < 8 && car.lastJunction !== key) {
      car.lastJunction = key;
      const options = [0, Math.PI / 2, Math.PI, -Math.PI / 2];
      let bestDir = car.dir;
      let bestScore = -Infinity;
      for (const o of options) {
        if (Math.abs(angleDiff(o, car.dir)) > Math.PI * 0.75) continue;
        const nx = car.x + Math.cos(o) * 100;
        const ny = car.y + Math.sin(o) * 100;
        const score = Math.abs(nx - tx) + Math.abs(ny - ty);
        if (score > bestScore) {
          bestScore = score;
          bestDir = o;
        }
      }
      car.dir = bestDir;
      car.angle = car.dir;
      if (Math.abs(Math.cos(car.dir)) > 0.5) car.y = jy;
      else car.x = jx;
    }
    car.speed += clamp(430 - car.speed, -300 * dt, 300 * dt);
    car.x += Math.cos(car.dir) * car.speed * dt;
    car.y += Math.sin(car.dir) * car.speed * dt;
    car.x = clamp(car.x, 0, WORLD);
    car.y = clamp(car.y, 0, WORLD);
    car.angle = car.dir;
    resolveBuildings(car, CAR.radius);
  }

  reset();

  return {
    state,
    reset,
    step,
    stars,
    currentMission,
    currentStep,
    stepTarget,
    startMission,
    applySave,
    makeSave,
    onRoad,
  };
}
