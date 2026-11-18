// Drawing only: the world's state and the current screen in, pixels out. The
// camera follows the player over a 1280x720 logical view of the 3200x3200 city,
// scaled to fit the window. Flat shapes and canvas text: a sun-soaked top-down
// city — pastel buildings with shadows, beach and water on the east edge, docks
// on the south — plus the HUD (cash, health, wanted stars, objective), a live
// minimap, and the title / pause / busted / mission panels.
import { BLOCK, CAR, GRID_LINES, MISSIONS, PALETTE, PITCH, PLAYER, ROAD_W, VIEW, WORLD } from './config.js';

export const SCREEN_TITLE = 'title';
export const SCREEN_PLAY = 'play';
export const SCREEN_PAUSED = 'paused';
export const SCREEN_BUSTED = 'busted';
export const SCREEN_MISSION = 'mission';
export const SCREEN_STORY = 'story';

const TAU = Math.PI * 2;

function clamp(value, min, max) {
  return value < min ? min : value > max ? max : value;
}

export function createRenderer(canvas) {
  const context = canvas.getContext('2d');
  const view = { scale: 1, x: 0, y: 0 };
  const fonts = new Map();

  function resize() {
    const ratio = window.devicePixelRatio || 1;
    const width = Math.round(window.innerWidth * ratio);
    const height = Math.round(window.innerHeight * ratio);
    canvas.width = width;
    canvas.height = height;
    view.scale = Math.min(width / VIEW.width, height / VIEW.height);
    view.x = (width - VIEW.width * view.scale) / 2;
    view.y = (height - VIEW.height * view.scale) / 2;
  }

  function text(value, x, y, size, color, align = 'left', baseline = 'alphabetic') {
    const key = `${size}`;
    if (!fonts.has(key)) fonts.set(key, `bold ${size}px ${'system-ui, -apple-system, "Segoe UI", sans-serif'}`);
    context.font = fonts.get(key);
    context.fillStyle = color;
    context.textAlign = align;
    context.textBaseline = baseline;
    context.fillText(value, x, y);
  }

  function panel(x, y, w, h, fill) {
    context.fillStyle = fill;
    context.fillRect(x, y, w, h);
  }

  // ---- world drawing (in world coordinates, under the camera transform) ----
  function drawGround(cam) {
    const x0 = Math.max(0, cam.x - VIEW.width / 2 - 40);
    const y0 = Math.max(0, cam.y - VIEW.height / 2 - 40);
    const x1 = Math.min(WORLD, cam.x + VIEW.width / 2 + 40);
    const y1 = Math.min(WORLD, cam.y + VIEW.height / 2 + 40);
    context.fillStyle = PALETTE.ground;
    context.fillRect(x0, y0, x1 - x0, y1 - y0);
    // Beach: sand strip on the east edge, water beyond it.
    const beachX = (GRID_LINES - 2) * PITCH + ROAD_W / 2;
    context.fillStyle = PALETTE.sand;
    context.fillRect(Math.max(beachX, x0), y0, Math.min(WORLD, x1) - Math.max(beachX, x0), y1 - y0);
    context.fillStyle = PALETTE.water;
    context.fillRect(Math.max(3150, x0), y0, Math.min(WORLD, x1) - Math.max(3150, x0), y1 - y0);
    context.fillStyle = PALETTE.waterDeep;
    context.fillRect(Math.max(3175, x0), y0, Math.min(WORLD, x1) - Math.max(3175, x0), y1 - y0);
    // Docks: concrete on the south edge.
    const dockY = (GRID_LINES - 2) * PITCH + ROAD_W / 2;
    context.fillStyle = PALETTE.dock;
    context.fillRect(x0, Math.max(dockY, y0), x1 - x0, Math.min(WORLD, y1) - Math.max(dockY, y0));
    // Roads: sidewalk band, asphalt, centre dashes.
    for (let k = 0; k < GRID_LINES; k += 1) {
      const c = k * PITCH;
      // Vertical road.
      context.fillStyle = PALETTE.sidewalk;
      context.fillRect(c - ROAD_W / 2 - 8, y0, ROAD_W + 16, y1 - y0);
      context.fillStyle = PALETTE.road;
      context.fillRect(c - ROAD_W / 2, y0, ROAD_W, y1 - y0);
      // Horizontal road.
      context.fillStyle = PALETTE.sidewalk;
      context.fillRect(x0, c - ROAD_W / 2 - 8, x1 - x0, ROAD_W + 16);
      context.fillStyle = PALETTE.road;
      context.fillRect(x0, c - ROAD_W / 2, x1 - x0, ROAD_W);
    }
    // Lane dashes.
    context.fillStyle = PALETTE.laneLine;
    for (let k = 0; k < GRID_LINES; k += 1) {
      const c = k * PITCH;
      for (let d = 0; d < WORLD; d += 64) {
        if (d % 128 < 64) continue;
        context.fillRect(c - 2, d, 4, 26);
        context.fillRect(d, c - 2, 26, 4);
      }
    }
  }

  function drawBuildings(state, cam) {
    const x0 = cam.x - VIEW.width / 2 - 60;
    const y0 = cam.y - VIEW.height / 2 - 60;
    const x1 = cam.x + VIEW.width / 2 + 60;
    const y1 = cam.y + VIEW.height / 2 + 60;
    for (const b of state.buildings) {
      if (b.x > x1 || b.x + b.w < x0 || b.y > y1 || b.y + b.h < y0) continue;
      const ox = b.hgt * 0.45;
      const oy = b.hgt * 0.55;
      context.fillStyle = 'rgba(0,0,0,0.28)';
      context.fillRect(b.x + ox, b.y + oy, b.w, b.h);
      context.fillStyle = b.color;
      context.fillRect(b.x, b.y, b.w, b.h);
      context.fillStyle = 'rgba(255,255,255,0.18)';
      context.fillRect(b.x + 6, b.y + 6, b.w - 12, 10);
      context.fillStyle = 'rgba(0,0,0,0.15)';
      context.fillRect(b.x, b.y + b.h - 8, b.w, 8);
    }
    for (const c of state.containers) {
      if (c.x > x1 || c.x + c.w < x0 || c.y > y1 || c.y + c.h < y0) continue;
      context.fillStyle = c.color;
      context.fillRect(c.x, c.y, c.w, c.h);
      context.fillStyle = 'rgba(255,255,255,0.25)';
      for (let s = 0; s < 4; s += 1) context.fillRect(c.x + 8 + s * 16, c.y + 4, 3, c.h - 8);
    }
    for (const t of state.trees) {
      if (t.x < x0 || t.x > x1 || t.y < y0 || t.y > y1) continue;
      context.fillStyle = 'rgba(0,0,0,0.2)';
      context.beginPath();
      context.arc(t.x + 4, t.y + 5, t.r, 0, TAU);
      context.fill();
      context.fillStyle = PALETTE.tree;
      context.beginPath();
      context.arc(t.x, t.y, t.r, 0, TAU);
      context.fill();
      context.fillStyle = PALETTE.treeLight;
      context.beginPath();
      context.arc(t.x - 3, t.y - 3, t.r * 0.55, 0, TAU);
      context.fill();
    }
  }

  function drawCarShape(car, isPlayerCar) {
    context.save();
    context.translate(car.x, car.y);
    context.rotate(car.angle);
    // Shadow.
    context.fillStyle = 'rgba(0,0,0,0.3)';
    context.fillRect(-CAR.length / 2 + 3, -CAR.width / 2 + 4, CAR.length, CAR.width);
    // Body.
    context.fillStyle = car.color;
    context.fillRect(-CAR.length / 2, -CAR.width / 2, CAR.length, CAR.width);
    context.fillStyle = 'rgba(255,255,255,0.35)';
    context.fillRect(-CAR.length / 2 + 4, -CAR.width / 2 + 2, 10, CAR.width - 4);
    // Windshield + roof.
    context.fillStyle = '#1c2733';
    context.fillRect(-6, -CAR.width / 2 + 3, 9, CAR.width - 6);
    context.fillStyle = 'rgba(255,255,255,0.22)';
    context.fillRect(4, -CAR.width / 2 + 4, 12, CAR.width - 8);
    // Headlights.
    context.fillStyle = '#fff8c9';
    context.fillRect(CAR.length / 2 - 3, -CAR.width / 2 + 2, 3, 5);
    context.fillRect(CAR.length / 2 - 3, CAR.width / 2 - 7, 3, 5);
    // Damage smoke when hurt.
    if (car.health < 45) {
      context.fillStyle = 'rgba(80,80,80,0.55)';
      context.beginPath();
      context.arc(-CAR.length / 2 + 4, 0, 6 + Math.random() * 3, 0, TAU);
      context.fill();
    }
    if (isPlayerCar) {
      context.strokeStyle = '#ffffff';
      context.lineWidth = 2;
      context.strokeRect(-CAR.length / 2 - 3, -CAR.width / 2 - 3, CAR.length + 6, CAR.width + 6);
    }
    context.restore();
    if (car.kind === 'police') {
      // Flashing light bar.
      const flash = Math.floor(stateTime * 6) % 2 === 0;
      context.fillStyle = flash ? '#ff3b30' : '#2f6fd8';
      context.beginPath();
      context.arc(car.x - 4, car.y - 8, 4, 0, TAU);
      context.fill();
      context.fillStyle = flash ? '#2f6fd8' : '#ff3b30';
      context.beginPath();
      context.arc(car.x - 4, car.y + 8, 4, 0, TAU);
      context.fill();
    }
  }

  let stateTime = 0;

  function drawEntities(state) {
    // Pickups.
    for (const pk of state.pickups) {
      const bob = Math.sin(state.time * 3 + pk.x) * 2;
      if (pk.kind === 'cash') {
        context.fillStyle = '#1f7a33';
        context.fillRect(pk.x - 11, pk.y - 7 + bob, 22, 14);
        context.fillStyle = '#7dff8a';
        context.font = 'bold 12px system-ui, sans-serif';
        context.textAlign = 'center';
        context.textBaseline = 'middle';
        context.fillText('$', pk.x, pk.y + bob);
      } else {
        context.fillStyle = '#ffffff';
        context.fillRect(pk.x - 10, pk.y - 10 + bob, 20, 20);
        context.fillStyle = '#e5484d';
        context.fillRect(pk.x - 3, pk.y - 8 + bob, 6, 16);
        context.fillRect(pk.x - 8, pk.y - 3 + bob, 16, 6);
      }
    }
    if (state.briefcase) {
      const b = state.briefcase;
      context.fillStyle = '#8a5a2b';
      context.fillRect(b.x - 12, b.y - 8, 24, 16);
      context.fillStyle = '#f2c94c';
      context.fillRect(b.x - 12, b.y - 2, 24, 4);
    }
    // Pedestrians.
    for (const ped of state.peds) {
      context.fillStyle = 'rgba(0,0,0,0.25)';
      context.beginPath();
      context.ellipse(ped.x + 2, ped.y + 3, 8, 5, 0, 0, TAU);
      context.fill();
      context.fillStyle = ped.state === 'down' ? '#777777' : ped.color;
      context.beginPath();
      context.arc(ped.x, ped.y, ped.state === 'down' ? 7 : 8, 0, TAU);
      context.fill();
      context.fillStyle = '#222222';
      context.beginPath();
      context.arc(ped.x + Math.cos(ped.angle) * 4, ped.y + Math.sin(ped.angle) * 4, 3, 0, TAU);
      context.fill();
    }
    // Cars.
    for (const car of state.cars) drawCarShape(car, car.driven);
    // Bullets.
    context.fillStyle = '#ffe14d';
    for (const b of state.bullets) {
      context.beginPath();
      context.arc(b.x, b.y, 3.5, 0, TAU);
      context.fill();
    }
    // Player on foot.
    const p = state.player;
    if (!p.inCar) {
      context.fillStyle = 'rgba(0,0,0,0.3)';
      context.beginPath();
      context.ellipse(p.x + 2, p.y + 4, 11, 7, 0, 0, TAU);
      context.fill();
      context.fillStyle = PALETTE.player;
      context.beginPath();
      context.arc(p.x, p.y, PLAYER.radius, 0, TAU);
      context.fill();
      context.strokeStyle = '#222222';
      context.lineWidth = 2;
      context.beginPath();
      context.arc(p.x, p.y, PLAYER.radius, 0, TAU);
      context.stroke();
      // Facing tick + pistol.
      context.strokeStyle = '#222222';
      context.lineWidth = 3;
      context.beginPath();
      context.moveTo(p.x, p.y);
      context.lineTo(p.x + Math.cos(p.angle) * 20, p.y + Math.sin(p.angle) * 20);
      context.stroke();
      context.fillStyle = '#222222';
      context.beginPath();
      context.arc(p.x + Math.cos(p.angle) * 6, p.y + Math.sin(p.angle) * 6, 4, 0, TAU);
      context.fill();
    }
  }

  function drawMarker(state, cam) {
    const target = state.marker;
    if (!target) return;
    const pulse = 1 + Math.sin(state.time * 4) * 0.15;
    // Beacon column.
    context.fillStyle = 'rgba(255,46,136,0.16)';
    context.fillRect(target.x - 26, target.y - 90, 52, 90);
    context.strokeStyle = PALETTE.marker;
    context.lineWidth = 3;
    context.beginPath();
    context.arc(target.x, target.y, 26 * pulse, 0, TAU);
    context.stroke();
    context.fillStyle = PALETTE.marker;
    context.beginPath();
    context.arc(target.x, target.y, 7, 0, TAU);
    context.fill();
    // Off-screen arrow at the viewport edge.
    const vx0 = cam.x - VIEW.width / 2;
    const vy0 = cam.y - VIEW.height / 2;
    const vx1 = cam.x + VIEW.width / 2;
    const vy1 = cam.y + VIEW.height / 2;
    if (target.x < vx0 || target.x > vx1 || target.y < vy0 || target.y > vy1) {
      const ax = clamp(target.x, vx0 + 50, vx1 - 50);
      const ay = clamp(target.y, vy0 + 50, vy1 - 50);
      const ang = Math.atan2(target.y - ay, target.x - ax);
      context.save();
      context.translate(ax, ay);
      context.rotate(ang);
      context.fillStyle = PALETTE.marker;
      context.beginPath();
      context.moveTo(18, 0);
      context.lineTo(-10, -12);
      context.lineTo(-10, 12);
      context.closePath();
      context.fill();
      context.restore();
      const d = Math.round(Math.hypot(target.x - (state.player.inCar ? state.player.inCar.x : state.player.x), target.y - (state.player.inCar ? state.player.inCar.y : state.player.y)) / 50);
      text(`${d}m`, ax, ay - 22, 16, PALETTE.marker, 'center');
    }
  }

  // ---- HUD (screen coordinates) ----
  function drawHud(state, ui) {
    const p = state.player;
    const stars = ui.stars;
    // Top-left: cash + health.
    panel(16, 14, 250, 64, PALETTE.hudPanel);
    text(`$${state.cash.toLocaleString('en-US')}`, 28, 40, 26, PALETTE.cash);
    text('CASH', 28, 66, 12, PALETTE.hudDim);
    const hw = 130;
    const hx = 150;
    context.fillStyle = 'rgba(255,255,255,0.2)';
    context.fillRect(hx, 26, hw, 12);
    context.fillStyle = p.health > 30 ? PALETTE.health : PALETTE.healthLow;
    context.fillRect(hx, 26, hw * clamp(p.health / 100, 0, 1), 12);
    text('HP', hx, 66, 12, PALETTE.hudDim);
    // Top-centre: objective, shrunk to fit its panel.
    const obj = ui.objective;
    if (obj) {
      let size = 17;
      const fit = (s) => {
        context.font = `bold ${s}px ${'system-ui, -apple-system, "Segoe UI", sans-serif'}`;
        return context.measureText(obj).width + 32;
      };
      let w = fit(size);
      while (w > 660 && size > 12) {
        size -= 1;
        w = fit(size);
      }
      panel((VIEW.width - w) / 2, 14, w, 44, PALETTE.hudPanel);
      text(obj, VIEW.width / 2, 42, size, PALETTE.hud, 'center');
    }
    // Mission timer / hold progress under the objective.
    if (ui.timer !== null && ui.timer !== undefined) {
      const w = 220;
      panel((VIEW.width - w) / 2, 64, w, 26, PALETTE.hudPanel);
      text(`⏱ ${Math.ceil(ui.timer)}s`, VIEW.width / 2, 83, 17, ui.timer < 15 ? PALETTE.wanted : PALETTE.hud, 'center');
    }
    if (ui.holdProgress > 0) {
      const w = 220;
      panel((VIEW.width - w) / 2, 64, w, 26, PALETTE.hudPanel);
      context.fillStyle = 'rgba(255,255,255,0.2)';
      context.fillRect((VIEW.width - w) / 2 + 10, 74, w - 20, 8);
      context.fillStyle = PALETTE.marker;
      context.fillRect((VIEW.width - w) / 2 + 10, 74, (w - 20) * clamp(ui.holdProgress, 0, 1), 8);
    }
    // Wanted stars, top-right above the minimap.
    if (stars > 0) {
      let starText = '';
      for (let i = 0; i < 5; i += 1) starText += i < stars ? '★' : '☆';
      text(starText, VIEW.width - 16, 40, 30, PALETTE.wanted, 'right');
    }
    // Speed + car health, bottom-left.
    if (p.inCar) {
      panel(16, VIEW.height - 64, 230, 48, PALETTE.hudPanel);
      const kmh = Math.round(Math.abs(p.inCar.speed) * 0.36);
      text(`${kmh} km/h`, 28, VIEW.height - 38, 21, PALETTE.hud);
      context.fillStyle = 'rgba(255,255,255,0.2)';
      context.fillRect(28, VIEW.height - 28, 150, 8);
      context.fillStyle = p.inCar.health > 30 ? PALETTE.health : PALETTE.healthLow;
      context.fillRect(28, VIEW.height - 28, 150 * clamp(p.inCar.health / 100, 0, 1), 8);
    } else {
      panel(16, VIEW.height - 64, 330, 48, PALETTE.hudPanel);
      text('WASD move · Shift run · E steal car · Space shoot', 28, VIEW.height - 32, 15, PALETTE.hudDim);
    }
    if (p.inCar) {
      text('E exit · Shift handbrake', 28, VIEW.height - 74, 13, PALETTE.hudDim);
    }
    // Toast message, bottom-centre.
    if (ui.toast) {
      const w = Math.min(680, 24 + ui.toast.length * 8);
      panel((VIEW.width - w) / 2, VIEW.height - 58, w, 40, PALETTE.hudPanel);
      text(ui.toast, VIEW.width / 2, VIEW.height - 30, 16, PALETTE.hudAccent, 'center');
    }
    if (ui.muted) text('🔇 muted (M)', VIEW.width - 16, VIEW.height - 16, 13, PALETTE.hudDim, 'right');
    drawMinimap(state, ui);
  }

  function drawMinimap(state, ui) {
    const size = 190;
    const mx = VIEW.width - size - 16;
    const my = 56;
    const scale = size / WORLD;
    context.save();
    panel(mx - 6, my - 6, size + 12, size + 12, PALETTE.minimapBg);
    context.beginPath();
    context.rect(mx, my, size, size);
    context.clip();
    context.fillStyle = '#1d2b1f';
    context.fillRect(mx, my, size, size);
    // Water + beach.
    context.fillStyle = PALETTE.water;
    context.fillRect(mx + 3150 * scale, my, size - 3150 * scale, size);
    context.fillStyle = PALETTE.sand;
    context.fillRect(mx + 3060 * scale, my, 90 * scale, size);
    // Roads.
    context.strokeStyle = PALETTE.minimapRoad;
    context.lineWidth = 3;
    for (let k = 0; k < GRID_LINES; k += 1) {
      const c = k * PITCH * scale;
      context.beginPath();
      context.moveTo(mx + c, my);
      context.lineTo(mx + c, my + size);
      context.stroke();
      context.beginPath();
      context.moveTo(mx, my + c);
      context.lineTo(mx + size, my + c);
      context.stroke();
    }
    // Buildings.
    context.fillStyle = 'rgba(255,255,255,0.28)';
    for (const b of state.buildings) {
      context.fillRect(mx + b.x * scale, my + b.y * scale, Math.max(2, b.w * scale), Math.max(2, b.h * scale));
    }
    // Marker.
    if (state.marker) {
      const pulse = 1 + Math.sin(state.time * 4) * 0.3;
      context.fillStyle = PALETTE.marker;
      context.beginPath();
      context.arc(mx + state.marker.x * scale, my + state.marker.y * scale, 5 * pulse, 0, TAU);
      context.fill();
    }
    // Cars.
    context.fillStyle = '#ffd23f';
    for (const car of state.cars) {
      if (car.kind === 'police') continue;
      context.fillRect(mx + car.x * scale - 1.5, my + car.y * scale - 1.5, 3, 3);
    }
    // Police.
    context.fillStyle = Math.floor(state.time * 4) % 2 === 0 ? '#ff3b30' : '#2f6fd8';
    for (const car of state.cars) {
      if (car.kind !== 'police') continue;
      context.beginPath();
      context.arc(mx + car.x * scale, my + car.y * scale, 3.5, 0, TAU);
      context.fill();
    }
    // Player.
    const p = state.player;
    const px = p.inCar ? p.inCar.x : p.x;
    const py = p.inCar ? p.inCar.y : p.y;
    context.fillStyle = '#ffffff';
    context.beginPath();
    context.arc(mx + px * scale, my + py * scale, 4.5, 0, TAU);
    context.fill();
    context.strokeStyle = '#000000';
    context.lineWidth = 1.5;
    context.beginPath();
    context.arc(mx + px * scale, my + py * scale, 4.5, 0, TAU);
    context.stroke();
    context.restore();
    text('NEON BAY', mx + size / 2, my + size + 22, 12, PALETTE.hudDim, 'center');
  }

  function drawPanel(title, lines, prompt, accent) {
    const width = 640;
    const lineH = 30;
    const height = 150 + lines.length * lineH;
    const x = (VIEW.width - width) / 2;
    const y = (VIEW.height - height) / 2;
    // Shrink the body font until the longest line fits inside the panel.
    let bodySize = 19;
    const fitBody = (s) => {
      context.font = `bold ${s}px ${'system-ui, -apple-system, "Segoe UI", sans-serif'}`;
      return Math.max(...lines.map((l) => context.measureText(l).width));
    };
    while (fitBody(bodySize) > width - 48 && bodySize > 13) bodySize -= 1;
    panel(x, y, width, height, 'rgba(10,16,28,0.88)');
    context.strokeStyle = accent || PALETTE.hudAccent;
    context.lineWidth = 3;
    context.strokeRect(x, y, width, height);
    text(title, VIEW.width / 2, y + 62, 42, PALETTE.hud, 'center');
    for (let i = 0; i < lines.length; i += 1) {
      text(lines[i], VIEW.width / 2, y + 116 + i * lineH, bodySize, PALETTE.muted, 'center');
    }
    text(prompt, VIEW.width / 2, y + height - 30, 20, accent || PALETTE.hudAccent, 'center');
  }

  /** Paint one frame. `ui` carries the screen-only facts (best, objective, stars...). */
  function draw(state, screen, ui) {
    stateTime = state.time;
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.fillStyle = PALETTE.backdrop;
    context.fillRect(0, 0, canvas.width, canvas.height);
    const p = state.player;
    const focusX = p.inCar ? p.inCar.x : p.x;
    const focusY = p.inCar ? p.inCar.y : p.y;
    const cam = {
      x: clamp(focusX, VIEW.width / 2, WORLD - VIEW.width / 2),
      y: clamp(focusY, VIEW.height / 2, WORLD - VIEW.height / 2),
    };
    // Title screen: slow pan over the city instead of following the player.
    if (screen === SCREEN_TITLE) {
      cam.x = clamp(1600 + Math.sin(state.time * 0.05) * 500, VIEW.width / 2, WORLD - VIEW.width / 2);
      cam.y = clamp(1600 + Math.cos(state.time * 0.04) * 400, VIEW.height / 2, WORLD - VIEW.height / 2);
    }
    const shakeX = state.shake > 0 ? (Math.random() - 0.5) * state.shake * 14 : 0;
    const shakeY = state.shake > 0 ? (Math.random() - 0.5) * state.shake * 14 : 0;
    context.setTransform(view.scale, 0, 0, view.scale, view.x + shakeX * view.scale, view.y + shakeY * view.scale);
    // Camera transform: translate so the camera centre lands in the middle of the view.
    context.translate(VIEW.width / 2 - cam.x, VIEW.height / 2 - cam.y);
    drawGround(cam);
    drawBuildings(state, cam);
    drawMarker(state, cam);
    drawEntities(state);
    // Back to screen space for the HUD and panels.
    context.setTransform(view.scale, 0, 0, view.scale, view.x, view.y);
    if (screen === SCREEN_TITLE) {
      const mission = MISSIONS[0];
      drawPanel(
        'NEON BAY',
        [
          'An open-world crime game — a whole city, yours to take.',
          'Steal cars, outrun the cops, run five jobs for Marisol.',
          mission.brief,
          ui.hasSave ? 'You have a saved game — Continue picks it up.' : `Best cash so far: $${ui.best.toLocaleString('en-US')}`,
        ],
        ui.hasSave ? 'Enter: Continue · N: New game' : 'Press Space or click to start',
        PALETTE.marker,
      );
      return;
    }
    drawHud(state, ui);
    if (screen === SCREEN_PAUSED) {
      drawPanel('Paused', ['The city waits for you.', 'M mute · Space resume'], 'Press P to resume');
    } else if (screen === SCREEN_BUSTED) {
      drawPanel('BUSTED', [ui.bustedText || 'The cops caught up with you.', 'You woke up at the hospital.'], 'Press Space to get back out there', PALETTE.wanted);
    } else if (screen === SCREEN_MISSION) {
      drawPanel(
        'JOB DONE',
        [ui.missionText || 'Mission complete.', `Cash: $${state.cash.toLocaleString('en-US')}`],
        state.storyComplete ? 'Press Space — Neon Bay is yours' : 'Press Space for the next job',
        PALETTE.safe,
      );
    } else if (screen === SCREEN_STORY) {
      drawPanel(
        'NEON BAY IS YOURS',
        ['All five jobs done. The Big Score is in the bag.', `Final cash: $${state.cash.toLocaleString('en-US')} · Best: $${ui.best.toLocaleString('en-US')}`, 'Free roam: keep driving, keep the heat low.'],
        'Press Space to keep playing',
        PALETTE.gold,
      );
    }
  }

  resize();
  window.addEventListener('resize', resize);
  return { draw };
}
