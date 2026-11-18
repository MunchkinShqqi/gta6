// NEON BAY — an original open-world crime game (top-down, in the spirit of GTA).
// Every tuning number, colour and mission in one place. The world is a 3200x3200
// sun-soaked coastal city: a road grid, buildings, parks, a beach on the east edge
// and docks on the south. Nothing here is Rockstar's: the city, names, story, art
// and sound are all original.

// World geometry: roads run on grid lines every PITCH px; each road is ROAD_W wide;
// the blocks between them hold buildings, parks and parking lots.
export const WORLD = 3200;
export const PITCH = 350;
export const ROAD_W = 96;
export const GRID_LINES = 10; // lines at 0, 350, ... 3150
export const BLOCK = PITCH - ROAD_W; // 254 px of buildable block between roads

/** The viewport's logical size; the renderer scales it to the window. */
export const VIEW = { width: 1280, height: 720 };

/** The simulation's fixed step, in seconds: 60 updates a second whatever the display's rate. */
export const STEP = 1 / 60;

export const PLAYER = {
  radius: 13,
  walkSpeed: 210,
  sprintSpeed: 320,
  health: 100,
  fireRate: 0.22, // seconds between pistol shots
  bulletSpeed: 900,
  bulletDamage: 34,
};

export const CAR = {
  radius: 17, // collision circle, roughly half the car length
  length: 44,
  width: 22,
  accel: 430,
  brake: 700,
  reverseAccel: 300,
  maxSpeed: 560,
  maxReverse: 200,
  turnRate: 2.6, // rad/s at full lock, scaled by speed
  drag: 0.55, // 1/s exponential drag
  health: 100,
};

export const TRAFFIC_COUNT = 16;
export const PED_COUNT = 26;
export const PICKUP_COUNT = 6;

export const WANTED = {
  maxStars: 5,
  heatPerStar: 20,
  decayFar: 2.2, // heat/s lost when no police car is near
  decayNear: 0.4, // heat/s lost while police are close
  jackOccupied: 25, // heat for stealing a driven car
  hitPed: 25,
  shotFired: 4, // per shot, only when a cop or a ped sees it
  killCop: 40,
  bustFine: 200, // cash lost when busted (or 10%, whichever is smaller)
};

export const POLICE = {
  carSpeed: 510,
  ramDamage: 8,
  bustHold: 1.1, // seconds a cop must touch the player on foot to bust them
};

export const SAVE_KEY = 'neon-bay.save.v1';
export const BEST_KEY = 'neon-bay.best.v1';

/** The story: five missions, in order. Each mission is a list of steps. */
export const MISSIONS = [
  {
    id: 'wheels',
    title: 'Mission 1 — Wheels Up',
    brief:
      'Marisol needs a driver. Steal any car — a parked one draws no heat — and bring it to her garage.',
    pay: 300,
    steps: [
      { type: 'steal', text: 'Steal a car (E near a car). Parked cars draw no heat.' },
      { type: 'goto', at: 'garage', radius: 70, text: 'Drive to Marisol’s garage (pink marker).' },
    ],
  },
  {
    id: 'pickup',
    title: 'Mission 2 — The Pickup',
    brief:
      'A package is waiting at the south docks. Collect it and deliver it to the Sunset Motel. Keep it clean — the cops watch the docks.',
    pay: 600,
    steps: [
      { type: 'goto', at: 'docks', radius: 70, text: 'Drive to the package at the docks.' },
      { type: 'goto', at: 'motel', radius: 70, text: 'Deliver the package to the Sunset Motel.' },
    ],
  },
  {
    id: 'getaway',
    title: 'Mission 3 — Hot Pursuit',
    brief:
      'The deal went loud and the whole precinct is coming. Lose the heat and reach the safehouse in 90 seconds.',
    pay: 900,
    timeLimit: 90,
    startWanted: 2,
    steps: [{ type: 'goto', at: 'safehouse', radius: 80, text: 'Reach the safehouse before the timer runs out!' }],
  },
  {
    id: 'courier',
    title: 'Mission 4 — Courier Takedown',
    brief:
      'A rival courier is carrying the Bay Kings’ ledger across town. Ram his car until it stops — or shoot the driver — grab the briefcase and bring it to Marisol.',
    pay: 1500,
    steps: [
      { type: 'chase', text: 'Chase the courier’s car. Ram it or shoot the driver until it stops.' },
      { type: 'goto', at: 'briefcase', radius: 60, text: 'Grab the briefcase.' },
      { type: 'goto', at: 'garage', radius: 70, text: 'Bring the briefcase to Marisol’s garage.' },
    ],
  },
  {
    id: 'score',
    title: 'Mission 5 — The Big Score',
    brief:
      'Tonight we hit the Bay Bank. Park at the vault door and hold still while the drill works — eight seconds — then lose the three-star heat and get to the safehouse.',
    pay: 2500,
    startWanted: 0,
    steps: [
      { type: 'goto', at: 'bank', radius: 80, text: 'Drive to the Bay Bank vault.' },
      { type: 'hold', at: 'bank', radius: 80, seconds: 8, text: 'Hold still — cracking the vault…' },
      { type: 'goto', at: 'safehouse', radius: 80, text: 'Escape to the safehouse with the loot!' },
    ],
  },
];

