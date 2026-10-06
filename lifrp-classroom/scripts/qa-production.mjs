import { chromium } from 'playwright';

const baseUrl = process.env.QA_URL || 'http://localhost:5173/';
const browser = await chromium.launch({ headless: true });
const checks = [];

async function check(name, callback) {
  try {
    await callback();
    checks.push({ name, passed: true });
  } catch (error) {
    checks.push({ name, passed: false, error: error.message });
  }
}

const desktop = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const desktopErrors = [];
desktop.on('console', (message) => {
  if (message.type() === 'error') desktopErrors.push(message.text());
});
desktop.on('pageerror', (error) => desktopErrors.push(error.message));

await check('desktop menu renders', async () => {
  await desktop.goto(baseUrl, { waitUntil: 'networkidle' });
  if ((await desktop.locator('.menu-screen').count()) !== 1) throw new Error('menu screen missing');
  if ((await desktop.locator('button.primary-button').count()) !== 1) throw new Error('start button missing');
});

await check('desktop flow reaches classroom', async () => {
  await desktop.fill('#player-name', 'QA 同学');
  await desktop.click('button.primary-button');
  await desktop.waitForSelector('.seat-screen');
  if ((await desktop.locator('.seat-option').count()) < 1) throw new Error('seat options missing');
  await desktop.locator('.seat-option').first().click();
  await desktop.click('.seat-footer .primary-button');
  await desktop.waitForSelector('#game-shell');
  await desktop.waitForSelector('#game-canvas');
});

await check('desktop view switch and event action work', async () => {
  await desktop.click('.icon-button[title="切换 2D / 3D"]');
  await desktop.waitForTimeout(100);
  if (!(await desktop.locator('.view-chip').innerText()).includes('视角切换中')) throw new Error('view switch state missing');
  await desktop.locator('.action-button').first().click();
  if ((await desktop.locator('.toast').count()) !== 1) throw new Error('toast missing');
});

await check('desktop console is clean', async () => {
  if (desktopErrors.length) throw new Error(desktopErrors.join('\n'));
});

const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
const mobileErrors = [];
mobile.on('console', (message) => {
  if (message.type() === 'error') mobileErrors.push(message.text());
});
mobile.on('pageerror', (error) => mobileErrors.push(error.message));

await check('mobile layout has no horizontal overflow', async () => {
  await mobile.goto(baseUrl, { waitUntil: 'networkidle' });
  const dimensions = await mobile.evaluate(() => ({ width: document.documentElement.scrollWidth, viewport: document.documentElement.clientWidth }));
  if (dimensions.width !== dimensions.viewport) throw new Error(`horizontal overflow ${dimensions.width}/${dimensions.viewport}`);
});

await check('mobile flow exposes controls', async () => {
  await mobile.fill('#player-name', '移动 QA');
  await mobile.click('button.primary-button');
  await mobile.waitForSelector('.seat-screen');
  await mobile.locator('.seat-option').first().click();
  await mobile.click('.seat-footer .primary-button');
  await mobile.waitForSelector('#game-shell');
  if ((await mobile.locator('.mobile-controls').count()) !== 1) throw new Error('mobile controls missing');
});

await check('mobile console is clean', async () => {
  if (mobileErrors.length) throw new Error(mobileErrors.join('\n'));
});

await desktop.close();
await mobile.close();
await browser.close();

const failed = checks.filter((check) => !check.passed);
console.log(JSON.stringify({ baseUrl, checks }, null, 2));
if (failed.length) process.exitCode = 1;
