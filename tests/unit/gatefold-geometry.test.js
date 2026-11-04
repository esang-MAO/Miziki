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

// GF3 point 1's exact panel sizes, with pan/pocket/disc scaled
// proportionally off the same 12" ratios.
test('gatefoldGeometry: 10" scales proportionally off the 350px panel\'s own ratios', () => {
  assert.deepEqual(gatefoldGeometry({ size: '10"', speed: 45 }), {
    referenceWidth: 390, referenceHeight: 740,
    panelSize: 292, panDistance: 146,
    pocketSize: 110, discDiameter: 130,
  });
});

test('gatefoldGeometry: 7" scales proportionally off the 350px panel\'s own ratios', () => {
  assert.deepEqual(gatefoldGeometry({ size: '7"', speed: 45 }), {
    referenceWidth: 390, referenceHeight: 740,
    panelSize: 204, panDistance: 102,
    pocketSize: 77, discDiameter: 91,
  });
});

test('gatefoldGeometry: no format given falls back to the 12" numbers', () => {
  assert.deepEqual(gatefoldGeometry(), gatefoldGeometry({ size: '12"', speed: 33.333 }));
});
