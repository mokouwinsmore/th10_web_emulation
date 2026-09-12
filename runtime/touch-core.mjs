// Basic Eagler touch semantics, translated from TH06/07/08 Touch.cpp and the
// corresponding Player movement branches. Intentionally no touch Replay code.
const clamp = (n, low, high) => Math.min(high, Math.max(low, n));
const finite = (n, fallback = 0) => Number.isFinite(n) ? n : fallback;
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const defaults = Object.freeze({touchEnabled: false, touchMovementMode: 'touch', unlimitedTouch: false,
  touchSensitivity: 100, touchFocusMode: 'hold-button', doubleTapBombEnabled: false, touchBombZoneEnabled: false});

export class TouchCore {
  constructor({now = () => performance.now(), options = {}} = {}) {
    this.now = now;
    this.options = {...defaults};
    this.controls = {fireEnabled: true, focusEnabled: false, joystickX: 0, joystickY: 0, bombSerial: 0, escapeSerial: 0};
    this.state = {mode: 'menu', owner: 0, skippable: false};
    this.pending = new Set();
    this.fingers = new Map();
    this.delta = {x: 0, y: 0};
    this.moveId = null;
    this.focusId = null;
    this.dialogueId = null;
    this.menu = null;
    this.tap = null;
    this.armedTap = null;
    this.configure(options);
  }
  get joystick() { return ['joystick', 'joystick-free'].includes(this.options.touchMovementMode); }
  get gameplay() { return this.state.mode === 'gameplay' || this.state.mode === 'dialogue'; }
  configure(options = {}) {
    const next = {...this.options};
    for (const key of ['touchEnabled', 'unlimitedTouch', 'doubleTapBombEnabled', 'touchBombZoneEnabled']) {
      if (typeof options[key] === 'boolean') next[key] = options[key];
    }
    if (['touch', 'touch-unlimited', 'joystick', 'joystick-free'].includes(options.touchMovementMode)) {
      next.touchMovementMode = options.touchMovementMode === 'touch-unlimited' ? 'touch' : options.touchMovementMode;
      if (options.touchMovementMode === 'touch-unlimited') next.unlimitedTouch = true;
    }
    if (['hold-button', 'toggle-button', 'two-finger'].includes(options.touchFocusMode)) next.touchFocusMode = options.touchFocusMode;
    if (Number.isFinite(options.touchSensitivity)) next.touchSensitivity = clamp(options.touchSensitivity, 50, 300);
    if (next.touchEnabled !== this.options.touchEnabled || next.touchMovementMode !== this.options.touchMovementMode ||
        next.touchFocusMode !== this.options.touchFocusMode || next.unlimitedTouch !== this.options.unlimitedTouch) this.cancel();
    this.options = next;
  }
  setState(state) {
    const next = {mode: state.mode, owner: state.owner ?? 0, skippable: !!state.skippable};
    if (!['menu', 'gameplay', 'dialogue', 'inactive'].includes(next.mode)) throw new Error('Invalid touch owner');
    if (next.owner !== this.state.owner || ((next.mode === 'menu' || next.mode === 'inactive') && next.mode !== this.state.mode) ||
        (this.state.mode === 'menu' && next.mode !== 'menu')) this.cancel();
    if (this.state.mode === 'dialogue' && next.mode === 'gameplay' && this.dialogueId !== null) {
      const finger = this.fingers.get(this.dialogueId);
      if (finger && !this.joystick && this.moveId === null) this.moveId = finger.id;
      this.dialogueId = null;
    }
    if (next.mode === 'dialogue' && this.state.mode !== 'dialogue') {
      this.delta = {x: 0, y: 0};
      this.moveId = this.focusId = null;
      this.tap = this.armedTap = null;
    }
    this.state = next;
  }
  updateControls(value) {
    for (const field of ['fireEnabled', 'focusEnabled']) if (typeof value[field] === 'boolean') this.controls[field] = value[field];
    for (const field of ['joystickX', 'joystickY']) if (Number.isInteger(value[field])) this.controls[field] = clamp(value[field], -32767, 32767);
    for (const [field, code] of [['bombSerial', 'KeyX'], ['escapeSerial', 'Escape']]) {
      if (!Number.isInteger(value[field]) || value[field] === this.controls[field]) continue;
      this.controls[field] = value[field];
      if (this.options.touchEnabled && (code === 'Escape' || this.gameplay)) this.pending.add(code);
    }
    if (Number.isFinite(value.touchSensitivity)) this.configure({touchSensitivity: value.touchSensitivity});
  }
  cancel({controls = false} = {}) {
    this.fingers.clear();
    this.delta = {x: 0, y: 0};
    this.moveId = this.focusId = this.dialogueId = null;
    this.menu = this.tap = this.armedTap = null;
    this.pending.clear();
    // Normal mode changes only release game-owned fingers. Host button state
    // is not ours to silently change. Explicit loss-of-focus releases transient
    // controls too; the persistent auto-fire preference remains unchanged.
    if (controls) {
      this.controls.focusEnabled = false;
      this.controls.joystickX = this.controls.joystickY = 0;
    }
  }
  release(id) {
    this.fingers.delete(id);
    if (this.moveId === id) { this.moveId = null; this.delta = {x: 0, y: 0}; }
    if (this.focusId === id) this.focusId = null;
    if (this.dialogueId === id) this.dialogueId = null;
  }
  // x/y are in the original 640x480 canvas space, not CSS or device pixels.
  // The browser bridge additionally supplies menu/gesture coordinates relative
  // to its viewport so layout zoom cannot distort gesture thresholds.
  pointer(type, {id, x, y, gestureX = x, gestureY = y, threshold = 24, tapRadius = 38.4, bombZone = false}) {
    if (!Number.isInteger(id) || ![x, y, gestureX, gestureY, threshold, tapRadius].every(Number.isFinite)) return false;
    if (!['down', 'move', 'up', 'cancel'].includes(type)) return false;
    const time = this.now();
    const point = {id, x, y, gx: gestureX, gy: gestureY, time, threshold: Math.max(1, threshold), tapRadius: Math.max(1, tapRadius)};
    if (type === 'cancel') { this.release(id); this.menu = this.tap = this.armedTap = null; return true; }
    if (type === 'down') {
      if (!this.options.touchEnabled || this.state.mode === 'inactive') return false;
      this.release(id); // Duplicate DOWN recovery, including stale move residue.
      const finger = {...point, start: point};
      this.fingers.set(id, finger);
      if (!this.gameplay) {
        if (!this.menu) this.menu = {primary: id, start: point, current: point, ids: new Set([id]), max: 1};
        else { this.menu.ids.add(id); this.menu.max = Math.max(this.menu.max, this.menu.ids.size); }
        return true;
      }
      if (this.options.touchBombZoneEnabled && bombZone) { this.pending.add('KeyX'); return true; }
      if (this.state.mode === 'dialogue') {
        this.tap = this.armedTap = null;
        if (this.dialogueId === null) this.dialogueId = id;
        return true;
      }
      const p = {x: point.gx, y: point.gy};
      if (this.options.doubleTapBombEnabled) {
        if (this.armedTap && time - this.armedTap.time <= 320 && distance(p, this.armedTap) <= point.tapRadius) {
          this.pending.add('KeyX'); this.tap = this.armedTap = null; return true;
        }
        this.tap = {id, ...p, time, moved: false};
      }
      if (this.joystick) return true;
      if (this.fingers.size >= 4) { this.cancel(); this.pending.add('Escape'); return true; }
      if (this.moveId === null) this.moveId = id;
      else if (this.options.touchFocusMode === 'two-finger' && this.focusId === null) this.focusId = id;
      return true;
    }
    const finger = this.fingers.get(id);
    if (!finger) return false; // MOVE/UP cannot fabricate a new input owner.
    if (type === 'move' && this.options.touchEnabled) {
      if (this.menu?.primary === id) this.menu.current = point;
      if (this.tap?.id === id && distance({x: point.gx, y: point.gy}, this.tap) > point.threshold) this.tap.moved = true;
      if (this.state.mode === 'gameplay' && this.moveId === id && !this.joystick) {
        this.delta.x += (x - finger.x) * this.options.touchSensitivity / 100;
        this.delta.y += (y - finger.y) * this.options.touchSensitivity / 100;
      }
      Object.assign(finger, point);
      return true;
    }
    if (type !== 'up') return false;
    const stationary = Math.abs(point.gx - finger.start.gx) <= point.threshold && Math.abs(point.gy - finger.start.gy) <= point.threshold;
    if (this.dialogueId === id && this.state.mode === 'dialogue' && time - finger.start.time < 500 && stationary) this.pending.add('KeyZ');
    if (this.menu && this.menu.ids.has(id) && (this.menu.primary === id || this.menu.max >= 2)) {
      const current = this.menu.primary === id ? point : this.menu.current;
      if (Math.abs(current.gx - this.menu.start.gx) <= point.threshold && Math.abs(current.gy - this.menu.start.gy) <= point.threshold) {
        this.pending.add(this.menu.max >= 2 ? 'KeyX' : 'KeyZ');
      }
      this.menu = null;
    }
    if (this.tap?.id === id) {
      const p = {x: point.gx, y: point.gy};
      this.armedTap = this.state.mode === 'gameplay' && !this.tap.moved && time - this.tap.time <= 220 && distance(p, this.tap) <= point.threshold ? {...p, time} : null;
      this.tap = null;
    }
    this.release(id);
    return true;
  }
  sampleKeys() {
    if (!this.options.touchEnabled || this.state.mode === 'inactive') { this.pending.clear(); return new Set(); }
    const keys = new Set(this.pending); this.pending.clear();
    if (this.state.mode === 'menu' && this.menu) {
      const dx = this.menu.current.gx - this.menu.start.gx, dy = this.menu.current.gy - this.menu.start.gy;
      if (Math.abs(dx) > this.menu.start.threshold || Math.abs(dy) > this.menu.start.threshold) {
        keys.add(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'ArrowRight' : 'ArrowLeft') : (dy > 0 ? 'ArrowDown' : 'ArrowUp'));
      }
    }
    if (this.gameplay) {
      if (this.controls.fireEnabled && this.state.mode !== 'dialogue') keys.add('KeyZ');
      if (this.controls.focusEnabled || (this.options.touchFocusMode === 'two-finger' && this.focusId !== null)) keys.add('ShiftLeft');
      if (this.options.touchMovementMode === 'joystick') {
        if (this.controls.joystickX > 16383) keys.add('ArrowRight');
        if (this.controls.joystickX < -16383) keys.add('ArrowLeft');
        if (this.controls.joystickY > 16383) keys.add('ArrowDown');
        if (this.controls.joystickY < -16383) keys.add('ArrowUp');
      }
    }
    const dialogue = this.fingers.get(this.dialogueId);
    if (this.state.mode === 'dialogue' && this.state.skippable && dialogue && this.now() - dialogue.start.time >= 500) keys.add('ControlLeft');
    return keys;
  }
  movement({x, y, normalSpeed, focusSpeed, focused, minX, maxX, minY, maxY, factorX = 1, factorY = 1, quantum = 0}) {
    if (!this.options.touchEnabled || this.state.mode !== 'gameplay') return null;
    const maxSpeed = Math.max(0, focused ? focusSpeed : normalSpeed);
    if (this.options.touchMovementMode === 'joystick-free') {
      const ax = this.controls.joystickX / 32767, ay = this.controls.joystickY / 32767;
      if (!ax && !ay) return null;
      return {vx: ax * maxSpeed, vy: ay * maxSpeed};
    }
    if (this.joystick || this.moveId === null) return null;
    const unlimited = this.options.unlimitedTouch;
    const ratio = !unlimited && focused && normalSpeed > 0 ? focusSpeed / normalSpeed : 1;
    if (!(ratio > 0) || !(factorX > 0 && factorY > 0)) return {vx: 0, vy: 0};
    const requestX = clamp(x + this.delta.x * ratio, minX, maxX) - x;
    const requestY = clamp(y + this.delta.y * ratio, minY, maxY) - y;
    this.delta.x = requestX / ratio; this.delta.y = requestY / ratio;
    let vx = requestX / factorX, vy = requestY / factorY;
    const speed = Math.hypot(vx, vy);
    if (!unlimited && speed > maxSpeed && speed > 0) { vx *= maxSpeed / speed; vy *= maxSpeed / speed; }
    // Fixed-point games need integer velocities. Retain subpixel residue until
    // another real motion or update can consume it; never round above the cap.
    if (quantum > 0) { vx = Math.trunc((vx + Math.sign(vx) * 1e-9) / quantum) * quantum; vy = Math.trunc((vy + Math.sign(vy) * 1e-9) / quantum) * quantum; }
    const consumedX = quantum > 0 ? Math.trunc(vx * factorX / quantum + Math.sign(vx) * 1e-7) * quantum : vx * factorX;
    const consumedY = quantum > 0 ? Math.trunc(vy * factorY / quantum + Math.sign(vy) * 1e-7) * quantum : vy * factorY;
    this.delta.x = finite(this.delta.x - consumedX / ratio);
    this.delta.y = finite(this.delta.y - consumedY / ratio);
    if (Math.abs(this.delta.x) < 1e-7) this.delta.x = 0;
    if (Math.abs(this.delta.y) < 1e-7) this.delta.y = 0;
    return {vx, vy};
  }
}
