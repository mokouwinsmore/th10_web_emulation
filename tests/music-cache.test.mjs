import test from 'node:test';
import assert from 'node:assert/strict';

import {PagedMusic} from '../runtime/assets.mjs';
import {musicTracks} from '../runtime/music-layout.mjs';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const bytes=Uint8Array.from({length:160},(_,i)=>i);
function cache(options={}){return new PagedMusic({size:bytes.length,blockSize:16,chunked:true},{capacity:8,fetcher:async url=>{const i=+url.match(/(\d+)\.bin/)[1];return new Response(bytes.slice(i*16,(i+1)*16));},...options});}
async function read(file,start,end){for(let attempt=0;attempt<2;attempt++){const result=file.subarray(start,end);if(result)return result;await file.pending;}throw new Error('Read stayed blocked');}
test('music read-ahead is ready before ReadFile crosses the next block, without duplicate requests',async()=>{
  const requests=[];let release;const gate=new Promise(resolve=>{release=resolve;});
  const file=cache({ahead:3,fetcher:async url=>{const i=+url.match(/(\d+)\.bin/)[1];requests.push(i);if(i===1)await gate;return new Response(bytes.slice(i*16,(i+1)*16));}});
  assert.deepEqual(await read(file,0,12),bytes.slice(0,12));await tick();assert.equal(file.subarray(16,30),null);release();await file.pending;await tick();
  assert.deepEqual(file.subarray(16,30),bytes.slice(16,30));assert.equal(requests.filter(i=>i===1).length,1);
  assert.deepEqual(file.subarray(32,46),bytes.slice(32,46));
});
test('speculative failures do not fail current audio; needed data is retried and validated',async()=>{
  let attempts=0;const file=cache({ahead:2,fetcher:async url=>{const i=+url.match(/(\d+)\.bin/)[1];if(i===1&&++attempts===1)throw new Error('temporary future read failure');return new Response(bytes.slice(i*16,(i+1)*16));}});
  assert.deepEqual(await read(file,0,8),bytes.slice(0,8));await tick();assert.deepEqual(await read(file,16,32),bytes.slice(16,32));assert.equal(attempts,2);
});
test('track and loop entries stay cached while the moving window is evicted',async()=>{
  const file=cache({capacity:2,ahead:0});await file.prepare([{offset:0,loop:8,length:16}]);
  await read(file,32,48);await read(file,64,80);await read(file,96,112);
  assert.deepEqual(file.subarray(8,16),bytes.slice(8,16));assert(file.blocks.size<=file.capacity+file.pinned.size);
});

test('original TH10 layout is bounded and ordered, unlike TH08 addresses',()=>{
  assert.equal(musicTracks.length,18);
  let end=16;for(const track of musicTracks){assert.equal(track.offset,end);assert(track.loop>=0&&track.loop<track.length);end=track.offset+track.length;}
  assert.equal(end,403789620);
});

test('external Range URL, baseURL and EOF preserve exact bytes',async()=>{
  const requests=[];
  const file=new PagedMusic({size:bytes.length,blockSize:16,url:'https://local.example/custom/music.dat'},{ahead:0,fetcher:async(url,options)=>{
    requests.push({url,range:options.headers.Range});const [,a,b]=/bytes=(\d+)-(\d+)/.exec(options.headers.Range);
    return new Response(bytes.slice(+a,+b+1),{status:206,headers:{'Content-Range':`bytes ${a}-${b}/${bytes.length}`}});
  }});
  assert.deepEqual(await read(file,151,999),bytes.slice(151));assert.deepEqual(file.subarray(999,1000),new Uint8Array());
  assert.deepEqual(requests,[{url:'https://local.example/custom/music.dat',range:'bytes=144-159'}]);
  let requested;const chunk=cache({ahead:0,baseURL:'https://local.example/nested/',fetcher:async url=>{requested=url;return new Response(bytes.slice(0,16));}});
  assert.deepEqual(await read(chunk,0,16),bytes.slice(0,16));assert.equal(requested,'https://local.example/nested/data/thbgm/0000.bin');
});

