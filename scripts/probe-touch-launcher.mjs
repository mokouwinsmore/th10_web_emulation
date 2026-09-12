import {chromium} from 'playwright';
import {writeFileSync, mkdirSync} from 'node:fs';
const out = 'artifacts/validation/touch-audit'; mkdirSync(out, {recursive: true});
const browser = await chromium.launch({headless: true, ...(process.env.TH10_CHROMIUM ? {executablePath: process.env.TH10_CHROMIUM} : {channel: 'msedge'}), args: ['--enable-unsafe-swiftshader']});
try {
  const page = await browser.newPage({viewport: {width: 1280, height: 900}}), errors = [];
  page.on('pageerror', error => errors.push(String(error)));
  await page.goto(process.argv[2] ?? 'http://127.0.0.1:8294/'); await page.waitForTimeout(2000);
  const state = {text: await page.locator('body').innerText(), buttons: await page.locator('button').evaluateAll(buttons => buttons.map(button =>
    ({id: button.id, text: button.textContent?.trim(), game: button.dataset.game, action: button.dataset.action})).filter(button => button.id || button.game)), errors};
  console.log(JSON.stringify(state, null, 2)); writeFileSync(`${out}/launcher-initial.json`, JSON.stringify(state, null, 2));
  await page.screenshot({path: `${out}/launcher-initial.png`});
} finally { await browser.close(); }
