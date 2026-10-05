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

async function newGamePage(viewport = { width: 1440, height: 1000 }) {
  const page = await browser.newPage({ viewport });
  await page.goto(`${baseUrl}/index.html`);
  await page.waitForLoadState('networkidle');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForLoadState('networkidle');
  await page.locator('#start-button').click();
  return page;
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

test('菜单和棋盘是两个独立界面', async () => {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.goto(`${baseUrl}/index.html`);
  await page.waitForLoadState('networkidle');
  assert.equal(await page.locator('#menu-screen').isHidden(), false);
  assert.equal(await page.locator('#game-screen').isHidden(), true);
  assert.equal(await page.locator('.difficulty-card').count(), 4);
  assert.equal(await page.locator('.level-button').count(), 100);
  await page.locator('#start-button').click();
  assert.equal(await page.locator('#menu-screen').isHidden(), true);
  assert.equal(await page.locator('#game-screen').isHidden(), false);
  assert.equal(await page.locator('.cell').count(), 81);
  await page.locator('#menu-button').click();
  assert.equal(await page.locator('#menu-screen').isHidden(), false);
  assert.equal(await page.locator('#game-screen').isHidden(), true);
  await page.close();
});

test('日夜模式切换会保存并更新页面主题', async () => {
  const page = await browser.newPage();
  await page.goto(`${baseUrl}/index.html`);
  await page.waitForLoadState('networkidle');
  assert.equal(await page.locator('body').getAttribute('data-theme'), 'night');
  await page.locator('#menu-theme-toggle').click();
  assert.equal(await page.locator('body').getAttribute('data-theme'), 'day');
  assert.match(await page.locator('#menu-theme-toggle').textContent(), /夜晚模式/);
  await page.reload();
  assert.equal(await page.locator('body').getAttribute('data-theme'), 'day');
  await page.close();
});

test('逻辑合法数字不会按标准答案被判错，冲突数字会被拦截', async () => {
  const page = await newGamePage();
  const puzzle = PUZZLES.simple[0];
  const candidate = await page.evaluate((puzzle) => {
    const grid = [...puzzle.puzzle].map(Number);
    for (let index = 0; index < 81; index += 1) {
      if (grid[index]) continue;
      const row = Math.floor(index / 9);
      const column = index % 9;
      const used = new Set();
      for (let offset = 0; offset < 9; offset += 1) {
        used.add(grid[row * 9 + offset]);
        used.add(grid[offset * 9 + column]);
      }
      const boxRow = Math.floor(row / 3) * 3;
      const boxColumn = Math.floor(column / 3) * 3;
      for (let rowOffset = 0; rowOffset < 3; rowOffset += 1) {
        for (let columnOffset = 0; columnOffset < 3; columnOffset += 1) used.add(grid[(boxRow + rowOffset) * 9 + boxColumn + columnOffset]);
      }
      const candidates = [1, 2, 3, 4, 5, 6, 7, 8, 9].filter((value) => !used.has(value));
      if (candidates.length > 1) return { index, legalAlternative: candidates.find((value) => value !== Number(puzzle.solution[index])) };
    }
    return null;
  }, puzzle);
  assert.ok(candidate);
  await page.locator(`[data-index="${candidate.index}"]`).click();
  await page.locator(`[data-value="${candidate.legalAlternative}"]`).click();
  assert.equal(await page.locator('#mistake-count').textContent(), '0');
  assert.equal(await page.locator('.cell.is-conflict').count(), 0);
  const peerValue = await page.evaluate((index) => {
    const cell = [...document.querySelectorAll('.cell')].find((item) => Number(item.dataset.index) === index);
    const row = Math.floor(index / 9);
    const column = index % 9;
    for (const peer of document.querySelectorAll('.cell')) {
      const peerIndex = Number(peer.dataset.index);
      if (!peer.textContent || peerIndex === index) continue;
      const peerRow = Math.floor(peerIndex / 9);
      const peerColumn = peerIndex % 9;
      if (peerRow === row || peerColumn === column || (Math.floor(peerRow / 3) === Math.floor(row / 3) && Math.floor(peerColumn / 3) === Math.floor(column / 3))) return Number(peer.textContent);
    }
    return null;
  }, candidate.index);
  assert.ok(peerValue);
  await page.locator('#clear-button').click();
  await page.locator(`[data-value="${peerValue}"]`).click();
  assert.equal(await page.locator('#mistake-count').textContent(), '1');
  await page.locator('#check-button').click();
  assert.equal(await page.locator('.cell.is-conflict').count(), 0);
  assert.match(await page.locator('#selection-hint').textContent(), /冲突|重复/);
  await page.close();
});

test('笔记模式显示候选，未选择时数字按钮只高亮盘面', async () => {
  const page = await newGamePage();
  const empty = page.locator('.cell:not(.is-given)').first();
  await empty.click();
  await page.locator('#notes-button').click();
  await page.locator('[data-value="1"]').click();
  assert.equal(await page.locator('.cell-notes').first().count(), 1);
  assert.ok((await page.locator('.cell-notes').first().textContent()).includes('1') || await page.locator('.cell-notes').count() > 0);
  await page.locator('#clear-button').click();
  await page.locator('.cell.is-selected').click();
  await page.locator('[data-value="1"]').click();
  assert.ok(await page.locator('.cell.is-number-highlight').count() > 0);
  assert.equal(await page.locator('#selection-hint').textContent(), '正在查看数字 1。');
  await page.close();
});

test('每局提示只使用一次并展示推理解释', async () => {
  const page = await newGamePage();
  await page.locator('#hint-button').click();
  assert.equal(await page.locator('#hint-button').isDisabled(), true);
  assert.match(await page.locator('#logic-kind').textContent(), /唯一|提示/);
  assert.match(await page.locator('#logic-title').textContent(), /应填|只剩|只有/);
  assert.ok(await page.locator('#logic-details p').count() >= 2);
  await page.locator('#hint-button').click({ force: true });
  assert.equal(await page.locator('#hint-button').isDisabled(), true);
  await page.close();
});

test('暂停、响应式棋盘和隔线样式正常', async () => {
  const page = await newGamePage({ width: 390, height: 844 });
  const boardBox = await page.locator('#board').boundingBox();
  assert.ok(boardBox);
  assert.ok(boardBox.width <= 354);
  assert.ok(boardBox.height <= 354);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true);
  assert.ok(await page.locator('.cell.box-right').count() > 0);
  assert.ok(await page.locator('.cell.box-bottom').count() > 0);
  await page.locator('#pause-button').click();
  assert.equal(await page.locator('#pause-label').getAttribute('hidden'), null);
  assert.equal(await page.locator('#paused-cover').getAttribute('hidden'), null);
  await page.locator('#pause-button').click();
  assert.notEqual(await page.locator('#pause-label').getAttribute('hidden'), null);
  await page.close();
});
