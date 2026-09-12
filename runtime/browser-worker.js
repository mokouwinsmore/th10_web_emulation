importScripts(new URL('../vendor/v86.js',self.location.href).href);
let host,keys=new Set(),pulses=new Map(),gamepad=null,quitRequested=false;const saves=new Set();let saveError;
let inputSources;
let touchAdapter,hostedStorePromise,started=false;
const pendingTouch=[];
const runtimeRoot=new URL('../',self.location.href);
const asset=path=>new URL(path,runtimeRoot).href;
async function hostedStore(){
  return hostedStorePromise??=Promise.all([import('./hosted-storage.mjs'),import('./storage.mjs')]).then(async([{HostedStorage},{openNativeStorage}])=>{
    const store=new HostedStorage(await openNativeStorage('eagler-jp'));await store.restore();return store;
  });
}
function touchEvent(data){
  if(!touchAdapter){if(pendingTouch.length<256)pendingTouch.push(data);return;}
  if(data.type==='touch-options')touchAdapter.configure(data.options);
  else if(data.type==='touch-controls')touchAdapter.controls(data.controls);
  else if(data.type==='direct-touch')touchAdapter.pointer(data.action,data.point);
  else touchAdapter.cancel();
}
const pendingInput=[];
function inputEvent(data){
  if(!inputSources){pendingInput.push(data);return;}
  if(data.type==='blur'){
    keys=inputSources.clear();pulses.clear();touchAdapter?.cancel();
  }else if(data.type==='keyboard-clear'){
    keys=inputSources.clear('keyboard');
  }else{
    const source=data.type==='pulse'?'pulse':(data.source??'keyboard');
    keys=inputSources.set(source,data.code,data.down||data.type==='pulse');
    if(data.type==='pulse')pulses.set(data.code,(host?.d3d.frames??0)+(data.frames??3));
  }
  if(host)host.input.keys=new Set(keys);
}
self.onmessage=({data})=>{
  if(data.type==='key'||data.type==='pulse')inputEvent(data);
  else if(data.type==='blur'||data.type==='keyboard-clear')inputEvent(data);
  else if(['touch-options','touch-controls','direct-touch','touch-cancel'].includes(data.type))touchEvent(data);
  else if(data.type==='touch-state')postMessage({type:'rpc',id:data.id,ok:true,value:touchAdapter?.status()??null});
  else if(data.type==='storage-command')hostedStore().then(async store=>{
    const value=await store.command(data.message);
    if(data.message.command==='write'||data.message.command==='remove')await store.sync();
    postMessage({type:'rpc',id:data.id,ok:true,value});
  }).catch(error=>postMessage({type:'rpc',id:data.id,ok:false,error:String(error)}));
  else if(data.type==='focus')host?.focus(data.active);
  else if(data.type==='gamepad'){gamepad=data.pad;if(host)host.input.pad=gamepad;}
  else if(data.type==='quit')quitRequested=true;
  else if(data.type==='flush-saves')Promise.all(saves).then(()=>{if(saveError)throw saveError;postMessage({type:'saves-flushed',id:data.id});}).catch(error=>postMessage({type:'saves-flushed',id:data.id,error:String(error)}));
  else if(data.type==='start'){
    if(started){postMessage({type:'error',message:'Runtime already started'});return;}
    started=true;start(data).catch(error=>postMessage({type:'error',message:error.stack??String(error)}));
  }
};
async function start({canvas,audioPort,language='jp',gamepad:pad,dataBuffer,touchOptions,musicSource,directViews=true,cacheRenderState=true,performanceTelemetry=false,legacySubmission=false,fastReturns=true,debugGLErrors=false}){
  if(dataBuffer&&language!=='jp')throw new Error('Hosted TH10 basic touch supports only the original Japanese game');
  const {InputSources}=await import('./input-sources.mjs');
  inputSources=new InputSources();
  for(const event of pendingInput.splice(0))inputEvent(event);
  const [{JitMachine},{Win32Host},{Scheduler},{WebGLD3D9},{loadLibrary},{installGDI},{GDIFonts},{fetchBytes,fetchGzip,PagedMusic},{openNativeStorage}]=await Promise.all([
    import('./jit-machine.mjs'),import('./win32.mjs'),import('./scheduler.mjs'),import('./webgl.mjs'),import('./library.mjs'),import('./gdi.mjs'),import('./gdi-fonts.mjs'),import('./assets.mjs'),import('./storage.mjs')]);
  postMessage({type:'status',message:'读取风神录原版程序与资源…'});
  const manifestResponse=await fetch(asset('manifest.json'));if(!manifestResponse.ok)throw new Error('Runtime manifest unavailable');
  const manifest=await manifestResponse.json(),variant=manifest.variants[language];
  const files=dataBuffer?await(await import('./native-data.mjs')).decodeNativeData(dataBuffer):new Map();
  if(!dataBuffer)await Promise.all(variant.files.map(async name=>files.set(name,await fetchBytes(asset('data/'+name)))));
  const exe=files.get(variant.program),digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',exe)),n=>n.toString(16).padStart(2,'0')).join('');
  if(digest!==variant.sha256)throw new Error('风神录程序校验失败');
  const music=dataBuffer&&!musicSource?{length:manifest.music.size,subarray:(start,end)=>new Uint8Array(Math.max(0,Math.min(end,manifest.music.size)-start))}:
    new PagedMusic(musicSource?{...manifest.music,chunked:false,url:musicSource.url}:manifest.music,{baseURL:runtimeRoot.href});files.set('thbgm.dat',music);
  if(music instanceof PagedMusic){
    const {musicTracks}=await import('./music-layout.mjs');
    postMessage({type:'status',message:'预读原版音乐入口…'});
    await music.prepare(musicTracks);
  }
  const [libraryBytes,blend,initialFont]=await Promise.all([files.get('d3dx9_31.dll')??fetchBytes(asset('native/d3dx9_31.dll')),fetchGzip(asset('fonts/blend.bin.gz')),fetchGzip(asset(`fonts/${language==='chs'?134:128}/32-400.json.gz`)).then(bytes=>JSON.parse(new TextDecoder().decode(bytes)))]);
  const m=await JitMachine.create(exe,{factory:self.V86,wasmPath:asset('vendor/v86.wasm'),directViews,fastReturns});host=new Win32Host(m,files,{language,program:variant.program});host.input.keys=new Set(keys);host.input.pad=pad??gamepad;
  const library=loadLibrary(m,libraryBytes,0x1000000,'d3dx9_31.dll');m.call(library.entry,{args:[library.base,1,0]});
  (await import('./lzss.mjs')).installLzss(host);
  const d3dxFast=await import('./d3dx-fast.mjs');d3dxFast.installD3DXFastPaths(m,library,host);
  (await import('./texture-edges.mjs')).installTextureEdges(host);
  const fonts=new GDIFonts(blend,[initialFont]);let io;
  installGDI(host,{draw(dc,...args){const key=JSON.stringify([dc.font.font,dc.font.face]);if(!fonts.fonts.has(key)){
    io=fetchGzip(asset(`fonts/${dc.font.font[8]}/${dc.font.font[0]}-${dc.font.font[4]}.json.gz`)).then(bytes=>{const font=JSON.parse(new TextDecoder().decode(bytes));if(JSON.stringify([font.font,font.face])!==key)throw new Error('字体参数不符 '+key);fonts.fonts.set(key,font);});m.cpu.emu_stop();return {blocked:true};
  }fonts.draw(dc,...args);return 1;}});
  const hosted=dataBuffer?await hostedStore():null,storage=hosted?null:await openNativeStorage(language);
  if(hosted)host.overlay=hosted.files;else for(const [name,data] of await storage.load())host.overlay.set(name,data);
  for(const name of host.overlay.keys()){const parts=name.split('/');for(let i=1;i<parts.length;i++)host.directories.add(parts.slice(0,i).join('/'));}
  host.onSave=(name,data)=>{let pending;if(hosted){hosted.capture(name,data);pending=hosted.sync();}else pending=storage.save(name,data);saves.add(pending);pending.then(()=>saves.delete(pending),error=>{saveError=error;saves.delete(pending);});};
  const read=host.api.ReadFile[1];host.api.ReadFile[1]=a=>{const file=host.handles.get(a[0]);if(file?.name!=='thbgm.dat')return read(a);const data=music.subarray(file.position,file.position+a[2]);if(!data){io=music.pending;m.cpu.emu_stop();return {blocked:true};}m.write(a[1],data);file.position+=data.length;if(a[3])m.u32(a[3],data.length);return 1;};
  if(dataBuffer||touchOptions){touchAdapter=(await import('./th10-touch.mjs')).installTh10Touch(host,{digest,options:touchOptions??{}});for(const event of pendingTouch.splice(0))touchEvent(event);}
  const scheduler=new Scheduler(m,host),renderer=new WebGLD3D9(canvas,host.d3d,{cacheState:cacheRenderState,measureWork:performanceTelemetry,reuseStaging:!legacySubmission,debugErrors:legacySubmission||debugGLErrors}),audio=audioPort?(await import('./audio-bridge.mjs')).connectAudio(host,audioPort):null;
  if(!legacySubmission)renderer.warmPrograms();
  const FramePerformance=performanceTelemetry?(await import('./frame-performance.mjs')).FramePerformance:null;
  let framePerformance;
  postMessage({type:'status',message:'初始化风神录…'});
  let lastFrame=0,lastTime=performance.now(),deadline=performance.now(),presentedClock=host.millis,textReady=false,firstFrame=false;
  const tasks=new MessageChannel();let resume;tasks.port1.onmessage=()=>resume();const yieldTask=()=>new Promise(resolve=>{resume=resolve;tasks.port2.postMessage(0);});
  while(host.exitCode===undefined){if(saveError)throw saveError;if(quitRequested&&host.d3d.frames>0){quitRequested=false;host.messages.push([1,0x10,0,0]);}const previous=host.d3d.frames;
    const stepStart=framePerformance?performance.now():0;scheduler.step(500000);if(framePerformance)framePerformance.addWork(performance.now()-stepStart);if(io){const pending=io;io=null;await pending;}
    if(!textReady&&host.d3d.device){textReady=true;await d3dxFast.warmD3DXText(host,library);lastFrame=host.d3d.frames;lastTime=deadline=performance.now();presentedClock=host.millis;}
    if(host.d3d.frames!==previous){if(!firstFrame){firstFrame=true;postMessage({type:'first-frame'});}for(const [code,until] of pulses)if(host.d3d.frames>=until){keys=inputSources.set('pulse',code,false);host.input.keys=new Set(keys);pulses.delete(code);}audio?.sync();const now=performance.now();
      if(FramePerformance){const sample={time:now,frame:host.d3d.frames,calls:renderer.stats.calls,batches:renderer.stats.batches,submitMs:renderer.submitMs};if(!framePerformance)framePerformance=new FramePerformance(sample);else{const metrics=framePerformance.sample(sample);if(metrics)postMessage({type:'performance',build:'th10-perf-5',directViews,cacheRenderState,legacySubmission,fastReturns:m.fastReturns!==false,debugGLErrors:renderer.debugErrors,...metrics});}}
      if(host.d3d.frames-lastFrame>=30){postMessage({type:'frame',frame:host.d3d.frames,fps:(host.d3d.frames-lastFrame)*1000/(now-lastTime),draws:{...renderer.stats},screen:{stage:m.u32(0x474c7c),character:m.u32(0x474c68),shot:m.u32(0x474c6c),difficulty:m.u32(0x474c74),lives:m.i32(0x474c70),power:m.i32(0x474c48),flags:m.u32(0x474ca0),replayMode:m.u32(0x491c00)}});lastFrame=host.d3d.frames;lastTime=now;}
      if(touchAdapter&&host.d3d.frames%10===0)postMessage({type:'touch-state',state:touchAdapter.status()});
      deadline+=host.millis-presentedClock;presentedClock=host.millis;if(deadline<performance.now()-100)deadline=performance.now();const delay=deadline-performance.now();if(delay>1)await new Promise(resolve=>setTimeout(resolve,delay));else await yieldTask();
    }else await yieldTask();
  }
  await Promise.all(saves);if(hosted)await hosted.sync();touchAdapter?.close();scheduler.close();m.close();postMessage({type:'exit',code:host.exitCode});
}
