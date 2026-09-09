import {openNativeStorage} from './storage.mjs';
let screen=document.querySelector('#screen');const status=document.querySelector('#status'),start=document.querySelector('#start');let worker,audio,transferred=false,requestId=0;const requests=new Map();
const quit=document.querySelector('#quit');quit.onclick=()=>{quit.disabled=true;worker?.postMessage({type:'quit'});status.textContent='正在按原版流程退出并保存…';};
const language=new URL(location.href).searchParams.get('lang')==='chs'?'chs':'jp';
const languageSelect=document.querySelector('#language');languageSelect.value=language;languageSelect.onchange=()=>{const url=new URL(location.href);url.searchParams.set('lang',languageSelect.value);location.href=url;};status.textContent=`东方风神录 ${language==='chs'?'简体汉化版':'日文原版'} 1.00a · 点击开始游戏`;
function fail(error){window.nativeStatus={type:'error',message:error.stack??String(error)};status.textContent=error.message??String(error);console.error(error);}
async function stop(){worker?.terminate();worker=null;if(audio&&audio.state!=='closed')await audio.close();audio=null;start.disabled=false;quit.disabled=true;languageSelect.disabled=false;start.textContent='重新开始';for(const request of requests.values())request.reject(new Error('游戏已停止'));requests.clear();}
function flushSaves(){if(!worker)return Promise.resolve();return new Promise((resolve,reject)=>{const id=++requestId,timer=setTimeout(()=>{requests.delete(id);reject(new Error('存档写入尚未完成'));},15000);requests.set(id,{resolve(){clearTimeout(timer);resolve();},reject(error){clearTimeout(timer);reject(error);}});worker.postMessage({type:'flush-saves',id});});}
start.onclick=async()=>{if(worker)return;start.disabled=true;languageSelect.disabled=true;try{
  if(!self.isSecureContext||!self.AudioWorkletNode||!screen.transferControlToOffscreen)throw new Error('请通过 localhost 或 HTTPS，在支持 WebGL 2 和 AudioWorklet 的桌面浏览器中打开。');
  audio=new AudioContext({sampleRate:44100,latencyHint:'interactive'});await audio.resume();await audio.audioWorklet.addModule('/runtime/audio-worklet.mjs');
  const sound=new AudioWorkletNode(audio,'native-directsound',{numberOfInputs:0,numberOfOutputs:1,outputChannelCount:[2]}),channel=new MessageChannel();sound.connect(audio.destination);
  const ready=new Promise((resolve,reject)=>{sound.port.onmessage=({data})=>{window.nativeAudio=data;if(data.type==='ready')resolve();};sound.onprocessorerror=()=>reject(new Error('音频处理器停止'));});sound.port.postMessage({type:'connect',port:channel.port1},[channel.port1]);await ready;
  if(transferred){const replacement=screen.cloneNode(false);screen.replaceWith(replacement);screen=replacement;}const canvas=screen.transferControlToOffscreen();transferred=true;worker=new Worker('/runtime/browser-worker.js');
  worker.onerror=async event=>{await stop();fail(new Error(event.message));};worker.onmessage=async({data})=>{
    if(data.type==='saves-flushed'){const request=requests.get(data.id);requests.delete(data.id);data.error?request?.reject(new Error(data.error)):request?.resolve();return;}
    window.nativeStatus=data;if(data.type==='status')status.textContent=data.message;else if(data.type==='frame')status.textContent=`${data.fps.toFixed(1)} FPS`;else if(data.type==='exit'){await stop();status.textContent='游戏已退出';}else if(data.type==='error'){await stop();fail(new Error(data.message));}
  };
  worker.postMessage({type:'start',canvas,audioPort:channel.port2,language,gamepad:readGamepad()},[canvas,channel.port2]);quit.disabled=false;screen.focus();
}catch(error){await stop();fail(error);}};
document.querySelector('#fullscreen').onclick=()=>screen.requestFullscreen().catch(fail);
for(const kind of ['keydown','keyup'])addEventListener(kind,event=>{if(event.target instanceof HTMLInputElement||event.target instanceof HTMLSelectElement)return;if(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Space','Tab'].includes(event.code))event.preventDefault();worker?.postMessage({type:'key',code:event.code,down:kind==='keydown'});});
addEventListener('blur',()=>{worker?.postMessage({type:'blur'});worker?.postMessage({type:'focus',active:false});});addEventListener('focus',()=>worker?.postMessage({type:'focus',active:true}));
window.nativePress=(code,down)=>worker?.postMessage({type:'key',code,down});window.nativePulse=(code,frames=3)=>worker?.postMessage({type:'pulse',code,frames});
const validName=name=>name===(language==='chs'?'scoreth10c.dat':'scoreth10.dat')||/^(?:th10\.cfg|replay\/th10_(?:\d{2}|ud\d{4})\.rpy)$/.test(name);
const toBase64=bytes=>{let result='';for(let i=0;i<bytes.length;i+=32768)result+=String.fromCharCode(...bytes.subarray(i,i+32768));return btoa(result);};
document.querySelector('#export').onclick=async()=>{try{await flushSaves();const entries=await(await openNativeStorage(language)).load(),files=entries.filter(([name,data])=>data&&validName(name)).map(([name,data])=>({name,data:toBase64(data)})),url=URL.createObjectURL(new Blob([JSON.stringify({format:'TH10-native-save',version:1,language,files})],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download=`th10-${language}-save.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);}catch(error){fail(error);}};
document.querySelector('#import').onchange=async event=>{try{await flushSaves();const db=await openNativeStorage(language),existing=new Map(await db.load()),entries=[];
  for(const file of event.target.files){const bytes=new Uint8Array(await file.arrayBuffer()),name=file.name.toLowerCase();
    if(name.endsWith('.json')){const bundle=JSON.parse(new TextDecoder().decode(bytes));if(bundle.format!=='TH10-native-save'||bundle.version!==1||bundle.language!==language||!Array.isArray(bundle.files))throw new Error('请选择对应语言的风神录存档备份');for(const entry of bundle.files){if(!validName(entry.name))throw new Error('存档文件名无效');entries.push([entry.name,Uint8Array.from(atob(entry.data),c=>c.charCodeAt(0))]);}}
    else if(name.endsWith('.rpy')){if(bytes.length<16||String.fromCharCode(...bytes.subarray(0,4))!=='t10r')throw new Error('无法识别的风神录录像');let replay=/^th10_(?:\d{2}|ud\d{4})\.rpy$/.test(name)?name:null;if(!replay){let slot=1;while(existing.has(`replay/th10_ud${String(slot).padStart(4,'0')}.rpy`))slot++;if(slot>9999)throw new Error('录像目录已满');replay=`th10_ud${String(slot).padStart(4,'0')}.rpy`;}const path='replay/'+replay;entries.push([path,bytes]);existing.set(path,bytes);}
    else if(validName(name))entries.push([name,bytes]);else throw new Error('请选择风神录存档、配置、录像或备份');
  }
  if(entries.length){await stop();for(const [name,data] of entries)await db.save(name,data);location.reload();}
}catch(error){fail(error);}};
function readGamepad(){const pad=Array.from(navigator.getGamepads?.()??[]).find(p=>p?.connected);return pad?{axes:Array.from(pad.axes),buttons:pad.buttons.map(b=>b.pressed)}:null;}
let lastGamepad;function pollGamepad(){if(worker){const pad=readGamepad(),key=JSON.stringify(pad);if(key!==lastGamepad){lastGamepad=key;worker.postMessage({type:'gamepad',pad});}}requestAnimationFrame(pollGamepad);}requestAnimationFrame(pollGamepad);
