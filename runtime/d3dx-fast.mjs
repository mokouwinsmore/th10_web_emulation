// The original D3DX resampler stays in the guest. Its hot saturation loops
// only clamp an already computed float RGBA row; do that work in bulk.
// Run the last pixel through the original instructions to preserve register,
// flags and x87 stack/status behavior at the continuation.
export function installD3DXFastPaths(machine,library,host){
  const m=machine;
  // The triangle tables depend only on dimensions, edge mode and precision.
  // Cache bytes made by the original DLL, and return a fresh allocation so
  // its normal free operation and simultaneous calls keep their ownership.
  {
    const address=library.base+0xd3c50,original=m.bytes(address,5),expected=[0x8b,0xff,0x55,0x8b,0xec],cache=new Map(),pending=new Map();
    if(!original.every((byte,i)=>byte===expected[i]))throw new Error('Unexpected D3DX9_31 filter-table code');
    const trampoline=m.allocate(16),jump=new Uint8Array(5);jump[0]=0xe9;new DataView(jump.buffer).setInt32(1,address+5-(trampoline+5)-5,true);m.cpu.mem_write(trampoline,[...original,...jump]);
    const complete=m.registerImport({dll:'native-host',name:'D3DX.FilterTableReady',argc:0,handler:()=>{
      const sp=m.reg('ESP'),request=pending.get(sp);pending.delete(sp);if(!request)throw new Error('D3DX filter return without request');
      const pointer=m.reg('EAX');if(pointer){const size=m.u32(pointer);if(size>=4&&size<=1024*1024){cache.set(request.key,m.bytes(pointer,size));while(cache.size>64)cache.delete(cache.keys().next().value);}}
      m.reg('EIP',request.returnAddress);return {blocked:true};
    }});
    m.replace(address,'D3DX.FilterTable',args=>{
      const key=args.slice(0,3).join(',')+','+m.reg('FPCW'),bytes=cache.get(key);
      if(bytes){cache.delete(key);cache.set(key,bytes);const pointer=host.alloc(bytes.length);m.write(pointer,bytes);return pointer;}
      const sp=m.reg('ESP');pending.set(sp+16,{key,returnAddress:m.u32(sp)});m.u32(sp,complete);m.reg('EIP',trampoline);return {blocked:true};
    },3);
  }
  // Filter-table construction calls floor tens of thousands of times. Keep
  // these tiny CRT operations inside x86 instead of crossing into JavaScript
  // and back for every number. Cdecl arguments and x87 ST0 returns are intact.
  for(const entry of library.image.imports){
    if(entry.dll!=='msvcrt.dll'||!['floor','ceil','fabs'].includes(entry.name))continue;
    const code=entry.name==='fabs'?[0xdd,0x44,0x24,4,0xd9,0xe1,0xc3]:[
      0x83,0xec,8,0xd9,0x3c,0x24,0x0f,0xb7,4,0x24,0x80,0xe4,0xf3,0x80,0xcc,entry.name==='floor'?4:8,
      0x66,0x89,0x44,0x24,2,0xd9,0x6c,0x24,2,0xdd,0x44,0x24,12,0xd9,0xfc,0xd9,0x2c,0x24,0x83,0xc4,8,0xc3,
    ],stub=m.allocate(code.length);m.cpu.mem_write(stub,code);m.u32(entry.address+library.base-library.image.base,stub);
  }
  // ARGB4444 is the original text atlas format. Preserve its conversion
  // exactly; gamma, color keys and dithering retain the original DLL path.
  {
    const levels=Float32Array.from({length:16},(_,n)=>n*m.f32(library.base+0x74b8));
    for(const [offset,name] of [[0xcc13f,'D3DX.ReadARGB4444'],[0xc66b2,'D3DX.WriteARGB4444']]){
      const address=library.base+offset,original=m.bytes(address,5),expected=[0x8b,0xff,0x55,0x8b,0xec];
      if(!original.every((byte,i)=>byte===expected[i]))throw new Error('Unexpected D3DX9_31 pixel conversion code');
      const trampoline=m.allocate(16),jump=new Uint8Array(5);jump[0]=0xe9;new DataView(jump.buffer).setInt32(1,address+5-(trampoline+5)-5,true);m.cpu.mem_write(trampoline,[...original,...jump]);
      m.replace(address,name,args=>{
        const object=m.reg('ECX'),width=m.u32(object+0x68),control=m.reg('FPCW'),fallback=()=>{m.reg('EIP',trampoline);return {blocked:true};};
        if(m.u32(object+4)!==26||m.u32(object+0x10))return fallback();
        const pointer=m.u32(object+0x20)+m.u32(object+0x60)*args[0]+m.u32(object+0x64)*args[1];
        if(offset===0xcc13f){
          if(m.u32(object+0x18)||(control&0xc00))return fallback();
          const source=m.view(pointer,width*2),out=m.view(args[2],width*16),input=new Uint16Array(source.buffer,source.byteOffset,width),output=new Float32Array(out.buffer,out.byteOffset,width*4);
          for(let i=0;i<width;i++){const n=input[i],p=i*4;output[p]=levels[n>>8&15];output[p+1]=levels[n>>4&15];output[p+2]=levels[n&15];output[p+3]=levels[n>>12];}
          return pointer+width*2;
        }
        if(m.u32(object+0x54)||m.u32(object+0x5c))return fallback();
        const table=m.u32(object+0x34)+(((args[0]&3)*8)+(args[1]&3))*4;
        for(let i=0;i<4;i++)if(m.u32(table+i*4)!==0x3f000000)return fallback();
        const source=m.view(args[2],width*16),out=m.view(pointer,width*2),input=new Float32Array(source.buffer,source.byteOffset,width*4),output=new Uint16Array(out.buffer,out.byteOffset,width);
        for(const value of input)if(!Number.isFinite(value)||value< -1||value>1)return fallback();
        // With no diffusion and a 0.5 threshold, the original truncating
        // float32 stores cannot cross an integer quantization boundary.
        const quantize=value=>Math.max(0,Math.min(15,Math.trunc(value*15+0.5)));
        for(let i=0;i<width;i++){const p=i*4;output[i]=quantize(input[p+3])<<12|quantize(input[p])<<8|quantize(input[p+1])<<4|quantize(input[p+2]);}
        m.u32(object+0x7c,control);return control;
      },3);
    }
  }
  // Keep D3DX's original filter coefficients and accumulation order. Only
  // replace the arithmetic over the intermediate float rows, with the same
  // x87 precision and float32 stores. The last source column runs natively.
  {
    const address=library.base+0xd7132,original=m.bytes(address,6),expected=[0x8b,0x55,0xf4,0x83,0xc2,0x08];
    if(!original.every((byte,i)=>byte===expected[i]))throw new Error('Unexpected D3DX9_31 filter code');
    const trampoline=m.allocate(16),jump=new Uint8Array(5);jump[0]=0xe9;new DataView(jump.buffer).setInt32(1,address+6-(trampoline+6)-5,true);m.cpu.mem_write(trampoline,[...original,...jump]);
    m.replace(address,'D3DX.FilterRGBA',()=>{
      const control=m.reg('FPCW'),precision=control&0x300;
      if((control&0xc00)!==0||(precision!==0&&precision!==0x200)){m.reg('EIP',trampoline);return {blocked:true};}
      const bytes=m.view(0x10000,0x7ff0000),words=new Uint32Array(bytes.buffer,bytes.byteOffset,bytes.length/4),floats=new Float32Array(bytes.buffer,bytes.byteOffset,bytes.length/4),at=p=>(p-0x10000)>>>2;
      const bp=m.reg('EBP'),end=m.u32(bp-0x28),yFirst=m.u32(bp-0x2c),yEnd=m.u32(bp-0x10),rows=m.u32(bp-8),single=precision===0;
      let column=m.reg('EAX'),source=m.u32(bp-0xc);
      // Float textures with exceptional values use the original x87 path.
      const sourceWidth=m.u32(m.u32(m.reg('EBX'))+0x68),src=at(source);
      for(let i=src;i<src+sourceWidth*4;i++){const value=floats[i];if(!Number.isFinite(value)||(value!==0&&Math.abs(value)<1.1754943508222875e-38)){m.reg('EIP',trampoline);return {blocked:true};}}
      while(column<end){
        const next=column+words[at(column)];if(next>=end)break;
        const input=at(source),r=floats[input],g=floats[input+1],b=floats[input+2],a=floats[input+3];
        for(let y=yFirst;y<yEnd;y+=8){
          const yi=at(y),destination=at(words[at(rows+words[yi]*12)]),wy=floats[yi+1];
          for(let x=column+4;x<next;x+=8){
            const xi=at(x),p=destination+words[xi]*4,weight=single?Math.fround(floats[xi+1]*wy):floats[xi+1]*wy;
            if(single){floats[p]=Math.fround(weight*r)+floats[p];floats[p+1]=Math.fround(weight*g)+floats[p+1];floats[p+2]=Math.fround(weight*b)+floats[p+2];floats[p+3]=Math.fround(weight*a)+floats[p+3];}
            else{floats[p]=weight*r+floats[p];floats[p+1]=weight*g+floats[p+1];floats[p+2]=weight*b+floats[p+2];floats[p+3]=weight*a+floats[p+3];}
          }
        }
        column=next;source+=16;
      }
      m.reg('EAX',column);m.reg('EDX',source+8);m.reg('EIP',address+6);return {blocked:true};
    });
  }
  for(const [offset,lower] of [[0xd7222,[-1,-1,-1,-1]],[0xd72ea,[-1,-1,-1,0]],[0xd73ae,[0,0,0,0]]]){
    const address=library.base+offset,original=m.bytes(address,7);
    const expected=offset===0xd73ae?[0x8b,0x06,0xd9,0xee,0x8d,0x0c,0x10]:[0x8b,0x06,0xd9,0xc1,0x8d,0x0c,0x10];
    if(!original.every((byte,i)=>byte===expected[i]))throw new Error('Unexpected D3DX9_31 resampler code');
    const trampoline=m.allocate(16),jump=new Uint8Array(5);jump[0]=0xe9;new DataView(jump.buffer).setInt32(1,address+7-(trampoline+7)-5,true);
    m.cpu.mem_write(trampoline,[...original,...jump]);
    m.replace(address,'D3DX.ClampRGBA',()=>{
      const width=m.u32(m.u32(m.reg('EBX')+4)+0x68),first=m.reg('EDI'),data=m.u32(m.reg('ESI'));
      const bytes=m.view(data,width*16),values=new Float32Array(bytes.buffer,bytes.byteOffset,bytes.byteLength/4);
      // Exceptional floats need the original x87 exception handling.
      let ordinary=true;for(let i=first*4;i<(width-1)*4;i++){const v=values[i];if(!Number.isFinite(v)||(v!==0&&Math.abs(v)<1.1754943508222875e-38)){ordinary=false;break;}}
      if(ordinary){for(let i=first*4;i<(width-1)*4;i++){const value=values[i],min=lower[i&3];values[i]=value<min?min:value<1?value:1;}m.reg('EDI',width-1);m.reg('EDX',(width-1)*16);}
      m.reg('EIP',trampoline);return {blocked:true};
    });
  }
}

