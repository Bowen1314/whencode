// Copy third-party browser libraries into site/vendor/ unmodified, with their licenses.
import { copyFileSync, writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';

const out = new URL('../site/vendor/', import.meta.url);
mkdirSync(out, { recursive: true });
const nm = new URL('../node_modules/', import.meta.url);

copyFileSync(new URL('ical.js/dist/ical.min.js', nm), new URL('ical.min.js', out));
copyFileSync(new URL('ical.js/LICENSE', nm), new URL('ical.js.LICENSE.txt', out));
copyFileSync(new URL('qrcode-generator/dist/qrcode.mjs', nm), new URL('qrcode.mjs', out));
// qrcode-generator ships its MIT notice in the source header; the full text is reproduced here.
writeFileSync(new URL('qrcode.mjs.LICENSE.txt', out), `MIT License

Copyright (c) 2009 Kazuhiko Arase

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

The word "QR Code" is a registered trademark of DENSO WAVE INCORPORATED.
`);
const sums = ['ical.min.js', 'qrcode.mjs'].map((f) => {
  const h = createHash('sha256').update(readFileSync(new URL(f, out))).digest('hex');
  return `${h}  ${f}`;
});
const versions = `ical.js ${JSON.parse(readFileSync(new URL('ical.js/package.json', nm))).version} (MPL-2.0)\nqrcode-generator ${JSON.parse(readFileSync(new URL('qrcode-generator/package.json', nm))).version} (MIT)\n`;
writeFileSync(new URL('VERSIONS.txt', out), versions + '\nSHA-256 (identical to the npm package files):\n' + sums.join('\n') + '\n');
console.log(versions + sums.join('\n'));
