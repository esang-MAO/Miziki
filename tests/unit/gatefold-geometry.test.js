import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gatefoldGeometry } from '../../src/gatefold/geometry.js';

// GF2/GF3 (docs/29_GATEFOLD.md point 1/2): the 12" case must reproduce the
// numbers every pre-GF3 gatefold literal already assumed (panel 350,
// pan 175 [half the panel], disc 156, pocket cutout 132).
test('gatefoldGeometry: 12" matches the numbers every panel/pan/disc literal already assumed', () => {
  assert.deepEqual(gatefoldGeometry({ size: '12"', speed: 33.333 }), {
    referenceWidth: 390, referenceHeight: 740,
    panelSize: 350, panDistance: 175,
    pocketSize: 132, discDiameter: 156,
  });
});

// Ken, 2026-11-05 (GF13 fix 3): the gatefold's own display stays one
// uniform size for every record regardless of format -- GF3's per-format
// scaling (10"/7" smaller than 12") is gone; every format now resolves to
// the same 12" numbers.
test('gatefoldGeometry: 10" is uniform with the 12" numbers, not scaled down', () => {
  assert.deepEqual(gatefoldGeometry({ size: '10"', speed: 45 }), gatefoldGeometry({ size: '12"', speed: 33.333 }));
});

test('gatefoldGeometry: 7" is uniform with the 12" numbers, not scaled down', () => {
  assert.deepEqual(gatefoldGeometry({ size: '7"', speed: 45 }), gatefoldGeometry({ size: '12"', speed: 33.333 }));
});

test('gatefoldGeometry: no format given falls back to the same uniform numbers', () => {
  assert.deepEqual(gatefoldGeometry(), gatefoldGeometry({ size: '12"', speed: 33.333 }));
});

// CC5 (docs/34_CARE_AND_CONTROL.md point 5/6): "two pockets are both
// inside the sleeve's bounds (no scroll) at the 390px reference width" --
// the sleeve itself is the 390px reference viewport minus its own 20px
// left/right inset (miziki.html's .gf-sleeve), i.e. exactly panelSize
// (350). Two discs at the full discDiameter plus CLAUDE.md's --sp-4
// (16px) gap between them must fit inside that without any room to
// spare for a scrollbar to kick in.
test('CC5: two discs at full size plus the --sp-4 gap fit inside the sleeve, no scroll needed', () => {
  const geom = gatefoldGeometry();
  const SLEEVE_INSET_PX = 20;
  const SP_4_PX = 16;
  const sleeveWidth = geom.referenceWidth - 2 * SLEEVE_INSET_PX;
  assert.equal(sleeveWidth, geom.panelSize);
  const twoDiscWidth = 2 * geom.discDiameter + SP_4_PX;
  assert.ok(twoDiscWidth <= sleeveWidth, 'two discs + gap (' + twoDiscWidth + 'px) overflow the sleeve (' + sleeveWidth + 'px)');
});
