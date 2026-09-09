import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {JitMachine} from '../runtime/jit-machine.mjs';
import {Win32Host} from '../runtime/win32.mjs';
import {loadLibrary} from '../runtime/library.mjs';
import {installD3DXFastPaths,warmD3DXText} from '../runtime/d3dx-fast.mjs';

async function converter(fast){
  const m=await JitMachine.create(readFileSync('../[th10] 东方风神录 (汉化版+日文版)/th10.exe')),host=new Win32Host(m);
  const library=loadLibrary(m,readFileSync('reference/native/d3dx9_31.dll'),0x1000000,'d3dx9_31.dll');
  m.call(library.entry,{args:[library.base,1,0]});if(fast)installD3DXFastPaths(m,library,host);
  const params=m.allocate(64);m.u32(params,640);m.u32(params+4,480);m.u32(params+8,22);host.d3d.createDevice(params);
  return {m,host,library,convert(c){
    const [w,h,dw,dh]=c.shape,bpp=c.format===26?2:4,pitch=(w+4)*bpp,bytes=new Uint8Array(pitch*(h+4));let seed=919;
    for(let i=0;i<bytes.length;i++){seed=(Math.imul(seed,1664525)+1013904223)>>>0;bytes[i]=c.sparse&&i%40<24?0:seed>>>24;}
    const src=m.allocate(bytes.length),sr=m.allocate(16),dr=m.allocate(16),dst=host.d3d.surface(dw+7,dh+5,c.format);
    m.write(src,bytes);m.write(sr,new Uint8Array(new Int32Array([2,2,w+2,h+2]).buffer));m.write(dr,new Uint8Array(new Int32Array([3,1,dw+3,dh+1]).buffer));m.view(dst.data,dst.size).fill(0xa7);m.reg('FPCW',c.fpcw??0x3f);
    const status=m.call(library.exports.get('D3DXLoadSurfaceFromMemory'),{args:[dst.address,0,dr,src,c.format,pitch,0,sr,c.filter,c.colorKey??0],limit:1e9});
    assert.equal(status,0);assert.equal(m.reg('ESP'),m.stack);return m.bytes(dst.data,dst.size);
  }};
}

test('D3DX float row acceleration preserves original DLL resampling, including text atlas sizes',async()=>{
  const reference=await converter(false),fast=await converter(true);
  const cases=[
    {shape:[730,36,354,17],format:26,filter:4,sparse:true},
    {shape:[1024,36,512,18],format:26,filter:4,sparse:true},
    {shape:[38,36,17,17],format:26,filter:4},
    {shape:[13,7,29,19],format:26,filter:4},
    {shape:[1,7,1,11],format:26,filter:4},
    {shape:[47,19,21,8],format:21,filter:4},
    {shape:[31,21,17,9],format:26,filter:0x80004},
    {shape:[38,36,19,18],format:26,filter:5},
    {shape:[38,36,23,21],format:21,filter:3},
    {shape:[38,36,38,36],format:26,filter:1},
    {shape:[38,36,17,17],format:26,filter:4,colorKey:0xff000000},
    {shape:[38,36,17,17],format:26,filter:4,fpcw:0x27f},
    {shape:[38,36,17,17],format:26,filter:4,fpcw:0x37f},
  ];
  try{for(const c of cases){const expected=reference.convert(c);for(let repeat=0;repeat<2;repeat++){const actual=fast.convert(c);assert.ok(Buffer.from(actual).equals(Buffer.from(expected)),JSON.stringify({...c,repeat}));}}assert.ok(fast.host.calls.get('D3DX.ClampRGBA')>0,'The accelerated clamp must actually execute');assert.ok(fast.host.calls.get('D3DX.FilterRGBA')>0,'The accelerated filter must actually execute');assert.ok(fast.host.calls.get('D3DX.ReadARGB4444')>0);assert.ok(fast.host.calls.get('D3DX.WriteARGB4444')>0);assert.ok(fast.host.calls.get('D3DX.FilterTable')>fast.host.calls.get('D3DX.FilterTableReady'),'Repeated dimensions must use cached original tables');}
  finally{reference.m.close();fast.m.close();}
});

