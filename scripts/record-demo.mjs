// Record the demo walkthrough (Playwright video, on-screen captions, no voice-over).
//   node scripts/record-demo.mjs            -> demo/raw/*.webm + demo/captions.json
// Captions are injected as an overlay, which needs bypassCSP in THIS recording context only.
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync, readdirSync, renameSync } from 'node:fs';

const BASE = process.env.BASE_URL || 'https://bowen1314.github.io/whencode/';
const demoDir = new URL('../demo/', import.meta.url).pathname;
const rawDir = demoDir + 'raw/';
mkdirSync(rawDir, { recursive: true });
const fixture = new URL('../tests/fixtures/student-ny.ics', import.meta.url).pathname;
const PLAN = 't=CS+214+project&d=2026-10-24~2026-11-08&h=9-21&s=30&z=America%2FNew_York';

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, locale: 'en-US', timezoneId: 'Europe/London',
  bypassCSP: true, ...(process.env.NO_VIDEO ? {} : { recordVideo: { dir: rawDir, size: { width: 1280, height: 800 } } }),
});
await ctx.addInitScript(() => {
  const mk = () => {
    if (document.getElementById('__cap')) return;
    const d = document.createElement('div');
    d.id = '__cap';
    Object.assign(d.style, {
      position: 'fixed', left: '0', right: '0', bottom: '0', zIndex: '99999', padding: '14px 28px 16px',
      background: 'rgba(17,18,40,.93)', color: '#fff', font: '600 21px/1.4 system-ui, sans-serif', textAlign: 'center',
      minHeight: '62px', pointerEvents: 'none',
    });
    document.body.append(d);
    const saved = sessionStorage.getItem('__cap');
    if (saved) d.textContent = saved;
  };
  window.__cap = (t) => { mk(); document.getElementById('__cap').textContent = t; sessionStorage.setItem('__cap', t); };
  document.addEventListener('DOMContentLoaded', mk);
});

const page = await ctx.newPage();
const t0 = Date.now();
const captions = [];
const cap = async (text, ms) => {
  captions.push({ t: (Date.now() - t0) / 1000, text });
  await page.evaluate((t) => window.__cap(t), text);
  if (ms) await page.waitForTimeout(ms);
};
const wait = (ms) => page.waitForTimeout(ms);
const scrollTo = async (sel, offset = 80) => {
  await page.evaluate(([s, o]) => {
    const e = document.querySelector(s);
    window.scrollTo({ top: e.getBoundingClientRect().top + window.scrollY - o, behavior: 'smooth' });
  }, [sel, offset]);
  await wait(700);
};
const typeSlow = async (sel, text) => { await page.click(sel); await page.keyboard.type(text, { delay: 70 }); };

// ---- 1. Intro and setup
await page.goto(BASE);
await cap('WhenCode: find a meeting time for a group project. No accounts, no server, and no calendar upload.', 5500);
await cap('Group projects mix classes, jobs and time zones. The usual fixes are long chat threads or poll sites that want an account or calendar access.', 6500);
await scrollTo('#setup-form', 20);
await cap('The organiser picks the dates, daily hours, slot length and time zone.', 1000);
await typeSlow('#f-title', 'CS 214 project');
await page.fill('#f-start', '2026-10-24');
await page.fill('#f-end', '2026-11-08');
await page.selectOption('#f-tz', 'America/New_York');
await wait(1800);
await cap('The page shows how many slots that makes and how long each member\'s code will be.', 4000);
await page.click('button[type=submit]');
await wait(900);
await cap('Result: one starter link, plus a message ready to paste into the group chat.', 4500);
await page.click('[data-qr="starter-link"]');
await scrollTo('[data-qr-box="starter-link"]', 300);
await cap('There is a QR code too, for moving the link to a phone.', 3500);

// ---- 2. Member in London paints
await page.goto(`${BASE}#${PLAN}`);
await cap('Bo opens the starter link in London. The organiser set New York hours, and the grid shows London time.', 6000);
await scrollTo('#fill-grid', 120);
await cap('The EU and US change clocks a week apart. Days where the offset differs carry a "+1 h" / "−1 h" badge.', 6000);
await page.fill('#m-name', 'Bo');
const box = async (i) => page.locator(`#fill-grid .cell[data-i="${i}"]`).boundingBox();
await cap('Drag to mark free times. Touch works the same way.', 800);
for (const [a, b] of [[49, 52], [97, 100]]) {
  const s = await box(a), e = await box(b);
  await page.mouse.move(s.x + s.width / 2, s.y + s.height / 2);
  await page.mouse.down();
  await page.mouse.move(e.x + e.width / 2, e.y + e.height / 2, { steps: 12 });
  await page.mouse.up();
  await wait(700);
}
await wait(1200);
await page.locator('#fill-grid .cell[data-i="145"]').focus();
await cap('Keyboard works too: arrows move, Space toggles, Shift+arrow paints. Screen readers hear each cell\'s day, time and state.', 1200);
await page.keyboard.press('Space');
for (let k = 0; k < 3; k++) { await wait(350); await page.keyboard.press('Shift+ArrowDown'); }
await wait(3500);
await scrollTo('#code-h', 30);
await cap('The code updates as Bo paints. "What\'s inside" decodes it: a name, one bit per slot, a window check and a checksum.', 7500);
await cap('Nothing else is in the code: no event titles, no time zone, no contact details.', 4500);

