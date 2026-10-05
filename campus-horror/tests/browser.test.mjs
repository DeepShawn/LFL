import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createStaticServer } from '../scripts/serve.mjs';
import { createGame } from '../site/game.js';
import { getScene } from '../site/world.js';
import { SaveStore } from '../site/storage.js';

let server, browser, base;
const artifacts = fileURLToPath(new URL('../artifacts/', import.meta.url));
before(async () => {
  await mkdir(artifacts, { recursive: true });
  server = createStaticServer(fileURLToPath(new URL('../site/', import.meta.url)), '/night-school');
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}/night-school/`;
  browser = await chromium.launch(process.env.CAMPUS_MESA ? {
    headless: true, channel: 'chromium', args: ['--use-gl=angle', '--use-angle=gl', '--ozone-platform=x11', '--ignore-gpu-blocklist'],
  } : { headless: true });
});
after(async () => { await browser?.close(); if (server) await new Promise(r => server.close(r)); });

async function pageFor(options = {}) {
  const page = await browser.newPage({ viewport: { width: 1100, height: 720 }, ...options });
  page.errors = []; page.badRequests = [];
  page.on('pageerror', e => page.errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') page.errors.push(m.text()); });
  page.on('response', response => { if (response.status() >= 400) page.badRequests.push(`${response.status()} ${response.url()}`); });
  page.on('request', request => { if (!request.url().startsWith(base) && !request.url().startsWith('data:')) page.badRequests.push(request.url()); });
  await page.clock.install();
  await page.goto(base); await page.waitForLoadState('networkidle');
  return page;
}
function fixture(scene = 'campus', mode = 'easy', object = null) {
  const state = createGame(mode); state.scene = scene; state.view = '2d'; state.checkpointRequest = false;
  Object.assign(state.player, getScene(scene).spawn);
  if (object) { const point = getScene(scene).objects.find(o => o.id === object); Object.assign(state.player, { x: point.x, z: point.z + 1.1, yaw: 0 }); }
  if (scene !== 'tutorial') {
    for (const [id, flag] of [['lab', 'archive'], ['classroom', 'circuit'], ['dorm', 'seat'], ['canteen', 'pass']]) {
      const order = ['campus', 'admin', 'lab', 'classroom', 'dorm', 'canteen'];
      if (order.indexOf(scene) >= order.indexOf(id)) state.flags[flag] = true;
    }
    state.inventory.archive = !!state.flags.archive; state.inventory.pass = !!state.flags.pass;
  }
  state.checkpointLabel = `${getScene(scene).label} · 测试检查点`;
  return state;
}
async function seed(page, state) {
  const memory = new Map(); const save = new SaveStore({ getItem: k => memory.get(k) ?? null, setItem: (k, v) => memory.set(k, v) }, '/night-school/');
  assert.equal(save.save(state, true, true).ok, true);
  await page.goto(base); await page.waitForLoadState('networkidle');
  await page.evaluate(([key, value]) => localStorage.setItem(key, value), [...memory.entries()][0]);
  await page.reload(); await page.waitForLoadState('networkidle');
  await page.locator(`[data-continue=${state.mode}]`).click();
  await page.waitForSelector('#game-screen:not([hidden])');
}
async function readSave(page, mode = 'easy') { return page.evaluate(mode => JSON.parse(localStorage.getItem(`campus-night:/night-school/:${mode}`)), mode); }
async function openObject(page) { await page.locator('#interact-button:not([disabled])').click(); await page.waitForSelector('#interaction-dialog[open]'); }
async function closePaper(page) { await page.getByRole('button', { name: '关闭面板', exact: true }).click(); }
function clean(page) { assert.deepEqual(page.errors, []); assert.deepEqual(page.badRequests, []); }

test('real WebGL2 startup, both views, pause, settings, journal and root-relative deployment', { timeout: 60000 }, async () => {
  const page = await pageFor();
  try {
    await page.screenshot({ path: artifacts + '/title.png' });
    await page.locator('[data-new=easy]').click();
    await page.getByRole('button', { name: '进入校园', exact: true }).click();
    await page.waitForFunction(() => !document.querySelector('#view-3d').hidden && document.querySelector('#view-3d').width > 100);
    assert.equal(await page.locator('#view-3d').evaluate(c => !c.getContext('webgl2').isContextLost()), true);
    await page.screenshot({ path: artifacts + '/campus-3d.png' });
    await page.locator('#view-button').click();
    assert.equal(await page.locator('#view-2d').isVisible(), true);
    await page.screenshot({ path: artifacts + '/campus-2d.png' });
    await page.locator('#journal-button').click();
    assert.match(await page.locator('#interaction-dialog h2').innerText(), /已核验/); await closePaper(page);
    await page.locator('#map-button').click(); assert.match(await page.locator('#interaction-dialog').innerText(), /食堂/); await closePaper(page);
    await page.locator('#pause-button').click();
    const frozen = await readSave(page);
    await page.waitForTimeout(400); assert.equal((await readSave(page)).auto.elapsed, frozen.auto.elapsed);
    await page.getByRole('button', { name: '声音与显示', exact: true }).click();
    await page.getByLabel('静音', { exact: true }).check();
    await page.getByRole('button', { name: '完成设置' }).click();
    await page.locator('#view-button').click(); assert.equal(await page.locator('#view-3d').isVisible(), true);
    clean(page);
  } finally { await page.close(); }
});

test('five chapter puzzle interfaces accept actual clicks and preserve inventory', { timeout: 90000 }, async () => {
  const page = await pageFor();
  try {
    await seed(page, fixture('admin', 'easy', 'admin-puzzle')); await openObject(page);
    await page.getByRole('button', { name: /提示 1/ }).click();
    for (const id of ['admin', 'lab', 'classroom', 'dorm', 'canteen']) await page.locator(`[data-building=${id}]`).click();
    await page.getByRole('button', { name: '按此顺序开柜', exact: true }).click();
    assert.equal((await readSave(page)).auto.flags.archive, true);
    await seed(page, fixture('lab', 'easy', 'lab-puzzle')); await openObject(page);
    await page.getByRole('switch', { name: /播/ }).click();
    await page.getByRole('button', { name: '核准本楼设置', exact: true }).click();
    assert.equal((await readSave(page)).checkpoint.pendingEncounter, null);
    assert.equal((await readSave(page)).checkpoint.flags.circuit, undefined);
    await page.clock.runFor(100);
    await page.waitForFunction(() => document.querySelector('#objective').textContent.includes('教学楼')); 
    await page.locator('#view-button').click(); await page.locator('#view-button').click();
    await seed(page, fixture('classroom', 'easy', 'classroom-puzzle')); await openObject(page);
    await page.locator('[data-number="41"]').count();
    await page.getByRole('button', { name: /核验网格外第41座/ }).click();
    assert.match(await page.locator('#interaction-message').innerText(), /不一致/);
    await page.locator('[data-number="17"]').click(); assert.equal((await readSave(page)).checkpoint.flags.seat, undefined);
    await page.clock.runFor(100);
    await page.waitForFunction(() => document.querySelector('#objective').textContent.includes('宿舍'));
    await seed(page, fixture('dorm', 'easy', 'dorm-puzzle')); await openObject(page);
    await page.getByRole('button', { name: '翻到三片纸背', exact: true }).click();
    for (const [id, text] of [['a', '上片（左）槽：空'], ['b', '中片槽：空'], ['c', '下片（右）槽：空']]) {
      await page.locator(`[data-fragment=${id}]`).click(); await page.getByRole('button', { name: new RegExp(text.replace(/[()（）]/g, '\\$&')) }).click();
    }
    await page.screenshot({ path: artifacts + '/dorm-puzzle.png' });
    await page.getByRole('button', { name: '按当前拼法核验旧联', exact: true }).click(); assert.equal((await readSave(page)).auto.inventory.pass, true);
    await seed(page, fixture('canteen', 'easy', 'canteen-puzzle')); await openObject(page);
    await page.getByRole('button', { name: /灯下 · 名册原件/ }).click();
    await page.getByRole('button', { name: /门侧 · 旧签离联/ }).click();
    await page.getByRole('button', { name: /检查第41碗/ }).click(); await page.getByRole('button', { name: '预选倒扣第41碗', exact: true }).click();
    await page.getByRole('button', { name: '核验旧凭并归名', exact: true }).click();
    const save = await readSave(page); assert.equal(save.auto.inventory.name, true); assert.equal(save.auto.inventory.pass, true); assert.equal(save.auto.inventory.archive, true);
    clean(page);
  } finally { await page.close(); }
});

test('SAN recovery, refresh resume, checkpoint rollback and tutorial full-SAN drinking', { timeout: 60000 }, async () => {
  const page = await pageFor();
  try {
    const s = fixture('tutorial', 'tutorial', 'tutorial-lamp'); s.player.san = 40; s.inventory.water = 2; s.tutorial.puzzle = true; s.flags.tutorial = true;
    await seed(page, s); await openObject(page);
    await page.getByRole('button', { name: /接入照明检修/ }).click();
    await page.waitForFunction(() => !document.querySelector('#interaction-dialog').open);
    await page.clock.runFor(100);
    await page.keyboard.down('KeyR'); await page.clock.runFor(6000); await page.keyboard.up('KeyR');
    assert.equal(await page.locator('#san-value').innerText(), '100', JSON.stringify(await page.evaluate(() => ({ active: document.activeElement?.outerHTML, hidden: document.hidden, modal: document.querySelector('#system-dialog').open, hint: document.querySelector('#recovery-hint').textContent }))));
    await page.locator('#drink-button').click();
    let save = await readSave(page, 'tutorial'); assert.equal(save.auto.tutorial.water, true); assert.equal(save.auto.tutorial.recovered, true); assert.equal(save.auto.inventory.water, 2);
    await page.locator('#pause-button').click();
    await page.getByRole('button', { name: '从最近检查点重新开始', exact: true }).click();
    await page.getByRole('button', { name: '确认重试检查点', exact: true }).click();
    assert.equal(await page.locator('#san-value').innerText(), '40');
    assert.equal((await readSave(page, 'tutorial')).auto.tutorial.retried, true);
    await page.reload(); await page.waitForLoadState('networkidle'); await page.locator('[data-continue=tutorial]').click();
    assert.equal(await page.locator('#san-value').innerText(), '40');
    clean(page);
  } finally { await page.close(); }
});

for (const [echoes, power, choice, title] of [[false, false, 'leave', '旧名出门'], [true, true, 'leave', '最后一遍点名'], [true, true, 'sign', '第四十一行']]) {
  test(`gate ending UI ${title}`, { timeout: 45000 }, async () => {
    const page = await pageFor();
    try {
      const s = fixture('campus', 'easy', 'gate'); Object.assign(s.flags, { archive: true, circuit: true, seat: true, pass: true, name: true, echoes, power }); Object.assign(s.inventory, { archive: true, pass: true, name: true });
      await seed(page, s); await openObject(page);
      if (choice === 'sign') {
        await page.getByRole('button', { name: /查看新签名选项/ }).click();
        await page.getByRole('checkbox').check(); await page.getByRole('button', { name: '确认：我主动认领第41行', exact: true }).click();
      } else await page.getByRole('button', { name: '出示旧联与旧名，核验离校', exact: true }).click();
      await page.waitForSelector('#system-dialog[open]'); assert.equal(await page.locator('#system-dialog h2').innerText(), title);
      clean(page);
    } finally { await page.close(); }
  });
}

test('mobile touch layout and storage denial are explicit', { timeout: 45000 }, async () => {
  const page = await pageFor({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
  try {
    await page.screenshot({ path: artifacts + '/mobile-title.png' });
    await seed(page, fixture('classroom', 'easy', 'classroom-puzzle'));
    assert.equal(await page.locator('#joystick').isVisible(), true, JSON.stringify(await page.evaluate(() => ({ coarse: matchMedia('(pointer:coarse)').matches, maxTouch: navigator.maxTouchPoints, hidden: document.querySelector('#game-screen').hidden, display: getComputedStyle(document.querySelector('#joystick')).display }))));
    await openObject(page); await page.screenshot({ path: artifacts + '/mobile-puzzle.png' });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.locator('[data-number="17"]').click();
    await page.screenshot({ path: artifacts + '/mobile-game.png' });
    clean(page);
  } finally { await page.close(); }
  const denied = await browser.newPage();
  try {
    await denied.addInitScript(() => Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('Denied', 'SecurityError'); } }));
    await denied.goto(base); await denied.waitForLoadState('networkidle');
    assert.match(await denied.locator('#boot-status').innerText(), /无法读取本地存档/);
  } finally { await denied.close(); }
});

test('keyboard movement and mobile joystick change actual saved coordinates', { timeout: 60000 }, async () => {
  const page = await pageFor();
  try {
    await seed(page, fixture('campus'));
    await page.keyboard.down('KeyS'); await page.clock.runFor(3000); await page.keyboard.up('KeyS');
    await page.locator('#pause-button').click();
    assert.ok((await readSave(page)).auto.player.z > 18, 'keyboard movement crosses campus');
    await page.getByRole('button', { name: '继续探索', exact: true }).click();
    await page.locator('#view-button').click();
    await page.waitForFunction(() => !document.querySelector('#view-3d').hidden);
    await page.clock.runFor(100);
    await page.keyboard.down('KeyW'); await page.clock.runFor(1000); await page.keyboard.up('KeyW');
    await page.locator('#pause-button').click();
    assert.ok((await readSave(page)).auto.player.z > 20, `3D movement follows retained heading: ${JSON.stringify((await readSave(page)).auto.player)}`);
    clean(page);
  } finally { await page.close(); }
  const mobile = await pageFor({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  try {
    await seed(mobile, fixture('campus'));
    const box = await mobile.locator('#joystick').boundingBox();
    const cdp = await mobile.context().newCDPSession(mobile);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: box.x + box.width / 2, y: box.y + box.height * .85, id: 1 }] });
    await mobile.clock.runFor(1200);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await mobile.locator('#pause-button').click();
    assert.ok((await readSave(mobile)).auto.player.z > 12, 'touch joystick movement persisted');
    clean(mobile);
  } finally { await mobile.close(); }
});

test('all seven scenes render actual WebGL pixels; low SAN and bell motion update', { timeout: 60000 }, async () => {
  const page = await pageFor();
  try {
    const report = await page.evaluate(async () => {
      const { Renderer3D } = await import('./renderer-3d.js');
      const { createGame } = await import('./game.js');
      const { SCENES } = await import('./world.js');
      const canvas = document.createElement('canvas'); canvas.style.cssText = 'position:fixed;inset:0;width:640px;height:400px;z-index:30'; document.body.append(canvas);
      const renderer = new Renderer3D(canvas); const results = [];
      for (const scene of Object.values(SCENES)) {
        const s = createGame(scene.id === 'tutorial' ? 'tutorial' : 'easy'); s.scene = scene.id; Object.assign(s.player, scene.spawn);
        renderer.render(s, .016, { quality: 'low' });
        const gl = canvas.getContext('webgl2'); const pixels = new Uint8Array(canvas.width * canvas.height * 4);
        gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
        results.push({ id: scene.id, error: gl.getError(), lost: gl.isContextLost(), variation: new Set(pixels).size, calls: renderer.renderer.info.render.calls });
      }
      const s = createGame(); s.scene = 'lab'; Object.assign(s.player, { x: 18, z: 18, yaw: 0 }); s.flags.circuit = true; s.bellUntil = 2.3;
      renderer.render(s, .016, {}); const normal = renderer.renderer.toneMappingExposure;
      s.player.san = 10; s.elapsed = .5; renderer.render(s, .016, {});
      const low = renderer.renderer.toneMappingExposure;
      renderer.dispose(); canvas.remove();
      return { results, normal, low };
    });
    for (const result of report.results) { assert.equal(result.error, 0, result.id); assert.equal(result.lost, false); assert.ok(result.variation > 8, JSON.stringify(result)); assert.ok(result.calls > 1, JSON.stringify(result)); }
    assert.ok(report.low < report.normal);
    clean(page);
  } finally { await page.close(); }
});

test('five-floor geometry, near-wall rendering, indicators and minimap use shared height', { timeout: 90000 }, async () => {
  const page = await pageFor();
  try {
    const report = await page.evaluate(async () => {
      const { Renderer3D } = await import('./renderer-3d.js');
      const { Renderer2D } = await import('./renderer-2d.js');
      const { createGame } = await import('./game.js');
      const { SCENES } = await import('./world.js');
      const canvas = document.createElement('canvas'), mini = document.createElement('canvas');
      canvas.style.cssText = 'position:fixed;inset:0;width:640px;height:400px;z-index:30';
      mini.style.cssText = 'position:fixed;right:0;top:0;width:200px;height:140px;z-index:31';
      document.body.append(canvas, mini);
      const r3 = new Renderer3D(canvas), r2 = new Renderer2D(mini, { mini: true });
      const checks = [];
      for (const id of ['admin', 'lab', 'classroom']) for (let floor = 1; floor <= 5; floor++) {
        const s = createGame(); s.scene = id; Object.assign(s.player, { x: 25, z: 24, y: (floor - 1) * 3.6, floor, yaw: 0 });
        const prior = JSON.stringify(s); r3.render(s, .016, { quality: 'low' }); r2.render(s, 0, {});
        const gl = canvas.getContext('webgl2'), pixels = new Uint8Array(canvas.width * canvas.height * 4);
        gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
        checks.push({ id, floor, unchanged: prior === JSON.stringify(s), cameraY: r3.camera.position.y, glError: gl.getError(), pixels: new Set(pixels).size });
      }
      const stairState = createGame(); stairState.scene = 'admin'; Object.assign(stairState.player, { x: 31.5, z: 15, y: .9, floor: 1 });
      r3.render(stairState, .016, {}); const stairEye = r3.camera.position.y;
      const campus = createGame(); r3.render(campus, .016, {});
      const gate = r3.items.get('gate');
      const gateRingY = gate.indicator.position.y;
      r3.dispose(); r2.dispose(); canvas.remove(); mini.remove();
      return { checks, stairEye, gateRingY };
    });
    for (const row of report.checks) { assert.equal(row.glError, 0); assert.equal(row.unchanged, true); assert.ok(Math.abs(row.cameraY - ((row.floor - 1) * 3.6 + 1.65)) < .01); assert.ok(row.pixels > 8, JSON.stringify(row)); }
    assert.ok(Math.abs(report.stairEye - 2.55) < .01);
    assert.ok(report.gateRingY > .043, 'gate marker above platform');
    clean(page);
  } finally { await page.close(); }
});

test('actual stair movement lifts the camera, minimap stays in HUD and toggles without state loss', { timeout: 90000 }, async () => {
  const page = await pageFor();
  try {
    const s = fixture('admin'); Object.assign(s.player, { x: 31.5, z: 22.8, y: 0, floor: 1, yaw: 0 });
    await seed(page, s); await page.locator('#view-button').click();
    await page.waitForFunction(() => !document.querySelector('#view-3d').hidden);
    await page.clock.runFor(100);
    assert.equal(await page.locator('#minimap-panel').isVisible(), true);
    const bounds = await page.locator('#minimap-canvas').boundingBox(); assert.ok(bounds.width < 300 && bounds.height < 240);
    await page.keyboard.down('KeyW'); await page.clock.runFor(4000); await page.keyboard.up('KeyW');
    await page.locator('#pause-button').click();
    const climbed = (await readSave(page)).auto; assert.ok(climbed.player.y > 1 && climbed.player.y < 1.8);
    await page.getByRole('button', { name: '继续探索', exact: true }).click();
    await page.locator('#minimap-toggle').click(); assert.equal(await page.locator('#minimap-canvas').isVisible(), false);
    await page.locator('#minimap-toggle').click(); assert.equal(await page.locator('#minimap-canvas').isVisible(), true);
    await page.locator('#pause-button').click(); const after = (await readSave(page)).auto;
    assert.deepEqual(after.player, climbed.player);
    await page.screenshot({ path: artifacts + '/five-floor-stairs.png' });
    clean(page);
  } finally { await page.close(); }
});

test('upper floor loads from checkpoint with matching HUD and current-floor evidence only', { timeout: 60000 }, async () => {
  const page = await pageFor({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  try {
    const s = fixture('admin'); Object.assign(s.player, { x: 6, z: 7.1, y: 7.2, floor: 3 }); s.view = '3d';
    await seed(page, s);
    await page.waitForFunction(() => document.querySelector('#location-label').textContent.includes('3F'));
    assert.equal(await page.locator('#minimap-panel').getAttribute('data-floor'), '3');
    await openObject(page); await page.getByRole('button', { name: '翻到纸背 · 核验压痕', exact: true }).click();
    assert.ok((await readSave(page)).auto.notes.includes('admin-f3-note')); assert.ok(!(await readSave(page)).auto.notes.includes('admin-note'));
    await closePaper(page); await page.screenshot({ path: artifacts + '/mobile-3d-minimap.png' });
    const overlap = await page.evaluate(() => {
      const m = document.querySelector('#minimap-panel').getBoundingClientRect();
      return ['joystick', 'sprint-button', 'interact-button', 'view-button'].some(id => { const r = document.getElementById(id).getBoundingClientRect(); return m.left < r.right && m.right > r.left && m.top < r.bottom && m.bottom > r.top; });
    });
    assert.equal(overlap, false); clean(page);
  } finally { await page.close(); }
});

test('all upper investigations require evidence and accept UI answers with one reward', { timeout: 90000 }, async () => {
  const page = await pageFor();
  try {
    const cases = { admin: ['original', 'forty', 'seventeen'], lab: ['short', 'short', 'long', 'latch'], classroom: ['40', '17', '3', '1'] };
    const flags = { admin: 'adminTrace', lab: 'labTrace', classroom: 'classTrace' };
    for (const [id, answers] of Object.entries(cases)) {
      const s = fixture(id); Object.assign(s.player, { x: 22, z: 7.1, y: 14.4, floor: 5, san: 50 });
      await seed(page, s); await openObject(page);
      assert.equal(await page.getByRole('button', { name: '提交本楼复核', exact: true }).isDisabled(), true);
      await closePaper(page);
      s.notes = [2, 3, 4].flatMap(f => [`${id}-f${f}-note`, `${id}-f${f}-evidence`]);
      await seed(page, s); await openObject(page);
      for (const [i, value] of answers.entries()) await page.locator('#interaction-dialog select').nth(i).selectOption(value);
      await page.getByRole('button', { name: '提交本楼复核', exact: true }).click();
      const saved = await readSave(page); assert.equal(saved.auto.flags[flags[id]], true); assert.equal(saved.auto.player.san, 60);
      await openObject(page); assert.match(await page.locator('#interaction-dialog').innerText(), /已复核|已核验/);
      await closePaper(page);
    }
    clean(page);
  } finally { await page.close(); }
});

test('3D loss pauses play, explicit 2D continuation and restored context render again', { timeout: 60000 }, async () => {
  const page = await pageFor();
  try {
    const s = fixture('admin'); s.view = '3d';
    await seed(page, s); await page.waitForFunction(() => document.querySelector('#view-3d').width > 100);
    await page.evaluate(() => { window.lostGL = document.getElementById('view-3d').getContext('webgl2').getExtension('WEBGL_lose_context'); window.lostGL.loseContext(); });
    await page.waitForFunction(() => document.querySelector('#system-dialog').open);
    assert.match(await page.locator('#system-dialog').innerText(), /3D画面暂时中断/);
    await page.getByRole('button', { name: '切换2D继续', exact: true }).click();
    assert.equal(await page.locator('#view-2d').isVisible(), true);
    await page.evaluate(() => window.lostGL.restoreContext());
    await page.waitForFunction(() => !document.querySelector('#view-3d').getContext('webgl2').isContextLost());
    await page.clock.runFor(200); await page.locator('#view-button').click();
    await page.waitForFunction(() => !document.querySelector('#view-3d').hidden);
    await page.clock.runFor(200);
    assert.equal(await page.locator('#system-dialog').isVisible(), false);
    clean(page);
  } finally { await page.close(); }
});

test('SAN audio gain increases without bypassing mute or pause', { timeout: 30000 }, async () => {
  const page = await pageFor();
  try {
    await page.evaluate(async () => {
      const { GameAudio } = await import('./audio.js'); const { createGame } = await import('./game.js');
      const button = document.createElement('button'); button.id = 'audio-probe'; button.textContent = '音频测试'; document.body.prepend(button);
      button.addEventListener('click', async () => {
        const audio = new GameAudio(); const started = await audio.start(); const state = createGame();
        const param = audio.dissonanceGain.gain, targets = [];
        const setTarget = param.setTargetAtTime.bind(param);
        param.setTargetAtTime = (value, time, constant) => { targets.push(value); return setTarget(value, time, constant); };
        audio.update(state, .1, { volume: .3 });
        const clear = targets.at(-1);
        state.player.san = 10; state.elapsed = 10; audio.lastUpdate = -Infinity; audio.update(state, .1, { volume: .3 });
        const noisyTarget = targets.at(-1);
        audio.lastUpdate = -Infinity; audio.update(state, .1, { volume: .3, muted: true });
        const mutedOutput = audio.outputLevel; audio.pause(); const paused = audio.paused;
        window.audioProbeResult = { started, clear, noisyTarget, mutedOutput, paused, contextCount: audio.context ? 1 : 0 };
        audio.dispose(); button.remove();
      });
    });
    await page.locator('#audio-probe').click(); await page.waitForFunction(() => window.audioProbeResult);
    const result = await page.evaluate(() => window.audioProbeResult);
    assert.equal(result.started, true); assert.equal(result.contextCount, 1); assert.ok(result.noisyTarget > result.clear); assert.equal(result.mutedOutput, 0); assert.equal(result.paused, true);
    clean(page);
  } finally { await page.close(); }
});

test('2D continuation can retry a 3D checkpoint without an uninitialized renderer', { timeout: 45000 }, async () => {
  const page = await pageFor();
  try {
    const s = fixture('campus'); await seed(page, s);
    await page.evaluate(() => { const key = 'campus-night:/night-school/:easy'; const data = JSON.parse(localStorage.getItem(key)); data.checkpoint.view = '3d'; localStorage.setItem(key, JSON.stringify(data)); });
    await page.reload(); await page.waitForLoadState('networkidle'); await page.locator('[data-continue=easy]').click();
    await page.locator('#pause-button').click(); await page.getByRole('button', { name: '从最近检查点重新开始', exact: true }).click(); await page.getByRole('button', { name: '确认重试检查点', exact: true }).click();
    assert.equal(await page.locator('#view-2d').isVisible(), true);
    clean(page);
  } finally { await page.close(); }
});
