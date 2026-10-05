const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const server = http.createServer((req, res) => {
  const name = req.url.split('?')[0] === '/' ? 'index.html' : req.url.slice(1);
  const file = path.resolve(root, name);
  if (!file.startsWith(root) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    res.writeHead(404); res.end(); return;
  }
  res.writeHead(200, {'content-type': 'text/html; charset=utf-8'});
  fs.createReadStream(file).pipe(res);
});

(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const browser = await chromium.launch({headless: true});
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 820 }, deviceScaleFactor: 1 });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${port}/?test=1`, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__SKYLINE_TEST__);
    assert.equal(await page.title(), '云端筑屋 · 天际线堆叠');
    assert.equal(await page.locator('canvas').count(), 3);

    const baseline = await page.evaluate(() => window.__SKYLINE_TEST__.physicsCheck([
      { x: 0, w: 120 }, { x: 0, w: 110 }, { x: 0, w: 100 }
    ]));
    assert.equal(baseline.safe, undefined);
    assert(baseline.safety > 0.9, `centered tower safety=${baseline.safety}`);

    const shifted = await page.evaluate(() => window.__SKYLINE_TEST__.physicsCheck([
      { x: 0, w: 120 }, { x: 42, w: 110 }, { x: 42, w: 100 }, { x: 42, w: 90 }
    ]));
    assert(shifted.safety < baseline.safety, 'upper mass shift must reduce safety');
    assert(shifted.margin < baseline.margin, 'upper mass shift must reduce support margin');

    await page.evaluate(() => window.__SKYLINE_TEST__.start());
    for (let i = 0; i < 4; i++) {
      await page.waitForFunction(() => window.__SKYLINE_TEST__.snapshot().state === 'aiming');
      await page.evaluate(() => window.__SKYLINE_TEST__.placeAt(0));
      await page.evaluate(() => window.__SKYLINE_TEST__.advance(1));
    }
    const built = await page.evaluate(() => window.__SKYLINE_TEST__.snapshot());
    assert.equal(built.state, 'aiming');
    assert.equal(built.floors, 4);
    assert(built.score > 0);

    const paused = await page.evaluate(() => {
      const t = window.__SKYLINE_TEST__;
      t.pause();
      const before = t.snapshot();
      t.advance(1);
      return { before, after: t.snapshot() };
    });
    assert.equal(paused.before.paused, true);
    assert.equal(paused.after.floors, paused.before.floors);
    await page.evaluate(() => window.__SKYLINE_TEST__.resume());

    const stats = await page.evaluate(() => window.__SKYLINE_TEST__.stats());
    assert(stats.physicsSteps > 0);
    assert(stats.stackPaints > 0);
    assert(stats.clearedPixels >= 0);
    assert.equal(errors.length, 0, errors.join('\n'));

    const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
    await mobile.goto(`http://127.0.0.1:${port}/?test=1`, { waitUntil: 'load' });
    const mobileLayout = await mobile.evaluate(() => ({
      width: document.documentElement.scrollWidth,
      viewport: innerWidth,
      stage: document.querySelector('.stage').getBoundingClientRect().height
    }));
    assert.equal(mobileLayout.width, mobileLayout.viewport);
    assert(mobileLayout.stage > 500);
    await mobile.close();
    console.log(JSON.stringify({ ok: true, floors: built.floors, score: built.score, stats, mobileLayout }));
  } finally {
    await browser.close();
    server.close();
  }
})().catch(error => { console.error(error.stack); process.exitCode = 1; });
