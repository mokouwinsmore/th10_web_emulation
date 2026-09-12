import test from 'node:test';
import assert from 'node:assert/strict';
import {UniformCache} from '../runtime/webgl-uniform-cache.mjs';
function fixture() {
  const calls=[],gl=new Proxy({}, {get:(_t,method)=>(location,...args)=>calls.push({method,location,args})});
  return {calls, cache:new UniformCache(gl,new Map([['scalar',{}],['matrix',{}],['vector',{}]])), gl};
}
test('unchanged uniforms skip GL submissions; signed zero and changed values are retained',()=>{
  const {cache,calls}=fixture();
  assert.equal(cache.set('scalar','uniform1f',[0]),true);
  assert.equal(cache.set('scalar','uniform1f',[0]),false);
  assert.equal(cache.set('scalar','uniform1f',[-0]),true);
  assert.equal(cache.set('scalar','uniform1f',[1]),true);
  assert.equal(cache.set('missing','uniform1f',[1]),false);
  assert.equal(calls.length,3);
});
test('mutable input vectors and matrices are snapshotted, not retained by reference',()=>{
  const {cache,calls}=fixture(),values=new Float32Array([1,2,3,4]);
  cache.set('vector','uniform4fv',[values]); values[0]=8;
  assert.equal(cache.set('vector','uniform4fv',[values]),true);
  assert.equal(cache.set('vector','uniform4fv',[[8,2,3,4]]),false);
  const matrix=new Float32Array(16); matrix[0]=1;
  cache.set('matrix','uniformMatrix4fv',[false,matrix]);matrix[5]=1;
  assert.equal(cache.set('matrix','uniformMatrix4fv',[false,matrix]),true);
  assert.equal(cache.set('matrix','uniformMatrix4fv',[false,matrix.slice()]),false);
  assert.equal(calls.length,4);
});
test('uniform caches are independent per linked shader program',()=>{
  const {gl,calls,cache}=fixture(),other=new UniformCache(gl,new Map([['scalar',{}]]));
  cache.set('scalar','uniform1i',[1]);other.set('scalar','uniform1i',[1]);
  assert.equal(cache.set('scalar','uniform1i',[1]),false);
  assert.equal(other.set('scalar','uniform1i',[1]),false);assert.equal(calls.length,2);
});
