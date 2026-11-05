// docs/15_SURFACE_NOISE.md §5: dead-wax etchings -- pure generation only
// (matrix line/message/glyph-jitter). No DOM mocking needed: this module's
// DOM-writing functions (applyDeadWaxEtching/setDeadWaxMagnified) only ever
// touch #deadWax* via $() at call time, never at module load.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEAD_WAX_MESSAGES, matrixTail, matrixLineFor, messageFor, etchingFor, glyphJitter,
  deadWaxEtchRadius, deadWaxArcPath, etchThirdLine,
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

// AU10 (docs/16_AUDIO.md §5): "the groove band ends at a radius set by how
// full the side is -- short sides leave a wide band of smooth dead wax."
test('deadWaxEtchRadius: a full side (1) reads a narrower radius than an empty one (0)', () => {
  const full = deadWaxEtchRadius(1);
  const empty = deadWaxEtchRadius(0);
  assert.ok(full < empty);
});

test('deadWaxEtchRadius: omitted fullness reads as fully used (the fixed pre-AU10 radius)', () => {
  assert.equal(deadWaxEtchRadius(undefined), deadWaxEtchRadius(1));
});

test('deadWaxEtchRadius: clamps to 0..1', () => {
  assert.equal(deadWaxEtchRadius(-5), deadWaxEtchRadius(0));
  assert.equal(deadWaxEtchRadius(5), deadWaxEtchRadius(1));
});

test('deadWaxArcPath: an SVG arc centered on the 200×200 viewBox, radius reflected in the path', () => {
  const p = deadWaxArcPath(50);
  assert.match(p, /^M 50 100 A 50 50 0 1 1 150 100$/);
});

// GS5 (docs/30_GROOVES_AND_SHELF.md): etchThirdLine -- format alone before
// a pressing's found, format + phase/date once one has.
test('etchThirdLine: format alone with no collection entry', () => {
  const m = { codec: 'FLAC', rate: 96000, bits: 24 };
  assert.equal(etchThirdLine(m, undefined), 'FLAC 24/96');
});

test('etchThirdLine: adds "PRESSED AT [phase] · [date]" once a pressing is found', () => {
  const m = { codec: 'FLAC', rate: 96000, bits: 24 };
  const entry = { discoveredAt: new Date(2026, 10, 14).getTime(), phase: 'twilight' };
  assert.equal(etchThirdLine(m, entry), 'FLAC 24/96 · PRESSED AT DUSK · 14 NOV');
});

test('etchThirdLine: an older entry without a stamped phase shows the date alone', () => {
  const m = { codec: 'MP3' };
  const entry = { discoveredAt: new Date(2026, 0, 3).getTime() };
  assert.equal(etchThirdLine(m, entry), 'MP3 · PRESSED 3 JAN');
});

test('etchThirdLine: no entry, no meta -- empty', () => {
  assert.equal(etchThirdLine(null, undefined), '');
});
