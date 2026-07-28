import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const htmlPath = join(root, 'public', 'docs', 'texno-whitepaper.html');
const pdfPath = join(root, 'public', 'docs', 'texno-whitepaper.pdf');
const base = process.env.TEXNO_URL || 'http://localhost:3847';

await mkdir(join(root, 'public', 'docs'), { recursive: true });

const fileUrl = `file://${htmlPath}`;
const browser = await chromium.launch();
const page = await browser.newPage();
try {
  await page.goto(`${base}/docs/texno-whitepaper.html`, { waitUntil: 'networkidle', timeout: 8000 });
} catch {
  await page.goto(fileUrl, { waitUntil: 'load' });
}
await page.pdf({
  path: pdfPath,
  format: 'A4',
  printBackground: true,
  margin: { top: '18mm', right: '16mm', bottom: '20mm', left: '16mm' },
});
await browser.close();
console.log('PDF generado:', pdfPath);