test('preparation is bounded, ignores invalid hints and retries failed speculative entries',async()=>{
  let fail=true;const file=cache({ahead:0,maxPinnedBytes:32,fetcher:async url=>{if(fail)throw Error('offline');const i=+url.match(/(\d+)\.bin/)[1];return new Response(bytes.slice(i*16,(i+1)*16));}});
  await file.prepare([{offset:-1,loop:0,length:16},{offset:0,loop:16,length:160}]);
  assert.equal(file.pinned.size,2);assert.equal(file.inflight.size,0);fail=false;
  assert.deepEqual(await read(file,0,24),bytes.slice(0,24));
  for(let i=2;i<10;i++)await read(file,i*16,i*16+16);
  assert(file.blocks.size<=file.capacity+file.pinned.size);
});

test('demand larger than cache survives asynchronous completion and trims after copying',async()=>{
  const file=cache({capacity:2,ahead:0});
  assert.deepEqual(await read(file,3,151),bytes.slice(3,151));assert(file.blocks.size<=2);
});

test('short or non-206 Range responses fail demand without poisoning the retry',async()=>{
  let mode=0;const file=new PagedMusic({size:16,blockSize:16},{ahead:0,fetcher:async()=>new Response(bytes.slice(0,mode===1?8:16),{status:mode===0?200:206,headers:{'Content-Range':'bytes 0-15/16'}})});
  for(mode=0;mode<2;mode++){assert.equal(file.subarray(0,16),null);await assert.rejects(file.pending);assert.equal(file.inflight.size,0);}
  assert.deepEqual(await read(file,0,16),bytes.slice(0,16));
});

test('demand joining a failing in-flight prefetch retries once with fresh bytes',async()=>{
  let rejectSpec,attempts=0;
  const file=cache({ahead:2,fetcher:async url=>{
    const i=+url.match(/(\d+)\.bin/)[1];
    if(i===1&&++attempts===1)return new Promise((_,reject)=>{rejectSpec=reject;});
    return new Response(bytes.slice(i*16,(i+1)*16));
  }});
  await read(file,0,8);await tick();assert.equal(file.subarray(16,32),null);
  rejectSpec(Error('late speculative failure'));await file.pending;
  assert.deepEqual(file.subarray(16,32),bytes.slice(16,32));assert.equal(attempts,2);
  await Promise.all(file.inflight.values());
});

test('preparation deadline aborts a hung fetch and demand retries without stale cache writes',async()=>{
  let lateResolve,signal,attempts=0;
  const file=cache({ahead:0,prefetchTimeoutMs:10,prepareTimeoutMs:20,fetcher:async(url,options)=>{
    attempts++;if(attempts===1){signal=options.signal;return new Promise(resolve=>{lateResolve=resolve;});}
    return new Response(bytes.slice(0,16));
  }});
  await file.prepare([{offset:0,loop:0,length:16}]);
  assert(signal.aborted);assert.equal(file.inflight.size,0);
  assert.deepEqual(await read(file,0,16),bytes.slice(0,16));
  lateResolve(new Response(new Uint8Array(16).fill(255)));await tick();
  assert.deepEqual(file.subarray(0,16),bytes.slice(0,16));assert.equal(attempts,2);
});

test('a distant seek cancels old speculative work and refills the new window',async()=>{
  const aborted=[];
  const file=cache({ahead:2,fetcher:async(url,options)=>{
    const i=+url.match(/(\d+)\.bin/)[1];
    if(i===1||i===2){options.signal.addEventListener('abort',()=>aborted.push(i));return new Promise(()=>{});}
    return new Response(bytes.slice(i*16,(i+1)*16));
  }});
  await read(file,0,8);await tick();await read(file,96,112);await tick();await tick();
  assert.deepEqual(aborted.sort(),[1,2]);assert(file.blocks.has(7));assert(file.blocks.has(8));
  assert(file.speculative.size<=2);
});

test('same-length bytes from a different Range are rejected',async()=>{
  const file=new PagedMusic({size:32,blockSize:16},{ahead:0,fetcher:async()=>new Response(bytes.slice(16,32),{status:206,headers:{'Content-Range':'bytes 16-31/32'}})});
  assert.equal(file.subarray(0,16),null);await assert.rejects(file.pending,/区间不符/);assert.equal(file.blocks.size,0);
});
