import test from 'node:test';
import assert from 'node:assert/strict';
import {FramePerformance} from '../runtime/frame-performance.mjs';

test('optional metrics report real completed frames, not requested 60Hz, and reset windows', () => {
  const metrics = new FramePerformance({time: 100, frame: 50, calls: 1000, batches: 100});
  metrics.addWork(800); metrics.addWork(NaN); metrics.addWork(-4);
  assert.equal(metrics.sample({time: 900, frame: 54, calls: 1100, batches: 120}), null);
  assert.deepEqual(metrics.sample({time: 1100, frame: 55, calls: 1125, batches: 125}),
    {frames: 5, elapsedMs: 1000, fps: 5, workMs: 160, submitMs: 0, drawCalls: 25, batches: 5});
  metrics.addWork(200);
  assert.deepEqual(metrics.sample({time: 2100, frame: 65, calls: 1325, batches: 175}),
    {frames: 10, elapsedMs: 1000, fps: 10, workMs: 20, submitMs: 0, drawCalls: 20, batches: 5});
});

test('GL submit time uses counter deltas on the same completed-frame window', () => {
  const metrics=new FramePerformance({time:0,frame:0,submitMs:400});metrics.addWork(850);
  const sample=metrics.sample({time:1000,frame:20,calls:640,batches:540,submitMs:480});
  assert.equal(sample.workMs,42.5);assert.equal(sample.submitMs,4);assert.equal(sample.fps,20);
  metrics.addWork(600);
  assert.equal(metrics.sample({time:2000,frame:40,calls:1280,batches:1080,submitMs:600}).submitMs,6);
});
