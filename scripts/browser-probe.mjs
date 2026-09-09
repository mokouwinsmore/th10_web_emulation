import {launchBrowser} from './native/browser-launch.mjs';
import {mkdirSync,writeFileSync} from 'node:fs';
const browser=await launchBrowser(),page=await browser.newPage({viewport:{width:1100,height:900}}),out='artifacts/browser-probe';mkdirSync(out,{recursive:true});
page.on('pageerror',error=>console.error(error.message));page.on('console',message=>{if(message.type()==='error')console.error(message.text());});
async function frames(target,label){await page.waitForFunction(target=>window.nativeStatus?.type==='error'||window.nativeStatus?.frame>=target,target,{timeout:180000});const status=await page.evaluate(()=>nativeStatus);await page.screenshot({path:`${out}/${label}.png`});console.log(label,JSON.stringify(status),JSON.stringify(await page.evaluate(()=>nativeAudio)));if(status.type==='error')throw new Error(status.message);}
async function press(code){const before=await page.evaluate(()=>nativeStatus.frame);await page.evaluate(code=>nativePulse(code,3),code);await frames(before+60,code+'-'+before);}
try{await page.goto(process.env.NATIVE_URL??'http://127.0.0.1:8091');await page.locator('#start').click();await frames(600,'title');
  if(process.env.PROBE_PLAY==='1'){await press('KeyZ');await press('KeyZ');await press('KeyZ');await press('KeyZ');await page.evaluate(()=>nativePress('KeyZ',true));const target=await page.evaluate(()=>nativeStatus.frame+600);await frames(target,'stage1');await press('ShiftLeft');await press('KeyX');await frames(target+300,'bomb');}
  const worker=page.workers().find(w=>w.url().endsWith('/runtime/browser-worker.js'));writeFileSync(out+'/state.json',JSON.stringify(await worker.evaluate(()=>({calls:[...host.calls],log:host.log.map(x=>({...x,data:undefined})),sounds:host.sound.buffers.map(b=>({frequency:b.frequency,length:b.data?.length,playing:b.playing})),memory:[0x474c00,0x491c00,0x4776c0].map(p=>[p,host.m.readWords(p,64)])})),null,2));
}catch(error){console.error(error.stack);process.exitCode=1;}finally{await browser.close();}
