# WhenCode

**Find a meeting time for a group project with no accounts and no server, and without anyone uploading their calendar.**

Live: https://bowen1314.github.io/whencode/ · Demo video: [demo/demo.mp4](demo/demo.mp4) · Built during LaunchPad Hacks (October 16 – November 20, 2026). All code in this repository was written during the event, starting 2026-10-24.

## Who it is for

Student group-project teams whose members are spread across classes, part-time jobs and sometimes time zones. Such teams usually coordinate in a group chat and either argue it out in long threads or use a poll tool. Poll tools ask someone to paint availability by hand on a hosted page, or to connect a calendar account. WhenCode keeps everything in the group chat the team already uses.

## What it does

1. **Organiser** picks the dates, weekdays, daily hours, slot length (15/20/30/60 min) and time zone, and gets a *starter link* plus a ready-to-paste chat message (and an optional QR code).
2. **Each member** opens the link and marks when they're free in one of two ways:
   - by painting a grid with mouse, touch or keyboard;
   - by importing an `.ics` export of their own calendar. The file is parsed **in the browser**, and repeating events (RRULE, RDATE, EXDATE, moved occurrences via RECURRENCE-ID) are expanded with ical.js.

   Imported events become hatched "busy" cells that the member reviews and can override. The page then shows the member a short **code**, and a reply link containing it. A "What's inside this code?" panel decodes the member's own code byte by byte and lists the free times it contains.
3. **Organiser** pastes the codes, or the whole chat log, into the merge page and gets:
   - a **heatmap** where each cell shows "free/total", with names on focus or click;
   - a **ranked list of the best slots** for a chosen meeting length. Each slot shows who can't make it and how long the same people stay free, and members can be marked **required**;
   - a downloadable **.ics invite** for the chosen slot (UTC times, no e-mail addresses).

Members in other time zones see the grid in their local time. If a daylight-saving change happens in only one of the two zones during the window, the affected day shows a "+1 h"/"−1 h" badge. Every cell's accessible label gives its exact local and organiser time.

## How it works

- **Slots are instants.** The planning window generates each day's slots as wall-clock times in the organiser's zone and converts them to absolute UTC instants with the browser's `Intl` time zone data. No tz library is shipped. DST policy:
  - a wall time that does not exist (spring forward) yields no slot;
  - a repeated wall time (fall back) yields one slot, at its first occurrence.
- **Starter link**: the window is stored in readable form after `#`, e.g. `#t=CS+214&d=2026-11-23~2026-12-06&h=9-21&s=30&z=America%2FNew_York`. Browsers never send the fragment to a server.
- **Code format** (`WC1.` + base64url):

  | Part | Size |
  |---|---|
  | window fingerprint | 2 bytes |
  | name length + name (UTF-8, at most 24 characters) | 1 + n bytes |
  | encoding flag | 1 byte |
  | availability: one bit per slot, or LEB128 run lengths, whichever is shorter | varies |
  | CRC-16 checksum | 2 bytes |

  A code made for a different window, or one damaged by copying, is rejected with a specific message. The code contains no event titles, no time zone and no device or contact data.
- **Merging** is done entirely in the page. A meeting option counts a member only if they are free for the *whole* meeting. Meetings never span a gap: the end of a day, or a skipped DST hour. Options are ordered by number of people available, then by earliest start, and overlapping options are thinned greedily.
- **Privacy is enforced, not just promised.** `index.html` carries a Content Security Policy with `connect-src 'none'`, `default-src 'none'` and `script-src 'self'`, so page code cannot send data anywhere. A test proves the policy is active: it checks that `fetch()` to another host is refused with a `connect-src` violation. Another test checks that every request in the full flow is a same-origin static file with no query string.
- **Offline**: a small service worker caches the app's own files after the first visit.
- **Local storage**: a member's name and grid (not event titles) and the organiser's list of codes are kept in that browser's `localStorage` for convenience. A "Forget my data on this device" button clears the member data.

