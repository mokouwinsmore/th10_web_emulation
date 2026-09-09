import {readFileSync,mkdirSync,writeFileSync,appendFileSync} from 'node:fs';
import {launchBrowser} from './native/browser-launch.mjs';

const language=process.env.GAME_LANGUAGE??'chs',mode=process.env.TEXT_MODE??'music';
const out=process.env.PROBE_OUT??`artifacts/text-performance-${language}-${mode}`;
mkdirSync(out,{recursive:true});writeFileSync(out+'/progress.log','');
const log=(...args)=>appendFileSync(out+'/progress.log',args.map(x=>typeof x==='string'?x:JSON.stringify(x)).join(' ')+'\n');
const browser=await launchBrowser(),page=await browser.newPage({viewport:{width:1100,height:900}});
async function startCpuProfile(){
  const cdp=await browser.newBrowserCDPSession(),{targetInfos}=await cdp.send('Target.getTargets'),target=targetInfos.find(x=>x.type==='worker'&&x.url.endsWith('/runtime/browser-worker.js'));
  if(!target)throw new Error('Worker profiling target not found');const {sessionId}=await cdp.send('Target.attachToTarget',{targetId:target.targetId,flatten:false});let id=0;const pending=new Map();
  cdp.on('Target.receivedMessageFromTarget',event=>{if(event.sessionId!==sessionId)return;const message=JSON.parse(event.message),wait=pending.get(message.id);if(wait){pending.delete(message.id);message.error?wait.reject(new Error(JSON.stringify(message.error))):wait.resolve(message.result);}});
  const send=(method,params={})=>new Promise((resolve,reject)=>{const request=++id;pending.set(request,{resolve,reject});cdp.send('Target.sendMessageToTarget',{sessionId,message:JSON.stringify({id:request,method,params})}).catch(reject);});
  await send('Profiler.enable');await send('Profiler.start');return async()=>{const result=await send('Profiler.stop');writeFileSync(out+'/worker.cpuprofile',JSON.stringify(result.profile));await cdp.detach();};
}
let worker;const source=readFileSync('runtime/browser-worker.js','utf8');
const instrumentation=`
globalThis.textProbe={events:[],frames:[],phase:'startup',totals:{}};
function measureTextWork(name,fn){const before=performance.now();try{return fn();}finally{const elapsed=performance.now()-before,p=textProbe;p.totals[name]=(p.totals[name]??0)+elapsed;if(name==='step'){p.stepMs=(p.stepMs??0)+elapsed;p.steps=(p.steps??0)+1;}if(elapsed>8)p.events.push({name,ms:elapsed,frame:host?.d3d.frames,phase:p.phase});}}
const originalFetch=globalThis.fetch;globalThis.fetch=async(...args)=>{const before=performance.now(),response=await originalFetch(...args);if(String(args[0]).includes('/fonts/'))textProbe.events.push({name:'font-fetch',url:String(args[0]),ms:performance.now()-before,frame:host?.d3d.frames,phase:textProbe.phase});return response;};
`;
let instrumented=instrumentation+source;
instrumented=instrumented.replace('let io;',`let io;
for(const entry of m.image.imports)if(entry.name==='D3DXLoadSurfaceFromMemory'){
 const original=library.exports.get(entry.name);m.u32(entry.address,m.registerImport({dll:'native-host',name:'probe.'+entry.name,argc:10,handler:a=>{
 const s=host.d3d.com.get(a[0]);textProbe.events.push({name:'surface-load',frame:host.d3d.frames,phase:textProbe.phase,args:a.slice(0,10),dst:s?{width:s.width,height:s.height,format:s.format}:null,srcRect:a[7]?m.readWords(a[7],4):null,dstRect:a[2]?m.readWords(a[2],4):null,caller:m.u32(m.reg('ESP'))});m.reg('EIP',original);return {blocked:true};}}));
}`);
instrumented=instrumented.replace('fonts.draw(dc,...args);','measureTextWork("gdi-draw",()=>fonts.draw(dc,...args));textProbe.events.push({name:"text",frame:host.d3d.frames,phase:textProbe.phase,size:dc.font.font[0],text:args[3]});');
instrumented=instrumented.replace('scheduler.step(500000);','measureTextWork("step",()=>scheduler.step(500000));');
instrumented=instrumented.replace('if(io){const pending=io;io=null;await pending;}','if(io){const pending=io;io=null;const beforeIO=performance.now();await pending;textProbe.events.push({name:"io",ms:performance.now()-beforeIO,frame:host.d3d.frames,phase:textProbe.phase});}');
instrumented=instrumented.replace('if(host.d3d.frames!==previous){','if(host.d3d.frames!==previous){const p=textProbe,nowFrame=performance.now();p.frames.push({frame:host.d3d.frames,ms:p.lastTime?nowFrame-p.lastTime:0,phase:p.phase,virtual:host.millis,cpuMs:p.stepMs??0,steps:p.steps??0});p.lastTime=nowFrame;p.stepMs=0;p.steps=0;');
await page.route('**/runtime/browser-worker.js',route=>route.fulfill({contentType:'text/javascript',body:instrumented}));
page.on('pageerror',error=>log('PAGE_ERROR',error.stack));
async function frames(n){const first=await page.evaluate(()=>window.nativeStatus?.frame??0);await page.waitForFunction(target=>window.nativeStatus?.type==='error'||window.nativeStatus?.frame>=target,first+n,{timeout:180000});const state=await page.evaluate(()=>nativeStatus);if(state.type==='error')throw new Error(state.message);return state;}
async function pulse(code){await page.evaluate(code=>nativePulse(code,3),code);await frames(45);}
async function phase(name){log('PHASE',name,await page.evaluate(()=>nativeStatus));await worker.evaluate(name=>{textProbe.phase=name;host.m.profile=true;host.m.samples=new Map();if(!host.readerProbe){host.readerProbe={};const invoke=host.m.onImport;host.m.onImport=entry=>{if(entry.name==='D3DX.FilterRGBA'&&!host.readerProbe.read){const m=host.m,converter=m.reg('EBX'),src=m.u32(converter),dst=m.u32(converter+4);host.readerProbe={read:m.u32(m.u32(src)+4),write:m.u32(m.u32(dst)+8),src: m.readWords(src,32),dst:m.readWords(dst,32),srcAddress:src,dstAddress:dst};}return invoke(entry);};}},name);}
async function save(name){const result=await worker.evaluate(()=>({...textProbe,reader:host.readerProbe,samples:[...(host.m.samples??[])].sort((a,b)=>b[1]-a[1]).slice(0,100),calls:[...host.calls]}));writeFileSync(out+'/'+name+'.json',JSON.stringify(result));await page.screenshot({path:out+'/'+name+'.png'});const f=result.frames.filter(x=>x.phase===result.phase).map(x=>x.ms).sort((a,b)=>a-b);log(name,{frames:f.length,mean:f.reduce((a,b)=>a+b,0)/f.length,p95:f[Math.floor(f.length*.95)],p99:f[Math.floor(f.length*.99)],max:f.at(-1),slow:f.filter(x=>x>50).length},await page.evaluate(()=>nativeStatus));}
try{
  await page.goto(`http://127.0.0.1:${process.env.PROBE_PORT??8091}/?lang=${language}`);
  if(process.env.TEXT_UNLOCKED==='1'){const name=language==='chs'?'scoreth10c.dat':'scoreth10.dat';await page.evaluate(async({language,name,data})=>{const {openNativeStorage}=await import('/runtime/storage.mjs');await(await openNativeStorage(language)).save(name,new Uint8Array(data));},{language,name,data:Array.from(readFileSync(`../[th10] 东方风神录 (汉化版+日文版)/全开档/${name}`))});}
  await page.locator('#start').click();await frames(450);worker=page.workers().find(w=>w.url().endsWith('/runtime/browser-worker.js'));
  await pulse('KeyZ');
  if(mode==='music'||mode==='full'){
    for(let i=0;i<(process.env.TEXT_UNLOCKED==='1'?5:4);i++)await pulse('ArrowDown');await phase('music-first-entry');const stopProfile=process.env.CPU_PROFILE==='1'?await startCpuProfile():null;await pulse('KeyZ');await frames(240);await stopProfile?.();await save('music-first-entry');
    if(!await worker.evaluate(()=>textProbe.events.some(x=>x.name==='text'&&x.phase==='music-first-entry')))throw new Error('Music Room did not render original text');
    await phase('music-switch');for(let i=0;i<(process.env.TEXT_UNLOCKED==='1'?17:5);i++)await pulse('ArrowDown');await save('music-switch');
    await pulse('KeyX');await frames(60);await phase('music-repeat-entry');await pulse('KeyZ');await frames(180);await save('music-repeat-entry');
    if(mode==='full'){await pulse('KeyX');await frames(60);for(let i=0;i<(process.env.TEXT_UNLOCKED==='1'?5:4);i++)await pulse('ArrowUp');}
  }
  if(mode!=='music'){
    for(let i=0;i<4;i++)await pulse('KeyZ');await worker.evaluate(()=>{const h=host.d3d,present=h.onPresent;h.onPresent=(...args)=>{host.m.u32(0x474c70,8);host.m.u32(0x474c48,100);return present(...args);};});
    await page.evaluate(()=>nativePress('KeyZ',true));await phase('stage1');await frames(4200);await page.evaluate(()=>nativePress('KeyZ',false));await save('stage1');
    await phase('dialogue');await frames(900);await save('dialogue');
    if(!await worker.evaluate(()=>textProbe.events.some(x=>x.name==='text'&&x.phase==='dialogue'&&x.text.trim().length>5)))throw new Error('Original dialogue did not appear');
    for(let i=0;i<8;i++){await pulse('KeyZ');await frames(45);}await save('dialogue-advance');
  }
  log('PASSED');
}catch(error){log('ERROR',error.stack);if(worker)await save('error').catch(()=>{});process.exitCode=1;}finally{await browser.close();}
