// docs/15_SURFACE_NOISE.md §5: dead-wax etchings -- pure generation only
// (matrix line/message/glyph-jitter). No DOM mocking needed: this module's
// DOM-writing functions (applyDeadWaxEtching/setDeadWaxMagnified) only ever
// touch #deadWax* via $() at call time, never at module load.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEAD_WAX_MESSAGES, matrixTail, matrixLineFor, messageFor, etchingFor, glyphJitter,
} from '../../src/record-art/etchings.js';

test('matrixTail is the same for the same release id, different for a different one', () => {
  assert.equal(matrixTail('album-1'), matrixTail('album-1'));
  assert.notEqual(matrixTail('album-1'), matrixTail('album-2'));
  assert.equal(matrixTail('album-1').length, 5);
});

test('matrixLineFor shares the same tail across sides, differing only in the side letter', () => {
  const a = matrixLineFor('album-1', 'A');
  const b = matrixLineFor('album-1', 'B');
  assert.equal(a, 'MZK-' + matrixTail('album-1') + '-A1');
  assert.equal(b, 'MZK-' + matrixTail('album-1') + '-B1');
  assert.notEqual(a, b);
});

test('matrixLineFor falls back to side A when sides are off ("")', () => {
  assert.equal(matrixLineFor('album-1', ''), 'MZK-' + matrixTail('album-1') + '-A1');
});

test('messageFor picks one of the known messages, deterministically per release+side', () => {
  const m = messageFor('album-1', 'A');
  assert.ok(DEAD_WAX_MESSAGES.includes(m));
  assert.equal(messageFor('album-1', 'A'), m);
});

test('messageFor can differ by side, since each side is its own etching', () => {
  // not guaranteed for every id (a hash collision is possible), but true for
  // a handful of distinct ids -- confirms side is actually part of the seed
  let differedAtLeastOnce = false;
  for(const id of ['r1', 'r2', 'r3', 'r4', 'r5', 'r6']){
    if(messageFor(id, 'A') !== messageFor(id, 'B')) differedAtLeastOnce = true;
  }
  assert.ok(differedAtLeastOnce);
});

test('etchingFor bundles the matrix line and the message for one side', () => {
  const e = etchingFor('album-1', 'A');
  assert.equal(e.matrix, matrixLineFor('album-1', 'A'));
  assert.equal(e.message, messageFor('album-1', 'A'));
});

test('glyphJitter is deterministic per seed+index, and small enough to read as hand-scratched, not scrambled', () => {
  const a = glyphJitter(42, 3);
  const b = glyphJitter(42, 3);
  const c = glyphJitter(42, 4);
  assert.deepEqual(a, b);
  assert.notDeepEqual(a, c);
  assert.ok(Math.abs(a.dy) <= 0.8);
  assert.ok(Math.abs(a.rotate) <= 4.5);
});

test('glyphJitter differs by seed too, so two different releases never jitter identically', () => {
  assert.notDeepEqual(glyphJitter(1, 0), glyphJitter(2, 0));
});
