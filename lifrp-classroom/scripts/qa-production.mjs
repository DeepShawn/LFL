import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { productionServer } from './qa-server.mjs';

const server = await productionServer();
const url = server.url;
const output = process.env.QA_OUTPUT || '/tmp/lifrp-qa-v2';
await mkdir(output, { recursive: true });
const results = [];
const browser = await chromium.launch({ headless: process.env.QA_HEADLESS === '1' || !process.env.DISPLAY, args: ['--use-gl=angle', '--use-angle=gl', '--ignore-gpu-blocklist', '--enable-webgl', '--disable-gpu-sandbox'], env: { ...process.env, LIBGL_ALWAYS_SOFTWARE: '1' } });
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

async function contextAction(page, id, roll) {
  let button = page.locator(`#interaction-hub button[data-action="${id}"]`);
  if (!(await button.count())) {
    const more = page.locator('#interaction-hub .interaction-more');
    if (await more.count()) await more.click({ force: true });
    button = page.locator(`#interaction-hub button[data-action="${id}"]`);
  }
  if (!(await button.count())) { const state = await snapshot(page); throw new Error(`missing context action ${id}; state=${JSON.stringify({ currentEvent: state.currentEvent, phase: state.phase, result: state.results[state.currentEvent], snack: state.data.snacking })} position=${JSON.stringify(state.position)} hub=${JSON.stringify(await page.locator('#interaction-hub').innerText())}`); }
  await button.waitFor({ state: 'visible' });
  assert.equal(await button.isEnabled(), true, `context action ${id} should be enabled`);
  if (roll === undefined) await button.click({ force: true });
  else await button.evaluate((node, value) => {
    const random = Math.random;
    try { Math.random = () => value; node.click(); }
    finally { Math.random = random; }
  }, roll);
  const dialog = page.locator('dialog[open]');
  if (await dialog.count()) {
    const confirm = dialog.locator('.primary-button');
    if (await confirm.count()) {
      if (roll === undefined) await confirm.click({ force: true });
      else await confirm.evaluate((node, value) => {
        const random = Math.random;
        try { Math.random = () => value; node.click(); }
        finally { Math.random = random; }
      }, roll);
    }
  }
  await page.waitForTimeout(80);
}

async function walkTo(page, point, waypoints = []) {
  for (const destination of [...waypoints, point]) {
    for (let attempt = 0; attempt < 14; attempt += 1) {
      const current = (await snapshot(page)).position;
      const dx = destination.x - current.x;
      const dz = destination.z - current.z;
      if (Math.hypot(dx, dz) < .05) break;
      const axis = Math.abs(dx) >= Math.abs(dz) ? 'x' : 'z';
      const amount = axis === 'x' ? dx : dz;
      const code = axis === 'x' ? (amount > 0 ? 'KeyD' : 'KeyA') : (amount > 0 ? 'KeyS' : 'KeyW');
      const before = await snapshot(page);
      await page.keyboard.down(code);
      await page.waitForTimeout(Math.max(700, Math.min(1200, Math.abs(amount) / 2.35 * 1000)));
      await page.keyboard.up(code);
      await page.waitForTimeout(45);
      const after = await snapshot(page);
      if (Math.hypot(after.position.x - before.position.x, after.position.z - before.position.z) < .03) {
        // A table or partition blocked the straight segment. The next waypoint
        // (when supplied) gives the same lightweight pathing a second chance.
        break;
      }
    }
  }
  const end = await snapshot(page);
  assert.ok(Math.hypot(end.position.x - point.x, end.position.z - point.z) < 1.75, `could not approach ${JSON.stringify(point)} from ${JSON.stringify(end.position)}`);
}

function targetFor(room, action, point) {
  if (action.startsWith('go:')) {
    const destination = action.slice(3);
    return `${room}:${destination === 'corridor' ? 'corridor-door' : `${destination}-door`}`;
  }
  if (room === 'classroom') {
    if (point.z < -2.2) return point.x < -1 ? 'classroom:submit' : 'classroom:board';
    return 'classroom:desk';
  }
  if (room === 'corridor') return 'corridor:witness';
  if (point.z > 2) return 'office:corridor-door';
  return action === 'intervene:organize' ? 'office:teacher' : 'office:records';
}

