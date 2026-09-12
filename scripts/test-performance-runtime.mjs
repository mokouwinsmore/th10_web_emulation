// Real generated runtime/protocol smoke in an isolated browser profile.
// This fixture does not validate the full launcher UI or a physical phone.
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {performanceFixture} from './performance-fixture.mjs';

const project=fileURLToPath(new URL('..',import.meta.url));
const fixture=await performanceFixture(project,{source:false});
const report={date:new Date().toISOString(),scope:'Generated hosted runtime, desktop touch emulation; not launcher/phone acceptance',checks:[],errors:[]};
let browser;
try{
  browser=await chromium.launch({channel:'msedge',headless:true,args:['--enable-unsafe-swiftshader']});
  const context=await browser.newContext({viewport:{width:960,height:720},hasTouch:true});
  const page=await context.newPage();page.on('pageerror',error=>report.errors.push(String(error)));
  await page.goto(fixture.url);
  await page.waitForFunction(()=>window.fixtureReady);
  const bytes=[0,1,127,128,255],path='/savesth10/perf-smoke.bin';
  await page.evaluate(async({path,bytes})=>{await command('write',{path,bytes});await command('sync');},{path,bytes});
  await page.reload();await page.waitForFunction(()=>window.fixtureReady);
  assert.deepEqual((await page.evaluate(path=>command('read',{path}),path)).bytes,bytes);
  assert.ok((await page.evaluate(()=>command('list'))).files.some(file=>file.path===path));
  report.checks.push('save write/sync/reload/read/list preserves exact bytes in isolated storage');
  await page.evaluate(()=>fixtureLaunch());
  const frame=page.frames().find(f=>f.url().includes('th10.html'));
  const waitFrame=async(target)=>{
    await frame.waitForFunction(target=>window.nativeStatus?.type==='error'||window.nativeStatus?.frame>=target,target,{timeout:90000});
    assert.notEqual((await frame.evaluate(()=>window.nativeStatus)).type,'error');
  };
  await waitFrame(450);
  assert.equal(await frame.evaluate(()=>document.querySelector('#nativePerformance').hidden),true);
  report.checks.push('default production launch has no profiling overlay');
  await frame.evaluate(()=>{Module.eaglerOptions.touchEnabled=true;});
  for(let i=0;i<5;i++){
    const before=await frame.evaluate(()=>nativeStatus.frame),box=await frame.locator('#canvas').boundingBox();
    await page.touchscreen.tap(box.x+box.width/2,box.y+box.height/2);await waitFrame(before+75);
  }
  await frame.waitForFunction(()=>window.nativeTouchState?.mode==='gameplay',null,{timeout:30000});
  assert.equal(await frame.evaluate(()=>nativeStatus.screen.stage),1);
  report.checks.push('five trusted browser touches enter original Stage 1');
  const before=await frame.evaluate(()=>nativeTouchState.pointerEvents),box=await frame.locator('#canvas').boundingBox();
  await page.touchscreen.tap(box.x+box.width*.35,box.y+box.height*.6);
  await frame.waitForFunction(before=>window.nativeTouchState?.pointerEvents>before,before);
  report.checks.push('gameplay trusted touch reaches the native adapter');
  await page.keyboard.down('Escape');
  await page.waitForTimeout(100);await page.keyboard.up('Escape');
  await frame.waitForFunction(()=>window.nativeTouchState?.pauseState>0);
  report.checks.push('pause reaches the original pause state');
  await page.setViewportSize({width:720,height:960});
  await frame.waitForFunction(()=>innerWidth===720&&innerHeight===960);
  assert.deepEqual(await frame.evaluate(()=>[Module.canvas.width,Module.canvas.height]),[640,480]);
  report.checks.push('portrait resize preserves the original backing resolution');
  report.audio=await frame.evaluate(()=>window.nativeAudio);
  assert.equal(report.audio?.type,'audio');assert.ok(report.audio.frames>0&&report.audio.peak>0);
  report.checks.push('AudioWorklet processed nonzero PCM (not external BGM acceptance)');
  await page.evaluate(path=>command('remove',{path}),path);
  assert.ok(!(await page.evaluate(()=>command('list'))).files.some(file=>file.path===path));
  report.checks.push('isolated save removal persists through storage command');
  assert.deepEqual(report.errors,[]);assert.deepEqual(await page.evaluate(()=>fixtureErrors),[]);
  report.ok=true;
}catch(error){report.ok=false;report.error=String(error.stack??error);process.exitCode=1;}
finally{
  await browser?.close();await fixture.close();
  await writeFile(new URL('../artifacts/validation/mobile-performance/perf5-runtime-smoke.json',import.meta.url),JSON.stringify(report,null,2));
  console.log(JSON.stringify(report,null,2));
}
