// Build demo/transcript.md from the caption timeline written by record-demo.mjs.
import { readFileSync, writeFileSync } from 'node:fs';
const dir = new URL('../demo/', import.meta.url);
const { total, captions } = JSON.parse(readFileSync(new URL('captions.json', dir), 'utf8'));
const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const lines = [
  '# WhenCode demo: transcript',
  '',
  `Video: \`demo/demo.mp4\`, ${mmss(total)} long, 1280×800, captions only (no voice-over). It was recorded with Playwright against the live site https://bowen1314.github.io/whencode/. The captions were overlaid in the recording browser. All names and calendars in the video are synthetic.`,
  '',
  '| Time | On-screen caption |',
  '|---|---|',
  ...captions.map((c) => `| ${mmss(c.t)} | ${c.text.replace(/\|/g, '\\|')} |`),
  '',
];
writeFileSync(new URL('transcript.md', dir), lines.join('\n'));
console.log(`${captions.length} captions, ${mmss(total)}`);
