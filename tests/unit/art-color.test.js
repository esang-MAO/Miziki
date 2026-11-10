// UN6 (docs/36_UNIFORMITY.md): artTint()/spineColor() are pure {h,s,l}-in,
// hex-out colour math — no DOM/canvas needed (shareDominantColor() is the
// one function here that touches canvas, and it moved unchanged from
// src/share/styles.js, already exercised wherever that file's own share
// tests cover resolveShareStyle()'s 'cover' branch).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { artTint, spineColor } from '../../src/ui/art-color.js';

const FALLBACK_FROM = '#242127', FALLBACK_TO = '#1C1A1F'; // --disc-a/--disc-b

function hexToRgb(hex){
  const h = hex.replace('#', '');
  return { r: parseInt(h.slice(0,2),16), g: parseInt(h.slice(2,4),16), b: parseInt(h.slice(4,6),16) };
}
function srgbToLinear(c){ const n = c/255; return n <= 0.03928 ? n/12.92 : Math.pow((n+0.055)/1.055, 2.4); }
function relLuminance(hex){
  const { r, g, b } = hexToRgb(hex);
  return 0.2126*srgbToLinear(r) + 0.7152*srgbToLinear(g) + 0.0722*srgbToLinear(b);
}
function contrastRatio(hexA, hexB){
  const l1 = relLuminance(hexA), l2 = relLuminance(hexB);
  const lighter = Math.max(l1, l2), darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}
function compositeOverHex(r, g, b, a, bgHex){
  const bg = hexToRgb(bgHex);
  const mix = (fg, bgch) => Math.round(a*fg + (1-a)*bgch);
  const toHex = v => v.toString(16).padStart(2, '0');
  return '#' + toHex(mix(r, bg.r)) + toHex(mix(g, bg.g)) + toHex(mix(b, bg.b));
}
const ON_DARK = '#EFE9DF';

for(const [name, hsl] of Object.entries({
  'a saturated orange': { h: 28, s: 0.9, l: 0.55 },
  'a navy': { h: 222, s: 0.65, l: 0.3 },
})){
  test(`artTint() on ${name}: --on-dark clears 7:1 on \`from\`, the 66% muted read clears 4.5:1`, () => {
    const { from, to } = artTint(hsl);
    assert.ok(contrastRatio(ON_DARK, from) >= 7, `--on-dark vs from (${from}) — ${contrastRatio(ON_DARK, from).toFixed(2)}:1`);
    const muted = compositeOverHex(239, 233, 223, 0.66, from);
    assert.ok(contrastRatio(muted, from) >= 4.5, `66% muted vs from (${from}) — ${contrastRatio(muted, from).toFixed(2)}:1`);
    assert.notEqual(to, from, '`to` is a distinct, darker step');
    assert.ok(relLuminance(to) <= relLuminance(from), '`to` is never lighter than `from`');
  });
}

test('artTint() on a near-grey (low saturation) falls back to --disc-a/--disc-b, not a muddy tint', () => {
  const { from, to } = artTint({ h: 40, s: 0.05, l: 0.5 });
  assert.equal(from, FALLBACK_FROM);
  assert.equal(to, FALLBACK_TO);
});

test('artTint() with no usable colour (null input) is the same no-art fallback', () => {
  assert.deepEqual(artTint(null), { from: FALLBACK_FROM, to: FALLBACK_TO });
});

test('spineColor() stays within a legible mid-lightness range and never goes darker than the matching artTint().to', () => {
  for(const hsl of [{ h: 10, s: 0.8, l: 0.1 }, { h: 10, s: 0.8, l: 0.95 }]){
    const spine = spineColor(hsl);
    const { to } = artTint(hsl);
    assert.ok(relLuminance(spine) >= relLuminance(to) - 1e-6, `spine (${spine}) is darker than to (${to})`);
  }
});

test('spineColor() on a near-grey also falls back to --disc-a', () => {
  assert.equal(spineColor({ h: 10, s: 0.05, l: 0.5 }), FALLBACK_FROM);
  assert.equal(spineColor(null), FALLBACK_FROM);
});