// Prime the text-only conversion paths during initial loading, using scratch
// surfaces on the device the game just created. No draw, Present, game tick,
// input or save operation is performed. Restore the suspended CPU context.
export async function warmD3DXText(host,library){
  const m=host.m,context=m.cpu.context_alloc();m.cpu.context_save(context);
  const originalStack=m.stack,scratchStack=host.alloc(0x20000),source=host.alloc(1024*36*2),srcRect=host.alloc(16),dstRect=host.alloc(16),edge=host.alloc(0x124),surface=host.d3d.surface(512,36,26);
  m.stack=scratchStack+0x20000-16;m.resetThreadFPU();
  const bytes=m.view(source,1024*36*2),pixels=new Uint16Array(bytes.buffer,bytes.byteOffset,bytes.byteLength/2);
  for(let i=0;i<pixels.length;i++)pixels[i]=i%7<3?0:0xf000|(i&0xfff);
  m.u32(edge+0x100,26);m.u32(edge+0x104,1024);m.u32(edge+0x108,36);m.u32(edge+0x110,2048);m.u32(edge+0x120,source);
  try{
    m.call(0x436da0,{args:[edge,36],limit:100000000});
    for(const control of [0x3f,0x27f])for(let pass=0;pass<2;pass++)for(const [width,destWidth,height] of [[1024,512,18],[1024,512,17],[730,354,17]]){
      m.reg('FPCW',control);m.write(srcRect,new Uint8Array(new Int32Array([0,0,width,36]).buffer));m.write(dstRect,new Uint8Array(new Int32Array([0,0,destWidth,height]).buffer));
      const result=m.call(library.exports.get('D3DXLoadSurfaceFromMemory'),{args:[surface.address,0,dstRect,source,26,2048,0,srcRect,4,0],limit:100000000});
      if(result!==0)throw new Error('Text preparation failed: '+result.toString(16));
      // Let v86 finish compiling the paths before gameplay starts.
      await new Promise(resolve=>setTimeout(resolve,0));
    }
  }finally{host.d3d.com.release(surface);for(const p of [scratchStack,source,srcRect,dstRect,edge])host.free(p);m.stack=originalStack;m.cpu.context_restore(context);m.cpu.context_free(context);}
}
