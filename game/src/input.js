// Keyboard and pointer input. Held keys give a steering vector; one-shot presses
// (interact, shoot, pause, mute, confirm) are queued as bit flags and taken once by
// the loop, so a press between two frames is never lost and never counted twice.
// The mouse aims the pistol on foot: the pointer's world position is tracked.

export const ACTION_CONFIRM = 1;
export const ACTION_PAUSE = 2;
export const ACTION_INTERACT = 4;
export const ACTION_SHOOT = 8;
export const ACTION_MUTE = 16;

const UP = new Set(['ArrowUp', 'KeyW']);
const DOWN = new Set(['ArrowDown', 'KeyS']);
const LEFT = new Set(['ArrowLeft', 'KeyA']);
const RIGHT = new Set(['ArrowRight', 'KeyD']);
const CONFIRM = new Set(['Space', 'Enter']);
const INTERACT = new Set(['KeyE']);
const PAUSE = new Set(['KeyP', 'Escape']);
const MUTE = new Set(['KeyM']);
const SPRINT = new Set(['ShiftLeft', 'ShiftRight']);

export function createInput(target) {
  let up = false;
  let down = false;
  let left = false;
  let right = false;
  let sprint = false;
  let actions = 0;
  let pointer = null; // {x, y} in canvas CSS pixels, or null
  let pointerDown = false;

  function key(code, value) {
    if (UP.has(code)) up = value;
    else if (DOWN.has(code)) down = value;
    else if (LEFT.has(code)) left = value;
    else if (RIGHT.has(code)) right = value;
    else if (SPRINT.has(code)) sprint = value;
  }

  window.addEventListener('keydown', (event) => {
    if (UP.has(event.code) || DOWN.has(event.code) || LEFT.has(event.code) || RIGHT.has(event.code) || SPRINT.has(event.code)) {
      key(event.code, true);
      event.preventDefault();
    } else if (CONFIRM.has(event.code)) {
      if (!event.repeat) actions |= ACTION_CONFIRM;
      event.preventDefault();
    } else if (INTERACT.has(event.code)) {
      if (!event.repeat) actions |= ACTION_INTERACT;
    } else if (PAUSE.has(event.code)) {
      if (!event.repeat) actions |= ACTION_PAUSE;
    } else if (MUTE.has(event.code)) {
      if (!event.repeat) actions |= ACTION_MUTE;
    }
  });
  window.addEventListener('keyup', (event) => {
    key(event.code, false);
  });
  // A key released while the tab is hidden never sends keyup: let go of everything on blur.
  window.addEventListener('blur', () => {
    up = down = left = right = sprint = false;
    pointerDown = false;
  });
  target.addEventListener('pointermove', (event) => {
    const rect = target.getBoundingClientRect();
    pointer = { x: event.clientX - rect.left, y: event.clientY - rect.top };
  });
  target.addEventListener('pointerdown', (event) => {
    const rect = target.getBoundingClientRect();
    pointer = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    pointerDown = true;
    actions |= ACTION_CONFIRM;
  });
  target.addEventListener('pointerup', () => {
    pointerDown = false;
  });
  target.addEventListener('contextmenu', (event) => event.preventDefault());

  return {
    /** Steering vector: {x, y} each -1, 0 or 1. Up is -y. */
    vector() {
      return { x: (right ? 1 : 0) - (left ? 1 : 0), y: (down ? 1 : 0) - (up ? 1 : 0) };
    },
    sprint() {
      return sprint;
    },
    /** True while the mouse button (or touch) is held: hold to fire on foot. */
    firing() {
      return pointerDown;
    },
    /** The pointer's position in canvas CSS pixels, or null. */
    pointer() {
      return pointer;
    },
    /** The one-shot presses since the last call, as ACTION_* flags. */
    takeActions() {
      const taken = actions;
      actions = 0;
      return taken;
    },
    /** Test hook: pretend a key is held. */
    __setKey(code, value) {
      key(code, value);
    },
    __press(action) {
      actions |= action;
    },
  };
}
