import {test} from 'node:test';
import assert from 'node:assert/strict';
import {InputSources} from '../runtime/input-sources.mjs';

test('keyboard holds survive touch and pulse release in either order', () => {
  const edges = [], input = new InputSources((...edge) => edges.push(edge));
  input.set('keyboard', 'KeyZ', true);
  input.set('touch', 'KeyZ', true);
  input.set('pulse', 'KeyZ', true);
  input.clear('touch'); input.clear('pulse');
  assert.deepEqual([...input.keys], ['KeyZ']);
  assert.deepEqual(edges, [['KeyZ', true]]);
  input.clear('keyboard');
  assert.deepEqual(edges, [['KeyZ', true], ['KeyZ', false]]);
});

test('cancel clears all producers exactly once and accepts subsequent input', () => {
  const edges = [], input = new InputSources((...edge) => edges.push(edge));
  input.replace('touch', ['ShiftLeft', 'KeyZ']);
  input.set('keyboard', 'ShiftLeft', true);
  input.clear(); input.clear();
  assert.equal(input.keys.size, 0);
  assert.deepEqual(edges, [['ShiftLeft', true], ['KeyZ', true], ['ShiftLeft', false], ['KeyZ', false]]);
  input.set('keyboard', 'KeyZ', true);
  assert.deepEqual([...input.keys], ['KeyZ']);
});
