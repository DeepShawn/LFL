import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { writeFile, mkdir } from 'node:fs/promises';
const baseUrl = process.env.QA_URL || 'http://127.0.0.1:5173/';
const output = process.env.QA_OUTPUT || '/tmp/lifrp-qa-v2';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: process.env.QA_HEADLESS === '1' || !process.env.DISPLAY, args: ['--use-gl=angle', '--use-angle=gl', '--ignore-gpu-blocklist', '--enable-webgl', '--disable-gpu-sandbox'], env: { ...process.env, LIBGL_ALWAYS_SOFTWARE: '1' } });
const reports = [];
try {
  const scenarios = [
    { name: 'source-baseline', query: '?assetBaseline=1', viewport: {width:960,height:600}, mobile:false, quality:'medium' },
    { name: 'optimized-same-settings', query: '', viewport: {width:960,height:600}, mobile:false, quality:'medium' },
    { name: 'desktop-high', query: '', viewport: {width:1280,height:800}, mobile:false, quality:'high' },
    { name: 'mobile-standard', query: '', viewport: {width:844,height:390}, mobile:true, quality:'medium' },
  ];
  if (process.env.NO_BASELINE) scenarios.shift();
  for (const scenario of scenarios) {
    const context=await browser.newContext({viewport:scenario.viewport,hasTouch:scenario.mobile,isMobile:scenario.mobile,deviceScaleFactor:scenario.mobile?2:1});
    const page=await context.newPage(); const errors=[];
    page.on('pageerror',e=>errors.push(e.message)); page.on('console',e=>{if(e.type()==='error')errors.push(e.text())});
    await page.goto(baseUrl+scenario.query,{waitUntil:'networkidle'});
    await page.evaluate(quality=>{localStorage.setItem('lifrp-classroom:v2:settings',JSON.stringify({quality,speech:false,sound:false}));},scenario.quality);
    await page.reload({waitUntil:'networkidle'});
    await page.fill('#player-name','性能验收');
    await page.locator('[data-action=new-game]').click();await page.locator('[data-action=confirm-seat]').click();
    await page.waitForFunction(()=>window.__lifrp.metrics().loaded && window.__lifrp.metrics().totalFrames>10);
    await page.locator('[data-action=panel]').click();
    await page.evaluate(()=>window.__lifrp.resetMetrics());
    await page.waitForTimeout(6500);
    const metrics=await page.evaluate(()=>window.__lifrp.metrics());
    assert.equal(metrics.webgl,'WebGL2');assert.ok(metrics.frames>5 && metrics.drawCalls>0);
    assert.deepEqual(errors,[]);
    const resources=await page.evaluate(()=>performance.getEntriesByType('resource').filter(e=>e.name.includes('.glb')).map(e=>({url:e.name,bytes:e.encodedBodySize,ms:e.duration})));
    await page.screenshot({path:`${output}/${scenario.name}.png`});
    reports.push({name:scenario.name,viewport:scenario.viewport,softwareRenderer:'Chromium ANGLE / Mesa llvmpipe (not device GPU)',...metrics,resources});
    await context.close();
  }
} finally { await browser.close(); }
if(!process.env.NO_BASELINE) {
  const original=reports[0],optimized=reports[1];
  assert.ok(optimized.drawCalls < original.drawCalls * .5,'optimization must materially reduce draw calls');
}
await writeFile(`${output}/performance.json`,JSON.stringify({baseUrl,reports},null,2));
console.log(JSON.stringify({baseUrl,reports},null,2));
