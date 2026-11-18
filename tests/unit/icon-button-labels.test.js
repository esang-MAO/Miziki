// BD15 (docs/38_BEFORE_THE_DOMAIN.md item 1): every button whose content
// is only an icon (an inline <svg>, or nothing at all -- the icon painted
// by CSS) needs an aria-label in plain words, or VoiceOver has nothing to
// read. A regression guard, not a one-time audit: this parses the real
// miziki.html and fails the moment a new icon-only button ships without
// one, rather than relying on every PR remembering to check by hand.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const html = readFileSync(path.join(__dirname, '../../miziki.html'), 'utf8')
  .replace(/<!--[\s\S]*?-->/g, ''); // comments can contain stray "<button" text

// Finds every unlabelled icon-only <button>: one with no aria-label/
// aria-labelledby and no visible text once any inline <svg> icon is
// stripped out (an svg's own <title>, if any, would otherwise read as
// "visible text" and hide a real gap -- stripped first for that reason).
function findUnlabelledIconButtons(markup){
  const re = /<button\b([^>]*)>([\s\S]*?)<\/button>/g;
  const offenders = [];
  let m;
  while((m = re.exec(markup))){
    const [, attrs, inner] = m;
    if(/\baria-label\s*=/.test(attrs) || /\baria-labelledby\s*=/.test(attrs)) continue;
    const withoutSvg = inner.replace(/<svg\b[\s\S]*?<\/svg>/g, '');
    const text = withoutSvg.replace(/<[^>]*>/g, '').replace(/\s+/g, '');
    if(!text) offenders.push(attrs.match(/\bid\s*=\s*"([^"]+)"/)?.[1] || attrs.trim() || '(no id)');
  }
  return offenders;
}

test('findUnlabelledIconButtons: a button with visible text needs no aria-label', () => {
  assert.deepEqual(findUnlabelledIconButtons('<button id="a"><svg></svg><span>Library</span></button>'), []);
});

test('findUnlabelledIconButtons: a button with only an icon and an aria-label is fine', () => {
  assert.deepEqual(findUnlabelledIconButtons('<button id="a" aria-label="Open player"><svg></svg></button>'), []);
});

test('findUnlabelledIconButtons: a button with only an icon and no label is flagged', () => {
  assert.deepEqual(findUnlabelledIconButtons('<button id="bad"><svg></svg></button>'), ['bad']);
});

test('findUnlabelledIconButtons: an empty button with no label is flagged', () => {
  assert.deepEqual(findUnlabelledIconButtons('<button id="bad"></button>'), ['bad']);
});

test('findUnlabelledIconButtons: aria-labelledby also satisfies the check', () => {
  assert.deepEqual(findUnlabelledIconButtons('<button id="a" aria-labelledby="x"><svg></svg></button>'), []);
});

test('every icon-only button in miziki.html has an aria-label or aria-labelledby', () => {
  const offenders = findUnlabelledIconButtons(html);
  assert.deepEqual(offenders, [], 'icon-only buttons missing an aria-label: ' + offenders.join(', '));
});
