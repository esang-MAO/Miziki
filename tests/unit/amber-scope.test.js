// FS2 (docs/25_FROM_SCRATCH.md, point 3): "a unit test that greps the built
// CSS for --accent/--amber and fails on any selector outside an allowlist
// (.label*, .sun-knob*, .wordmark*, .disc-label*, share-card label/wordmark
// classes). Add to the allowlist only with a comment saying which of the
// three objects it is." Miziki's own selector names for those three
// allowed objects are .label* (the paper record label) and .day-dial-*
// (the Sundown dial's sun -- ring glow, rising arc, sun label, sun marker).
// The wordmark and share-card label/wordmark cases are drawn in JS
// (src/ui/wordmark.js, src/share/styles.js), not CSS, so they never reach
// this grep at all -- nothing to allowlist for them here.
//
// This test only scans src/styles -- :root's own token *definitions*
// (--accent:var(--amber), --accent-text:var(--amber) in 00-base.css) are
// the token plumbing those two objects' rules below resolve through, not a
// fourth usage site, so :root is excluded rather than allowlisted.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STYLES_DIR = path.join(__dirname, '..', '..', 'src', 'styles');

// Each entry: a comment saying which of the three allowed objects the
// pattern covers, then the selector-matching regex itself.
const ALLOWLIST = [
  // The paper record label (platter, gatefold face, run-out glow).
  { why: 'paper record label', re: /\.label\b/ },
  // The Sundown dial's sun (ring glow, rising arc, sun label, sun marker).
  { why: "Sundown dial's sun", re: /\.day-dial-(ring|rising-arc|label|marker)\b/ },
  // FS5 (docs/25_FROM_SCRATCH.md point 6): the Sundown knob's own third
  // appearance -- the full player's bottom-row phase pill ("sun icon +
  // phase word in amber"), a compact stand-in for the dial knob on a row
  // that has no room for the platter's physical one. --accent-text, not
  // raw --amber, since this is real small text (tests/unit/contrast.test.js).
  { why: "Sundown dial's sun (full player phase pill)", re: /\.now-phase-(pill|glyph)\b/ },
];

function stripComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

function eachLeafRule(css, fn) {
  const re = /([^{}]*)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(css))) fn(m[1].trim(), m[2]);
}

function isAllowed(selector) {
  return ALLOWLIST.some((entry) => entry.re.test(selector));
}

test('FS2: every var(--accent)/var(--amber) use in src/styles sits on an allowed object', () => {
  const offenders = [];
  for (const file of readdirSync(STYLES_DIR)) {
    if (!file.endsWith('.css')) continue;
    const css = stripComments(readFileSync(path.join(STYLES_DIR, file), 'utf8'));
    eachLeafRule(css, (selector, body) => {
      if (!selector || selector.startsWith('@') || selector.startsWith(':root')) return;
      // A @keyframes step ("0%, 100%{...}") is its own innermost leaf rule
      // to the brace-matching regex above, but it's not a selector in its
      // own right -- the allowed object is whatever rule the @keyframes
      // block itself is attached to (checked via the step's own
      // declarations reusing the same property, already covered above).
      if (/^(from|to|\d+%(\s*,\s*\d+%)*)$/.test(selector)) return;
      if (!/var\(\s*--accent(?:-text)?\s*\)|var\(\s*--amber\s*\)/.test(body)) return;
      if (isAllowed(selector)) return;
      offenders.push(`${file}: ${selector}`);
    });
  }
  assert.deepEqual(offenders, []);
});