async function clickTarget(page, targetId, point) {
  const screen = await page.evaluate(id => window.__lifrp.targetScreen(id), targetId);
  if (!screen) {
    const state = await snapshot(page);
    console.warn(`targetScreen unavailable target=${targetId} state=${JSON.stringify({ room: state.room, view: state.view, position: state.position, phase: state.phase })} metrics=${JSON.stringify(await page.evaluate(() => window.__lifrp.metrics()))}`);
    return walkTo(page, point);
  }
  await page.evaluate(({ x, y }) => {
    const canvas = document.querySelector('#game-canvas');
    if (!canvas) return;
    const init = { clientX: x, clientY: y, pointerId: 91, bubbles: true, button: 0 };
    canvas.dispatchEvent(new PointerEvent('pointerdown', init));
    canvas.dispatchEvent(new PointerEvent('pointerup', init));
  }, screen);
  try {
    await page.waitForFunction(({ x, z }) => {
      const position = window.__lifrp.snapshot().position;
      return Math.hypot(position.x - x, position.z - z) < 1.15;
    }, point);
  } catch (error) {
    const state = await snapshot(page);
    throw new Error(`${error.message}; target=${targetId} requested=${JSON.stringify(point)} state=${JSON.stringify({ room: state.room, position: state.position, status: state.status, hub: await page.locator('#interaction-hub').innerText() })}`);
  }
}

async function sceneAction(page, id, point, waypoints = [], roll) {
  const room = (await snapshot(page)).room;
  await clickTarget(page, targetFor(room, id, point), point);
  await contextAction(page, id, roll);
}

