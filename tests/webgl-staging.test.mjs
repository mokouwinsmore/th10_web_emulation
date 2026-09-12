import test from 'node:test';
import assert from 'node:assert/strict';
import {WebGLD3D9} from '../runtime/webgl.mjs';

const matrix=x=>new Uint8Array(new Float32Array([1,0,0,0,0,1,0,0,0,0,1,0,x,0,0,1]).buffer);
function packet(primitive,count,seed=0,extra={}){
  const stride=28,vertices=new Uint8Array((primitive===4?count*3:count+2)*stride);
  for(let i=0;i<vertices.length;i++)vertices[i]=(seed*17+i*31)&255;
  return {primitive,count,stride,vertices,indices:null,fvf:0x144,texture:1,target:2,depthTarget:3,
    viewport:Uint8Array.of(0,0,64,64),scissor:Uint8Array.of(0,0,64,64),
    states:new Map([[7,1],[14,1],[23,4]]),stages:new Map([[1,4]]),transforms:new Map(),...extra};
}
function recorder(reuseStaging){
  const r=Object.create(WebGLD3D9.prototype),draws=[];
  Object.assign(r,{reuseStaging,batchEnabled:true,stats:{calls:0,batches:0}});
  r.draw=d=>{draws.push({primitive:d.primitive,count:d.count,stride:d.stride,fvf:d.fvf,texture:d.texture,
    indices:d.indices?Array.from(d.indices):null,vertices:Array.from(d.vertices),
    matrices:d.instanceWorlds?Array.from(d.instanceWorlds):null,scissor:Array.from(d.scissor??[])});};
  return {r,draws};
}
function compare(sequence){
  const a=recorder(false),b=recorder(true);
  for(const item of sequence){if(item==='flush'){a.r.flush();b.r.flush();}else{a.r.queue(item);b.r.queue(item);}}
  a.r.flush();b.r.flush();assert.deepEqual(b.draws,a.draws);return b;
}
test('upstream staging preserves triangle, fan and alternating strip bytes and order',()=>{
  let random=12345;const next=()=>{random=(Math.imul(random,1664525)+1013904223)>>>0;return random;};
  const seq=[];for(let i=0;i<180;i++){seq.push(packet(4+next()%3,next()%12,next(),{texture:next()%3}));if(i%7===0)seq.push('flush');}
  compare(seq);
});
test('staging grows without losing earlier geometry and is reused after synchronous upload',()=>{
  const {r,draws}=compare([packet(4,1500,1),packet(5,2000,2),'flush',packet(6,2000,3),'flush']);
  const allocation=r.batchBytes,first=draws[0].vertices.slice();
  r.queue(packet(5,2,4));r.flush();assert.strictEqual(r.batchBytes,allocation);assert.deepEqual(draws[0].vertices,first);
});
test('one-megabyte flush, indexed barriers and scissor changes retain boundaries',()=>{
  const seq=Array.from({length:45},(_,i)=>packet(4,1000,i));
  seq.push(packet(4,2,1,{indices:Uint8Array.of(0,1,2,3,4,5),indexFormat:101}));
  seq.push(packet(5,2,2,{scissor:Uint8Array.of(4,4,50,50)}));seq.push(packet(6,2,3));compare(seq);
});
test('instanced world buffer retains matrix/factor bytes across flushes and 2D transitions',()=>{
  const base=packet(5,2,0,{fvf:0x102,stride:20,vertices:new Uint8Array(80)}),seq=[];
  for(let i=0;i<1030;i++)seq.push({...base,states:new Map([[60,(0xff000000+i)>>>0]]),transforms:new Map([[256,matrix(i/10)]])});
  seq.push('flush',packet(4,2,3),'flush');compare(seq);
});
test('invalidated context still fails Present and the explicit GL error check is retained',()=>{
  let errors=0,flushes=0;const r=Object.create(WebGLD3D9.prototype);
  r.gl={bindFramebuffer(){},disable(){},blitFramebuffer(){},flush(){flushes++;},getError(){errors++;return 0;},isContextLost(){return false;}};
  r.canvas={width:64,height:64};r.surface=()=>({framebuffer:1});const device={back:{width:64,height:64}};
  r.present(device);assert.equal(errors,0);assert.equal(flushes,1);
  r.debugErrors=true;r.present(device);assert.equal(errors,1);assert.equal(flushes,2);
  r.gl.getError=()=>1282;assert.throws(()=>r.checkError(),/1282/);
  r.contextLost=true;assert.throws(()=>r.present(device),/context lost/);
});
