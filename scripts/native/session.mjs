import {readFileSync,openSync,readSync,fstatSync,closeSync} from 'node:fs';
import {JitMachine} from '../../runtime/jit-machine.mjs';
import {Win32Host} from '../../runtime/win32.mjs';
import {Scheduler} from '../../runtime/scheduler.mjs';
import {loadLibrary} from '../../runtime/library.mjs';
import {installGDI} from '../../runtime/gdi.mjs';
import {WindowsFonts} from './windows-fonts.mjs';
import {installLzss} from '../../runtime/lzss.mjs';
import {installD3DXFastPaths} from '../../runtime/d3dx-fast.mjs';
import {installTextureEdges} from '../../runtime/texture-edges.mjs';
export async function createSession({language='jp',unlocked=false}={}){
  const trace=message=>{if(process.env.TRACE_PROBE)console.log('INIT',message);};trace(language);
  const original=new URL('../../../[th10] 东方风神录 (汉化版+日文版)/',import.meta.url),program=language==='chs'?'th10chs.exe':'th10.exe',archive=language==='chs'?'th10c.dat':'th10.dat';
  const files=new Map([program,archive].map(name=>[name,readFileSync(new URL(name,original))]));
  const fd=openSync(new URL('thbgm.dat',original),'r'),length=fstatSync(fd).size;files.set('thbgm.dat',{length,subarray(start,end){const bytes=Buffer.alloc(Math.max(0,Math.min(end,length)-start));readSync(fd,bytes,0,bytes.length,start);return bytes;}});
  trace('files loaded');const m=await JitMachine.create(files.get(program)),host=new Win32Host(m,files,{language,program,epochMs:1788840000000,timezoneMinutes:-480});trace('machine created');
  if(unlocked){const name=language==='chs'?'scoreth10c.dat':'scoreth10.dat';host.overlay.set(name,readFileSync(new URL('全开档/'+name,original)));}
  trace('save loaded');const library=loadLibrary(m,readFileSync(new URL('../../reference/native/d3dx9_31.dll',import.meta.url)),0x1000000,'d3dx9_31.dll'),fonts=new WindowsFonts();installGDI(host,fonts);installLzss(host);installD3DXFastPaths(m,library,host);installTextureEdges(host);trace('dll loaded');m.call(library.entry,{args:[library.base,1,0]});trace('dll initialized');const scheduler=new Scheduler(m,host);
  if(process.env.AUDIT_TITLE){let address,valid=false,last,history=[];const alloc=host.alloc.bind(host);host.alloc=size=>{const p=alloc(size);if(size===6389204){address=p+0x13244;console.log('TITLE_ALLOC',p.toString(16));}return p;};m.onImport=entry=>{const sp=m.reg('ESP'),call={name:entry.name,pc:m.u32(sp).toString(16),args:m.readWords(sp+4,8).map(x=>x.toString(16)),thread:host.currentThreadId};history.push(call);if(history.length>20)history.shift();if(address){const value=m.u32(address);if(value===0xc0003)valid=true;if(valid&&value!==0xc0003){console.log('TITLE_CORRUPT',value.toString(16),history);throw new Error('Title script overwritten');}last=value;}host.invoke(entry);};}
  const session={m,host,scheduler,fonts,steps:0,screen(){return {frame:host.d3d.frames,stage:m.u32(0x474c7c),character:m.u32(0x474c68),shot:m.u32(0x474c6c),difficulty:m.u32(0x474c74),lives:m.i32(0x474c70),power:m.i32(0x474c48),flags:m.u32(0x474ca0),heap:m.heap,player:m.u32(0x477834)};},
    frames(count,before){const target=host.d3d.frames+count;let previous=-1,stalled=0;while(host.d3d.frames<target&&host.exitCode===undefined){if(host.d3d.frames!==previous){previous=host.d3d.frames;stalled=0;before?.(session);}scheduler.step(500000);if(++stalled>600)throw new Error('No Present for 300 million guest instructions');if(process.env.TRACE_PROBE&&session.steps%1000===0)console.log('STEP',session.steps,m.reg('EIP').toString(16),session.screen(),[...host.calls].slice(-8),scheduler.threads.map(t=>({id:t.id,wait:t.wait,done:t.done,ready:t.ready,pc:t.context.instruction_pointer[0].toString(16)})));if(++session.steps>5e6)throw new Error('Probe step budget exceeded');}if(host.exitCode!==undefined)throw new Error('Original program exited '+host.exitCode);return session.screen();},
    async framesAsync(count,before){for(let remaining=count;remaining>0;remaining-=60){session.frames(Math.min(60,remaining),before);await new Promise(resolve=>setImmediate(resolve));}return session.screen();},
    key(code,count=45){host.input.keys.add(code);session.frames(3);host.input.keys.delete(code);return session.frames(count-3);},
    close(){fonts.close();scheduler.close();m.close();closeSync(fd);}};
  return session;
}
