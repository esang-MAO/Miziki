// LB4 (docs/36A_LIBRARY_AND_LAUNCH.md, decision 4): the playlist row drag
// reorder's pure logic -- see src/library/drag-reorder.js's own file-top
// comment for why only these two functions are pulled out pure.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dragTargetIndex, reorderPresentIds } from '../../src/library/drag-reorder.js';

test('dragTargetIndex: pointer over the first row\'s own slot', () => {
  assert.equal(dragTargetIndex(100, 56, 5, 100), 0);
  assert.equal(dragTargetIndex(100, 56, 5, 120), 0); // still nearer slot 0 than 1
});

test('dragTargetIndex: pointer over a middle slot', () => {
  // slot 2 spans [100+2*56-28, 100+2*56+28) around its own centre
  assert.equal(dragTargetIndex(100, 56, 5, 100 + 2 * 56), 2);
});

test('dragTargetIndex: pointer over the last row\'s own slot', () => {
  assert.equal(dragTargetIndex(100, 56, 5, 100 + 4 * 56), 4);
});

test('dragTargetIndex: clamps above the top of the list', () => {
  assert.equal(dragTargetIndex(100, 56, 5, -500), 0);
});

test('dragTargetIndex: clamps below the bottom of the list', () => {
  assert.equal(dragTargetIndex(100, 56, 5, 5000), 4);
});

test('dragTargetIndex: a single-row list always stays at 0', () => {
  assert.equal(dragTargetIndex(100, 56, 1, 5000), 0);
});

test('dragTargetIndex: a zero-height row never divides by zero', () => {
  assert.equal(dragTargetIndex(100, 0, 5, 250), 0);
});

test('reorderPresentIds: plain reorder with nothing forgotten', () => {
  assert.deepEqual(reorderPresentIds(['a', 'b', 'c'], ['c', 'a', 'b']), ['c', 'a', 'b']);
});

test('reorderPresentIds: a forgotten id elsewhere in the list keeps its own slot', () => {
  // 'x' (forgotten -- not in finalPresentIds, since the playlist detail
  // page never renders a row, and so never a drag, for it) stays put at
  // index 1 while the present ids around it (a, b, c) take the new order
  // the drag produced.
  assert.deepEqual(
    reorderPresentIds(['a', 'x', 'b', 'c'], ['c', 'b', 'a']),
    ['c', 'x', 'b', 'a'],
  );
});

test('reorderPresentIds: no-op when the order is unchanged', () => {
  assert.deepEqual(reorderPresentIds(['a', 'b', 'c'], ['a', 'b', 'c']), ['a', 'b', 'c']);
});

test('reorderPresentIds: a playlist with only forgotten ids is untouched', () => {
  assert.deepEqual(reorderPresentIds(['x', 'y'], []), ['x', 'y']);
});
