import {launchBrowser} from './native/browser-launch.mjs';import {mkdirSync,writeFileSync,appendFileSync,readFileSync} from 'node:fs';
import {captureFrame} from './native/capture-frame.mjs';
const language=process.env.GAME_LANGUAGE??'jp',out=`artifacts/browser-quality-${language}`;mkdirSync(out,{recursive:true});writeFileSync(out+'/progress.log','');const log=(...args)=>appendFileSync(out+'/progress.log',args.map(x=>typeof x==='string'?x:JSON.stringify(x)).join(' ')+'\n');
const browser=await launchBrowser(),page=await browser.newPage({viewport:{width:1100,height:900}});page.on('pageerror',error=>log('PAGE_ERROR',error.stack));let worker;
async function waitFrames(n){const before=await page.evaluate(()=>window.nativeStatus?.frame??0);await page.waitForFunction(target=>window.nativeStatus?.type==='error'||window.nativeStatus?.frame>=target,before+n,{timeout:180000});const state=await page.evaluate(()=>nativeStatus);if(state.type==='error')throw new Error(state.message);return state;}
async function press(code){await page.evaluate(code=>nativePulse(code,3),code);await waitFrames(45);}
async function snap(name){await page.screenshot({path:`${out}/${name}.png`});log(name,await page.evaluate(()=>nativeStatus),await page.evaluate(()=>nativeAudio));if(process.env.CAPTURE_D3D==='1')await captureFrame(worker,name,out+'/pixels');}
try{await page.goto(`http://127.0.0.1:8091/?lang=${language}`);
  const score=language==='chs'?'scoreth10c.dat':'scoreth10.dat',data=Array.from(readFileSync(`../[th10] 东方风神录 (汉化版+日文版)/全开档/${score}`));await page.evaluate(async({language,score,data})=>{const {openNativeStorage}=await import('/runtime/storage.mjs');await(await openNativeStorage(language)).save(score,new Uint8Array(data));},{language,score,data});
  await page.locator('#start').click();await waitFrames(450);worker=page.workers().find(w=>w.url().endsWith('/runtime/browser-worker.js'));await snap('title');await press('KeyZ');await snap('menu');
  if(process.env.QUALITY_MODE==='music'){
    for(let i=0;i<5;i++)await press('ArrowDown');await press('KeyZ');await waitFrames(120);await snap('music');for(let i=0;i<17;i++){await press('ArrowDown');await snap('music-'+(i+1));}await press('KeyX');await snap('music-exit');
  }else{
    for(let i=0;i<4;i++)await press('KeyZ');await page.evaluate(()=>nativePress('KeyZ',true));await waitFrames(600);await snap('stage1');
    await worker.evaluate(()=>{const present=host.d3d.onPresent;host.test={fps:[],frames:[]};host.d3d.onPresent=(...args)=>{host.m.u32(0x474c70,8);host.m.u32(0x474c48,100);return present(...args);};});
    await press('KeyX');await snap('bomb');await press('Escape');await snap('pause');await press('Escape');await snap('resume');
    if(process.env.QUALITY_MODE!=='short'){await waitFrames(4200);await page.evaluate(()=>nativePress('KeyZ',false));await snap('boss');await waitFrames(120);await snap('dialogue');await page.evaluate(()=>{nativePress('KeyZ',true);nativePress('ControlLeft',true);});await waitFrames(2400);await snap('boss-pattern');}
  }
  writeFileSync(out+'/state.json',JSON.stringify(await worker.evaluate(()=>({calls:[...host.calls],log:host.log.map(x=>({...x,data:undefined})),heap:host.m.heap,files:[...host.overlay].map(([n,b])=>[n,b?.length])})),null,2));
}catch(error){log('ERROR',error.stack);await page.screenshot({path:out+'/error.png'}).catch(()=>{});process.exitCode=1;}finally{await browser.close();}
