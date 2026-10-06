import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { productionServer } from './qa-server.mjs';

const server = await productionServer();
const url = server.url;
const output = process.env.QA_OUTPUT || '/tmp/lifrp-qa-v2';
await mkdir(output, { recursive: true });
const results = [];
const browser = await chromium.launch({ headless: false, args: ['--use-gl=angle', '--use-angle=gl', '--ignore-gpu-blocklist', '--enable-webgl', '--disable-gpu-sandbox'], env: { ...process.env, LIBGL_ALWAYS_SOFTWARE: '1' } });
const click = (page, id) => page.locator(`[data-action="${id}"]`).click();
const snapshot = page => page.evaluate(() => window.__lifrp.snapshot());
async function clickWithRoll(page, id, roll) {
  const button = page.locator(`[data-action="${id}"]`);
  await button.waitFor({ state: 'visible' });
  assert.equal(await button.isEnabled(), true);
  await button.evaluate((node, value) => {
    const random = Math.random;
    try { Math.random = () => value; node.click(); }
    finally { Math.random = random; }
  }, roll);
}

async function start(page, mobile = false) {
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.fill('#player-name', mobile ? '移动验收' : '桌面验收');
  await page.selectOption('#role-select', 'monitor');
  await clickWithRoll(page, 'new-game', .2);
  await click(page, 'confirm-seat');
  await page.waitForFunction(() => window.__lifrp.metrics().loaded && window.__lifrp.metrics().totalFrames >= 5);
  const m = await page.evaluate(() => window.__lifrp.metrics());
  assert.equal(m.webgl, 'WebGL2');
  assert.ok(m.meshes > 0 && m.drawCalls > 0 && m.triangles > 0, 'real GLB must be rendered');
  assert.equal(await page.locator('.scene-fallback').count(), 0, 'fallback must not count as WebGL success');
  return m;
}

async function run(name, test) {
  try { const evidence = await test(); results.push({ name, passed: true, evidence }); }
  catch (error) { results.push({ name, passed: false, error: error.stack || error.message }); }
}

await run('Desktop: real model, five chapters, all eight objectives and ending', async () => {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [], requests = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
  page.on('response', response => { if (response.url().includes('.glb')) requests.push({ url: response.url(), status: response.status() }); });
  try {
    const initial = await start(page);
    await page.screenshot({ path: `${output}/desktop-map.png` });
    await click(page, 'view');
    await page.waitForFunction(() => window.__lifrp.snapshot().switchRemaining === 0);
    const before = await snapshot(page);
    await page.keyboard.down('KeyW');
    await page.waitForFunction(z => Math.abs(window.__lifrp.snapshot().position.z - z) > .2, before.position.z);
    await page.keyboard.up('KeyW');
    await page.screenshot({ path: `${output}/desktop-first-person.png` });
    await click(page, 'view');
    for (const action of ['inspect:q2','inspect:q5','solve:q2:44','solve:q5:balanced','submit']) await click(page, action);
    await page.locator('.event-chip').nth(1).click();
    const target=(await snapshot(page)).data.snacking.target;
    for(let i=0;i<target;i++) {
      await page.waitForFunction(() => { const g=window.__lifrp.snapshot();return !g.data.snacking.watching && g.data.snacking.watchRemaining>1.8 && g.data.snacking.biteRemaining<=0; });
      await click(page,'snack');
      assert.equal((await snapshot(page)).data.snacking.eaten,i+1);
    }
    await click(page,'advance');
    for(const action of ['evidence:blackboard','evidence:experiment']) await click(page,action);
    await clickWithRoll(page,'answer:surface-area',.99);
    await page.locator('.event-chip').nth(1).click();
    for(const action of ['evidence:blackboard','evidence:textbook','go:corridor','evidence:witness','go:classroom','speak:fact','speak:clarify','speak:learn']) await click(page,action);
    await click(page,'advance');
    for(const action of ['evidence:work','go:corridor','evidence:witness','go:classroom','explain:method','difference:reasoning','submit']) await click(page,action);
    await page.locator('.event-chip').nth(1).click();
    for(const action of ['go:corridor','evidence:witness','go:office','evidence:order','go:corridor','judge:serious']) await click(page,action);
    await clickWithRoll(page,'divert',.01);
    assert.equal((await snapshot(page)).results['milk-tea'], 'success');
    await click(page,'advance');
    for(const action of ['evidence:classroom','go:office','evidence:office','go:corridor','evidence:witness','intervene:dialogue']) await click(page,action);
    await click(page,'advance');
    for(const action of ['schedule:balanced','track','study','track','study','holiday:next-day','schedule:balanced','track','study','track','study','holiday:next-day','schedule:balanced','rest','track','study','submit']) await click(page,action);
    const ended = await snapshot(page);
    assert.equal(ended.phase,'ending');
    assert.ok(['perfect','ordinary'].includes(ended.outcome));
    assert.equal(Object.values(ended.results).filter(x=>x==='success').length,8);
    assert.deepEqual(errors,[]);
    assert.ok(requests.length >= 3 && requests.every(x=>x.status===200));
    await page.screenshot({path:`${output}/ending.png`});
    await click(page,'home');
    await click(page,'continue');
    await page.waitForSelector('[data-action=home]');
    assert.equal((await snapshot(page)).outcome,ended.outcome);
    return { initial, outcome: ended.outcome, successfulEvents:8, glbRequests:requests };
  } finally { await page.close(); }
});