/** Named places on the map (world coordinates). */
export const PLACES = {
  garage: { x: 700, y: 700, label: 'Marisol’s Garage' },
  motel: { x: 2450, y: 1050, label: 'Sunset Motel' },
  docks: { x: 1400, y: 2975, label: 'South Docks' },
  safehouse: { x: 2800, y: 2800, label: 'Safehouse' },
  bank: { x: 1750, y: 1750, label: 'Bay Bank' },
  hospital: { x: 350, y: 2450, label: 'Hospital' },
  start: { x: 700, y: 1050, label: 'Neon Bay' },
};

/** Sun-soaked palette: warm sand, teal water, pastel buildings, neon pink markers. */
export const PALETTE = {
  backdrop: '#0e1420',
  ground: '#7fae7a', // grass between roads
  sand: '#e8d39a',
  water: '#2f8fc4',
  waterDeep: '#1f6da3',
  road: '#3a3f4a',
  roadEdge: '#2c303a',
  sidewalk: '#b9b3a4',
  laneLine: '#e8e4d2',
  buildingRoof: ['#e07856', '#e8a34c', '#5fb8a6', '#7d8fd4', '#c96f9e', '#8fae5c', '#d4c25e', '#6fb3d8'],
  buildingSide: '#00000033',
  park: '#5d9e57',
  tree: '#2f7a33',
  treeLight: '#57a84e',
  dock: '#8a8f98',
  container: ['#c65b3c', '#3c7dc6', '#5aa864', '#c6a43c'],
  player: '#ffd23f',
  playerDark: '#2b2b2b',
  ped: ['#f2f2f2', '#ff9d9d', '#9dd4ff', '#c9f29d', '#e8c9ff'],
  cop: '#2f6fd8',
  copLight: '#ff3b30',
  marker: '#ff2e88',
  safe: '#37d67a',
  hud: '#ffffff',
  hudDim: '#cfd6e4',
  hudPanel: 'rgba(10, 16, 28, 0.72)',
  hudAccent: '#ffd23f',
  wanted: '#ff3b30',
  health: '#37d67a',
  healthLow: '#ff3b30',
  cash: '#7dff8a',
  minimapRoad: '#565d6b',
  minimapBg: 'rgba(10, 16, 28, 0.85)',
  text: '#eef1f5',
  muted: '#9aa3b5',
  panel: '#171e2e',
  gold: '#f2c94c',
};

export const FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif';

/** Car body colours (traffic, parked, player cars). */
export const CAR_COLORS = ['#e5484d', '#f2c94c', '#4fc3f7', '#9d7bff', '#f28c4c', '#e8e8e8', '#37d67a', '#ff7ab8', '#8a8f98'];
