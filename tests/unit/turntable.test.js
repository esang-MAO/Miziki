import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TURNTABLE_LINEUP, TURNTABLE_IDS, turntableInfo, turntableModelLabel, turntablesHad, displayTurntable } from '../../src/profile/turntable.js';

test('TURNTABLE_LINEUP lists all eleven models, Standard first', () => {
  assert.equal(TURNTABLE_IDS.length, 11);
  assert.equal(TURNTABLE_IDS[0], 'standard');
  assert.deepEqual(TURNTABLE_IDS, TURNTABLE_LINEUP.map(m => m.id));
});

test('turntableInfo falls back to standard for an unknown id', () => {
  assert.equal(turntableInfo('jukebox').id, 'standard');
});

test('turntableModelLabel reads the label off the lineup', () => {
  assert.equal(turntableModelLabel('console'), 'Console');
  assert.equal(turntableModelLabel('jukebox'), 'Standard');
});

test('turntablesHad: Standard is always had, nothing else without a found entry or Deluxe', () => {
  const had = turntablesHad({ standard: { foundAt: 1, phase: 'night' } }, false);
  assert.ok(had.has('standard'));
  assert.equal(had.size, 1);
});

// ST4 point 3: Console/Linear count as had purely from Deluxe, with no
// found-list entry required.
test('turntablesHad: Deluxe adds Console and Linear without a found entry', () => {
  const had = turntablesHad({ standard: { foundAt: 1, phase: 'night' } }, true);
  assert.ok(had.has('console'));
  assert.ok(had.has('linear'));
  assert.ok(!had.has('deck'));
});

test('turntablesHad: a separately-earned model counts as had regardless of Deluxe', () => {
  const had = turntablesHad({ standard: { foundAt: 1, phase: 'night' }, deck: { foundAt: 2, phase: 'dawn' } }, false);
  assert.ok(had.has('deck'));
});

test('displayTurntable: a model you have displays as saved', () => {
  const found = { standard: { foundAt: 1, phase: 'night' }, deck: { foundAt: 2, phase: 'dawn' } };
  assert.equal(displayTurntable('deck', found, false), 'deck');
});

// Same fallback rule as displayShelfFinish (ST3): a stale/unavailable
// saved value falls back to the one model you always have, without
// changing the saved value itself.
test('displayTurntable: a model you no longer have falls back to standard', () => {
  const found = { standard: { foundAt: 1, phase: 'night' } };
  assert.equal(displayTurntable('console', found, false), 'standard');
});

test('displayTurntable: Console/Linear display while Deluxe is on, even unfound', () => {
  const found = { standard: { foundAt: 1, phase: 'night' } };
  assert.equal(displayTurntable('console', found, true), 'console');
});
