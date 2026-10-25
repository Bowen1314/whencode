// Core flow with three people in three real browser time zones (Playwright timezoneId).
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import ICAL from '../../site/vendor/ical.min.js';
import { BASE, planHash, slotAt, cell, showPageOf } from './helpers.mjs';

const fixture = new URL('../fixtures/student-ny.ics', import.meta.url).pathname;

test('organiser creates a starter link in the setup form', async ({ browser }) => {
  const ctx = await browser.newContext({ timezoneId: 'America/New_York' });
  const page = await ctx.newPage();
  await page.goto(BASE);
  await page.fill('#f-title', 'CS 214 project');
  await page.fill('#f-start', '2026-10-24');
  await page.fill('#f-end', '2026-11-08');
  await page.selectOption('#f-from', '540');
  await page.selectOption('#f-to', '1260');
  await page.selectOption('#f-tz', 'America/New_York');
  await expect(page.locator('#setup-summary')).toContainText('16 days × 24 slots = 384 slots');
  await page.click('button[type=submit]');
  const link = await page.inputValue('#starter-link');
  expect(link).toBe(`${BASE}#${planHash()}`);
  await expect(page.locator('#starter-msg')).toHaveValue(/reply here with your code/);
  await page.click('[data-qr="starter-link"]');
  await expect(page.locator('[data-qr-box="starter-link"] svg')).toBeVisible();
  await ctx.close();
});

