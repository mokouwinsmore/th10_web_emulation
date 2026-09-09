import {hex} from './machine.mjs';
import {decode932,encode932,decode936,encode936,characterType} from './encoding.mjs';
import {Direct3D9} from './d3d9.mjs';
import {DirectInput8} from './input.mjs';
import {DirectSound8} from './dsound.mjs';
import {installMidi} from './midi.mjs';

export class Win32Host {
  constructor(machine,files=new Map(),{epochMs=Date.now(),timezoneMinutes=new Date(epochMs).getTimezoneOffset(),language='jp',program=language==='chs'?'th10chs.exe':'th10.exe'}={}){
    this.m=machine;this.files=files;this.handles=new Map();this.nextHandle=0x200;this.allocations=new Map();this.freeBlocks=[];this.calls=new Map();this.error=0;this.tls=new Map();this.nextTLS=0;this.currentThreadId=1;this.millis=1000;this.pendingThreads=[];this.messages=[];this.critical=new Map();this.log=[];
    this.epochMs=epochMs;this.timezoneMinutes=timezoneMinutes;this.language=language;this.program=program;this.codepage=language==='chs'?936:932;
    machine.onImport=entry=>this.invoke(entry);this.d3d=new Direct3D9(this);this.input=new DirectInput8(this);this.sound=new DirectSound8(this);
    this.overlay=new Map();this.cwd='';this.directories=new Set(['']);
    installMidi(this);
  }
  alloc(size){size=Math.max(16,(size+15)&~15);const index=this.freeBlocks.findIndex(b=>b.size>=size);let p;if(index>=0){const b=this.freeBlocks[index];p=b.p;b.p+=size;b.size-=size;if(!b.size)this.freeBlocks.splice(index,1);}else p=this.m.allocate(size);this.allocations.set(p,size);return p;}
  free(p){const size=this.allocations.get(p);if(!size)return;this.allocations.delete(p);this.freeBlocks.push({p,size});this.freeBlocks.sort((a,b)=>a.p-b.p);for(let i=this.freeBlocks.length-2;i>=0;i--){const a=this.freeBlocks[i],b=this.freeBlocks[i+1];if(a.p+a.size===b.p){a.size+=b.size;this.freeBlocks.splice(i+1,1);}}}
  handle(value){const h=this.nextHandle++;this.handles.set(h,value);return h;}
  decode(bytes,codepage=this.codepage){return (codepage===936?decode936:decode932)(bytes);}
  encode(text,codepage=this.codepage){return (codepage===936?encode936:encode932)(text);}
  text(p){if(!p)return '';const b=this.m.bytes(p,4096),n=b.indexOf(0);return this.decode(b.subarray(0,n<0?4096:n));}
  putText(p,text,capacity=4096){const b=this.encode(text);if(p&&capacity)this.m.write(p,[...b.subarray(0,capacity-1),0]);return b.length;}
  makeText(text){const p=this.alloc(text.length*4+8);this.putText(p,text);return p;}
  path(name){name=name.replaceAll('\\','/').toLowerCase();const absolute=/^(?:c:\/th10\/?|\/)/.test(name);name=name.replace(/^c:\/th10\/?/,'').replace(/^\//,'');const parts=(absolute?[]:this.cwd.split('/').filter(Boolean));for(const p of name.split('/'))if(p==='..')parts.pop();else if(p&&p!=='.')parts.push(p);return parts.join('/');}
  file(name){return this.overlay.has(name)?this.overlay.get(name):this.files.get(name);}
  save(name,data,persist=true){this.overlay.set(name,data);if(persist)this.onSave?.(name,data);}
  flushFile(handle){const file=this.handles.get(handle);if(file?.dirty){this.onSave?.(file.name,file.data);file.dirty=false;}return 1;}
  closeHandle(handle){const value=this.handles.get(handle);if(!value){this.error=6;return 0;}this.flushFile(handle);if(value.kind==='thread'&&!value.done)value.closed=true;else this.handles.delete(handle);return 1;}
  focus(active){this.foreground=active;if(!active)this.input.keys.clear();this.messages.push([1,0x1c,active?1:0,0]);}
  findData(out,name){const m=this.m,short=name.slice(name.lastIndexOf('/')+1),directory=this.directories.has(name),size=directory?0:this.file(name)?.length??0;m.view(out,320).fill(0);m.u32(out,directory?16:32);m.u32(out+32,size);this.putText(out+44,short,260);}
  findFirst(pattern,out){const slash=pattern.lastIndexOf('/'),base=pattern.slice(0,slash+1),name=pattern.slice(slash+1),expression=new RegExp('^'+(name==='*.*'?'*':name).replace(/[.+^${}()|[\]\\]/g,'\\$&').replaceAll('*','.*').replaceAll('?','.')+'$','i'),names=new Set([...this.files.keys(),...this.overlay.keys(),...this.directories]),found=[...names].filter(n=>n.startsWith(base)&&!n.slice(base.length).includes('/')&&expression.test(n.slice(base.length))&&(this.directories.has(n)||this.file(n))).sort();if(!found.length){this.error=2;return 0xffffffff;}this.findData(out,found[0]);return this.handle({kind:'find',names:found,index:1});}
  invoke(entry){
    const m=this.m,sp=m.reg('ESP'),name=entry.name,func=entry.handler?[entry.argc??0,entry.handler]:this.api[name],args=m.readWords(sp+4,entry.dll==='native-host'?16:func?.[0]??16);
    this.calls.set(name,(this.calls.get(name)??0)+1);
    if(!func)throw new Error('Unimplemented '+entry.dll+'!'+name+' at '+hex(m.u32(sp))+' args='+args.slice(0,8).map(hex).join(','));
    const [argc,handler]=func,value=handler.call(this,args);if(value?.blocked)return;m.ret(value?.fp64!==undefined?0:value??0,entry.dll.toLowerCase()==='msvcrt.dll'?0:argc);
    if(value?.fp64!==undefined){if(!this.fpReturn){this.fpReturn=this.alloc(16);m.cpu.mem_write(this.fpReturn,[0xdd,0x44,0x24,4,0xc2,8,0]);}const sp=m.reg('ESP')-12;m.u32(sp,m.reg('EIP'));const bits=new Uint8Array(8);new DataView(bits.buffer).setFloat64(0,value.fp64,true);m.write(sp+4,bits);m.reg('ESP',sp);m.reg('EIP',this.fpReturn);}
    if(this.callGuest){const request=this.callGuest,calls=request.calls??[request];this.callGuest=null;let sp=m.reg('ESP'),next=m.reg('EIP');if(request.returnValue!==undefined){sp-=4;m.u32(sp,next);this.callbackReturns??=new Map();if(!this.callbackReturns.has(request.returnValue))this.callbackReturns.set(request.returnValue,m.registerImport({dll:'native-host',name:'callback.complete',argc:0,handler:()=>request.returnValue}));next=this.callbackReturns.get(request.returnValue);}for(let i=calls.length-1;i>=0;i--){const call=calls[i];for(let j=call.args.length-1;j>=0;j--){sp-=4;m.u32(sp,call.args[j]);}sp-=4;m.u32(sp,next);next=call.address;}m.reg('ESP',sp);m.reg('EIP',next);}
  }
  api={
    DialogBoxParamA:[5,()=>7], // IDNO: use the original windowed path; HTML owns fullscreen.
    FindWindowA:[2,()=>0],SetForegroundWindow:[1,()=>1],
    SendMessageA:[4,a=>{if(this.windowProc)this.callGuest={address:this.windowProc,args:a};return 0;}],
    DisableThreadLibraryCalls:[1,()=>1],
    ExitThread:[1,a=>{const thread=this.handles.get(this.currentThreadId);if(thread){thread.done=true;thread.exitCode=a[0];}this.m.reg('EIP',this.m.returnAddress);this.m.cpu.emu_stop();return {blocked:true};}],
    ResumeThread:[1,a=>{const thread=this.handles.get(a[0]);if(!thread)return 0xffffffff;const before=thread.suspended?1:0;thread.suspended=false;return before;}],
    malloc:[1,a=>this.alloc(a[0])],calloc:[2,a=>{const p=this.alloc(a[0]*a[1]);this.m.view(p,a[0]*a[1]).fill(0);return p;}],free:[1,a=>{this.free(a[0]);}],
    realloc:[2,a=>{const p=this.alloc(a[1]),size=Math.min(a[1],this.allocations.get(a[0])??0);if(size)this.m.write(p,this.m.bytes(a[0],size));this.free(a[0]);return p;}],
    '??2@YAPAXI@Z':[1,a=>this.alloc(a[0])],'??3@YAXPAX@Z':[1,a=>{this.free(a[0]);}],
    _initterm:[2,a=>{const calls=[];for(let p=a[0];p<a[1];p+=4){const address=this.m.u32(p);if(address)calls.push({address,args:[]});}if(calls.length)this.callGuest={calls};return 0;}],
    _onexit:[1,a=>a[0]],__dllonexit:[3,a=>a[0]],srand:[1,()=>{}],
    memmove:[3,a=>{this.m.write(a[0],this.m.bytes(a[1],a[2]));return a[0];}],
    floor:[2,()=>({fp64:Math.floor(new DataView(this.m.bytes(this.m.reg('ESP')+4,8).buffer).getFloat64(0,true))})],
    ceil:[2,()=>({fp64:Math.ceil(new DataView(this.m.bytes(this.m.reg('ESP')+4,8).buffer).getFloat64(0,true))})],
    fabs:[2,()=>({fp64:Math.abs(new DataView(this.m.bytes(this.m.reg('ESP')+4,8).buffer).getFloat64(0,true))})],
    InterlockedExchange:[2,a=>{const old=this.m.u32(a[0]);this.m.u32(a[0],a[1]);return old;}],
    InterlockedCompareExchange:[3,a=>{const old=this.m.u32(a[0]);if(old===a[2])this.m.u32(a[0],a[1]);return old;}],
    InterlockedIncrement:[1,a=>{const v=this.m.u32(a[0])+1;this.m.u32(a[0],v);return v;}],InterlockedDecrement:[1,a=>{const v=this.m.u32(a[0])-1;this.m.u32(a[0],v);return v;}],
    Direct3DCreate9:[1,()=>this.d3d.create()],
    DirectInput8Create:[5,a=>{this.m.u32(a[3],this.input.create());return 0;}],
    '#11':[3,a=>{this.m.u32(a[1],this.sound.create());return 0;}],
    GetKeyboardState:[1,a=>{this.m.write(a[0],this.input.keyboard());return 1;}],SetKeyboardState:[1,()=>1],joyGetPosEx:[2,a=>this.input.joyPosition(a)],joyGetDevCapsA:[3,a=>this.input.joyCaps(a)],
    SetTimer:[4,a=>this.handle({kind:'timer',window:a[0],id:a[1],interval:a[2],callback:a[3],last:this.millis})],KillTimer:[2,()=>1],
    timeSetEvent:[5,a=>this.handle({kind:'multimedia-timer',interval:a[0],callback:a[2],parameter:a[3],flags:a[4],last:this.millis})],timeKillEvent:[1,a=>{this.handles.delete(a[0]);return 0;}],
    GetVersion:[0,()=>0x0a280105],GetVersionExA:[1,a=>{const m=this.m;[5,1,2600,2].forEach((v,i)=>m.u32(a[0]+4+i*4,v));return 1;}],
    GetModuleHandleA:[1,()=>0x400000],GetModuleFileNameA:[3,a=>this.putText(a[1],'C:\\th10\\'+this.program,a[2])],
    GetCommandLineA:[0,()=>this.commandLine??=this.makeText('"C:\\th10\\'+this.program+'"')],
    GetStartupInfoA:[1,a=>{this.m.u32(a[0],68);return 0;}],GetStdHandle:[1,a=>a[0]],SetStdHandle:[2,()=>1],GetFileType:[1,()=>2],SetHandleCount:[1,a=>a[0]],
    GetCurrentProcessId:[0,()=>1],GetCurrentThreadId:[0,()=>this.currentThreadId],GetCurrentProcess:[0,()=>0xffffffff],GetProcessHeap:[0,()=>1],
    HeapCreate:[3,()=>1],HeapDestroy:[1,()=>1],HeapAlloc:[3,a=>{const p=this.alloc(a[2]);if(a[1]&8)this.m.view(p,a[2]).fill(0);return p;}],HeapFree:[3,a=>{this.free(a[2]);return 1;}],HeapSize:[3,a=>this.allocations.get(a[2])??0],
    HeapReAlloc:[4,a=>{const p=this.alloc(a[3]),size=Math.min(a[3],this.allocations.get(a[2])??0);if(size)this.m.write(p,this.m.bytes(a[2],size));this.free(a[2]);return p;}],
    VirtualAlloc:[4,a=>{const p=this.alloc(a[1]);this.m.view(p,a[1]).fill(0);return p;}],VirtualFree:[3,a=>{this.free(a[0]);return 1;}],GlobalAlloc:[2,a=>{const p=this.alloc(a[1]);if(a[0]&0x40)this.m.view(p,a[1]).fill(0);return p;}],GlobalFree:[1,a=>{this.free(a[0]);return 0;}],LocalFree:[1,a=>{this.free(a[0]);return 0;}],
    InitializeCriticalSection:[1,a=>{this.critical.set(a[0],{owner:0,count:0});}],EnterCriticalSection:[1,a=>{const lock=this.critical.get(a[0]);if(!lock)throw new Error('Uninitialized critical section '+hex(a[0]));if(lock.owner&&lock.owner!==this.currentThreadId){this.waitLock=a[0];this.m.cpu.emu_stop();return {blocked:true};}lock.owner=this.currentThreadId;lock.count++;}],LeaveCriticalSection:[1,a=>{const lock=this.critical.get(a[0]);if(!lock||lock.owner!==this.currentThreadId)throw new Error('Critical section owner mismatch');if(!--lock.count)lock.owner=0;}],DeleteCriticalSection:[1,a=>{this.critical.delete(a[0]);}],
    TlsAlloc:[0,()=>this.nextTLS++],TlsSetValue:[2,a=>{this.tls.set(this.currentThreadId+':'+a[0],a[1]);return 1;}],TlsGetValue:[1,a=>this.tls.get(this.currentThreadId+':'+a[0])??0],TlsFree:[1,()=>1],
    GetLastError:[0,()=>this.error],SetLastError:[1,a=>{this.error=a[0];}],IsBadReadPtr:[2,()=>0],IsBadWritePtr:[2,()=>0],IsBadCodePtr:[1,()=>0],
    FormatMessageA:[7,a=>{const text='Windows error '+a[2]+'\r\n';if(a[0]&0x100)this.m.u32(a[4],this.makeText(text));else this.putText(a[4],text,a[5]);return text.length;}],
    SetUnhandledExceptionFilter:[1,a=>{const before=this.exceptionFilter??0;this.exceptionFilter=a[0];return before;}],
    GetACP:[0,()=>this.codepage],GetOEMCP:[0,()=>this.codepage],SetEnvironmentVariableA:[2,()=>1],
    GetEnvironmentStringsW:[0,()=>{const p=this.alloc(4);return p;}],GetEnvironmentStrings:[0,()=>this.makeText('')],FreeEnvironmentStringsW:[1,()=>1],FreeEnvironmentStringsA:[1,()=>1],
    GetCPInfo:[2,a=>{this.m.u32(a[1],2);this.m.write(a[1]+4,(a[0]||this.codepage)===936?[63,0,0x81,0xfe,0,0,0,0,0,0,0,0,0,0]:[63,0,0x81,0x9f,0xe0,0xfc,0,0,0,0,0,0,0,0]);return 1;}],
    GetLocaleInfoA:[4,a=>this.putText(a[2],a[1]===0x1004?String(this.codepage):this.codepage===936?'Chinese':'Japanese',a[3])+1],
    GetStringTypeW:[4,a=>{const bytes=this.m.bytes(a[1],a[2]*2),v=new DataView(bytes.buffer);for(let i=0;i<a[2];i++){const type=characterType(v.getUint16(i*2,true));this.m.write(a[3]+i*2,[type&255,type>>>8]);}return 1;}],
    GetStringTypeA:[5,a=>{const b=this.m.bytes(a[2],a[3]);for(let i=0;i<b.length;i++){const type=characterType(b[i]);this.m.write(a[4]+i*2,[type&255,type>>>8]);}return 1;}],
    WideCharToMultiByte:[8,a=>{let count=a[3];if(count===0xffffffff){count=0;while(this.m.bytes(a[2]+count*2,2).some(x=>x))count++;count++;}const text=new TextDecoder('utf-16le').decode(this.m.bytes(a[2],count*2)),bytes=this.encode(text,a[0]||this.codepage);if(a[4]&&a[5])this.m.write(a[4],bytes.subarray(0,a[5]));if(a[7])this.m.u32(a[7],0);return bytes.length;}],
    MultiByteToWideChar:[6,a=>{let count=a[3];if(count===0xffffffff){count=0;while(this.m.view(a[2]+count,1)[0])count++;count++;}const text=this.decode(this.m.bytes(a[2],count),a[0]||this.codepage),bytes=new Uint8Array(text.length*2),v=new DataView(bytes.buffer);for(let i=0;i<text.length;i++)v.setUint16(i*2,text.charCodeAt(i),true);if(a[4]&&a[5])this.m.write(a[4],bytes.subarray(0,a[5]*2));return text.length;}],
    LCMapStringW:[6,a=>{let text=new TextDecoder('utf-16le').decode(this.m.bytes(a[2],a[3]*2));text=a[1]&0x100?text.toLowerCase():a[1]&0x200?text.toUpperCase():text;if(a[4]&&a[5]){const b=new Uint8Array(Math.min(a[5],text.length)*2),v=new DataView(b.buffer);for(let i=0;i<b.length/2;i++)v.setUint16(i*2,text.charCodeAt(i),true);this.m.write(a[4],b);}return text.length;}],
    LCMapStringA:[6,a=>{let text=this.decode(this.m.bytes(a[2],a[3]));text=a[1]&0x100?text.toLowerCase():a[1]&0x200?text.toUpperCase():text;const b=this.encode(text);if(a[4]&&a[5])this.m.write(a[4],b.subarray(0,a[5]));return b.length;}],
    GetTickCount:[0,()=>Math.floor(this.millis)],timeGetTime:[0,()=>Math.floor(this.millis)],
    QueryPerformanceFrequency:[1,a=>{this.m.u32(a[0],1000000);this.m.u32(a[0]+4,0);return 1;}],
    QueryPerformanceCounter:[1,a=>{this.m.u32(a[0],Math.floor(this.millis*1000));this.m.u32(a[0]+4,0);return 1;}],
    GetSystemTimeAsFileTime:[1,a=>{const t=BigInt(this.epochMs+Math.floor(this.millis)-1000)*10000n+116444736000000000n;this.m.u32(a[0],Number(t&0xffffffffn));this.m.u32(a[0]+4,Number(t>>32n));}],
    GetTimeZoneInformation:[1,a=>{this.m.view(a[0],172).fill(0);this.m.i32(a[0],this.timezoneMinutes);return 0;}],
    Sleep:[1,a=>{this.sleepMs=Math.min(a[0],10000);this.yielded=true;this.m.cpu.emu_stop();}],
    IsProcessorFeaturePresent:[1,()=>0],GetConsoleTitleA:[2,a=>this.putText(a[0],'TH10',a[1])],
    GetSystemInfo:[1,a=>{const m=this.m;m.u32(a[0],0);m.u32(a[0]+4,4096);m.u32(a[0]+8,0x10000);m.u32(a[0]+12,0x7ffeffff);m.u32(a[0]+16,1);m.u32(a[0]+20,1);m.u32(a[0]+24,586);m.u32(a[0]+28,65536);}],
    CreateMutexA:[3,()=>this.handle({kind:'mutex'})],CreateEventA:[4,a=>this.handle({kind:'event',manual:!!a[1],signaled:!!a[2]})],CloseHandle:[1,a=>this.closeHandle(a[0])],SetEvent:[1,a=>{const e=this.handles.get(a[0]);if(e)e.signaled=true;return 1;}],ResetEvent:[1,a=>{const e=this.handles.get(a[0]);if(e)e.signaled=false;return 1;}],
    CreateThread:[6,a=>{const id=this.handle({kind:'thread',entry:a[2],parameter:a[3],suspended:!!(a[4]&4)});if(a[5])this.m.u32(a[5],id);this.pendingThreads.push({id,entry:a[2],parameter:a[3]});return id;}],
    WaitForSingleObject:[2,a=>{const t=this.handles.get(a[0]);if(!t||t.kind!=='thread'||t.done)return 0;if(!a[1])return 258;this.waitHandle=a[0];this.yielded=true;this.m.cpu.emu_stop();return {blocked:true};}],
    MsgWaitForMultipleObjects:[5,a=>{for(let i=0;i<a[0];i++){const e=this.handles.get(this.m.u32(a[1]+i*4));if(e?.signaled||e?.done){if(e&&!e.manual)e.signaled=false;return i;}}if(this.messages.some(msg=>(msg.thread??1)===this.currentThreadId))return a[0];if(!a[3])return 258;this.sleepMs=1;this.m.cpu.emu_stop();return {blocked:true};}],
    RegOpenKeyA:[3,()=>2],RegQueryValueExA:[6,()=>2],RegCloseKey:[1,()=>0],
    CoInitialize:[1,()=>0],CoUninitialize:[0,()=>0],
    timeBeginPeriod:[1,()=>0],timeEndPeriod:[1,()=>0],timeGetDevCaps:[2,a=>{this.m.u32(a[0],1);this.m.u32(a[0]+4,1000);return 0;}],
    MessageBoxA:[4,a=>{this.log.push({type:'message',text:this.text(a[1]),title:this.text(a[2])});throw new Error('Game message: '+this.text(a[1]));}],
    ExitProcess:[1,a=>{this.exitCode=a[0];this.m.cpu.emu_stop();}],
    TerminateProcess:[2,a=>{this.exitCode=a[1];this.m.cpu.emu_stop();return 1;}],
    LoadLibraryA:[1,a=>this.handle({kind:'module',name:this.text(a[0])})],
    GetProcAddress:[2,a=>{const dll=this.handles.get(a[0])?.name??'dynamic',name=a[1]<65536?'#'+a[1]:this.text(a[1]);if(!this.api[name])return 0;return this.m.registerImport({dll,name});}],
    CreateFileA:[7,a=>{const name=this.path(this.text(a[0]));let data=this.file(name);if(a[4]===1&&data){this.error=80;return 0xffffffff;}if((a[4]===3||a[4]===5)&&!data){this.error=2;return 0xffffffff;}if(a[4]===1||a[4]===2||(a[4]===4&&!data)||a[4]===5){data=new Uint8Array(0);this.save(name,data,false);}if(!data){this.error=2;return 0xffffffff;}return this.handle({kind:'file',name,data,position:0,writable:!!(a[1]&0x40000000),dirty:!!(a[1]&0x40000000)&&[1,2,4,5].includes(a[4])});}],
    GetFileSize:[2,a=>{const f=this.handles.get(a[0]);if(a[1])this.m.u32(a[1],0);return f?.data.length??0xffffffff;}],
    ReadFile:[5,a=>{const f=this.handles.get(a[0]);if(!f)return 0;const bytes=f.data.subarray(f.position,f.position+a[2]);this.m.write(a[1],bytes);f.position+=bytes.length;if(a[3])this.m.u32(a[3],bytes.length);return 1;}],
    SetFilePointer:[4,a=>{const f=this.handles.get(a[0]);if(!f)return 0xffffffff;const signed=a[1]|0;f.position=(a[3]===0?0:a[3]===1?f.position:f.data.length)+signed;return f.position;}],
    WriteFile:[5,a=>{const f=this.handles.get(a[0]);if(!f||!f.writable){this.error=5;return 0;}const data=new Uint8Array(Math.max(f.data.length,f.position+a[2]));data.set(f.data);data.set(this.m.view(a[1],a[2]),f.position);f.position+=a[2];f.data=data;f.dirty=true;this.save(f.name,data,false);if(a[3])this.m.u32(a[3],a[2]);this.log.push({type:'write',handle:a[0],name:f.name,data:this.m.bytes(a[1],Math.min(1024,a[2]))});return 1;}],
    FlushFileBuffers:[1,a=>this.flushFile(a[0])],GetCurrentDirectoryA:[2,a=>this.putText(a[1],'C:\\th10'+(this.cwd?'\\'+this.cwd.replaceAll('/','\\'):''),a[0])],SetCurrentDirectoryA:[1,a=>{const path=this.path(this.text(a[0]));if(!this.directories.has(path)){this.error=3;return 0;}this.cwd=path;return 1;}],
    CreateDirectoryA:[2,a=>{const name=this.path(this.text(a[0]));if(this.directories.has(name)){this.error=183;return 0;}this.directories.add(name);return 1;}],FindFirstFileA:[2,a=>this.findFirst(this.path(this.text(a[0])),a[1])],FindNextFileA:[2,a=>{const search=this.handles.get(a[0]);if(!search||search.index>=search.names.length){this.error=18;return 0;}this.findData(a[1],search.names[search.index++]);return 1;}],FindClose:[1,a=>{this.handles.delete(a[0]);return 1;}],DeleteFileA:[1,a=>{const name=this.path(this.text(a[0]));if(!this.file(name)){this.error=2;return 0;}this.save(name,null);return 1;}],MoveFileA:[2,a=>{const source=this.path(this.text(a[0])),destination=this.path(this.text(a[1])),data=this.file(source);if(!data||this.file(destination)){this.error=data?183:2;return 0;}this.save(destination,data.slice());this.save(source,null);return 1;}],
    GetTimeFormatA:[6,a=>{const date=new Date(this.epochMs+Math.floor(this.millis)-1000-this.timezoneMinutes*60000),parts=a[2]?[8,10,12].map(o=>new DataView(this.m.bytes(a[2]+o,2).buffer).getUint16(0,true)):[date.getUTCHours(),date.getUTCMinutes(),date.getUTCSeconds()],value=parts.map(n=>String(n).padStart(2,'0')).join(':');if(!a[5])return value.length+1;this.putText(a[4],value,a[5]);return value.length+1;}],
    GetStockObject:[1,a=>this.handle({kind:'stock',id:a[0]})],
    LoadCursorA:[2,()=>1],RegisterClassA:[1,a=>{this.windowProc=this.m.u32(a[0]+4);return 1;}],
    CreateWindowExA:[12,()=>{this.messages.push([1,0x1c,1,0]);return 1;}],ShowWindow:[2,()=>1],ShowCursor:[1,a=>a[0]?0:-1],SetCursor:[1,()=>1],SetActiveWindow:[1,()=>1],GetForegroundWindow:[0,()=>this.foreground===false?0:1],
    GetWindowLongA:[2,()=>0],DefWindowProcA:[4,a=>{if(a[1]===0x10)this.messages.push([a[0],2,0,0]);return 0;}],GetWindowThreadProcessId:[2,a=>{if(a[1])this.m.u32(a[1],1);return 1;}],AttachThreadInput:[3,()=>1],MoveWindow:[6,()=>1],
    GetSystemMetrics:[1,a=>a[0]===0?640:a[0]===1?480:0],WINNLSEnableIME:[2,()=>1],SystemParametersInfoA:[4,()=>1],
    PeekMessageA:[5,a=>{const index=this.messages.findIndex(msg=>(msg.thread??1)===this.currentThreadId);if(index<0)return 0;const msg=this.messages[index];msg.forEach((v,i)=>this.m.u32(a[0]+4*i,v));this.m.u32(a[0]+16,Math.floor(this.millis));if(a[4]&1)this.messages.splice(index,1);return 1;}],TranslateMessage:[1,()=>1],DispatchMessageA:[1,a=>{if(this.windowProc)this.callGuest={address:this.windowProc,args:this.m.readWords(a[0],4)};return 0;}],
    PostThreadMessageA:[4,a=>{const msg=[0,a[1],a[2],a[3]];msg.thread=a[0];this.messages.push(msg);return 1;}],
    DestroyWindow:[1,()=>{this.messages.push([1,2,0,0]);return 1;}],
  };
}
