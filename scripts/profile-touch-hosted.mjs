// Local diagnostic only. No game resources or profiling code are published.
// Measures the original Stage 1 with touch disabled, in a fresh browser context.
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {readFileSync, mkdirSync, writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {performanceFixture} from './performance-fixture.mjs';
import {createHash} from 'node:crypto';

const project = resolve(fileURLToPath(new URL('..', import.meta.url)));
const label = process.argv[2] ?? 'baseline';
if (!/^[a-z0-9_-]+$/i.test(label)) throw new Error('Invalid report label');
const out = resolve(project, 'artifacts/validation/mobile-performance', label);
const url = process.argv[3] ?? 'http://127.0.0.1:18132/';
const detailed = process.env.TH10_PERF_LIGHT !== '1';
const reference = process.env.TH10_PERF_REFERENCE === '1';
const renderReference = process.env.TH10_PERF_RENDER_REFERENCE === '1';
const legacySubmission = process.env.TH10_PERF_SUBMISSION_REFERENCE === '1';
const scene = process.env.TH10_PERF_SCENE ?? 'stage1';
const isolated = process.env.TH10_PERF_FIXTURE === '1';
const baselineCPU = process.env.TH10_PERF_BASELINE_CPU === '1';
const gpuProbe = process.env.TH10_PERF_GPU === '1';
const setterProbe = process.env.TH10_PERF_SETTERS === '1';
const baselineSnapshots = process.env.TH10_PERF_BASELINE_SNAPSHOTS === '1';
if (!['stage1', 'demo'].includes(scene)) throw new Error('Unsupported performance scene');
const launchURL = new URL(url);
launchURL.searchParams.set('th10Perf', '1');
if (reference) launchURL.searchParams.set('th10LegacyViews', '1');
if (renderReference) launchURL.searchParams.set('th10LegacyRender', '1');
if (legacySubmission) launchURL.searchParams.set('th10LegacySubmission', '1');
if (baselineCPU) launchURL.searchParams.set('th10LegacyReturns', '1');
mkdirSync(out, {recursive: true});
const report = {date: new Date().toISOString(), label, url, touchEnabled: false,
  scope: 'Desktop Edge, original game, no phone/GPU timing claim', scene, detailed, reference, renderReference, legacySubmission, setterProbe, gpuProbe,
  testClock: '2026-09-09T00:00:00Z, UTC, supplied only to diagnostic Win32Host', errors: []};
let browser, server, page, stopProfile, fixture;

async function beginProfile(browser, workerURL) {
  const cdp = await browser.newBrowserCDPSession();
  const {targetInfos} = await cdp.send('Target.getTargets');
  const target = targetInfos.find(t => t.type === 'worker' && t.url === workerURL);
  if (!target) throw new Error('Runtime worker profile target missing');
  const {sessionId} = await cdp.send('Target.attachToTarget', {targetId: target.targetId, flatten: false});
  let serial = 0; const pending = new Map();
  cdp.on('Target.receivedMessageFromTarget', event => {
    if (event.sessionId !== sessionId) return;
    const message = JSON.parse(event.message), request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id); clearTimeout(request.timer);
    message.error ? request.reject(new Error(JSON.stringify(message.error))) : request.resolve(message.result);
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++serial, timer = setTimeout(() => { pending.delete(id); reject(new Error(`${method} timed out`)); }, 15000);
    pending.set(id, {resolve, reject, timer});
    cdp.send('Target.sendMessageToTarget', {sessionId, message: JSON.stringify({id, method, params})}).catch(error => {
      clearTimeout(timer); pending.delete(id); reject(error);
    });
  });
  await send('Profiler.enable'); await send('Profiler.start');
  return async () => {
    const {profile} = await send('Profiler.stop');
    writeFileSync(resolve(out, 'worker.cpuprofile'), JSON.stringify(profile));
    await cdp.detach();
    const nodes = new Map(profile.nodes.map(n => [n.id, n])), totals = new Map();
    for (let i = 0; i < profile.samples.length; i++) {
      const n = nodes.get(profile.samples[i]), f = n.callFrame;
      const key = `${f.functionName || '(anonymous)'} @ ${f.url}:${f.lineNumber + 1}`;
      totals.set(key, (totals.get(key) ?? 0) + (profile.timeDeltas[i] ?? 0));
    }
    return [...totals].sort((a, b) => b[1] - a[1]).slice(0, 30).map(([site, us]) => ({site, ms: us / 1000}));
  };
}

