import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdirSync, writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {spawn} from 'node:child_process';
const output = resolve('artifacts/validation/touch-audit'), url = process.argv[2] ?? 'http://127.0.0.1:8294/';
mkdirSync(output, {recursive: true});
const report = {date: new Date().toISOString(), url, browser: 'Edge Chromium desktop, software WebGL; touch emulation, not a physical phone', checks: [], errors: [], requestsFailed: []};
const browser = await chromium.launch({headless: true, ...(process.env.TH10_CHROMIUM ? {executablePath: process.env.TH10_CHROMIUM} : {channel: 'msedge'}), args: ['--enable-unsafe-swiftshader']});
let page, frame, server;
try {
  if (!process.argv[2]) {
    server = spawn(process.execPath, ['scripts/serve.mjs', '8294'], {cwd: resolve('../../../eagler-touhou'), stdio: ['ignore', 'pipe', 'pipe'], shell: false});
    let log = '';
    await new Promise((resolveReady, reject) => {
      const timer = setTimeout(() => reject(new Error(`Local test server did not start: ${log}`)), 60000);
      server.stdout.on('data', bytes => { log += bytes; if (log.includes('eagler-touhou: http://')) { clearTimeout(timer); resolveReady(); } });
      server.stderr.on('data', bytes => { log += bytes; });
      server.once('error', error => { clearTimeout(timer); reject(error); });
      server.once('exit', code => { clearTimeout(timer); reject(new Error(`Local test server exited (${code}): ${log}`)); });
    });
  }
  const context = await browser.newContext({viewport: {width: 1280, height: 900}, hasTouch: true});
  await context.addInitScript(() => {
    window.__touchTestEvents = [];
    for (const name of ['pointerdown', 'pointerup', 'pointercancel', 'touchstart', 'touchend']) addEventListener(name, event => {
      if (window.__touchTestEvents.length < 40) window.__touchTestEvents.push({type: event.type, target: event.target?.id,
        pointerType: event.pointerType, x: event.clientX, y: event.clientY, defaultPrevented: event.defaultPrevented});
    }, true);
  });
  page = await context.newPage(); page.on('pageerror', error => report.errors.push(String(error)));
  page.on('requestfailed', request => report.requestsFailed.push({url: request.url(), error: request.failure()?.errorText}));
  await page.goto(url); await page.waitForTimeout(1500);
  for (const selector of ['#changelogConfirm', '#siteNoticeClose']) if (await page.locator(selector).isVisible()) await page.locator(selector).click();
  await page.locator('button.game[data-game="th10"]').click();
  await page.locator('#gamePackageImport').click();
  await page.locator('#gameDataImportInput').setInputFiles(resolve('artifacts/validation/th10-touch/th10-touch.package.zip'));
  await page.waitForFunction(() => document.querySelector('#gameDataImportWindow').hidden, null, {timeout: 30000});
  report.checks.push({name: 'real TH10 card and standard Package Store import'});
  if (await page.locator('#mobileOptionsToggle').getAttribute('aria-expanded') !== 'true') await page.locator('#mobileOptionsToggle').click();
  await page.locator('#touchToggle').click();
  if (await page.locator('#decisionDialog').isVisible()) await page.locator('#decisionConfirm').click();
  const navigation = page.waitForEvent('framenavigated', {predicate: item => item.url().includes('th10.html'), timeout: 30000});
  await page.locator('#launch').click();
  frame = await navigation;
  assert.ok(frame, 'TH10 runs in the real launcher iframe');
  if (await page.locator('#touchHelpClose').isVisible()) await page.locator('#touchHelpClose').click();
  await frame.waitForFunction(() => window.nativeStatus?.type === 'error' || window.nativeStatus?.frame >= 450, null, {timeout: 120000});
  let native = await frame.evaluate(() => window.nativeStatus); assert.notEqual(native?.type, 'error', native?.message);
  if (await page.locator('#touchHelpClose').isVisible()) await page.locator('#touchHelpClose').click();
  report.checks.push({name: 'managed DATA, worker, WebGL and first frame', status: native});
  await page.screenshot({path: resolve(output, 'hosted-title.png')});
  for (let i = 0; i < 5; i++) {
    const before = await frame.evaluate(() => window.nativeStatus?.frame ?? 0);
    const box = await frame.locator('#canvas').boundingBox(); assert.ok(box);
    const hit = await page.evaluate(({x, y}) => ({elements: document.elementsFromPoint(x, y).slice(0, 6).map(element => ({tag: element.tagName, id: element.id, className: element.className})),
      parentEvents: window.__touchTestEvents}), {x: box.x + box.width / 2, y: box.y + box.height / 2});
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
    await frame.waitForFunction(frame => window.nativeStatus?.type === 'error' || window.nativeStatus?.frame >= frame + 75, before, {timeout: 30000});
    report.checks.push({name: `browser menu tap ${i + 1}`, hit, parentEvents: await page.evaluate(() => window.__touchTestEvents), native: await frame.evaluate(() => ({touch: window.nativeTouchState, events: window.__touchTestEvents,
      canvas: document.querySelector('#canvas').getBoundingClientRect().toJSON(), size: [innerWidth, innerHeight]}))});
    if (i === 0 && !(await frame.evaluate(() => window.nativeTouchState?.pointerEvents))) throw new Error('First trusted touch did not reach runtime; inspect parent hit-test evidence');
  }
  await frame.waitForFunction(() => window.nativeStatus?.type === 'error' ||
    window.nativeTouchState?.mode === 'gameplay' && window.nativeTouchState?.playerState === 1 &&
    window.nativeStatus?.screen?.stage === 1 && window.nativeTouchState?.movementCalls >= 30, null, {timeout: 45000});
  native = await frame.evaluate(() => ({status: window.nativeStatus, touch: window.nativeTouchState}));
  assert.equal(native.touch?.mode, 'gameplay'); assert.equal(native.status.screen.stage, 1);
  report.checks.push({name: 'five trusted browser touch taps enter the original Stage 1', ...native});
  await page.screenshot({path: resolve(output, 'hosted-stage1.png')});
  const cdp = await context.newCDPSession(page), box = await frame.locator('#canvas').boundingBox();
  const start = await frame.evaluate(() => window.nativeTouchState.position);
  const point = {id: 1, x: box.x + box.width * 0.3, y: box.y + box.height * 0.75};
  await cdp.send('Input.dispatchTouchEvent', {type: 'touchStart', touchPoints: [point]});
  await cdp.send('Input.dispatchTouchEvent', {type: 'touchMove', touchPoints: [{...point, x: point.x + box.width * 0.3}]});
  await frame.waitForFunction(x => window.nativeTouchState?.position?.fixedX > x, start.fixedX, {timeout: 10000});
  const during = await frame.evaluate(() => window.nativeTouchState.position);
  await cdp.send('Input.dispatchTouchEvent', {type: 'touchEnd', touchPoints: []});
  assert.ok(during.fixedX > start.fixedX, 'trusted drag reaches real player position');
  assert.ok(during.fixedX - start.fixedX < 19200, 'limited drag does not teleport to target');
  const releaseSample = await frame.evaluate(() => window.nativeTouchState.inputSamples);
  await frame.waitForFunction(n => window.nativeTouchState?.inputSamples >= n + 20, releaseSample);
  const released = await frame.evaluate(() => window.nativeTouchState.position);
  await frame.waitForFunction(n => window.nativeTouchState?.inputSamples >= n + 40, releaseSample);
  const later = await frame.evaluate(() => window.nativeTouchState.position);
  assert.equal(later.fixedX, released.fixedX);
  report.checks.push({name: 'real host/canvas coordinate drag is speed-limited and stops on release', start, during, released, later});
  await page.touchscreen.tap(...await page.locator('#touchEscape').evaluate(element => { const rect = element.getBoundingClientRect(); return [rect.x + rect.width / 2, rect.y + rect.height / 2]; }));
  await frame.waitForFunction(() => window.nativeTouchState?.mode === 'menu', null, {timeout: 10000});
  report.checks.push({name: 'launcher touch Escape reaches native pause menu', state: await frame.evaluate(() => window.nativeTouchState)});
  await page.screenshot({path: resolve(output, 'hosted-pause.png')});
  assert.deepEqual(report.errors, []); report.ok = true;
} catch (error) {
  report.ok = false; report.error = String(error.stack ?? error); console.error(report.error); process.exitCode = 1;
  if (page) {
    report.body = await page.locator('body').innerText().catch(() => 'unavailable');
    report.frames = page.frames().map(frame => frame.url());
    report.native = await frame?.evaluate(() => ({status: window.nativeStatus, touch: window.nativeTouchState})).catch(() => null);
    await page.screenshot({path: resolve(output, 'hosted-failure.png')}).catch(() => {});
  }
} finally {
  await browser.close();
  if (server && server.exitCode === null) { const stopped = new Promise(resolve => server.once('exit', resolve)); server.kill(); await stopped; }
  writeFileSync(resolve(output, 'hosted-touch.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2));
}
