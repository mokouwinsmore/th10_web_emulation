import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {JitMachine} from '../runtime/jit-machine.mjs';
import {installInstructionHooks} from '../runtime/instruction-hooks.mjs';
const word = n => [...new Uint8Array(new Uint32Array([n]).buffer)];
test('real x86 inline MOV substitution preserves flags, stack, x87 and warmed code', async () => {
  const machine = await JitMachine.create(readFileSync('../../th10_web/dist/data/th10.exe'));
  try {
    machine.onImport = entry => { throw new Error(`Unexpected API ${entry.name}`); };
    const player = machine.allocate(2048), code = machine.allocate(128), out = code + 100;
    machine.u32(player + 0x454, 0x12345678); machine.reg('EDI', player); machine.reg('EBX', 19);
    const prefix = [0x53, 0xbb, ...word(7), 0xd9, 0xe8, 0x39, 0xdb];
    const expected = [0x8b, 0x87, 0x54, 4, 0, 0], site = code + prefix.length;
    machine.write(code, [...prefix, ...expected, 0x9c, 0x5a, 0x89, 0x15, ...word(out), 0xd9, 0x1d, ...word(out + 4), 0x89, 0x25, ...word(out + 8), 0x5b, 0xc3]);
    for (let n = 0; n < 40; n++) assert.equal(machine.call(code), 0x12345678);
    const baseline = machine.bytes(out, 12); let hits = 0;
    const hooks = installInstructionHooks(machine, [{name: 'fixture.mov', address: site, expected, resume(m) { hits++; m.reg('EAX', m.u32(m.reg('EDI') + 0x454)); return site + 6; }}]);
    for (let n = 0; n < 40; n++) {
      assert.equal(machine.call(code), 0x12345678); assert.deepEqual(machine.bytes(out, 12), baseline);
      assert.equal(machine.reg('EBX'), 19); assert.equal(machine.f32(out + 4), 1);
    }
    assert.equal(hits, 40); hooks.close(); hooks.close(); assert.equal(machine.call(code), 0x12345678); assert.equal(hits, 40);
    const before = machine.bytes(site, 6);
    assert.throws(() => installInstructionHooks(machine, [{name: 'good', address: site, expected, resume: () => site + 6},
      {name: 'wrong', address: site + 20, expected, resume: () => site + 26}]), /mismatch/);
    assert.deepEqual(machine.bytes(site, 6), before, 'all sites must validate before any mutation');
  } finally { machine.close(); }
});
