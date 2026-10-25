# WhenCode demo: transcript

Video: `demo/demo.mp4`, 2:38 long, 1280×800, captions only (no voice-over). It was recorded with Playwright against the live site https://bowen1314.github.io/whencode/. The captions were overlaid in the recording browser. All names and calendars in the video are synthetic.

| Time | On-screen caption |
|---|---|
| 0:00 | WhenCode: find a meeting time for a group project. No accounts, no server, and no calendar upload. |
| 0:05 | Group projects mix classes, jobs and time zones. The usual fixes are long chat threads or poll sites that want an account or calendar access. |
| 0:13 | The organiser picks the dates, daily hours, slot length and time zone. |
| 0:17 | The page shows how many slots that makes and how long each member's code will be. |
| 0:22 | Result: one starter link, plus a message ready to paste into the group chat. |
| 0:27 | There is a QR code too, for moving the link to a phone. |
| 0:30 | Bo opens the starter link in London. The organiser set New York hours, and the grid shows London time. |
| 0:37 | The EU and US change clocks a week apart. Days where the offset differs carry a "+1 h" / "−1 h" badge. |
| 0:43 | Drag to mark free times. Touch works the same way. |
| 0:47 | Keyboard works too: arrows move, Space toggles, Shift+arrow paints. Screen readers hear each cell's day, time and state. |
| 0:53 | The code updates as Bo paints. "What's inside" decodes it: a name, one bit per slot, a window check and a checksum. |
| 1:01 | Nothing else is in the code: no event titles, no time zone, no contact details. |
| 1:05 | Chen is in Kolkata, so the grid now shows India time. |
| 1:10 | Instead of painting, Chen imports an .ics export of their own calendar. The file is read on this device only. |
| 1:14 | ical.js expands repeating events, including a cancelled lecture (EXDATE) and a moved one (RECURRENCE-ID). Cancelled and "show as free" events are skipped. |
| 1:22 | Busy times are hatched. Event titles appear only on Chen's screen. Chen can override any cell before sharing. |
| 1:29 | Back to the organiser. Paste codes, links, or even the whole chat log. |
| 1:32 | Each code is checked. A code that was cut off is rejected with a reason instead of being merged wrongly. |
| 1:38 | A larger example: five members in five time zones (synthetic demo data). |
| 1:43 | Best times for a 1-hour meeting, each with who can't make it and how long the group stays free. |
| 1:49 | Mark someone as required and every option keeps them. The heatmap stripes the times they can't make. |
| 1:55 | Change the meeting length and the ranking updates. |
| 2:00 | The heatmap shows free/total in every cell, so it does not rely on colour. The chosen option is outlined. |
| 2:07 | Select any cell to see who is free and who isn't. |
| 2:12 | Download a calendar invite (.ics) for the chosen slot and post it to the group. |
| 2:18 | Privacy is enforced: the page's Content Security Policy (connect-src 'none') blocks network requests, and the tests check this. It also works offline. |
| 2:25 | Trade-offs: codes are collected by hand, nothing updates live, and anyone with a code can read that person's free/busy. |
| 2:32 | WhenCode: bowen1314.github.io/whencode · source: github.com/Bowen1314/whencode · built with an AI coding assistant (Claude). |