async function enterRoom(page, room, door, waypoints = []) {
  const fromRoom = (await snapshot(page)).room;
  if (fromRoom === room) {
    await page.waitForFunction(roomName => {
      const state = window.__lifrp.snapshot();
      const metrics = window.__lifrp.metrics();
      return state.room === roomName && metrics.room === roomName && metrics.loaded;
    }, room);
    return;
  }
  await clickTarget(page, targetFor(fromRoom, `go:${room}`, door), door);
  await contextAction(page, `go:${room}`);
  try {
    await page.waitForFunction(roomName => window.__lifrp.snapshot().room === roomName, room);
  } catch (error) {
    const state = await snapshot(page);
    throw new Error(`${error.message}; enter=${room} state=${JSON.stringify({ room: state.room, position: state.position, status: await page.locator('#scene-status').innerText(), phase: state.phase, hub: await page.locator('#interaction-hub').innerText() })}`);
  }
  await page.waitForFunction(roomName => {
    const state = window.__lifrp.snapshot();
    const metrics = window.__lifrp.metrics();
    return state.room === roomName && metrics.room === roomName && metrics.loaded;
  }, room);
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
    await page.waitForFunction(() => window.__lifrp.snapshot().view === 'map' && window.__lifrp.snapshot().switchRemaining === 0);
    await sceneAction(page, 'inspect:q2', { x: 0, z: .55 });
    await sceneAction(page, 'inspect:q5', { x: 0, z: .55 });
    await sceneAction(page, 'solve:q2:44', { x: 0, z: .55 });
    await sceneAction(page, 'solve:q5:balanced', { x: 0, z: .55 });
    await sceneAction(page, 'submit', { x: -1.25, z: -2.85 }, [{ x: 0, z: -2.8 }]);
    await click(page, 'next');
    const target=(await snapshot(page)).data.snacking.target;
    for(let i=0;i<target;i++) {
      await page.waitForFunction(() => { const g=window.__lifrp.snapshot();return !g.data.snacking.watching && g.data.snacking.watchRemaining>1.8 && g.data.snacking.biteRemaining<=0; });
      await sceneAction(page, 'snack', { x: 0, z: .55 }, [{ x: 0, z: -2.4 }]);
      assert.equal((await snapshot(page)).data.snacking.eaten,i+1);
    }
    await click(page,'advance');
    await sceneAction(page, 'evidence:blackboard', { x: 0, z: -3.18 });
    await sceneAction(page, 'evidence:experiment', { x: 0, z: -3.18 });
    await sceneAction(page, 'answer:surface-area', { x: 0, z: -3.18 }, [], .99);
    await click(page, 'next');
    await sceneAction(page, 'evidence:blackboard', { x: 0, z: -3.18 });
    await sceneAction(page, 'evidence:textbook', { x: 0, z: -3.18 });
    await enterRoom(page, 'corridor', { x: -4.45, z: -1 });
    await sceneAction(page, 'evidence:witness', { x: 0, z: 0 });
    await enterRoom(page, 'classroom', { x: -9.5, z: -.9 });
    await sceneAction(page, 'speak:fact', { x: 0, z: -3.18 });
    await sceneAction(page, 'speak:clarify', { x: 0, z: -3.18 });
    await sceneAction(page, 'speak:learn', { x: 0, z: -3.18 });
    await click(page,'advance');
    await sceneAction(page, 'evidence:work', { x: 0, z: .55 });
    await enterRoom(page, 'corridor', { x: -4.45, z: -1 });
    await sceneAction(page, 'evidence:witness', { x: 0, z: 0 });
    await enterRoom(page, 'classroom', { x: -9.5, z: -.9 });
    await sceneAction(page, 'explain:method', { x: 0, z: .55 });
    await sceneAction(page, 'difference:reasoning', { x: 0, z: .55 });
    await sceneAction(page, 'submit', { x: 0, z: .55 });
    await click(page, 'next');
    await enterRoom(page, 'corridor', { x: -4.45, z: -1 });
    await sceneAction(page, 'evidence:witness', { x: 0, z: 0 });
    await enterRoom(page, 'office', { x: 9.5, z: -.9 });
    await sceneAction(page, 'evidence:order', { x: 0, z: -3.05 });
    await enterRoom(page, 'corridor', { x: 0, z: 3.1 }, [{ x: 1.4, z: -3.2 }, { x: 1.4, z: 3.25 }, { x: 0, z: 3.1 }]);
    await sceneAction(page, 'judge:serious', { x: 0, z: 0 });
    await sceneAction(page, 'divert', { x: 0, z: 0 }, [], .01);
    const teaState = await snapshot(page);
    assert.equal(teaState.results['milk-tea'], 'success', `tea result=${teaState.results['milk-tea']} data=${JSON.stringify(teaState.data['milk-tea'])} history=${JSON.stringify(teaState.history.slice(-5))} hub=${JSON.stringify(await page.locator('#interaction-hub').innerText())}`);
    await click(page,'advance');
    await enterRoom(page, 'classroom', { x: -9.5, z: -.9 });
    await sceneAction(page, 'evidence:classroom', { x: 0, z: -3.18 });
    await enterRoom(page, 'corridor', { x: -4.45, z: -1 });
    await enterRoom(page, 'office', { x: 9.5, z: -.9 });
    await sceneAction(page, 'evidence:office', { x: 0, z: -3.05 });
    await enterRoom(page, 'corridor', { x: 0, z: 3.1 }, [{ x: 1.4, z: -3.2 }, { x: 1.4, z: 3.25 }, { x: 0, z: 3.1 }]);
    await sceneAction(page, 'evidence:witness', { x: 0, z: 0 });
    await sceneAction(page, 'intervene:dialogue', { x: 0, z: 0 });
    await click(page,'advance');
    await enterRoom(page, 'classroom', { x: -9.5, z: -.9 });
    for(const action of ['schedule:balanced','track','study','track','study','holiday:next-day','schedule:balanced','track','study','track','study','holiday:next-day','schedule:balanced','rest','track','study','submit']) await sceneAction(page, action, { x: 0, z: .55 });
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
    await page.goto(url, { waitUntil: 'networkidle' });
    await page.evaluate(f=>localStorage.setItem('lifrp-classroom:v2:day',JSON.stringify({version:2,game:f})),fixture);
    await page.getByRole('button',{name:/一天生存/}).click();await click(page,'continue');
    await page.waitForFunction(()=>window.__lifrp.metrics().loaded);
    await page.keyboard.press('KeyE');
    await page.waitForFunction(()=>window.__lifrp.snapshot().phase==='ending');
    const escaped=await snapshot(page);assert.equal(escaped.room,'office');assert.equal(escaped.results['milk-tea'],'success');
    const failed={...fixture,position:{x:0,z:0},chase:{remaining:.15,distance:5,goalRoom:'office'}};
    await click(page,'home');
    await page.evaluate(f=>localStorage.setItem('lifrp-classroom:v2:day',JSON.stringify({version:2,game:f})),failed);
    await page.getByRole('button',{name:/一天生存/}).click();await click(page,'continue');
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
