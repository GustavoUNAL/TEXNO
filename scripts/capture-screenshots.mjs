import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'docs', 'screenshots');
const base = process.env.TEXNO_URL || 'http://localhost:3847';
const sample = join(root, 'data', 'galeras elektro 2026.mp3');

await mkdir(out, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

await page.goto(`${base}/`, { waitUntil: 'networkidle' });
await page.waitForTimeout(800);
await page.screenshot({ path: join(out, '01-landing-hero.png') });

await page.setViewportSize({ width: 1440, height: 2200 });
await page.goto(`${base}/`, { waitUntil: 'networkidle' });
await page.waitForTimeout(500);
await page.screenshot({ path: join(out, '02-landing-full.png'), fullPage: true });

await page.setViewportSize({ width: 1440, height: 900 });
await page.goto(`${base}/opensource.html`, { waitUntil: 'networkidle' });
await page.waitForTimeout(500);
await page.screenshot({ path: join(out, '03-open-source.png'), fullPage: true });

try {
  await page.goto(`${base}/#analizar`, { waitUntil: 'networkidle' });
  const input = page.locator('#audio');
  await input.setInputFiles(sample);
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(out, '04-upload-ready.png') });

  await page.click('#submit-btn');
  await page.waitForSelector('#lab-modal:not([hidden])', { timeout: 15000 });
  await page.waitForFunction(
    () => document.getElementById('lab-busy')?.hasAttribute('hidden'),
    { timeout: 120000 },
  );
  await page.waitForSelector('#plot-spectrum .plotly', { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(2000);
  await page.screenshot({ path: join(out, '05-lab-modal.png'), fullPage: false });

  const scroll = page.locator('.modal-scroll');
  await scroll.evaluate((el) => { el.scrollTop = el.scrollHeight * 0.45; });
  await page.waitForTimeout(600);
  await page.screenshot({ path: join(out, '06-lab-charts.png'), fullPage: false });
} catch (err) {
  console.warn('Lab screenshot skipped:', err.message);
}

await browser.close();
console.log('Screenshots saved to docs/screenshots/');
