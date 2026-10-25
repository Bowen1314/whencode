// Capture the submission screenshots (1280x800) from a running local server.
//   node scripts/serve.mjs 8765 & node scripts/screenshots.mjs
import { chromium } from 'playwright';
const BASE = process.env.BASE_URL || 'http://127.0.0.1:8765/whencode/';
const out = new URL('../screenshots/', import.meta.url).pathname;
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, timezoneId: 'Europe/London', locale: 'en-US' });
const page = await ctx.newPage();
const top = async (sel, offset = 12) => {
  await page.evaluate(([s, o]) => { const e = document.querySelector(s); window.scrollTo(0, e.getBoundingClientRect().top + window.scrollY - o); }, [sel, offset]);
  await page.waitForTimeout(150);
};

// 1. Setup with the starter link ready
await page.goto(BASE);
await page.fill('#f-title', 'CS 214 group project');
await page.click('button[type=submit]');
await top('.hero');
await page.screenshot({ path: out + '1-setup.png' });
await top('#setup-result');
await page.click('[data-qr="starter-link"]');
await page.waitForTimeout(150);

// 2 + 3. Member in London imports the sample calendar
const plan = 't=CS+214+group+project&d=2026-11-23~2026-12-06&h=9-21&s=30&z=America%2FNew_York';
await page.goto(`${BASE}#${plan}`);
await page.fill('#m-name', 'Bo');
await page.click('#tab-import');
await page.click('#ics-sample');
await page.locator('#fill-grid .cell[data-i="14"]').click();
await top('#ics-report', 70);
await page.screenshot({ path: out + '2-member-import.png' });
await top('#code-h', 30);
await page.screenshot({ path: out + '3-whats-inside.png' });

// 4 + 5. Organiser merges the five-person demo
await page.goto(BASE);
await page.click('#demo-btn');
await page.waitForSelector('#members li');
await page.locator('#members li', { hasText: 'Dee' }).getByLabel('Required').check();
await top('#members-h', 40);
await page.screenshot({ path: out + '4-best-times.png' });
await page.locator('#options button', { hasText: 'Show on heatmap' }).first().click();
await page.waitForTimeout(200);
await top('#heat-grid', 60);
await page.screenshot({ path: out + '5-heatmap.png' });
await b.close();
console.log('saved to', out);
