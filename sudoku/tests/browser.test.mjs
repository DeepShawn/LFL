import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { PUZZLES } from '../puzzles.js';

const root = fileURLToPath(new URL('..', import.meta.url));
let server;
let browser;
let baseUrl;

function contentType(path) {
  return { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' }[extname(path)] || 'application/octet-stream';
}

before(async () => {
  server = createServer(async (request, response) => {
    const requestPath = request.url === '/' ? '/index.html' : request.url.split('?')[0];
    const filePath = normalize(join(root, requestPath));
    if (!filePath.startsWith(root)) {
      response.writeHead(403); response.end(); return;
    }
    try {
      response.writeHead(200, { 'content-type': contentType(filePath) });
      response.end(await readFile(filePath));
    } catch {
      response.writeHead(404); response.end('Not found');
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ headless: true });
});

after(async () => {
  await browser?.close();
  await new Promise((resolve) => server?.close(resolve));
});

test('页面加载、四档目录和棋盘可交互', async () => {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`${baseUrl}/index.html`);
  await page.waitForLoadState('networkidle');
  assert.equal(await page.title(), '九格档案 · Sudoku Archive');
  assert.equal(await page.locator('.difficulty-card').count(), 4);
  assert.equal(await page.locator('.level-button').count(), 100);
  assert.equal(await page.locator('.cell').count(), 81);
  assert.equal(await page.locator('.cell.is-given').count() > 0, true);
  const initialFilled = Number(await page.locator('#filled-count').textContent());
  await page.locator('.cell:not(.is-given)').first().click();
  await page.locator('[data-value="1"]').click();
  assert.equal(Number(await page.locator('#filled-count').textContent()), initialFilled + 1);
  assert.equal(errors.length, 0, errors.join('\n'));
  await page.close();
});

test('完成第一关后会弹出归档并解锁下一关', async () => {
  const page = await browser.newPage();
  await page.goto(`${baseUrl}/index.html`);
  await page.waitForLoadState('networkidle');
  const puzzle = PUZZLES.simple[0];
  for (let index = 0; index < 81; index += 1) {
    if (puzzle.puzzle[index] !== '0') continue;
    await page.locator(`[data-index="${index}"]`).click();
    await page.locator(`[data-value="${puzzle.solution[index]}"]`).click();
  }
  assert.equal(await page.locator('#complete-modal').isHidden(), false);
  assert.match(await page.locator('#complete-message').textContent(), /下一份档案已解锁/);
  assert.equal(await page.locator('#level-progress').textContent(), '1 / 100');
  await page.locator('#next-button').click();
  assert.equal(await page.locator('#stage-index').textContent(), '002');
  assert.equal(await page.locator('[data-level="2"]').isDisabled(), false);
  await page.close();
});

test('难度切换和暂停计时有效', async () => {
  const page = await browser.newPage();
  await page.goto(`${baseUrl}/index.html`);
  await page.waitForLoadState('networkidle');
  await page.locator('[data-difficulty="master"]').click();
  assert.match(await page.locator('#stage-title').textContent(), /骨灰级/);
  assert.equal(await page.locator('#stage-index').textContent(), '001');
  await page.locator('#pause-button').click();
  assert.equal(await page.locator('#pause-label').isHidden(), false);
  assert.equal(await page.locator('#paused-cover').isHidden(), false);
  await page.locator('#pause-button').click();
  assert.equal(await page.locator('#pause-label').isHidden(), true);
  await page.close();
});
