import assert from 'node:assert/strict';
import {mkdirSync, writeFileSync} from 'node:fs';
import {createTouchSession} from './native/touch-session.mjs';
import {installTh10Touch} from '../runtime/th10-touch.mjs';
const report = {date: new Date().toISOString(), backend: 'v86, Windows GDI diagnostic rendering', checks: []};
let session;
try {
  session = await createTouchSession({attach: (host, digest) => installTh10Touch(host, {digest,
    options: {touchEnabled: true, touchFocusMode: 'two-finger'}, now: () => host.millis})});
  const a = session.adapter;
  const point = (type, id, x, y) => a.pointer(type, {id, x, y});
  const check = (name, detail = a.status()) => { report.checks.push({name, ...detail}); console.log('PASS', name, JSON.stringify(detail)); };
  session.frames(450);
  for (let i = 0; i < 5; i++) { point('down', i + 1, 320, 240); point('up', i + 1, 320, 240); session.frames(75); }
  session.frames(150);
  assert.equal(a.status().mode, 'gameplay'); assert.equal(session.state().stage, 1); assert.equal(session.state().playerState, 1);
  check('five real menu touch taps enter Stage 1');
  const start = a.status().position;
  point('down', 20, 200, 200); point('move', 20, 240, 200); session.frames(1);
  let state = a.status(); assert.equal(state.position.fixedX - start.fixedX, 450); assert.equal(state.position.fixedY, start.fixedY);
  check('limited drag consumes exactly the native 4.5-unit speed');
  point('up', 20, 240, 200); const stopped = state.position.fixedX; session.frames(3); assert.equal(a.status().position.fixedX, stopped);
  check('release clears the remaining target immediately');
  point('down', 21, 200, 200); point('down', 22, 500, 200); point('move', 21, 240, 200); session.frames(2);
  state = a.status(); assert.equal(state.focus, true); assert.equal(state.position.fixedX - stopped, 400);
  check('two-finger focus reaches native focus branch and 2-unit speed');
  point('up', 22, 500, 200); point('up', 21, 240, 200); session.frames(2);
  a.configure({unlimitedTouch: true}); const beforeUnlimited = a.status().position;
  point('down', 23, 200, 200); point('move', 23, 280, 140); session.frames(1); state = a.status();
  assert.equal(state.position.fixedX - beforeUnlimited.fixedX, 8000); assert.equal(state.position.fixedY - beforeUnlimited.fixedY, -6000);
  assert.ok(Math.abs(state.position.x * 100 - state.position.fixedX) < 0.01); check('unlimited drag updates authoritative integers and native derived floats');
  point('move', 23, 1000, 140); session.frames(1); assert.equal(a.status().position.fixedX, 18400);
  point('move', 23, 999, 140); session.frames(1); assert.equal(a.status().position.fixedX, 18300); check('boundary clipping has no sticky residual');
  point('up', 23, 999, 140);
  a.configure({touchMovementMode: 'joystick-free'}); const beforeStick = a.status().position;
  a.controls({joystickX: -32767, joystickY: 0}); session.frames(2); assert.equal(a.status().position.fixedX - beforeStick.fixedX, -900);
  a.controls({joystickX: 0, joystickY: 0}); check('free joystick uses continuous native velocity');
  a.configure({touchMovementMode: 'joystick'}); const beforeDigital = a.status().position;
  a.controls({joystickX: 0, joystickY: -32767}); session.frames(2); assert.equal(a.status().position.fixedY - beforeDigital.fixedY, -900);
  a.controls({joystickX: 0, joystickY: 0}); check('ordinary joystick uses original direction keys');
  a.configure({touchMovementMode: 'touch', unlimitedTouch: false});
  a.controls({escapeSerial: 1}); session.frames(40); assert.equal(a.status().mode, 'menu'); check('touch pause switches to the real pause menu');
  const pausedPosition = a.status().position, pausedCalls = a.statistics.movementCalls;
  point('down', 30, 200, 200); point('move', 30, 230, 200); session.frames(2); point('cancel', 30, 230, 200);
  assert.deepEqual(a.status().position, pausedPosition); assert.equal(a.statistics.movementCalls, pausedCalls);
  a.controls({escapeSerial: 2}); session.frames(40); assert.equal(a.status().mode, 'gameplay'); check('pause gestures cannot move the player; touch resume works');
  a.configure({touchFocusMode: 'hold-button'}); session.host.input.keys.add('ShiftLeft'); a.controls({focusEnabled: true}); session.frames(1);
  a.cancel(); session.frames(1); assert.equal(a.status().focus, true); session.host.input.keys.delete('ShiftLeft'); session.frames(1); assert.equal(a.status().focus, false);
  check('touch cancellation never releases a held physical keyboard key');
  // Explicit test prerequisite, NOT a production gameplay modification: a new
  // TH10 run starts with insufficient power for a bomb. Give the fixture 2.00
  // power, then let the real game decide eligibility and consume it normally.
  session.m.i32(0x474c48, 40);
  const power = session.m.i32(0x474c48); a.controls({bombSerial: 1}); session.frames(5);
  assert.equal(session.m.i32(0x474c48), power - 20);
  check('eligible touch bomb serial reaches native bomb action', {fixturePower: power, powerAfter: session.m.i32(0x474c48)});
  report.ok = true;
} catch (error) { report.ok = false; report.error = String(error.stack ?? error); report.state = session?.adapter.status(); process.exitCode = 1; console.error(report.error); }
finally {
  session?.close(); mkdirSync('artifacts/validation/touch-audit', {recursive: true});
  writeFileSync('artifacts/validation/touch-audit/native-touch.json', JSON.stringify(report, null, 2));
}
