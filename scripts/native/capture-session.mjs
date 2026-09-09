import {mkdirSync,writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
// Development-only offscreen Direct3D 9 snapshot. No helper is shipped.
export function captureSession(s,name,out){
  mkdirSync(out,{recursive:true});const h=s.host.d3d,m=s.m,c={name,width:640,height:480,format:h.device.back.format,clear:0xff000000,textures:[],draws:[],ops:[]},textures=new Map(),old={draw:h.onDraw,clear:h.onClear},b64=b=>Buffer.from(b).toString('base64');
  h.onClear=d=>{if(d.target===h.device.back.address)c.ops.push({type:'clear',before:c.draws.length,flags:d.flags,color:d.color,depth:d.depth,stencil:d.stencil??0,rects:d.rects,viewport:b64(d.viewport)});};
  h.onDraw=d=>{if(d.target!==h.device.back.address)return;let texture=-1;if(d.texture){const surface=h.com.get(d.texture).surface,key=surface.address+':'+surface.version;if(!textures.has(key)){textures.set(key,c.textures.length);c.textures.push({width:surface.width,height:surface.height,format:surface.format,pixels:b64(m.bytes(surface.data,surface.size))});}texture=textures.get(key);}let vertices=d.vertices;if(d.indices){const indices=d.indexFormat===101?new Uint16Array(d.indices.buffer,d.indices.byteOffset,d.indices.length/2):new Uint32Array(d.indices.buffer,d.indices.byteOffset,d.indices.length/4);vertices=new Uint8Array(indices.length*d.stride);indices.forEach((index,i)=>vertices.set(d.vertices.subarray(index*d.stride,(index+1)*d.stride),i*d.stride));}c.draws.push({texture,vertices:b64(vertices),stride:d.stride,fvf:d.fvf,primitive:d.primitive,count:d.count,states:[...d.states],stages:[...d.stages].filter(([k])=>k<256),transforms:[...d.transforms].map(([k,b])=>[k,b64(b)]),viewport:b64(d.viewport)});};
  try{s.frames(1);}finally{h.onDraw=old.draw;h.onClear=old.clear;}
  writeFileSync(`${out}/${name}.json`,JSON.stringify([c]));execFileSync('artifacts/D3D9Oracle.exe',[`${out}/${name}.json`,out],{windowsHide:true,stdio:'pipe'});
  execFileSync('python',['-c',"from PIL import Image;from pathlib import Path;import sys;p=Path(sys.argv[1]);Image.frombytes('RGBA',(640,480),p.read_bytes(),'raw','BGRA').convert('RGB').save(p.with_suffix('.png'))",`${out}/${name}.bin`],{windowsHide:true});
}
