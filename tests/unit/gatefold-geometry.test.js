import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gatefoldGeometry } from '../../src/gatefold/geometry.js';

// GF2 (docs/29_GATEFOLD.md point 2/3): this PR returns today's 12" numbers
// for every format/viewport unchanged -- GF3 is the step that makes these
// vary by format.
test('gatefoldGeometry: the 12" case reproduces today\'s numbers exactly', () => {
  const g = gatefoldGeometry({ size: '12"', speed: 33.333 }, { width: 390, height: 740 });
  assert.deepEqual(g, {
    referenceWidth: 390, referenceHeight: 740,
    panelSize: 350, panDistance: 175,
    pocketSize: 156, discDiameter: 156,
  });
});

test('gatefoldGeometry: no format/viewport given still returns the same numbers', () => {
  assert.deepEqual(gatefoldGeometry(), gatefoldGeometry({ size: '7"', speed: 45 }, { width: 800, height: 600 }));
});