await run('Mobile portrait/landscape: WebGL2, touch movement, controls, saving, rendering after resume', async()=>{
  const context = await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:2});
  const page = await context.newPage();const errors=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('console',e=>{if(e.type()==='error')errors.push(e.text())});
  try {
    const initial=await start(page,true);
    assert.equal(initial.assetTier,'mobile');
    const width=await page.evaluate(()=>({scroll:document.documentElement.scrollWidth,client:document.documentElement.clientWidth}));
    assert.equal(width.scroll,width.client);
    const p0=(await snapshot(page)).position;
    const rect=await page.locator('#joystick').boundingBox();
    const cdp = await context.newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: rect.x+rect.width/2, y: rect.y+rect.height/2-25, id: 1 }] });
    await page.waitForFunction(p=>Math.hypot(window.__lifrp.snapshot().position.x-p.x,window.__lifrp.snapshot().position.z-p.z)>.15,p0);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.screenshot({path:`${output}/mobile-portrait.png`});
    await page.setViewportSize({width:844,height:390});
    await page.screenshot({path:`${output}/mobile-landscape.png`});
    await click(page,'settings');
    const elapsed=(await snapshot(page)).elapsed;
    await page.waitForTimeout(500);
    assert.equal((await snapshot(page)).elapsed,elapsed,'settings pause simulation');
    await page.selectOption('select[aria-label="画质"]','low');
    await page.getByRole('button',{name:'关闭',exact:true}).click();
    await page.waitForFunction(()=>window.__lifrp.metrics().quality==='low' && window.__lifrp.metrics().loaded);
    await click(page,'settings');
    await page.getByRole('button',{name:'保存并返回菜单'}).click();
    await click(page,'continue');
    await page.waitForFunction(()=>window.__lifrp.metrics().loaded && window.__lifrp.metrics().totalFrames>5);
    assert.ok((await snapshot(page)).elapsed >= elapsed);
    assert.deepEqual(errors,[]);
    return {initial, resumed:await page.evaluate(()=>window.__lifrp.metrics()),errors};
  } finally { await context.close(); }
});
await run('Chase, failure settlement and isolated day save', async () => {
  const context = await browser.newContext({ viewport: { width: 960, height: 600 } });
  const page = await context.newPage();
  const errors=[];page.on('pageerror', e=>errors.push(e.message));
  try {
    await start(page);
    const initial=await snapshot(page);
    const fixture={...initial, mode:'day', difficulty:'terror', phase:'chase', room:'corridor', view:'first-person', position:{x:9.5,z:-.9}, chase:{remaining:18,distance:5,goalRoom:'office'}, currentEvent:'milk-tea', events:['milk-tea'], results:{...initial.results,'milk-tea':'pending'}, data:structuredClone(initial.data)};
    fixture.data['milk-tea'].stage='evasion';fixture.data['milk-tea'].routeStarted=true;
    await page.evaluate(f=>localStorage.setItem('lifrp-classroom:v2:day',JSON.stringify({version:2,game:f})),fixture);
    await page.reload();await page.getByRole('button',{name:/一天生存/}).click();await click(page,'continue');
    await page.waitForFunction(()=>window.__lifrp.metrics().loaded);
    await page.keyboard.press('KeyE');
    await page.waitForFunction(()=>window.__lifrp.snapshot().phase==='ending');
    const escaped=await snapshot(page);assert.equal(escaped.room,'office');assert.equal(escaped.results['milk-tea'],'success');
    const failed={...fixture,position:{x:0,z:0},chase:{remaining:.15,distance:5,goalRoom:'office'}};
    await click(page,'home');
    await page.evaluate(f=>localStorage.setItem('lifrp-classroom:v2:day',JSON.stringify({version:2,game:f})),failed);
    await page.reload();await page.getByRole('button',{name:/一天生存/}).click();await click(page,'continue');
    await page.waitForFunction(()=>window.__lifrp.snapshot().phase==='ending');
    assert.equal((await snapshot(page)).outcome,'terror');
    assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('lifrp-classroom:v2:chapters')).game.mode),'chapters');
    assert.deepEqual(errors,[]);
    return { physicalDoorEscape:escaped.outcome, chaseTimeout:'terror', chapterSaveIntact:true };
  } finally { await context.close(); }
});
await browser.close();
await server.close();
await writeFile(`${output}/results.json`,JSON.stringify({url,softwareRenderer:true,results},null,2));
console.log(JSON.stringify({url,softwareRenderer:true,results},null,2));
if(results.some(x=>!x.passed))process.exitCode=1;
