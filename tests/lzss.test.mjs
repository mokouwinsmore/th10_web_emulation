import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {NativeMachine} from '../runtime/machine.mjs';import {decodeLzss} from '../runtime/lzss.mjs';
test('accelerated decoder matches unmodified TH10 x86 for overlap, dictionary wrap and retained history',async()=>{
  const m=await NativeMachine.create(readFileSync('../[th10] 东方风神录 (汉化版+日文版)/th10.exe'),{wasmBinary:readFileSync('reference/native/unicorn-bounded.wasm')});
  try{for(const count of [0,1,12,64,9000]){const packed=[];let cur=0,used=0,size=0;const bits=(v,n)=>{for(let i=n-1;i>=0;i--){cur=cur*2+((v>>>i)&1);if(++used===8){packed.push(cur);cur=0;used=0;}}};
    for(let i=0;i<count;i++){if(i%5===4){bits(0,1);bits(i%8191+1,13);bits(i%16,4);size+=i%16+3;}else{bits(1,1);bits((i*71+19)&255,8);size++;}}bits(0,1);bits(0,13);if(used)packed.push(cur<<(8-used));
    const input=Uint8Array.from(packed),initial=Uint8Array.from({length:8192},(_,i)=>i*13&255),dict=initial.slice(),output=new Uint8Array(size),inp=m.allocate(input.length),out=m.allocate(Math.max(1,size));m.write(inp,input);m.write(0x48f868,initial);decodeLzss(input,output,dict);
    assert.equal(m.call(0x435dc0,{args:[inp,input.length,out,size],limit:20_000_000}),out);assert.deepEqual(m.bytes(out,size),output);assert.deepEqual(m.bytes(0x48f868,8192),dict);
  }}finally{m.close();}
});
