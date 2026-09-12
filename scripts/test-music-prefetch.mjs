// Deterministic cache-layer comparison, not an FPS benchmark or original PCM test.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
import {PagedMusic} from '../runtime/assets.mjs';
import {PagedMusic as Baseline} from '../artifacts/validation/mobile-performance/perf5-baseline/assets.mjs';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
async function run(Type,prepare){
  const blockSize=4096,size=256*blockSize,requests=[],hash=createHash('sha256');let stalls=0;
  const file=new Type({size,blockSize,chunked:true},{fetcher:async url=>{
    const index=+url.match(/(\d+)\.bin/)[1];requests.push(index);await tick();
    return new Response(Buffer.alloc(blockSize,index&255));
  }});
  if(prepare)await file.prepare([{offset:0,loop:128*blockSize,length:size}]);
  const startupRequests=requests.length;
  for(const index of [...Array.from({length:80},(_,i)=>i),...Array.from({length:32},(_,i)=>128+i),0,128]){
    let data=file.subarray(index*blockSize,index*blockSize+1024);
    if(!data){stalls++;await file.pending;data=file.subarray(index*blockSize,index*blockSize+1024);}
    assert(data);hash.update(data);await tick();await tick();
  }
  await Promise.all(file.inflight?.values()??[]);
  return {stalls,requests:requests.length,startupRequests,residentBytes:file.blocks.size*blockSize,sha256:hash.digest('hex')};
}
const report={scope:'Synthetic sequential reads plus seeks, identical scheduling opportunity and bytes; no game FPS claim',baseline:await run(Baseline,false),aheadOnly:await run(PagedMusic,false),withEntries:await run(PagedMusic,true)};
assert.equal(report.baseline.sha256,report.aheadOnly.sha256);assert.equal(report.baseline.sha256,report.withEntries.sha256);
assert(report.aheadOnly.stalls<report.baseline.stalls);assert(report.withEntries.stalls<report.baseline.stalls);
await writeFile(new URL('../artifacts/validation/mobile-performance/perf5-music-comparison.json',import.meta.url),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
