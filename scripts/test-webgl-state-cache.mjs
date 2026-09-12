// Browser pixel-for-pixel comparison of the original submission path and the
// state cache. Entirely synthetic resources; no game or personal save content.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile, mkdir, writeFile} from 'node:fs/promises';
import {resolve, sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';
const root=resolve(fileURLToPath(new URL('../runtime/',import.meta.url)));
const server=createServer(async(req,res)=>{
  try {
    const name=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
    if(name==='/'){res.setHeader('Content-Type','text/html');res.end('<!doctype html><title>WebGL cache conformance</title>');return;}
    const file=resolve(root,'.'+name);
    if(!file.startsWith(root+sep)||!file.endsWith('.mjs')){res.writeHead(404);res.end();return;}
    res.setHeader('Content-Type','text/javascript');res.end(await readFile(file));
  }catch{res.writeHead(404);res.end();}
});
await new Promise((done,fail)=>{server.once('error',fail);server.listen(0,'127.0.0.1',done);});
let browser;const report={date:new Date().toISOString(),scope:'Synthetic WebGL2 pixels, same browser, reference vs cached'};
try{
  browser=await chromium.launch({channel:'msedge',headless:true,args:['--enable-unsafe-swiftshader']});
  const page=await browser.newPage();await page.goto(`http://127.0.0.1:${server.address().port}/`);
  report.cases=await page.evaluate(async()=>{
    const [{Win32Host},{WebGLD3D9}]=await Promise.all([import('/win32.mjs'),import('/webgl.mjs')]);
    const render=(cacheState)=>{
      const memory=new Uint8Array(8*1024*1024),view=new DataView(memory.buffer);let next=0x10000,stub=0x8000;
      const m={replace(){},registerImport(){return stub+=16;},allocate(n){const p=next;next=(next+n+15)&~15;return p;},
        write(p,b){memory.set(b,p);},view(p,n){return memory.subarray(p,p+n);},bytes(p,n){return memory.slice(p,p+n);},
        u32(p,n){if(n===undefined)return view.getUint32(p,true);view.setUint32(p,n>>>0,true);},i32(p){return view.getInt32(p,true);},
        f32(p,n){if(n===undefined)return view.getFloat32(p,true);view.setFloat32(p,n,true);},readWords(p,n){return Array.from({length:n},(_,i)=>view.getUint32(p+i*4,true));}};
      const host=new Win32Host(m),d3d=host.d3d,p=host.alloc(56);m.u32(p,64);m.u32(p+4,64);m.u32(p+8,21);
      const d=d3d.createDevice(p),renderer=new WebGLD3D9(new OffscreenCanvas(64,64),d3d,{cacheState,reuseStaging:cacheState,debugErrors:true}),gl=renderer.gl;
      if(cacheState)renderer.warmPrograms();
      const counts={uniforms:0,attachments:0,parameters:0,draws:0};
      for(const name of ['uniform1i','uniform1f','uniform3f','uniform4fv','uniformMatrix4fv','framebufferRenderbuffer','texParameteri','drawArrays','drawArraysInstanced']){
        const method=gl[name].bind(gl),key=name.startsWith('uniform')?'uniforms':name==='framebufferRenderbuffer'?'attachments':name==='texParameteri'?'parameters':'draws';
        gl[name]=(...a)=>{counts[key]++;return method(...a);};
      }
      const tex=d3d.texture(4,4,1,0,21,1),pixels=m.view(tex.surface.data,tex.surface.size);
      for(let i=0;i<16;i++){pixels[i*4]=i&1?255:32;pixels[i*4+1]=i&2?200:24;pixels[i*4+2]=i&4?220:16;pixels[i*4+3]=170;}
      tex.surface.version++;
      const vp=(width=64)=>new Uint8Array(new Uint32Array([0,0,width,64,0,0x3f800000]).buffer);
      const matrix=x=>new Uint8Array(new Float32Array([1,0,0,0,0,1,0,0,0,0,1,0,x,0,0,1]).buffer);
      const quad=(left,top,right,bottom,z=0.5)=>{
        const b=new Uint8Array(4*28),v=new DataView(b.buffer);
        [[left,top,0,0],[right,top,1.8,0],[left,bottom,0,1.8],[right,bottom,1.8,1.8]].forEach(([x,y,u,w],i)=>{
          const o=i*28;v.setFloat32(o,x,true);v.setFloat32(o+4,y,true);v.setFloat32(o+8,z,true);v.setFloat32(o+12,1,true);
          v.setUint32(o+16,0xff80c0ff,true);v.setFloat32(o+20,u,true);v.setFloat32(o+24,w,true);
        });return b;
      };
      const target2=d3d.surface(64,64,21,0,1),depth2=d3d.surface(64,64,75,0,2),records=[];
      const snapshot=name=>{renderer.flush();renderer.readSurface(d.back);const error=gl.getError();if(error)throw new Error(`GL error ${error} ${name}`);records.push({name,pixels:Array.from(m.view(d.back.data,d.back.size))});};
      const clear=(target=d.back,depth=d.depth)=>renderer.clear({target:target.address,depthTarget:depth?.address??0,viewport:vp(),flags:3,color:0xff102030,depth:1,stencil:0});
      const draw=(i,{target=d.back,depth=d.depth,texture=tex,world=0}={})=>renderer.queue({type:'draw',primitive:5,count:2,stride:28,
        vertices:quad(3+i%6,4,50,52,0.2+i*0.001),indices:null,fvf:0x144,texture:texture?.address??0,target:target.address,depthTarget:depth?.address??0,
        viewport:vp(),scissor:new Uint8Array(new Int32Array([4,3,60,61]).buffer),
        states:new Map([[7,depth?1:0],[14,1],[23,4],[27,1],[19,5],[20,6],[15,i%3===0?1:0],[25,5],[24,40],[28,i%4===0?1:0],[34,0xff303060],[174,i%2],[60,i%2?0xff80ffff:0xffff8040]]),
        stages:new Map([[1,4],[2,2],[3,3],[4,4],[5,2],[6,1],[13,i%2?1:3],[14,3],[17,i%2?1:2],[16,2]]),
        transforms:new Map([[256,matrix(world)],[2,matrix(0)],[3,matrix(0)],[16,matrix(0)]])});
      clear();for(let i=0;i<36;i++){draw(i);renderer.flush();}snapshot('alpha-depth-fog-scissor-and-program-switches');
      clear();for(let i=0;i<24;i++){draw(1);renderer.flush();}snapshot('identical-uniforms-repeated');
      // FBO switches, depth/stencil attachment replacement and texture mutation.
      clear(target2,depth2);draw(2,{target:target2,depth:depth2});renderer.flush();
      renderer.copy(target2,[0,0,64,64],d.back,[0,0]);d.back.version++;
      for(let i=0;i<3;i++){renderer.target(d.back.address,0);renderer.target(d.back.address,d.depth.address);}
      pixels.fill(200);tex.surface.version++;draw(1,{depth:null});renderer.flush();snapshot('fbo-copy-and-texture-upload');
      renderer.present(d);draw(3);renderer.flush();snapshot('present-does-not-corrupt-program-cache');
      clear();
      const worldVertices=new Uint8Array(new Float32Array([-.75,-.7,.3,0,0, .2,-.7,.3,1,0, -.75,.7,.3,0,1, .2,.7,.3,1,1]).buffer);
      for(let i=0;i<12;i++){
        renderer.queue({type:'draw',primitive:5,count:2,stride:20,vertices:worldVertices,fvf:0x102,texture:tex.address,
          target:d.back.address,depthTarget:d.depth.address,viewport:vp(),scissor:new Uint8Array(new Int32Array([0,0,64,64]).buffer),
          states:new Map([[7,1],[14,1],[23,4],[60,0xffffffff],[27,1],[19,5],[20,6]]),
          stages:new Map([[1,4],[2,2],[3,3],[4,2],[5,2],[6,1]]),
          transforms:new Map([[256,matrix(i*.045)],[2,matrix(0)],[3,matrix(0)]])});
      }
      renderer.flush();snapshot('instanced-world-matrices-and-following-2d');
      const ext=gl.getExtension('WEBGL_debug_renderer_info'),driver=ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER);
      gl.getExtension('WEBGL_lose_context')?.loseContext();return{records,counts,driver};
    };
    const reference=render(false),cached=render(true);
    return reference.records.map((r,i)=>({name:r.name,differingBytes:r.pixels.reduce((sum,b,j)=>sum+(b!==cached.records[i].pixels[j]),0),
      totalBytes:r.pixels.length,distinctByteValues:new Set(r.pixels).size,referenceCalls:reference.counts,cachedCalls:cached.counts,driver:cached.driver}));
  });
  for(const item of report.cases){assert.equal(item.differingBytes,0,item.name);assert.ok(item.distinctByteValues>4,`${item.name}: rendered nontrivial pixels`);}
  assert.ok(report.cases[0].cachedCalls.uniforms<report.cases[0].referenceCalls.uniforms);
  assert.ok(report.cases[0].cachedCalls.attachments<report.cases[0].referenceCalls.attachments);
  assert.equal(report.cases[0].cachedCalls.draws,report.cases[0].referenceCalls.draws);report.ok=true;
}catch(error){report.ok=false;report.error=String(error.stack??error);process.exitCode=1;}
finally{await browser?.close();await new Promise(done=>server.close(done));
  const out=resolve(root,'../artifacts/validation/mobile-performance');await mkdir(out,{recursive:true});
  await writeFile(resolve(out,'webgl-cache-pixels.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));}
