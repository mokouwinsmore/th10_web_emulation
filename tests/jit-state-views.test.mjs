import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {JitMachine} from '../runtime/jit-machine.mjs';
import {NativeMachine} from '../runtime/machine.mjs';
const word = n => [...new Uint8Array(new Uint32Array([n]).buffer)];

for (const directViews of [false, true]) {
  test(`real v86 ${directViews ? 'cached' : 'reference'} views survive context restore and growth inside imports`, async () => {
    const m = await JitMachine.create(readFileSync('../../th10_web/dist/data/th10.exe'), {directViews});
    try {
      const data = m.allocate(32), code = m.allocate(64);
      m.reg('EAX', 0xf1234567); m.reg('EBP', 0x12345678); m.reg('FPCW', 0x27f);
      m.u32(data, 41);
      const saved = m.cpu.context_alloc(); m.cpu.context_save(saved);
      m.wasmMemory.grow(1);
      m.core.reg32[0] = 99; assert.equal(m.reg('EAX'), 99);
      m.reg('EBP', 123); m.reg('FPCW', 0x37f);
      m.cpu.context_restore(saved);
      assert.equal(m.reg('EAX'), 0xf1234567); assert.equal(m.reg('EBP'), 0x12345678); assert.equal(m.reg('FPCW'), 0x27f);
      m.write(code, [0xa1, ...word(data), 0x83, 0xc0, 1, 0xc3]);
      for (let i = 0; i < 40; i++) assert.equal(m.call(code), 42);
      m.wasmMemory.grow(0); m.u32(data, 99); assert.equal(m.call(code), 100);
      let calls = 0;
      const entry = {dll: 'fixture', name: 'grow-during-import'}, stub = m.registerImport(entry);
      m.onImport = received => {
        assert.equal(received, entry); calls++;
        m.wasmMemory.grow(0); m.u32(data, 7); m.ret(5, 0);
      };
      m.write(code, [0xe8, ...word(stub - code - 5), 0x03, 0x05, ...word(data), 0xc3]);
      for (let i = 0; i < 5; i++) assert.equal(m.call(code), 12);
      assert.equal(calls, 5); m.cpu.context_free(saved);

      // Differentially compare every saved CPU field, not just the return value.
      const before=m.cpu.context_alloc(),expected=m.cpu.context_alloc(),actual=m.cpu.context_alloc();
      for(const sp of [0x10000,data,data+1,m.memorySize-4,0xfffc,0xffff,m.memorySize,m.memorySize-3]){
        if(sp>=0x10000&&sp+4<=m.memorySize)m.u32(sp,0xf1234567);
        m.reg('ESP',sp);m.reg('EAX',0x12345678);m.reg('EFLAGS',0x8d7);m.reg('FPCW',0x37f);
        m.cpu.context_save(before);
        let referenceError,fastError;
        try{NativeMachine.prototype.ret.call(m,0xfedcba98,2);}catch(error){referenceError=error.message;}
        m.cpu.context_save(expected);m.cpu.context_restore(before);
        try{m.ret(0xfedcba98,2);}catch(error){fastError=error.message;}
        m.cpu.context_save(actual);
        assert.equal(fastError,referenceError,`return bounds ${sp.toString(16)}`);
        assert.deepEqual(actual,expected,`complete return state ${sp.toString(16)}`);
      }
      // stdcall cleanup wraps as a 32-bit ESP; nonnumeric coercion stays generic.
      for(const [value,args] of [[0x100000001,0x40000000],[undefined,undefined],[{valueOf:()=>17},2]]){
        m.reg('ESP',data);m.u32(data,0x401234);m.cpu.context_save(before);
        NativeMachine.prototype.ret.call(m,value,args);m.cpu.context_save(expected);m.cpu.context_restore(before);
        m.ret(value,args);m.cpu.context_save(actual);assert.deepEqual(actual,expected);
      }
    } finally { m.close(); }
  });
}
