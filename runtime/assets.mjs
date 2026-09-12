export async function fetchBytes(url){const response=await fetch(url);if(!response.ok)throw new Error(`读取失败：${url} (${response.status})`);return new Uint8Array(await response.arrayBuffer());}
export async function fetchGzip(url){const bytes=await fetchBytes(url);if(bytes[0]!==0x1f||bytes[1]!==0x8b)return bytes;return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());}

// Cache original PCM bytes before the emulated synchronous ReadFile needs them.
// Track starts/loop points remain resident; the moving window is a bounded LRU.
export class PagedMusic {
  constructor(info,{fetcher=(...args)=>fetch(...args),capacity=64,ahead=12,baseURL=null,maxPinnedBytes=48*1024*1024,prefetchTimeoutMs=5000,prepareTimeoutMs=10000}={}){
    this.prefetchTimeoutMs=prefetchTimeoutMs;this.prepareTimeoutMs=prepareTimeoutMs;this.speculative=new Map();
    this.length=info.size;this.chunked=!!info.chunked;this.blockSize=info.blockSize??262144;
    this.baseURL=baseURL;this.url=info.url;this.maxPinnedBlocks=Math.floor(maxPinnedBytes/this.blockSize);
    this.fetcher=fetcher;this.capacity=Math.max(1,capacity);this.ahead=Math.min(ahead,Math.max(0,this.capacity-2));
    this.blocks=new Map();this.inflight=new Map();this.pinned=new Set();this.required=new Set();this.pending=null;this.prefetched=-1;
  }
  trim(){
    const limit=Math.max(this.capacity+this.pinned.size,this.required.size+this.pinned.size);
    if(this.blocks.size<=limit)return;
    for(const index of this.blocks.keys()){
      if(!this.pinned.has(index)&&!this.required.has(index))this.blocks.delete(index);
      if(this.blocks.size<=limit)break;
    }
  }
  load(index,{speculative=false,timeoutMs=this.prefetchTimeoutMs}={}){
    if(this.blocks.has(index))return Promise.resolve(this.blocks.get(index));
    if(this.inflight.has(index))return this.inflight.get(index);
    const controller=speculative?new AbortController():null;
    if(controller)this.speculative.set(index,controller);
    let timer;
    const pending=Promise.resolve().then(async()=>{
      const start=index*this.blockSize,end=Math.min(start+this.blockSize,this.length)-1;
      const path=this.chunked?`/data/thbgm/${String(index).padStart(4,'0')}.bin`:'/data/thbgm.dat';
      const url=this.url??(this.baseURL?new URL(path.slice(1),this.baseURL).href:path);
      const request=async()=>{
        const options=this.chunked?{}:{headers:{Range:`bytes=${start}-${end}`}};
        if(controller)options.signal=controller.signal;
        const response=await this.fetcher(url,options);
        if(!response.ok||(!this.chunked&&response.status!==206))throw new Error('音乐数据读取失败：'+url);
        if(!this.chunked&&response.headers.get('Content-Range')!==`bytes ${start}-${end}/${this.length}`)throw new Error('音乐数据返回区间不符：'+url);
        const data=new Uint8Array(await response.arrayBuffer());
        if(data.length!==end-start+1)throw new Error('音乐数据长度不完整：'+url);
        return data;
      };
      // Race as well as abort: an injected fetcher may not honor AbortSignal.
      const aborted=controller?new Promise((_,reject)=>{
        const fail=()=>reject(new Error('音乐预读取消或超时'));
        controller.signal.addEventListener('abort',fail,{once:true});
        if(controller.signal.aborted)fail();
        timer=setTimeout(()=>controller.abort(),timeoutMs);
      }):null;
      const data=await (aborted?Promise.race([request(),aborted]):request());
      this.blocks.set(index,data);this.trim();return data;
    }).finally(()=>{clearTimeout(timer);this.inflight.delete(index);this.speculative.delete(index);});
    this.inflight.set(index,pending);return pending;
  }
  demand(index){
    const wasSpeculative=this.speculative.has(index),pending=this.load(index);
    // A demand joining an in-flight speculative request gets one fresh retry.
    return wasSpeculative?pending.catch(()=>this.load(index)):pending;
  }
  async prepare(tracks){
    // Each original stream fills up to 1 MiB when seeking. Pin that window at
    // both entry points so changing tracks and looping do not suspend a frame.
    for(const track of tracks){
      if(![track.offset,track.loop,track.length].every(Number.isSafeInteger)||track.offset<0||track.loop<0||track.length<=0||track.loop>=track.length||track.offset+track.length>this.length)continue;
      for(const start of [track.offset,track.offset+track.loop]){
        const end=Math.min(start+1048576,track.offset+track.length,this.length);
        for(let i=Math.floor(start/this.blockSize);i<=Math.floor((end-1)/this.blockSize);i++)if(this.pinned.size<this.maxPinnedBlocks)this.pinned.add(i);
      }
    }
    // Preparation is speculative: unavailable entries retry on demand.
    const indices=[...this.pinned],deadline=performance.now()+this.prepareTimeoutMs;let next=0;
    await Promise.all(Array.from({length:4},async()=>{
      while(next<indices.length){
        const remaining=deadline-performance.now();if(remaining<=0)break;
        await this.load(indices[next++],{speculative:true,timeoutMs:Math.min(remaining,this.prefetchTimeoutMs)}).catch(()=>{});
      }
    }));
  }
  prefetch(last){
    this.prefetched=last;
    for(const [index,controller] of this.speculative){
      if((index<=last||index>last+this.ahead)&&!this.required.has(index)&&!this.pinned.has(index))controller.abort();
    }
    for(let i=last+1;i<=last+this.ahead&&i*this.blockSize<this.length;i++){
      if(this.blocks.has(i)||this.inflight.has(i))continue;
      if(this.speculative.size>=this.ahead)break;
      this.load(i,{speculative:true}).catch(()=>{}).finally(()=>{
        // Completion of an obsolete window makes room for the latest seek.
        if(this.prefetched!==last)this.prefetch(this.prefetched);
      });
    }
  }
  subarray(start,end){
    start=Math.max(0,Math.min(start,this.length));end=Math.max(start,Math.min(end,this.length));
    if(start===end)return new Uint8Array(0);
    const first=Math.floor(start/this.blockSize),last=Math.floor((end-1)/this.blockSize),missing=[];
    this.required=new Set();for(let i=first;i<=last;i++){this.required.add(i);if(!this.blocks.has(i))missing.push(i);}
    if(missing.length){this.pending=Promise.all(missing.map(i=>this.demand(i)));return null;}
    const result=new Uint8Array(end-start);
    for(let i=first;i<=last;i++){
      const block=this.blocks.get(i),from=Math.max(start,i*this.blockSize),to=Math.min(end,(i+1)*this.blockSize);
      result.set(block.subarray(from-i*this.blockSize,to-i*this.blockSize),from-start);this.blocks.delete(i);this.blocks.set(i,block);
    }
    this.required.clear();this.trim();this.pending=null;this.prefetch(last);return result;
  }
}
