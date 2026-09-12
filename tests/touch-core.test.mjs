import test from 'node:test';
import assert from 'node:assert/strict';
import {TouchCore} from '../runtime/touch-core.mjs';
import {InputSources} from '../runtime/input-sources.mjs';
const position = {x: 0, y: 200, normalSpeed: 4, focusSpeed: 2, focused: false, minX: -184, maxX: 184, minY: 32, maxY: 432};
function fixture(options = {}) {
  let time = 0;
  const core = new TouchCore({now: () => time, options: {touchEnabled: true, ...options}});
  core.setState({mode: 'gameplay', owner: 1});
  return {core, advance(ms) { time += ms; }, point(type, id, x, y) { return core.pointer(type, {id, x, y}); }};
}
test('limited drag retains only unconsumed movement and release stops it', () => {
  const {core, point} = fixture(); point('down', 1, 200, 200); point('move', 1, 220, 200);
  assert.deepEqual(core.movement(position), {vx: 4, vy: 0}); assert.equal(core.delta.x, 16);
  assert.deepEqual(core.movement({...position, x: 4}), {vx: 4, vy: 0}); assert.equal(core.delta.x, 12);
  point('up', 1, 220, 200); assert.equal(core.movement(position), null); assert.equal(core.delta.x, 0);
});
test('active zero drag still owns movement rather than leaking physical directions', () => {
  const {core, point} = fixture(); point('down', 1, 10, 10); assert.deepEqual(core.movement(position), {vx: 0, vy: 0});
});
test('focus ratio, sensitivity and unlimited drag match Player source semantics', () => {
  const {core, point} = fixture({touchSensitivity: 200}); point('down', 1, 100, 100); point('move', 1, 110, 100);
  assert.deepEqual(core.movement({...position, focused: true}), {vx: 2, vy: 0}); assert.equal(core.delta.x, 16);
  core.configure({unlimitedTouch: true}); point('down', 2, 100, 100); point('move', 2, 110, 100);
  assert.deepEqual(core.movement({...position, focused: true}), {vx: 20, vy: 0}); assert.equal(core.delta.x, 0);
});
test('diagonal speed cap is radial, and clipped boundary does not build a backlog', () => {
  const {core, point} = fixture(); point('down', 1, 0, 0); point('move', 1, 100, 100);
  const result = core.movement(position); assert.ok(Math.abs(Math.hypot(result.vx, result.vy) - 4) < 1e-8);
  core.delta = {x: 100, y: 0}; assert.deepEqual(core.movement({...position, x: 184}), {vx: 0, vy: 0}); assert.equal(core.delta.x, 0);
  point('move', 1, 99, 100); assert.deepEqual(core.movement({...position, x: 184}), {vx: -1, vy: 0});
});
test('fixed point movement retains fractions without increasing speed beyond cap', () => {
  const {core, point} = fixture(); point('down', 1, 0, 0); point('move', 1, 10, 10);
  const result = core.movement({...position, quantum: 0.01});
  assert.equal(result.vx, 2.82); assert.equal(result.vy, 2.82); assert.ok(Math.hypot(result.vx, result.vy) <= 4);
  core.delta = {x: 0.005, y: 0}; assert.equal(core.movement({...position, quantum: 0.01}).vx, 0); assert.equal(core.delta.x, 0.005);
});
test('two-finger focus and move keep distinct identities, duplicate down resets stale movement', () => {
  const {core, point} = fixture({touchFocusMode: 'two-finger'});
  point('down', 1, 10, 10); point('down', 2, 20, 20); assert.ok(core.sampleKeys().has('ShiftLeft'));
  point('move', 2, 50, 50); assert.equal(core.delta.x, 0);
  point('up', 2, 50, 50); assert.ok(!core.sampleKeys().has('ShiftLeft')); assert.equal(core.moveId, 1);
  point('move', 1, 20, 10); point('down', 1, 200, 100); assert.deepEqual(core.delta, {x: 0, y: 0});
  point('cancel', 1, 200, 100); assert.equal(core.moveId, null);
});
test('four-finger pause is one pulse and releases all gameplay touch owners', () => {
  const {core, point} = fixture({touchFocusMode: 'two-finger'});
  for (let id = 1; id <= 4; id++) point('down', id, 100 + id, 100);
  assert.ok(core.sampleKeys().has('Escape')); assert.ok(!core.sampleKeys().has('Escape'));
  assert.equal(core.fingers.size, 0); assert.equal(core.moveId, null);
});
test('menu tap, multi-finger return and held swipe do not leave a stale primary', () => {
  const {core, point} = fixture(); core.setState({mode: 'menu', owner: 1});
  point('down', 1, 100, 100); point('up', 1, 100, 100); assert.ok(core.sampleKeys().has('KeyZ')); assert.equal(core.sampleKeys().size, 0);
  point('down', 2, 100, 100); point('down', 3, 100, 100); point('up', 3, 100, 100);
  assert.ok(core.sampleKeys().has('KeyX')); assert.equal(core.menu, null); point('up', 2, 100, 100); assert.equal(core.sampleKeys().size, 0);
  point('down', 4, 100, 100); point('move', 4, 100, 200); assert.ok(core.sampleKeys().has('ArrowDown')); assert.ok(core.sampleKeys().has('ArrowDown'));
  point('up', 4, 100, 200); assert.equal(core.sampleKeys().size, 0);
});
test('dialogue suppresses auto-fire, supports short advance and long hold skip', () => {
  const {core, point, advance} = fixture(); core.setState({mode: 'dialogue', owner: 1, skippable: true});
  assert.equal(core.sampleKeys().size, 0);
  point('down', 1, 100, 100); advance(100); point('up', 1, 100, 100); assert.ok(core.sampleKeys().has('KeyZ')); assert.equal(core.sampleKeys().size, 0);
  point('down', 2, 100, 100); advance(500); assert.ok(core.sampleKeys().has('ControlLeft'));
  core.setState({mode: 'gameplay', owner: 1}); assert.equal(core.moveId, 2);
  point('move', 2, 110, 100); assert.equal(core.delta.x, 10); assert.ok(!core.sampleKeys().has('ControlLeft'));
});
test('double tap can be performed by a secondary finger without stealing movement', () => {
  const {core, point, advance} = fixture({doubleTapBombEnabled: true}); point('down', 1, 0, 0); point('move', 1, 100, 100);
  point('down', 2, 200, 200); advance(100); point('up', 2, 200, 200); advance(100); point('down', 3, 200, 200);
  assert.ok(core.sampleKeys().has('KeyX')); assert.equal(core.moveId, 1); assert.ok(!core.sampleKeys().has('KeyX'));
});
test('serial actions are consumed once and cancel never releases a keyboard owner', () => {
  const {core} = fixture(); const sources = new InputSources(); sources.set('keyboard', 'ShiftLeft', true);
  core.updateControls({focusEnabled: true, bombSerial: 1, escapeSerial: 1}); const first = core.sampleKeys();
  assert.ok(first.has('KeyX') && first.has('Escape') && first.has('ShiftLeft'));
  sources.replace('touch', first); core.updateControls({bombSerial: 1, escapeSerial: 1});
  assert.ok(!core.sampleKeys().has('KeyX')); core.cancel({controls: true}); sources.clear('touch');
  assert.ok(sources.keys.has('ShiftLeft')); assert.equal(core.controls.focusEnabled, false);
});
test('ordinary joystick uses native direction thresholds; free joystick gives analog velocity', () => {
  const {core} = fixture({touchMovementMode: 'joystick'});
  core.updateControls({joystickX: 16383, joystickY: 32767}); assert.ok(!core.sampleKeys().has('ArrowRight')); assert.ok(core.sampleKeys().has('ArrowDown'));
  assert.equal(core.movement(position), null);
  core.configure({touchMovementMode: 'joystick-free'}); core.updateControls({joystickX: 32767, joystickY: 0});
  assert.deepEqual(core.movement(position), {vx: 4, vy: 0}); assert.deepEqual(core.movement({...position, focused: true}), {vx: 2, vy: 0});
});
test('pause, game owner changes, and disabling touch clear residual movement', () => {
  const {core, point} = fixture(); point('down', 1, 10, 10); point('move', 1, 90, 10);
  core.setState({mode: 'menu', owner: 1}); assert.equal(core.delta.x, 0); assert.equal(core.movement(position), null);
  core.setState({mode: 'gameplay', owner: 2}); assert.equal(core.moveId, null);
  point('down', 2, 10, 10); core.configure({touchEnabled: false}); assert.equal(core.fingers.size, 0); assert.equal(core.sampleKeys().size, 0);
});
test('unknown pointer ids and non-finite coordinates cannot create movement', () => {
  const {core, point} = fixture(); assert.equal(point('move', 7, 30, 50), false); assert.equal(point('down', 7, NaN, 50), false); assert.equal(core.fingers.size, 0);
});