// ---- 3. Member in Kolkata imports a calendar
await page.goto(`${BASE}#${PLAN}`);
await page.click('#all-busy');
await page.fill('#m-name', 'Chen');
await page.selectOption('#vtz-view-fill', 'Asia/Kolkata');
await cap('Chen is in Kolkata, so the grid now shows India time.', 4000);
await page.click('#tab-import');
await scrollTo('#panel-import', 120);
await cap('Instead of painting, Chen imports an .ics export of their own calendar. The file is read on this device only.', 3000);
await page.setInputFiles('#ics-file', fixture);
await wait(800);
await cap('ical.js expands repeating events, including a cancelled lecture (EXDATE) and a moved one (RECURRENCE-ID). Cancelled and "show as free" events are skipped.', 7500);
await scrollTo('#fill-grid', 120);
await page.locator('#fill-grid .cell.cal').first().focus();
await cap('Busy times are hatched. Event titles appear only on Chen\'s screen. Chen can override any cell before sharing.', 6500);

// ---- 4. Organiser merges
const chenCode = await page.inputValue('#my-code');
await page.goto(`${BASE}#${PLAN}&v=merge`);
await page.evaluate(() => localStorage.clear());
await page.reload();
await cap('Back to the organiser. Paste codes, links, or even the whole chat log.', 1000);
await page.fill('#paste', `Chen: ${chenCode}\nBo: ${chenCode.slice(0, -5)}  (cut off by the chat app)`);
await wait(2000);
await page.click('#add-codes');
await cap('Each code is checked. A code that was cut off is rejected with a reason instead of being merged wrongly.', 6000);

await page.goto(BASE);
await page.click('#demo-btn');
await page.waitForSelector('#members li');
await cap('A larger example: five members in five time zones (synthetic demo data).', 4500);
await scrollTo('#members-h', 40);
await cap('Best times for a 1-hour meeting, each with who can\'t make it and how long the group stays free.', 6000);
await page.locator('#members li', { hasText: 'Dee' }).getByLabel('Required').check();
await cap('Mark someone as required and every option keeps them. The heatmap stripes the times they can\'t make.', 5500);
await page.locator('#members li', { hasText: 'Dee' }).getByLabel('Required').uncheck();
await page.selectOption('#len', '3');
await cap('Change the meeting length and the ranking updates.', 4000);
await page.locator('#options button', { hasText: 'Show on heatmap' }).first().click();
await wait(400);
await scrollTo('#heat-grid', 110);
await cap('The heatmap shows free/total in every cell, so it does not rely on colour. The chosen option is outlined.', 6000);
await page.locator('#heat-grid .cell.all').first().focus();
await page.keyboard.press('ArrowRight');
await page.keyboard.press('ArrowLeft');
await scrollTo('#cell-detail', 420);
await cap('Select any cell to see who is free and who isn\'t.', 4500);
await scrollTo('#members-h', 40);
await page.locator('#options button', { hasText: 'Download invite' }).first().click();
await cap('Download a calendar invite (.ics) for the chosen slot and post it to the group.', 5000);

// ---- 5. Privacy and limits
await scrollTo('#privacy', 120);
await cap('Privacy is enforced: the page\'s Content Security Policy (connect-src \'none\') blocks network requests, and the tests check this. It also works offline.', 7500);
await cap('Trade-offs: codes are collected by hand, nothing updates live, and anyone with a code can read that person\'s free/busy.', 7000);
await page.goto(BASE);
await cap('WhenCode: bowen1314.github.io/whencode · source: github.com/Bowen1314/whencode · built with an AI coding assistant (Claude).', 6000);

const total = (Date.now() - t0) / 1000;
await page.close();
await ctx.close();
await browser.close();
if (process.env.NO_VIDEO) { console.log('dry run ok', total.toFixed(1)); process.exit(0); }
const vid = readdirSync(rawDir).filter((f) => f.endsWith('.webm')).map((f) => rawDir + f).at(-1);
renameSync(vid, rawDir + 'demo.webm');
writeFileSync(demoDir + 'captions.json', JSON.stringify({ total, captions }, null, 2));
console.log(`recorded ${total.toFixed(1)} s, ${captions.length} captions`);
