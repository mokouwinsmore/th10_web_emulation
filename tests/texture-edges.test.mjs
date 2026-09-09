import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {JitMachine} from '../runtime/jit-machine.mjs';import {Win32Host} from '../runtime/win32.mjs';import {installTextureEdges} from '../runtime/texture-edges.mjs';

test('transparent edge acceleration matches original JP and Chinese instructions byte for byte',async()=>{
  for(const exe of ['th10.exe','th10chs.exe']){
    const m=await JitMachine.create(readFileSync('../[th10] 东方风神录 (汉化版+日文版)/'+exe)),host=new Win32Host(m),object=host.alloc(0x124),data=host.alloc(1024*64*2),cases=[];let seed=57;
    const run=c=>{m.u32(object+0x100,c.format);m.u32(object+0x104,c.width);m.u32(object+0x108,c.height);m.u32(object+0x110,c.width*(c.format===26?2:4));m.u32(object+0x120,data);m.write(data,c.before);const result=m.call(0x436da0,{args:[object,c.rows],limit:100000000});assert.equal(m.reg('ESP'),m.stack);return {result,pixels:m.bytes(data,c.before.length)};};
    try{
      for(const [width,height,rows,format] of [[1,1,1,26],[1,9,7,26],[9,1,1,26],[13,17,17,26],[41,19,11,26],[1024,64,36,26],[31,23,21,21],[8,8,0,26]]){
        const before=new Uint8Array(width*height*(format===26?2:4));for(let i=0;i<before.length;i++){seed=(Math.imul(seed,1664525)+1013904223)>>>0;before[i]=seed>>>24;if(i%2===1&&i%5<3)before[i]&=15;}const c={width,height,rows,format,before};cases.push({...c,expected:run(c)});
      }
      installTextureEdges(host);
      for(const c of cases){const actual=run(c);assert.equal(actual.result,c.expected.result);assert.ok(Buffer.from(actual.pixels).equals(Buffer.from(c.expected.pixels)),`${exe} ${c.width}x${c.height}/${c.rows}/${c.format}`);}
      assert.ok(host.calls.get('TH10.TextureEdges')>0,'The accelerated entry must actually run');
    }finally{m.close();}
  }
});
