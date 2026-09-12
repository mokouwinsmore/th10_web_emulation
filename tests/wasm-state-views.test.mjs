import test from 'node:test';
import assert from 'node:assert/strict';
import {WasmStateViews} from '../runtime/wasm-state-views.mjs';

function facade(memory, Constructor, offset, length) {
  return new Proxy({}, {
    get(_target, key) { const view = new Constructor(memory.buffer, offset, length); const value = view[key]; return typeof value === 'function' ? value.bind(view) : value; },
    set(_target, key, value) { new Constructor(memory.buffer, offset, length)[key] = value; return true; },
  });
}

test('state views preserve WASM offsets, signedness and aliasing without copying', () => {
  const memory = new WebAssembly.Memory({initial: 2});
  const source = {registers: facade(memory, Int32Array, 64, 8), segment: facade(memory, Uint16Array, 256, 6), ram: facade(memory, Int32Array, 65536, 4096)};
  const cache = new WasmStateViews(memory, source, Object.keys(source));
  const first = cache.current(); assert.strictEqual(cache.current(), first);
  first.registers[0] = -1; assert.equal(source.registers[0], -1);
  source.ram[100] = 0x12345678; assert.equal(first.ram[100], 0x12345678);
  first.segment[1] = 0xffff; assert.equal(source.segment[1], 0xffff);
  assert.equal(first.ram.byteOffset, 65536); assert.equal(first.ram.length, 4096);
});

test('memory growth including grow(0) refreshes every cached view and preserves state', () => {
  const memory = new WebAssembly.Memory({initial: 2, maximum: 4});
  const source = {registers: facade(memory, Int32Array, 64, 8), ram: facade(memory, Int32Array, 65536, 4096)};
  const cache = new WasmStateViews(memory, source, Object.keys(source));
  let previous = cache.current(); previous.registers[2] = 123; previous.ram[22] = 987;
  for (const delta of [0, 1, 1]) {
    memory.grow(delta); const current = cache.current();
    assert.notStrictEqual(current, previous); assert.equal(previous.registers.length, 0);
    assert.equal(current.registers[2], 123); assert.equal(current.ram[22], 987);
    current.registers[3] = -789; assert.equal(source.registers[3], -789);
    previous = current;
  }
});

test('shared memory growth, when available, does not leave old-length cached views', () => {
  const memory = new WebAssembly.Memory({initial: 1, maximum: 2, shared: true});
  const source = {registers: facade(memory, Int32Array, 64, 8)};
  const cache = new WasmStateViews(memory, source, ['registers']);
  const before = cache.current(); before.registers[4] = 456;
  memory.grow(1); const after = cache.current();
  assert.notStrictEqual(after, before); assert.equal(after.registers[4], 456);
  assert.strictEqual(after.registers.buffer, memory.buffer);
});
