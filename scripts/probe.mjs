import {readFileSync,writeFileSync} from 'node:fs';
import {JitMachine} from '../runtime/jit-machine.mjs';
import {Win32Host} from '../runtime/win32.mjs';
import {Scheduler} from '../runtime/scheduler.mjs';
import {loadLibrary} from '../runtime/library.mjs';
import {installGDI} from '../runtime/gdi.mjs';
import {WindowsFonts} from './native/windows-fonts.mjs';
const original=new URL('../../[th10] 东方风神录 (汉化版+日文版)/',import.meta.url);
const files=new Map(['th10.exe','th10.dat','thbgm.dat'].map(name=>[name,readFileSync(new URL(name,original))]));
const machine=await JitMachine.create(files.get('th10.exe'));
const host=new Win32Host(machine,files),library=loadLibrary(machine,readFileSync('reference/native/d3dx9_31.dll'),0x1000000,'d3dx9_31.dll');
const fonts=new WindowsFonts();installGDI(host,fonts);
machine.call(library.entry,{args:[library.base,1,0]});
const scheduler=new Scheduler(machine,host);
let draws=0;host.d3d.onDraw=()=>draws++;host.d3d.onClear=()=>{};
try{for(let step=0;step<20000&&host.exitCode===undefined;step++){
  scheduler.step(500000);
  if(step%100===0)console.log('PROBE',JSON.stringify({step,pc:machine.reg('EIP').toString(16),frame:host.d3d.frames,draws,time:host.millis,heap:machine.heap,calls:[...host.calls].slice(-8)}));
  if(host.d3d.frames>=600)break;
}console.log('EXIT',host.exitCode);}catch(error){console.error(error.stack);console.log('STATE',JSON.stringify({pc:machine.reg('EIP').toString(16),sp:machine.reg('ESP').toString(16),stack:machine.readWords(machine.reg('ESP'),20).map(x=>x.toString(16)),log:host.log.map(x=>({...x,data:undefined})),calls:[...host.calls].slice(-20)}));process.exitCode=1;}finally{writeFileSync('artifacts/probe-calls.json',JSON.stringify([...host.calls],null,2));writeFileSync('artifacts/probe-fonts.json',JSON.stringify([...fonts.fonts.values()],null,2));writeFileSync('artifacts/probe-text.json',JSON.stringify([...fonts.text],null,2));fonts.close();scheduler.close();machine.close();}
