import {COM} from './com.mjs';
const zero=()=>0;
const bpp=format=>({20:3,21:4,22:4,23:2,24:2,25:2,26:2,28:1,50:1,51:2}[format]??4);
// Draw packets retain immutable state. Copy a map only when a later setter
// changes it, instead of copying every state group for every primitive.
function setState(device,group,key,value){if(device[group].get(key)===value)return;const shared=group+'Shared';if(device[shared]){device[group]=new Map(device[group]);device[shared]=false;}device[group].set(key,value);}
export class Direct3D9 {
  constructor(host){this.host=host;this.m=host.m;this.com=new COM(host);this.frames=0;this.draws=[];this.devices=[];}
  create(){return this.com.create('IDirect3D9',this.d3dMethods).address;}
  mode(out){[640,480,60,22].forEach((n,i)=>this.m.u32(out+i*4,n));return 0;}
  caps(out){
    const values=new Uint32Array(76);values.fill(0xffffffff,2,22);values[0]=1;values[22]=4096;values[23]=4096;values[24]=256;values[25]=8192;values[26]=4096;values[27]=16;
    // POW2 and SQUAREONLY are restrictions, not extra features. Reporting them
    // makes the original D3DX shrink rectangular dialogue atlases and portraits.
    values[15]=0x00005; // D3DPTEXTURECAPS_PERSPECTIVE | D3DPTEXTURECAPS_ALPHA
    values[35]=0x10008;values[36]=0x3ffffff;values[37]=8;values[38]=8;values[39]=0x7f;values[40]=8;values[41]=6;values[42]=4;values[43]=255;values[45]=0xfffff;values[46]=0xfffff;values[47]=16;values[48]=255;values[49]=0xfffe0101;values[50]=96;values[51]=0xffff0104;
    this.m.write(out,new Uint8Array(values.buffer));this.m.f32(out+28*4,1e10);this.m.f32(out+44*4,64);this.m.f32(out+52*4,8);return 0;
  }
  d3dMethods={
    GetAdapterCount:()=>1,GetAdapterModeCount:()=>1,GetAdapterDisplayMode:a=>this.mode(a[1]),EnumAdapterModes:a=>this.mode(a[3]),GetAdapterMonitor:()=>1,
    GetAdapterIdentifier:a=>{this.host.putText(a[2],'TH10 browser Direct3D 9');this.host.putText(a[2]+512,'TH10 browser Direct3D 9');return 0;},
    CheckDeviceFormatConversion:zero,
    CheckDeviceType:zero,CheckDeviceFormat:zero,CheckDeviceMultiSampleType:zero,CheckDepthStencilMatch:zero,GetDeviceCaps:a=>this.caps(a[2]),
    CreateDevice:a=>{if(!(a[3]&2))this.m.reg('FPCW',(this.m.reg('FPCW')&~0xf00)|0x3f);const device=this.createDevice(a[4]);this.m.u32(a[5],device.address);return 0;},
  };
  createDevice(params){
    const m=this.m,back=this.surface(m.u32(params)||640,m.u32(params+4)||480,m.u32(params+8)||22,0),depth=this.surface(back.width,back.height,80,0);
    const d=this.com.create('IDirect3DDevice9',this.deviceMethods,{back,depth,target:back,depthTarget:depth,params:m.bytes(params,56),viewport:new Uint8Array(new Uint32Array([0,0,back.width,back.height,0,0x3f800000]).buffer),transforms:new Map(),states:new Map(),stages:new Map(),samplers:new Map(),textures:new Map(),streams:new Map(),fvf:0});
    this.com.addRef(back);this.com.addRef(depth);
    d.destroy=()=>{this.onFlush?.();for(const address of d.textures.values())if(address)this.com.release(address);for(const stream of d.streams.values())if(stream.address)this.com.release(stream.address);if(d.indices?.address)this.com.release(d.indices.address);this.com.release(d.target);if(d.depthTarget)this.com.release(d.depthTarget);this.com.release(back);this.com.release(depth);this.devices.splice(this.devices.indexOf(d),1);};
    this.devices.push(d);this.device=d;return d;
  }
  deviceMethods={
    TestCooperativeLevel:zero,GetAvailableTextureMem:()=>256*1024*1024,EvictManagedResources:zero,GetDeviceCaps:a=>this.caps(a[0]),GetDisplayMode:a=>this.mode(a[1]),
    GetDirect3D:a=>{this.m.u32(a[0],this.create());return 0;},
    SetCursorProperties:zero,SetCursorPosition:zero,ShowCursor:zero,
    BeginScene:zero,EndScene:zero,
    Present:()=>{this.frames++;const interval=1000/60,previous=this.vblankTime??this.host.millis;this.vblankTime=previous+Math.max(1,Math.ceil((this.host.millis-previous-1e-7)/interval))*interval;this.host.millis=this.vblankTime;this.host.yielded=true;this.m.cpu.emu_stop();this.onPresent?.(this.device,this.draws);this.draws=[];return 0;},
    Reset:a=>{this.device.params=this.m.bytes(a[0],56);return 0;},
    GetBackBuffer:a=>{const s=this.device.back;this.com.addRef(s);this.m.u32(a[3],s.address);return 0;},
    GetRenderTarget:a=>{const s=this.device.target;this.com.addRef(s);this.m.u32(a[1],s.address);return 0;},GetDepthStencilSurface:a=>{const s=this.device.depthTarget;if(s)this.com.addRef(s);this.m.u32(a[0],s?.address??0);return s?0:0x88760866;},
    SetRenderTarget:a=>{if(a[0]!==0)return 0x8876086c;const d=this.device,target=this.com.get(a[1]);this.com.addRef(target);this.onFlush?.();this.com.release(d.target);d.target=target;d.viewport=new Uint8Array(new Uint32Array([0,0,target.width,target.height,0,0x3f800000]).buffer);return 0;},
    SetDepthStencilSurface:a=>{const d=this.device,depth=a[0]?this.com.get(a[0]):null;if(depth)this.com.addRef(depth);this.onFlush?.();if(d.depthTarget)this.com.release(d.depthTarget);d.depthTarget=depth;return 0;},
    Clear:a=>{const clear={type:'clear',target:this.device.target.address,depthTarget:this.device.depthTarget?.address??0,viewport:this.device.viewport,flags:a[2],color:a[3],depth:new Float32Array(new Uint32Array([a[4]]).buffer)[0],stencil:a[5],rects:a[0]?Array.from(this.m.readWords(a[1],a[0]*4)):null};if(this.onClear)this.onClear(clear);else this.draws.push(clear);return 0;},
    SetTransform:a=>{setState(this.device,'transforms',a[0],this.m.bytes(a[1],64));return 0;},GetTransform:a=>{this.m.write(a[1],this.device.transforms.get(a[0])??new Uint8Array(new Float32Array([1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]).buffer));return 0;},
    SetViewport:a=>{this.device.viewport=this.m.bytes(a[0],24);return 0;},GetViewport:a=>{this.m.write(a[0],this.device.viewport);return 0;},
    SetRenderState:a=>{setState(this.device,'states',a[0],a[1]);return 0;},GetRenderState:a=>{this.m.u32(a[1],this.device.states.get(a[0])??0);return 0;},
    SetTextureStageState:a=>{setState(this.device,'stages',a[0]*256+a[1],a[2]);return 0;},GetTextureStageState:a=>{this.m.u32(a[2],this.device.stages.get(a[0]*256+a[1])??0);return 0;},
    SetSamplerState:a=>{this.device.samplers.set(a[0]*256+a[1],a[2]);const key=({1:13,2:14,3:25,4:15,5:16,6:17,7:18,8:19,9:20,10:21})[a[1]];if(key)setState(this.device,'stages',a[0]*256+key,a[2]);return 0;},
    GetSamplerState:a=>{this.m.u32(a[2],this.device.samplers.get(a[0]*256+a[1])??0);return 0;},
    // Draw packets preserve their texture binding. Rebinding alone need not
    // submit them; releasing or locking a surface already flushes pending use.
    SetTexture:a=>{const old=this.device.textures.get(a[0]);if(old===a[1])return 0;if(a[1])this.com.addRef(a[1]);this.device.textures.set(a[0],a[1]);if(old)this.com.release(old);return 0;},GetTexture:a=>{const address=this.device.textures.get(a[0])??0;if(address)this.com.addRef(address);this.m.u32(a[1],address);return 0;},
    SetFVF:a=>{this.device.fvf=a[0];return 0;},GetFVF:a=>{this.m.u32(a[0],this.device.fvf);return 0;},SetVertexShader:zero,SetPixelShader:zero,
    CreateTexture:a=>{this.m.u32(a[6],this.texture(a[0],a[1],a[2],a[3],a[4],a[5]).address);return 0;},
    CreateOffscreenPlainSurface:a=>{this.m.u32(a[4],this.surface(a[0],a[1],a[2],a[3]).address);return 0;},
    UpdateSurface:a=>this.copyRects(this.com.get(a[0]),a[1],1,this.com.get(a[2]),a[3]),
    UpdateTexture:a=>this.copyRects(this.com.get(a[0]).surface,0,0,this.com.get(a[1]).surface,0),
    CreateRenderTarget:a=>{this.m.u32(a[6],this.surface(a[0],a[1],a[2],0,1).address);return 0;},CreateDepthStencilSurface:a=>{this.m.u32(a[6],this.surface(a[0],a[1],a[2],0,2).address);return 0;},
    CreateVertexBuffer:a=>{this.m.u32(a[4],this.buffer('IDirect3DVertexBuffer9',a[0],a[1],a[2],a[3]).address);return 0;},CreateIndexBuffer:a=>{this.m.u32(a[4],this.buffer('IDirect3DIndexBuffer9',a[0],a[1],a[2],a[3]).address);return 0;},
    SetStreamSource:a=>{const old=this.device.streams.get(a[0]);if(a[1])this.com.addRef(a[1]);this.device.streams.set(a[0],{address:a[1],offset:a[2],stride:a[3]});if(old?.address)this.com.release(old.address);return 0;},SetIndices:a=>{const old=this.device.indices;if(a[0])this.com.addRef(a[0]);this.device.indices={address:a[0]};if(old?.address)this.com.release(old.address);return 0;},
    DrawPrimitiveUP:a=>this.draw(a[0],a[1],a[2],a[3]),
    DrawPrimitive:a=>{const s=this.device.streams.get(0),b=this.com.get(s.address);return this.draw(a[0],a[2],b.data+s.offset+a[1]*s.stride,s.stride);},
    DrawIndexedPrimitiveUP:a=>this.draw(a[0],a[3],a[6],a[7],{data:a[4],format:a[5],min:a[1],count:a[2]}),
    DrawIndexedPrimitive:a=>{const s=this.device.streams.get(0),b=this.com.get(s.address),idx=this.com.get(this.device.indices.address);return this.draw(a[0],a[5],b.data+s.offset+(a[1]|0)*s.stride,s.stride,{data:idx.data+a[4]*(idx.fvf===101?2:4),format:idx.fvf,min:a[2],count:a[3]});},
    ValidateDevice:a=>{this.m.u32(a[0],1);return 0;},
  };
  surface(width,height,format,pool=1,usage=0){
    const m=this.m,size=width*height*bpp(format),s=this.com.create('IDirect3DSurface9',{}, {width,height,format,pool,usage,size,pitch:width*bpp(format),data:this.host.alloc(size),version:0});
    m.view(s.data,size).fill(0);
    s.handlers={GetDevice:a=>{this.com.addRef(this.device);m.u32(a[0],this.device.address);return 0;},GetDesc:a=>this.desc(s,a[0]),LockRect:a=>this.lock(s,a[0],a[1]),UnlockRect:()=>{s.version++;return 0;},GetContainer:a=>{m.u32(a[1],s.texture?.address??0);if(s.texture)this.com.addRef(s.texture);return s.texture?0:0x80004002;}};
    s.destroy=()=>{this.onRelease?.(s);this.host.free(s.data);};return s;
  }
  desc(s,out){[s.format,1,s.usage,s.pool,0,0,s.width,s.height].forEach((n,i)=>this.m.u32(out+i*4,n));return 0;}
  copyRects(src,rects,count,dst,points){
    // D3DX probes this fast path before using its original conversion routine.
    if(src.format!==dst.format||src===dst)return 0x8876086c; // D3DERR_INVALIDCALL
    const copies=[];for(let i=0;i<(rects?count:1);i++){
      const [x,y,r,b]=rects?this.m.readWords(rects+i*16,4).map(n=>n|0):[0,0,src.width,src.height],p=points?this.m.readWords(points+i*8,2).map(n=>n|0):[x,y];
      if(x<0||y<0||r<=x||b<=y||r>src.width||b>src.height||p[0]<0||p[1]<0||p[0]+r-x>dst.width||p[1]+b-y>dst.height)return 0x8876086c;
      copies.push({x,y,r,b,p});
    }
    for(const {x,y,r,b,p} of copies){
      if(this.onCopy?.(src,[x,y,r,b],dst,p))continue;
      for(let row=0;row<b-y;row++)this.m.write(dst.data+(p[1]+row)*dst.pitch+p[0]*bpp(dst.format),this.m.bytes(src.data+(y+row)*src.pitch+x*bpp(src.format),(r-x)*bpp(src.format)));
    }dst.version++;return 0;
  }
  lock(s,out,rect){this.onReadSurface?.(s);const x=rect?this.m.i32(rect):0,y=rect?this.m.i32(rect+4):0;this.m.u32(out,s.pitch);this.m.u32(out+4,s.data+y*s.pitch+x*bpp(s.format));return 0;}
  texture(width,height,levels,usage,format,pool){
    const m=this.m,s=this.surface(width,height,format,pool,usage),t=this.com.create('IDirect3DTexture9',{}, {surface:s,width,height,format});s.texture=t;s.refOwner=t;
    t.handlers={SetPriority:zero,GetPriority:zero,PreLoad:zero,GetType:()=>3,SetLOD:zero,GetLOD:zero,GetLevelCount:()=>1,GetDevice:a=>{this.com.addRef(this.device);m.u32(a[0],this.device.address);return 0;},GetLevelDesc:a=>this.desc(s,a[1]),GetSurfaceLevel:a=>{this.com.addRef(s);m.u32(a[1],s.address);return 0;},LockRect:a=>this.lock(s,a[1],a[2]),UnlockRect:()=>{s.version++;return 0;},AddDirtyRect:zero};
    t.destroy=()=>{s.destroy();this.com.forget(s);};return t;
  }
  buffer(kind,size,usage,fvf,pool){const m=this.m,b=this.com.create(kind,{}, {size,usage,fvf,pool,data:this.host.alloc(size)});b.handlers={SetPriority:zero,GetPriority:zero,PreLoad:zero,GetType:()=>6,Lock:a=>{m.u32(a[2],b.data+a[0]);return 0;},Unlock:zero,GetDesc:a=>{[100,6,usage,pool,size,fvf].forEach((n,i)=>m.u32(a[0]+i*4,n));return 0;}};b.destroy=()=>this.host.free(b.data);return b;}
  draw(primitive,count,address,stride,indices=null){
    const d=this.device,elementCount=primitive===1?count:primitive===2?count*2:primitive===3?count+1:primitive===4?count*3:count+2,vertexCount=indices?indices.count:elementCount;
    let indexBytes=null;if(indices){indexBytes=this.m.bytes(indices.data,elementCount*(indices.format===101?2:4));const values=indices.format===101?new Uint16Array(indexBytes.buffer,indexBytes.byteOffset,elementCount):new Uint32Array(indexBytes.buffer,indexBytes.byteOffset,elementCount);for(let i=0;i<values.length;i++){values[i]-=indices.min;if(values[i]>=vertexCount)throw new Error('Index outside declared Direct3D vertex range');}}
    const draw={type:'draw',primitive,count,stride,vertices:this.m.bytes(address+(indices?.min??0)*stride,vertexCount*stride),indices:indexBytes,indexFormat:indices?.format,fvf:d.fvf,texture:d.textures.get(0)??0,target:d.target.address,depthTarget:d.depthTarget?.address??0,viewport:d.viewport,states:d.states,stages:d.stages,transforms:d.transforms};d.statesShared=d.stagesShared=d.transformsShared=true;if(this.onDraw)this.onDraw(draw);else this.draws.push(draw);return 0;
  }
}
