import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SHELF_FINISHES, shelfFinishInfo, displayShelfFinish } from '../../src/profile/shelf-finish.js';

test('SHELF_FINISHES lists Walnut and Oak as free, Teak/Ash/Black ash as Deluxe', () => {
  const free = SHELF_FINISHES.filter(f => !f.deluxe).map(f => f.id);
  const deluxe = SHELF_FINISHES.filter(f => f.deluxe).map(f => f.id);
  assert.deepEqual(free, ['walnut', 'oak']);
  assert.deepEqual(deluxe, ['teak', 'ash', 'black']);
});

test('shelfFinishInfo falls back to walnut for an unknown id', () => {
  assert.equal(shelfFinishInfo('mahogany').id, 'walnut');
});

test('displayShelfFinish: a free finish always displays as saved', () => {
  assert.equal(displayShelfFinish('oak', false), 'oak');
  assert.equal(displayShelfFinish('oak', true), 'oak');
});

test('displayShelfFinish: a Deluxe finish with Deluxe on displays as saved', () => {
  assert.equal(displayShelfFinish('teak', true), 'teak');
});

// ST3 point 4: "if Deluxe is later turned off, a saved Deluxe finish falls
// back to Walnut on display (the saved value stays)."
test('displayShelfFinish: a Deluxe finish without Deluxe falls back to walnut', () => {
  assert.equal(displayShelfFinish('teak', false), 'walnut');
  assert.equal(displayShelfFinish('ash', false), 'walnut');
  assert.equal(displayShelfFinish('black', false), 'walnut');
});
