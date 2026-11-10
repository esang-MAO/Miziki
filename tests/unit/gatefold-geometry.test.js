import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gatefoldGeometry, gatefoldRowLayout } from '../../src/gatefold/geometry.js';

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

// UN7 (docs/36_UNIFORMITY.md point 1): panelSize = min(350, viewport.width
// - 2*16 - 24) -- the strip (24px) and the panel's own 16px side margins
// have to fit inside the real viewport, not just the panel.
test('gatefoldGeometry: a 390px phone gets 334, not the flat 350 that used to run off the edge', () => {
  const geom = gatefoldGeometry({ size: '12"', speed: 33.333 }, 390);
  assert.equal(geom.panelSize, 334);
  assert.equal(geom.panDistance, 167);
});

test('gatefoldGeometry: a wide viewport is capped at 350, never grows past it', () => {
  const geom = gatefoldGeometry({ size: '12"', speed: 33.333 }, 1200);
  assert.equal(geom.panelSize, 350);
  assert.equal(geom.panDistance, 175);
});

test('gatefoldGeometry: format has no effect on the viewport-driven size either', () => {
  assert.deepEqual(gatefoldGeometry({ size: '7"', speed: 45 }, 390), gatefoldGeometry({ size: '12"', speed: 33.333 }, 390));
});

test('gatefoldGeometry: omitting viewport keeps the old flat-350 fallback (module-load call before any real viewport is known)', () => {
  assert.equal(gatefoldGeometry().panelSize, 350);
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

// Box-set follow-up (docs/34_CARE_AND_CONTROL.md point 5 follow-up, Ken
// 2026-11-09, design-mockup revision): rows of up to 3 across, front row
// first, any remainder absorbed by the front row(s).
test('gatefoldRowLayout: empty/zero discs', () => {
  assert.deepEqual(gatefoldRowLayout(0), []);
  assert.deepEqual(gatefoldRowLayout(-1), []);
});

test('gatefoldRowLayout: a single disc sits alone in the front row, centered', () => {
  assert.deepEqual(gatefoldRowLayout(1), [{ row: 0, x: 0 }]);
});

test('gatefoldRowLayout: two discs sit side by side in the front row -- today\'s plain two-disc layout', () => {
  assert.deepEqual(gatefoldRowLayout(2), [
    { row: 0, x: -0.5 }, { row: 0, x: 0.5 },
  ]);
});

test('gatefoldRowLayout: three discs -- one row of 3 across', () => {
  assert.deepEqual(gatefoldRowLayout(3), [
    { row: 0, x: -1 }, { row: 0, x: 0 }, { row: 0, x: 1 },
  ]);
});

test('gatefoldRowLayout: four discs -- two rows of 2', () => {
  assert.deepEqual(gatefoldRowLayout(4), [
    { row: 0, x: -0.5 }, { row: 0, x: 0.5 },
    { row: 1, x: -0.5 }, { row: 1, x: 0.5 },
  ]);
});

test('gatefoldRowLayout: five discs -- front row of 3, back row of 2', () => {
  assert.deepEqual(gatefoldRowLayout(5), [
    { row: 0, x: -1 }, { row: 0, x: 0 }, { row: 0, x: 1 },
    { row: 1, x: -0.5 }, { row: 1, x: 0.5 },
  ]);
});

test('gatefoldRowLayout: six discs -- two rows of 3', () => {
  assert.deepEqual(gatefoldRowLayout(6), [
    { row: 0, x: -1 }, { row: 0, x: 0 }, { row: 0, x: 1 },
    { row: 1, x: -1 }, { row: 1, x: 0 }, { row: 1, x: 1 },
  ]);
});