### Code size (measured)

Output of `npm run measure` (8-character name, daily hours 9:00–21:00). "Worst case" is one bit per slot, the upper bound for any pattern. "Demo patterns" are the five synthetic members of the in-app demo, whose availability comes in blocks.

| Window (9:00–21:00 daily) | Slots | Code, worst case (chars) | Code, demo patterns (chars) | Reply link, worst case (chars) |
|---|---:|---:|---:|---:|
| 7 days, 30-min slots | 168 | 51 | 30–48 | 167 |
| 7 days, 15-min slots | 336 | 79 | 31–48 | 195 |
| 14 days, 30-min slots | 336 | 79 | 35–72 | 195 |
| 14 days, 15-min slots | 672 | 135 | 38–72 | 251 |
| 28 days, 30-min slots | 672 | 135 | 46–120 | 251 |
| 28 days, 15-min slots | 1344 | 247 | 51–120 | 363 |

The planner caps windows at 31 days and 2,016 slots.

## Prior art, and what is different

Group scheduling is a solved problem in many ways; WhenCode is a different trade-off, not a first.

- **When2meet**: free, no sign-up, paint-a-grid. Responses are stored on its server.
- **Crab Fit**: open source (GPL-3.0), no account, time-zone aware, heatmap. Events are stored on its server and deleted after 3 months of inactivity ([privacy page](https://crab.fit/privacy)). Its privacy page and third-party listings mention Google Calendar sync.
- **Doodle**: participants need no account. Since 2025, completing event creation requires a free or paid account ([Doodle help](https://help.doodle.com/en/articles/12086821-how-can-i-create-a-group-poll-without-an-account)).
- **LettuceMeet**: hosted poll with a heatmap; its blog describes Google sign-in to see your own calendar while filling in.
- **Google Calendar "Find a time" / Outlook Scheduling Assistant**: these show others' free/busy only when those people share their calendar with you or are in your organisation ([Google help](https://support.google.com/a/users/answer/11617205)). That rarely holds for a student team spread across schools and personal accounts.
- Encrypted polls such as Croodle encrypt responses in the browser but still store them on a server.

Differences: **no server or account at all**; **calendar import from a local .ics file that never leaves the device** (no OAuth); **a code that contains only a free/busy bitmap and a display name**, which the member can inspect. I did not find another tool that works this way, though that does not prove none exists.

## Evidence of need

- In a study of opt-in study groups in a 1,000+ student introductory engineering and computer science course at UC Berkeley, run online during COVID (477 students consented to the research), **48.5%** of students named scheduling group meetings as a challenge they faced. This was despite the matching system prioritising availability. Source: Kohli et al., SIGCSE 2023, [arXiv:2202.07439](https://arxiv.org/abs/2202.07439), section 3.4.
- The existence and popularity of the tools above shows the need. The privacy gap is that the convenient options (calendar sync, "find a time") require an account connection or an organisation-wide calendar.

**No user testing has been done yet.** Nothing here claims that students prefer WhenCode.

## Limitations and trade-offs

- **Manual collection.** Someone has to gather codes from the chat; there are no live updates and no notifications.
- **Codes are readable.** Anyone holding a code can decode that person's free/busy pattern for the window. That is the point, but share codes only in the group's own chat. Codes are not signed, so a member could submit a code under someone else's name. The merge page replaces an earlier code with the same name and says so.
- **Code length grows with the window** (table above). Very long windows with fine slots make long links.
- **Import scope.** Only `.ics` files are supported, not live calendar feeds, CalDAV or OAuth. Recurrence expansion relies on ical.js, and TZIDs are handled as follows:
  - a TZID that is neither defined in the file nor a valid IANA name (for example a Windows zone name without a VTIMEZONE) is read as the member's own time zone, with a warning;
  - all-day events are ignored unless the member opts in.
- **Time labels.** Columns are the organiser's days. A member far away may see a column that crosses their local midnight; it is marked with a line and the new date. Where daylight saving shifts one day relative to the rest, a "+1 h"/"−1 h" badge appears. The exact time is always in each cell's label and in the readout below the grid.
- **DST edge rule.** If the daily hours include a repeated hour (for example 1:00–2:00 on a fall-back night), only its first occurrence is offered.
- **Browser support.** Tested in Chromium only (Playwright). The app relies on standard APIs (`Intl` time zones, ES modules, service workers), but Safari and Firefox were not tested.
- **Offline.** The first visit needs a network connection, and the offline cache updates only when the service worker version changes.

## Run it locally

```bash
git clone https://github.com/Bowen1314/whencode.git
cd whencode
npm install            # dev tools only: Playwright, axe-core, and the vendored libraries' sources
npm run serve          # http://127.0.0.1:8765/whencode/
```

The site itself is the static folder `site/`, with no build step; any static file server works. `npm run vendor` re-copies ical.js and qrcode-generator from `node_modules` into `site/vendor/` unmodified and records their SHA-256 in `site/vendor/VERSIONS.txt`.

## Testing done

- `npm test`: 13 Node unit tests with hard-coded UTC instants, not values recomputed with `Intl`. They cover:
  - time zone conversion, including the DST gap and overlap;
  - slot generation across the US fall-back;
  - the same slots labelled in London (three different offsets in one window, since the EU and US change on different dates) and Kolkata (+5:30);
  - code round-trips for both encodings;
  - rejection of truncated, edited and wrong-window codes;
  - extracting codes from a pasted chat log;
  - .ics import of a synthetic calendar (RRULE + EXDATE + RECURRENCE-ID + VTIMEZONE across the DST change, a TZID without VTIMEZONE, UTC, floating, unknown zone, transparent, cancelled and all-day events);
  - slot ranking with required members and gaps;
  - the invite file, which must parse back with ical.js to the same instants.
- `npm run e2e`: 9 Playwright tests in Chromium:
  - three people in three real browser time zones (`timezoneId`: London paints, Kolkata imports an .ics, New York merges a pasted chat log), then ranking, a required member, the invite download parsed back, and the merged link reopened in Tokyo;
  - no request leaves the origin, `fetch()` to another host is refused by CSP, and there are zero CSP violations during the flow;
  - offline reload and the full flow with the network disabled;
  - keyboard-only painting with roving tabindex and live-region announcements;
  - axe-core (WCAG 2.1 A/AA rules) with zero serious or critical issues on all three views;
  - 375 px phone width with no horizontal scroll and tap-to-paint;
  - a wrong-window code rejected with a clear reason.
- The same e2e suite was run against the live GitHub Pages URL (`BASE_URL=https://bowen1314.github.io/whencode/ npx playwright test`).

Fixtures in `tests/fixtures/` are synthetic calendars written for this project.

## Credits

- [ical.js](https://github.com/kewisch/ical.js) 2.2.1 by Philipp Kewisch and contributors, **MPL-2.0**. It is vendored unmodified as `site/vendor/ical.min.js`, with the license in `site/vendor/ical.js.LICENSE.txt`.
- [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator) 2.0.4 by Kazuhiko Arase, **MIT**. It is vendored unmodified as `site/vendor/qrcode.mjs`. "QR Code" is a registered trademark of DENSO WAVE INCORPORATED.
- Test-only tools, which are not shipped: [Playwright](https://playwright.dev) (Apache-2.0) and [axe-core](https://github.com/dequelabs/axe-core) (MPL-2.0).
- Research cited: Kohli et al., SIGCSE 2023 (CC BY).
- All sample and demo data is synthetic.

## AI assistance

Built with an AI coding assistant (Claude); design decisions, testing and write-up reviewed by the author.

## License

MIT (see `LICENSE`). Vendored libraries keep their own licenses.
