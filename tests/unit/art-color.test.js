// UN6 (docs/36_UNIFORMITY.md): artTint()/spineColor() are pure {h,s,l}-in,
// hex-out colour math — no DOM/canvas needed (shareDominantColor() is the
// one function here that touches canvas, and it moved unchanged from
// src/share/styles.js, already exercised wherever that file's own share
// tests cover resolveShareStyle()'s 'cover' branch).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { artTint, spineColor, artAnchor } from '../../src/ui/art-color.js';

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

// CO4 (docs/37_COLOUR.md, recommendation 4): artAnchor() is a hand-picked
// table (Ken declined the Wada-derived partner-count approach -- see
// art-color.js's own header comment), not anything read from the
// catalogue's combination data, so these pin the table's own behaviour
// rather than any specific worked example from the plan.
test('artAnchor(): a warm orange cover anchors to a genuinely different-hue near-neutral dark', () => {
  const anchor = artAnchor({ h: 28, s: 0.9, l: 0.55 });
  assert.ok(anchor, 'expected a non-null anchor for a saturated orange cover');
  assert.equal(anchor.hex, '#1b3644');
  assert.equal(anchor.name, 'Slate Color');
});

test('artAnchor(): a cool navy cover anchors to a warm near-neutral dark', () => {
  const anchor = artAnchor({ h: 222, s: 0.65, l: 0.3 });
  assert.ok(anchor);
  assert.equal(anchor.name, 'Vandyke Brown');
});

test('artAnchor(): a yellow-green/olive cover has no good complement in the hand-picked table -- null', () => {
  for(const h of [100, 110, 120, 130, 140]){
    assert.equal(artAnchor({ h, s: 0.6, l: 0.5 }), null, `expected null at hue ${h}`);
  }
});

test('artAnchor(): a near-grey (low saturation) or no input returns null, same floor as artTint()', () => {
  assert.equal(artAnchor({ h: 40, s: 0.05, l: 0.5 }), null);
  assert.equal(artAnchor(null), null);
});

test('artAnchor(): never returns a candidate within the same hue family as the cover itself', () => {
  // recommendation 6: "the dark partner is a different hue, not the key
  // colour darkened" -- sweep the whole hue wheel and check the anchor
  // (when one is returned) is never suspiciously close to the input.
  for(let h = 0; h < 360; h += 5){
    const anchor = artAnchor({ h, s: 0.6, l: 0.5 });
    if(!anchor) continue;
    const anchorHue = anchor.name === 'Slate Color' ? 200
      : anchor.name === 'Vandyke Brown' ? 37
      : anchor.name === 'Deep Slate Olive' ? 108
      : 162; // Deep Slate Green
    const d = Math.abs(anchorHue - h) % 360;
    const dist = d > 180 ? 360 - d : d;
    assert.ok(dist >= 40, `anchor ${anchor.name} (hue ${anchorHue}) too close to cover hue ${h}: ${dist}`);
  }
});

test('artTint(): uses the anchor as `from` when one clears the contrast floors, with a darker `to` of the same colour', () => {
  const { from, to } = artTint({ h: 28, s: 0.9, l: 0.55 });
  const anchor = artAnchor({ h: 28, s: 0.9, l: 0.55 });
  assert.equal(from, anchor.hex);
  assert.notEqual(to, from);
  assert.ok(relLuminance(to) <= relLuminance(from), '`to` is never lighter than the anchor `from`');
  assert.ok(contrastRatio(ON_DARK, from) >= 7);
});

test('artTint(): with no usable anchor (olive/yellow-green cover), falls through to the same-hue result unchanged', () => {
  const hsl = { h: 115, s: 0.6, l: 0.5 };
  assert.equal(artAnchor(hsl), null, 'precondition: this hue has no anchor');
  const { from, to } = artTint(hsl);
  assert.ok(contrastRatio(ON_DARK, from) >= 7);
  assert.notEqual(to, from);
});
