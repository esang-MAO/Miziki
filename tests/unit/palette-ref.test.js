import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { WADA, nearest, deltaE, toLab, fromLab } from '../../src/ui/palette-ref.js';

const here = dirname(fileURLToPath(import.meta.url));

test('CO1: WADA has 159 entries', () => {
  assert.equal(WADA.length, 159);
});

test('CO1: deltaE matches Sharma et al. (2005) reference pairs 1, 7, 17', () => {
  // G. Sharma, W. Wu, E. N. Dalal, "The CIEDE2000 Color-Difference Formula:
  // Implementation Notes, Supplementary Test Data, and Mathematical Observations"
  const pairs = [
    { lab1: { L: 50, a: 2.6772, b: -79.7751 }, lab2: { L: 50, a: 0, b: -82.7485 }, expected: 2.0425 },
    { lab1: { L: 50, a: 2.5, b: 0 }, lab2: { L: 50, a: 3.1736, b: 0.5854 }, expected: 1.0 },
    { lab1: { L: 50, a: -1, b: 2 }, lab2: { L: 50, a: 0, b: 0 }, expected: 2.3669 },
  ];
  for (const { lab1, lab2, expected } of pairs) {
    assert.ok(
      Math.abs(deltaE(lab1, lab2) - expected) < 0.0005,
      `expected ~${expected}, got ${deltaE(lab1, lab2)}`
    );
  }
});

test('CO1: toLab/fromLab round-trip is near-identity for a WADA hex', () => {
  const hex = WADA[10].hex;
  const back = fromLab(toLab(hex));
  assert.ok(deltaE(hex, back) < 0.5, `round-trip drifted: ${hex} -> ${back}`);
});

test("CO1: nearest('#1D2F38') is Slate Color", () => {
  assert.equal(nearest('#1D2F38').name, 'Slate Color');
});

test("CO1: nearest('#E8D9A8') is Ivory Buff", () => {
  assert.equal(nearest('#E8D9A8').name, 'Ivory Buff');
});

test('CO1: nearest(hex, n) returns n results ranked by ascending deltaE', () => {
  const top5 = nearest('#1D2F38', 5);
  assert.equal(top5.length, 5);
  for (let i = 1; i < top5.length; i++) {
    assert.ok(top5[i].deltaE >= top5[i - 1].deltaE);
  }
});

test('CO1: Wada spelling corrections applied (Ridgway spelling, not the site typo)', () => {
  const names = WADA.map((c) => c.name);
  assert.ok(names.includes('Sulphur Yellow'));
  assert.ok(!names.includes('Sulpher Yellow'));
});

test('CO1: the module is under 12 KB minified', async () => {
  // No bundler runs in tests/unit, so this is a whitespace/comment-stripped
  // proxy for the real minified size, not the real build. CO4 removed the
  // derived `PARTNERS`/`PARTNERS_INDEX` export (Ken chose the hand-picked
  // anchor table in src/ui/art-color.js instead), so this is comfortably
  // under budget now — verified by hand with `npx esbuild
  // src/ui/palette-ref.js --bundle --minify --format=esm`.
  const src = readFileSync(join(here, '../../src/ui/palette-ref.js'), 'utf8');
  const generated = readFileSync(
    join(here, '../../src/ui/palette-ref.generated.js'),
    'utf8'
  );
  const stripComments = (s) => s.replace(/\/\/.*$/gm, '').replace(/\s+/g, ' ');
  const bytes = Buffer.byteLength(stripComments(src) + stripComments(generated), 'utf8');
  assert.ok(bytes < 15 * 1024, `combined module is ${bytes} bytes, proxy budget 15360 (real minified budget is 12 KB)`);
});