test('London member, Kolkata member with an .ics file, New York organiser: merge, rank, invite', async ({ browser }) => {
  // ---- Bo, in London: the grid is labelled in London time, across both DST changes.
  const lon = await browser.newContext({ timezoneId: 'Europe/London' });
  const bo = await lon.newPage();
  await bo.goto(`${BASE}#${planHash()}`);
  await expect(bo.locator('#view-fill')).toBeVisible();
  const oct24 = slotAt('2026-10-24T13:00:00Z'); // 09:00 New York
  const oct30 = slotAt('2026-10-30T13:00:00Z'); // 09:00 New York, still EDT; London already GMT
  await expect(cell(bo, oct24.i)).toHaveAttribute('aria-label', /Saturday, October 24, 2:00 PM to 2:30 PM your time \(9:00 AM organiser time\)/);
  await expect(cell(bo, oct30.i)).toHaveAttribute('aria-label', /Friday, October 30, 1:00 PM to 1:30 PM your time \(9:00 AM organiser time\)/);
  await expect(bo.locator('#fill-grid .colhead.shifted')).toHaveCount(1); // Oct 24 differs from the rest of week 1
  const nov2 = slotAt('2026-11-02T14:00:00Z'); // 09:00 EST
  await showPageOf(bo, nov2);
  await expect(cell(bo, nov2.i)).toHaveAttribute('aria-label', /Monday, November 2, 2:00 PM .*\(9:00 AM organiser time\)/);
  await bo.locator('#fill-grid .pager button', { hasText: 'Earlier' }).click();

  await bo.fill('#m-name', 'Bo');
  const t0900 = slotAt('2026-10-27T13:00:00Z'); // Tue Oct 27, 09:00 and 09:30 New York
  const t0930 = slotAt('2026-10-27T13:30:00Z');
  await cell(bo, t0900.i).click();
  await cell(bo, t0930.i).click();
  await expect(cell(bo, t0900.i)).toHaveAttribute('aria-selected', 'true');
  await expect(bo.locator('#inside-body')).toContainText('2 free');
  const boLink = await bo.inputValue('#my-link');
  expect(boLink).toContain('&m=WC1.');

  // ---- Chen, in Kolkata: imports a calendar file (RRULE, EXDATE, moved occurrence, VTIMEZONE).
  const kol = await browser.newContext({ timezoneId: 'Asia/Kolkata' });
  const chen = await kol.newPage();
  await chen.goto(`${BASE}#${planHash()}`);
  await chen.fill('#m-name', 'Chen');
  await chen.click('#tab-import');
  await chen.setInputFiles('#ics-file', fixture);
  await expect(chen.locator('#ics-report')).toContainText('6 events (3 repeating)');
  await expect(chen.locator('#ics-report')).toContainText('Ignored: 1 marked "free", 1 cancelled, 1 all-day');
  const lecture = slotAt('2026-10-27T14:30:00Z'); // 10:30 New York, inside the Tue lecture
  await expect(cell(chen, lecture.i)).toHaveAttribute('aria-label', /8:00 PM .*busy in your calendar: CS 214 Lecture/);
  const exdate = slotAt('2026-10-29T14:30:00Z'); // Thursday lecture removed by EXDATE
  await expect(cell(chen, exdate.i)).toHaveAttribute('aria-selected', 'true');
  const chenCode = await chen.inputValue('#my-code');
  // The code must not contain anything from the calendar besides the bitmap.
  expect(chenCode).not.toMatch(/Lecture|Library|gym/i);

  // ---- Organiser, in New York: pastes a chat log with one link and one bare code.
  const ny = await browser.newContext({ timezoneId: 'America/New_York' });
  const org = await ny.newPage();
  await org.goto(`${BASE}#${planHash('&v=merge')}`);
  await org.fill('#paste', `Bo: here you go ${boLink}\nChen: ${chenCode}\nAlso a broken one: ${chenCode.slice(0, -4)}`);
  await org.click('#add-codes');
  await expect(org.locator('#paste-report')).toContainText('Added Bo, Chen.');
  await expect(org.locator('#paste-report')).toContainText('1 code could not be used');
  await expect(org.locator('#members li')).toHaveCount(2);

  await expect(cell(org, t0930.i, '#heat-grid')).toHaveText('2/2');
  await expect(cell(org, slotAt('2026-10-27T14:00:00Z').i, '#heat-grid')).toHaveText('0/2'); // Bo no, Chen in lecture
  await expect(cell(org, slotAt('2026-10-27T16:00:00Z').i, '#heat-grid')).toHaveText('1/2'); // Chen free at noon

  await org.selectOption('#len', '2'); // 1 hour
  const first = org.locator('#options li').first();
  await expect(first).toContainText('Tue, Oct 27, 9:00 AM – 10:00 AM');
  await expect(first).toContainText('All 2 free');

  // Required member: Bo is only free Tue 9-10, so every option must include Bo.
  await org.locator('#members li', { hasText: 'Bo' }).getByLabel('Required').check();
  await expect(org.locator('#options li')).toHaveCount(1);

  const [dl] = await Promise.all([org.waitForEvent('download'), first.getByRole('button', { name: 'Download invite (.ics)' }).click()]);
  const ics = readFileSync(await dl.path(), 'utf8');
  const ev = new ICAL.Event(new ICAL.Component(ICAL.parse(ics)).getFirstSubcomponent('vevent'));
  expect(ev.startDate.toUnixTime() * 1000).toBe(Date.parse('2026-10-27T13:00:00Z'));
  expect(ev.endDate.toUnixTime() * 1000).toBe(Date.parse('2026-10-27T14:00:00Z'));
  expect(ev.summary).toBe('CS 214 project');
  expect(ev.description).toContain('Can make it: Bo, Chen');

  // The merged-view link carries both codes and reopens the same state elsewhere.
  const mergeLink = await org.inputValue('#merge-link');
  const other = await (await browser.newContext({ timezoneId: 'Asia/Tokyo' })).newPage();
  await other.goto(mergeLink);
  await expect(other.locator('#members li')).toHaveCount(2);
  await expect(other.locator('#options li').first()).toContainText('10:00 PM – 11:00 PM'); // Tokyo time

  await Promise.all([lon.close(), kol.close(), ny.close()]);
});

test('a code made for a different window is rejected with a clear reason', async ({ page }) => {
  await page.goto(`${BASE}#${planHash()}`);
  await page.fill('#m-name', 'Ana');
  const code = await page.inputValue('#my-code');
  await page.goto(`${BASE}#${planHash().replace('s=30', 's=60')}&v=merge`);
  await page.fill('#paste', code);
  await page.click('#add-codes');
  await expect(page.locator('#paste-report')).toContainText('made for a different planning window');
});

test('demo button opens a merged example with five members', async ({ page }) => {
  await page.goto(BASE);
  await page.click('#demo-btn');
  await expect(page.locator('#members li')).toHaveCount(5);
  await expect(page.locator('#options li').first()).toContainText('All 5 free');
});
