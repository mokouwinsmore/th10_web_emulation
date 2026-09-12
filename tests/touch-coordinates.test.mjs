import {test} from 'node:test';
import assert from 'node:assert/strict';
import {touchPoint} from '../runtime/touch-coordinates.mjs';

test('fullscreen black bars do not become gameplay coordinates', () => {
  const viewport = {width: 1000, height: 480}, rect = {left: 0, top: 0, ...viewport};
  assert.deepEqual(touchPoint(.5, .5, viewport, rect), {x: 320, y: 240, inside: true});
  assert.equal(touchPoint(.05, .5, viewport, rect).inside, false);
});
test('positioned and zoomed portrait canvas uses CSS coordinates without DPR', () => {
  const viewport = {width: 400, height: 800};
  const rect = {left: -100, top: 200, width: 800, height: 600};
  assert.deepEqual(touchPoint(.5, .5, viewport, rect), {x: 240, y: 160, inside: true});
  assert.equal(touchPoint(0, 0, viewport, {...rect, width: 0}), null);
});