test('in-guest CRT math preserves double results, cdecl stack and caller rounding mode',async()=>{
  const {m,library}=await converter(true);
  try{for(const name of ['floor','ceil','fabs']){
    const entry=library.image.imports.find(e=>e.name===name);if(!entry)continue;
    const address=m.u32(entry.address+library.base-library.image.base),code=m.allocate(64),out=code+48,relative=new Uint8Array(4);
    new DataView(relative.buffer).setInt32(0,address-(code+8)-5,true);
    m.cpu.mem_write(code,[0xff,0x74,0x24,8,0xff,0x74,0x24,8,0xe8,...relative,0x83,0xc4,8,0xdd,0x1d,...new Uint8Array(new Uint32Array([out]).buffer),0xc2,8,0]);
    for(const control of [0x3f,0x27f,0x37f,0x73f,0xb3f,0xf3f])for(const value of [-Infinity,-1e300,-9007199254740991,-123.456,-1,-.25,-Number.MIN_VALUE,-0,0,Number.MIN_VALUE,.9999,3.14159,9007199254740991,1e300,Infinity,NaN]){
      const bits=new DataView(new ArrayBuffer(8));bits.setFloat64(0,value,true);m.reg('FPCW',control);
      m.call(code,{args:[bits.getUint32(0,true),bits.getUint32(4,true)]});const actual=new DataView(m.bytes(out,8).buffer).getFloat64(0,true),expected=(name==='fabs'?Math.abs:Math[name])(value);
      assert.ok(Object.is(actual,expected),`${name}(${value}) at ${control.toString(16)}: ${actual}`);assert.equal(m.reg('ESP'),m.stack);assert.equal(m.reg('FPCW'),control);
    }
  }}finally{m.close();}
});

test('text preparation preserves the suspended game CPU, active stack and game clock',async()=>{
  const {m,host,library}=await converter(true);
  try{
    const stack=m.stack,guard=m.view(stack-8192,8192);for(let i=0;i<guard.length;i++)guard[i]=(i*17+41)&255;const expectedStack=guard.slice();
    const before=m.cpu.context_alloc();m.cpu.context_save(before);const clock=host.millis,objects=host.d3d.com.objects.size;
    await warmD3DXText(host,library);const after=m.cpu.context_alloc();m.cpu.context_save(after);
    for(const name of Object.keys(before))assert.deepEqual(after[name],before[name],name);
    assert.ok(Buffer.from(m.bytes(stack-8192,8192)).equals(Buffer.from(expectedStack)),'The suspended game stack must not be overwritten');assert.equal(m.stack,stack);assert.equal(host.millis,clock);assert.equal(host.d3d.com.objects.size,objects);assert.equal(host.overlay.size,0);
  }finally{m.close();}
});

test('ARGB4444 quantization matches the original DLL on both sides of every rounding boundary',async()=>{
  const reference=await converter(false),fast=await converter(true),values=[-1,-0,0,1],bits=new DataView(new ArrayBuffer(4));
  for(let n=0;n<15;n++){bits.setFloat32(0,(n+0.5)/15,true);const center=bits.getUint32(0,true);for(const delta of [-1,0,1]){bits.setUint32(0,center+delta,true);values.push(bits.getFloat32(0,true));}}
  const run=({m,host,library},control,row)=>{
    const width=values.length,object=host.alloc(128),table=host.alloc(128),source=host.alloc(width*16),destination=host.alloc(width*4);m.view(object,128).fill(0);
    for(let i=0;i<32;i++)m.f32(table+i*4,.5);m.u32(object+4,26);m.u32(object+0x20,destination);m.u32(object+0x34,table);m.u32(object+0x60,width*2);m.u32(object+0x68,width);
    for(let i=0;i<width;i++)for(let channel=0;channel<4;channel++)m.f32(source+i*16+channel*4,values[(i+channel)%width]);m.reg('FPCW',control);
    m.call(library.base+0xc66b2,{ecx:object,args:[row,0,source]});assert.equal(m.reg('FPCW'),control);return m.bytes(destination+row*width*2,width*2);
  };
  try{for(const control of [0x3f,0x27f,0x37f,0x73f,0xb3f,0xf3f])for(const row of [0,1])assert.ok(Buffer.from(run(reference,control,row)).equals(Buffer.from(run(fast,control,row))),`${control.toString(16)}/${row}`);}
  finally{reference.m.close();fast.m.close();}
});