try {
  if (isolated) {
    fixture = await performanceFixture(project);
    const fixtureURL = new URL(fixture.url);fixtureURL.search = launchURL.search;
    launchURL.href = fixtureURL.href;
    report.url = launchURL.href;report.isolated = true;report.baselineCPU = baselineCPU;
    report.scope = 'Isolated hosted runtime, desktop Edge; not launcher or phone acceptance';
  } else if (!process.argv[3]) {
    server = spawn(process.execPath, ['scripts/serve.mjs', '18132'], {
      cwd: resolve(project, '../../../eagler-touhou'), stdio: ['ignore', 'pipe', 'pipe'], shell: false});
    await new Promise((resolveReady, reject) => {
      let log = ''; const timer = setTimeout(() => reject(new Error(`Server timeout: ${log}`)), 45000);
      server.stdout.on('data', b => { log += b; if (log.includes('eagler-touhou: http://')) { clearTimeout(timer); resolveReady(); } });
      server.stderr.on('data', b => { log += b; });
      server.once('error', e => { clearTimeout(timer); reject(e); });
      server.once('exit', code => { clearTimeout(timer); reject(new Error(`Server exited ${code}: ${log}`)); });
    });
  }
  browser = await chromium.launch({headless: true,
    ...(process.env.TH10_CHROMIUM ? {executablePath: process.env.TH10_CHROMIUM} : {channel: 'msedge'}),
    args: ['--enable-unsafe-swiftshader']});
  const context = await browser.newContext({viewport: {width: 1280, height: 900}});
  page = await context.newPage(); page.on('pageerror', e => report.errors.push(String(e)));
  report.baselineSnapshots=baselineSnapshots;
  if(baselineSnapshots)await page.route('**/runtime/d3d9.mjs',route=>route.fulfill({contentType:'text/javascript',
    body:readFileSync(resolve(project,'artifacts/validation/mobile-performance/perf4-baseline/d3d9.mjs'),'utf8')}));
  // Expose existing objects only in this routed test worker, not runtime source.
  const source = readFileSync(resolve(project, 'runtime/browser-worker.js'), 'utf8');
  const anchor = "postMessage({type:'status',message:'初始化风神录…'});";
  const hostAnchor = 'new Win32Host(m,files,{language,program:variant.program})';
  assert.ok(source.includes(anchor), 'diagnostic injection anchor');
  assert.ok(source.includes(hostAnchor), 'controlled test clock anchor');
  await page.route('**/runtime/browser-worker.js', route => route.fulfill({contentType: 'text/javascript',
    body: source.replace(anchor, `globalThis.__perfObjects={host,m,scheduler,renderer,touchAdapter};${anchor}`)
      .replace(hostAnchor, "new Win32Host(m,files,{language,program:variant.program,epochMs:Date.parse('2026-09-09T00:00:00Z'),timezoneMinutes:0})")}));
  await page.goto(launchURL.href); await page.waitForTimeout(1000);
  let frame;
  if (isolated) {
    await page.waitForFunction(() => window.fixtureReady || window.fixtureErrors.length, null, {timeout:30000});
    assert.deepEqual(await page.evaluate(() => window.fixtureErrors), []);
    await page.evaluate(() => window.fixtureLaunch());
    frame = page.frames().find(f => f.url().includes('th10.html'));
  } else {
  for (const id of ['changelogConfirm', 'siteNoticeClose']) if (await page.locator('#' + id).isVisible()) await page.locator('#' + id).click();
  await page.locator('button.game[data-game="th10"]').click();
  await page.locator('#gamePackageImport').click();
  await page.locator('#gameDataImportInput').setInputFiles(resolve(project, 'artifacts/validation/th10-touch/th10-touch.package.zip'));
  await page.waitForFunction(() => document.querySelector('#gameDataImportWindow').hidden);
  const navigation = page.waitForEvent('framenavigated', {predicate: f => f.url().includes('th10.html'), timeout: 30000});
  await page.locator('#launch').click(); frame = await navigation;
  }
  await frame.waitForFunction(() => window.nativeStatus?.type === 'error' || window.nativeStatus?.frame >= 450, null, {timeout: 120000});
  const worker = page.workers().find(w => w.url().endsWith('/runtime/browser-worker.js'));
  assert.ok(worker, 'runtime worker');
  const waitFrames = async n => {
    const start = await frame.evaluate(() => window.nativeStatus?.frame ?? 0);
    await frame.waitForFunction(target => window.nativeStatus?.type === 'error' || window.nativeStatus?.frame >= target, start + n, {timeout: 90000});
    const state = await frame.evaluate(() => window.nativeStatus);
    assert.notEqual(state.type, 'error', state.message); return state;
  };
  report.environment = await worker.evaluate(() => {
    const {renderer, m, touchAdapter} = __perfObjects, gl = renderer.gl, ext = gl.getExtension('WEBGL_debug_renderer_info');
    return {ua: navigator.userAgent, renderer: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
      canvas: [renderer.canvas.width, renderer.canvas.height], memory: m.memorySize, touchEnabled: touchAdapter.core.options.touchEnabled,
      cachedViews: m.stateViews.current() !== m.core, cacheRenderState: renderer.cacheState,reuseStaging:renderer.reuseStaging,fastReturns:m.fastReturns,debugGLErrors:renderer.debugErrors};
  });
  assert.equal(report.environment.cachedViews, !reference, 'actual CPU access mode matches A/B request');
  assert.equal(report.environment.cacheRenderState, !renderReference, 'actual renderer matches A/B request');
  assert.equal(report.environment.reuseStaging,!legacySubmission,'actual staging path matches A/B request');
  assert.equal(report.environment.fastReturns,!baselineCPU,'actual return path matches A/B request');
  if (scene === 'stage1') {
    for (let i = 0; i < 5; i++) { await worker.evaluate(() => self.onmessage({data: {type: 'pulse', code: 'KeyZ', frames: 3}})); await waitFrames(75); }
  } else {
    // Leave the title untouched: the original attract demo provides its own
    // dense-bullet input sequence. This is not a touch recording feature.
    await frame.waitForFunction(() => window.nativeStatus?.type === 'error' ||
      window.nativeStatus?.screen?.stage > 0 && window.nativeTouchState?.playerState === 1,
      null, {timeout: 180000});
    await waitFrames(120);
  }
  await frame.waitForFunction(() => window.nativeTouchState?.movementCalls >= 40, null, {timeout: 45000});
  report.start = await frame.evaluate(() => ({status: window.nativeStatus, touch: window.nativeTouchState}));
  await worker.evaluate(({detailed, scene, gpuProbe, setterProbe}) => {
    const {host, m, scheduler, renderer} = __perfObjects;
    const p = globalThis.__stagePerf = {frames: [], apis: {}, stateSetters:{}, stepMs: 0, apiMs: 0, renderMs: 0, steps: 0, started: performance.now()};
    if(setterProbe)for(const name of ['SetTransform','SetViewport','SetScissorRect']){
      const original=host.d3d.deviceMethods[name];host.d3d.deviceMethods[name]=args=>{
        const d=host.d3d.device,previous=name==='SetTransform'?d.transforms.get(args[0]):name==='SetViewport'?d.viewport:d.scissor;
        const bytes=m.view(args[name==='SetTransform'?1:0],name==='SetTransform'?64:name==='SetViewport'?24:16);
        const counter=p.stateSetters[name]??={calls:0,identical:0};counter.calls++;
        if(previous&&previous.length===bytes.length&&previous.every((b,i)=>b===bytes[i]))counter.identical++;
        return original(args);
      };
    }
    const gl=renderer.gl,ext=gpuProbe?gl.getExtension('EXT_disjoint_timer_query_webgl2'):null;
    p.gpu={enabled:gpuProbe,available:!!ext,samples:[],discarded:0,
      scope:'Sparse individual batch GPU elapsed query; not full-frame GPU time'};
    let batchIndex=0;const pending=[];
    const pollGPU=()=>{
      if(!ext||!pending.length)return;
      const disjoint=gl.getParameter(ext.GPU_DISJOINT_EXT);
      for(let i=pending.length-1;i>=0;i--){const item=pending[i];
        if(!disjoint&&!gl.getQueryParameter(item.query,gl.QUERY_RESULT_AVAILABLE))continue;
        if(disjoint)p.gpu.discarded++;
        else p.gpu.samples.push({batch:item.batch,frame:item.frame,bytes:item.bytes,depth:item.depth,ms:gl.getQueryParameter(item.query,gl.QUERY_RESULT)/1e6});
        gl.deleteQuery(item.query);pending.splice(i,1);
      }
    };
    if(ext){const draw=renderer.draw.bind(renderer);renderer.draw=d=>{
      if(++batchIndex%127||pending.length>=8)return draw(d);
      const query=gl.createQuery();gl.beginQuery(ext.TIME_ELAPSED_EXT,query);
      try{return draw(d);}finally{gl.endQuery(ext.TIME_ELAPSED_EXT);pending.push({query,batch:batchIndex,frame:host.d3d.frames,bytes:d.vertices.length,depth:!!d.states.get(7)});}
    };}
    const step = scheduler.step.bind(scheduler);
    scheduler.step = (...args) => { const t = performance.now(); try { return step(...args); } finally { p.stepMs += performance.now() - t; p.steps++; } };
    if (detailed) {
    const invoke = host.invoke.bind(host);
    host.invoke = entry => { const t = performance.now(); try { return invoke(entry); } finally {
      const dt = performance.now() - t; p.apiMs += dt;
      const a = p.apis[entry.name] ??= {calls: 0, ms: 0}; a.calls++; a.ms += dt;
    } };
    for (const name of ['draw', 'clear', 'copy', 'present', 'readSurface']) {
      const original = renderer[name].bind(renderer);
      renderer[name] = (...args) => { const t = performance.now(); try { return original(...args); } finally { p.renderMs += performance.now() - t; } };
    }
    }
    const present = host.d3d.onPresent;
    let last = performance.now(), stepMs = 0, apiMs = 0, renderMs = 0, calls = renderer.stats.calls, batches = renderer.stats.batches, instructions = m.core.instruction_counter[0],submitMs=renderer.submitMs;
    host.d3d.onPresent = (...args) => {
      const result = present(...args), now = performance.now(), count = m.core.instruction_counter[0];
      if (p.frames.length < 3600) p.frames.push({frame: host.d3d.frames, wallMs: now - last,
        stepMs: p.stepMs - stepMs, apiMs: p.apiMs - apiMs, renderMs: p.renderMs - renderMs,
        calls: renderer.stats.calls - calls, batches: renderer.stats.batches - batches, instructions: (count - instructions) >>> 0,submitMs:renderer.submitMs-submitMs});
      last = now; stepMs = p.stepMs; apiMs = p.apiMs; renderMs = p.renderMs;
      calls = renderer.stats.calls; batches = renderer.stats.batches; instructions = count;
      submitMs=renderer.submitMs;
      if(host.d3d.frames%30===0)pollGPU();
      // Capture only AFTER the aligned performance window, so readback never
      // contaminates its timings. Default READ framebuffer is the game surface
      // left bound by present(), at the original 640x480 backing resolution.
      if(scene==='demo'&&host.d3d.frames===1920){
        if(renderer.canvas.width!==640||renderer.canvas.height!==480)throw Error('Demo capture requires original 640x480 backing size');
        const pixels=new Uint8Array(640*480*4);
        gl.readPixels(0,0,640,480,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
        globalThis.__perfPixels=pixels;
        p.pixelState={frame:host.d3d.frames,clock:host.millis,screen:[0x474c7c,0x474c68,0x474c6c,0x474c74,0x474c70,0x474c48].map(a=>m.u32(a)),touch:__perfObjects.touchAdapter.status()};
      }
      return result;
    };
    if (scene === 'stage1') self.onmessage({data: {type: 'key', code: 'KeyZ', down: true}});
  }, {detailed, scene, gpuProbe, setterProbe});
  if (detailed) stopProfile = await beginProfile(browser, worker.url());
  await waitFrames(600);
  report.hotspots = stopProfile ? await stopProfile() : []; stopProfile = null;
  report.measurements = await worker.evaluate(() => __stagePerf);
  if(scene==='demo'){
    const bytes=Buffer.from(await worker.evaluate(()=>Array.from(__perfPixels)));
    assert.equal(bytes.length,640*480*4);assert.ok(new Set(bytes).size>16,'nonempty real Demo pixels');
    writeFileSync(resolve(out,'demo-frame-1920.rgba'),bytes);
    report.demoPixels={...report.measurements.pixelState,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};
  }
  report.gpu=report.measurements.gpu;
  report.end = await frame.evaluate(() => ({status: window.nativeStatus, touch: window.nativeTouchState, performance: window.nativePerformance,
    overlay: document.querySelector('#nativePerformance')?.textContent}));
  if (scene === 'stage1') assert.equal(report.end.status.screen.stage, 1);
  else assert.ok(report.measurements.frames.length > 500, 'original demo provided a useful sample');
  assert.equal(report.end.performance.directViews, !reference);
  assert.equal(report.end.performance.cacheRenderState,!renderReference);
  assert.match(report.end.overlay, /th10-perf-4/);
  await page.screenshot({path: resolve(out, 'stage1.png')});
  // The original demo is deterministic under the diagnostic clock. Align the
  // paired windows by exact logical Present number, not CDP polling latency.
  const f = scene === 'demo' ? report.measurements.frames.filter(x => x.frame >= 1380 && x.frame < 1920) : report.measurements.frames.slice(2);
  if (scene === 'demo') assert.equal(f.length, 540, 'complete aligned Demo window');
  const sum = key => f.reduce((total, x) => total + x[key], 0) / f.length;
  const intervals=f.map(x=>x.wallMs).sort((a,b)=>a-b),pct=p=>intervals[Math.max(0,Math.ceil(intervals.length*p)-1)];
  report.summary = {frames: f.length, firstFrame:f[0].frame,lastFrame:f.at(-1).frame,wallMs: sum('wallMs'), stepMs: sum('stepMs'), apiMs: detailed?sum('apiMs'):null,
    renderMs: detailed?sum('renderMs'):null, submitMs:sum('submitMs'),drawCalls: sum('calls'), batches: sum('batches'), instructions: sum('instructions'),
    p50WallMs:pct(.5),p95WallMs:pct(.95),p99WallMs:pct(.99),maxWallMs:intervals.at(-1)};
  report.apiHotspots = Object.entries(report.measurements.apis).sort((a,b) => b[1].ms - a[1].ms).slice(0, 20);
  assert.deepEqual(report.errors, []); report.ok = true;
} catch (error) { report.ok = false; report.error = String(error.stack ?? error); process.exitCode = 1; }
finally {
  if (stopProfile) await stopProfile().catch(() => {});
  await browser?.close();
  if (fixture) {report.fixtureReads = Object.fromEntries(fixture.requests);await fixture.close();}
  if (server && server.exitCode === null) { const stopped = new Promise(resolve => server.once('exit', resolve)); server.kill(); await stopped; }
  writeFileSync(resolve(out, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({...report, measurements: undefined, end: undefined}, null, 2));
}
