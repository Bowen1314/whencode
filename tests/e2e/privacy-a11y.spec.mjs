// Privacy (no network with user data, CSP enforced), offline, keyboard, screen-reader semantics,
// axe-core scan, and phone-width layout.
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { BASE, ORIGIN, planHash, cell } from './helpers.mjs';

const fixture = new URL('../fixtures/student-ny.ics', import.meta.url).pathname;
const basePath = new URL(BASE).pathname;

test('every request is a same-origin static file; CSP blocks fetch to other hosts; no CSP violations', async ({ page }) => {
  const requests = [];
  const cspErrors = [];
  page.on('request', (r) => requests.push(r.url()));
  page.on('console', (m) => { if (/Content Security Policy|Refused to/i.test(m.text())) cspErrors.push(m.text()); });

  // Full flow: setup -> member (paint + import + QR) -> merge -> invite.
  await page.goto(BASE);
  await page.click('button[type=submit]');
  await page.click('[data-qr="starter-link"]');
  await page.goto(`${BASE}#${planHash()}`);
  await page.fill('#m-name', 'Privacy Test');
  await page.locator('#fill-grid .cell[data-i]').first().click();
  await page.click('#tab-import');
  await page.setInputFiles('#ics-file', fixture);
  await expect(page.locator('#ics-report')).toContainText('occurrences overlap');
  await page.click('[data-qr="my-link"]');
  const link = await page.inputValue('#my-link');
  await page.goto(link);
  await expect(page.locator('#members li')).toHaveCount(1);
  const [dl] = await Promise.all([page.waitForEvent('download'), page.locator('#options button', { hasText: 'Download invite' }).first().click()]);
  expect(readFileSync(await dl.path(), 'utf8')).toContain('BEGIN:VEVENT');

  // Enforcement, not just absence: a request to another host is refused by the page's CSP.
  const blocked = await page.evaluate(async () => {
    let violation = null;
    document.addEventListener('securitypolicyviolation', (e) => { violation = e.violatedDirective; });
    let fetchFailed = false;
    try { await fetch('https://example.com/collect?x=1'); } catch { fetchFailed = true; }
    await new Promise((r) => setTimeout(r, 50));
    return { fetchFailed, violation };
  });
  expect(blocked.fetchFailed).toBe(true);
  expect(blocked.violation).toBe('connect-src');
  cspErrors.splice(0); // that refusal was deliberate

  for (const u of requests) {
    if (u.startsWith('blob:')) continue; // the invite download is a local blob: URL
    const url = new URL(u);
    expect(url.origin, u).toBe(ORIGIN);
    expect(url.pathname.startsWith(basePath), u).toBe(true);
    expect(url.search, u).toBe('');
    expect(u, 'no code in any request').not.toContain('WC1.');
    expect(u).not.toContain('Privacy');
  }
  expect(requests.some((u) => u.includes('ical.min.js'))).toBe(true);
  expect(cspErrors).toEqual([]);
});

test('works offline after the first visit (service worker)', async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(BASE);
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  await ctx.setOffline(true);
  await page.goto(`${BASE}#${planHash()}`);
  await page.reload();
  await expect(page.locator('#fill-grid .cell[data-i]').first()).toBeVisible();
  await page.click('#tab-import');
  await page.setInputFiles('#ics-file', fixture);
  await expect(page.locator('#ics-report')).toContainText('occurrences overlap');
  await page.goto(BASE);
  await page.click('#demo-btn');
  await expect(page.locator('#members li')).toHaveCount(5);
  await ctx.close();
});

test('keyboard only: Tab into the grid, arrows move, Space toggles, Shift+arrow paints, changes are announced', async ({ page }) => {
  await page.goto(`${BASE}#${planHash()}`);
  await page.focus('#m-name');
  await page.keyboard.type('Kay');
  let tries = 0;
  while (tries++ < 40) {
    await page.keyboard.press('Tab');
    if (await page.evaluate(() => document.activeElement?.getAttribute('role') === 'gridcell')) break;
  }
  expect(await page.evaluate(() => document.activeElement.getAttribute('role'))).toBe('gridcell');
  const focused = () => page.evaluate(() => document.activeElement.dataset.i);
  const start = await focused();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowRight');
  const a = await focused();
  expect(a).not.toBe(start);
  await page.keyboard.press('Space');
  await expect(cell(page, a)).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#fill-grid .sr-only[aria-live]')).toContainText('Free:');
  await page.keyboard.press('Shift+ArrowDown');
  await page.keyboard.press('Shift+ArrowDown');
  await expect(page.locator('#fill-grid .cell[aria-selected="true"]')).toHaveCount(3);
  await page.keyboard.press('Space');
  await expect(page.locator('#fill-grid .cell[aria-selected="true"]')).toHaveCount(2);
  await expect(page.locator('#inside-body')).toContainText('2 free');
  // Grid semantics for screen readers.
  const g = page.locator('#fill-grid [role="grid"]');
  await expect(g).toHaveAttribute('aria-multiselectable', 'true');
  await expect(page.locator('#fill-grid [role="columnheader"]').first()).toBeVisible();
  await expect(page.locator('#fill-grid [role="rowheader"]').first()).toBeAttached();
  // Only one cell is in the tab order (roving tabindex).
  await expect(page.locator('#fill-grid .cell[tabindex="0"]')).toHaveCount(1);
});

test('axe-core: no serious or critical issues on the three views', async ({ browser }) => {
  // axe is injected as a script, which the page's own CSP would (correctly) refuse.
  const ctx = await browser.newContext({ bypassCSP: true });
  const page = await ctx.newPage();
  const axeSrc = readFileSync(new URL('../../node_modules/axe-core/axe.min.js', import.meta.url), 'utf8');
  const scan = async (label) => {
    await page.addScriptTag({ content: axeSrc });
    const res = await page.evaluate(async () => {
      const r = await window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] } });
      return r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${v.id}: ${v.nodes.length} (${v.nodes[0].target})`);
    });
    expect(res, label).toEqual([]);
  };
  await page.goto(BASE);
  await page.click('button[type=submit]');
  await scan('setup');
  await page.goto(`${BASE}#${planHash()}`);
  await page.click('#tab-import');
  await page.click('#ics-sample');
  await scan('member');
  await page.goto(BASE);
  await page.click('#demo-btn');
  await expect(page.locator('#members li')).toHaveCount(5);
  await page.locator('#options button', { hasText: 'Show on heatmap' }).first().click();
  await scan('merge');
  await ctx.close();
});

test('phone width (375 px): no horizontal scroll, tap paints a cell', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  const noHScroll = () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
  await page.goto(BASE);
  expect(await noHScroll()).toBe(true);
  await page.goto(`${BASE}#${planHash()}`);
  expect(await noHScroll()).toBe(true);
  const c = page.locator('#fill-grid .cell[data-i]').nth(30);
  await c.tap();
  await expect(c).toHaveAttribute('aria-selected', 'true');
  await page.goto(BASE);
  await page.click('#demo-btn');
  await expect(page.locator('#members li')).toHaveCount(5);
  expect(await noHScroll()).toBe(true);
  await ctx.close();
});
