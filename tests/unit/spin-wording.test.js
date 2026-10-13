import { test } from 'node:test';
import assert from 'node:assert/strict';

// src/sundown/spin-wording.js has no imports at all (pure) -- no mocking
// needed to load it directly, same as sundown/rhythm.js or crate/geometry.js.
const { SPIN_PHASE_WORDING, spinPhaseWording, spinChipText } = await import('../../src/sundown/spin-wording.js');

const PHASES = ['night', 'dawn', 'morning', 'midday', 'afternoon', 'golden', 'twilight'];

test('SPIN_PHASE_WORDING: every one of the seven day-arc phases has the doc\'s own exact wording', () => {
  assert.deepEqual(SPIN_PHASE_WORDING, {
    night: 'late at night',
    dawn: 'at dawn',
    morning: 'this morning',
    midday: 'at midday',
    afternoon: 'this afternoon',
    golden: 'at golden hour',
    twilight: 'at dusk',
  });
  assert.deepEqual(Object.keys(SPIN_PHASE_WORDING).sort(), [...PHASES].sort());
});

test('spinPhaseWording: resolves each phase to its wording', () => {
  for(const phase of PHASES){
    assert.equal(spinPhaseWording(phase), SPIN_PHASE_WORDING[phase]);
  }
});

test('spinPhaseWording: an unknown, missing, or null phase resolves to null, never "undefined"', () => {
  assert.equal(spinPhaseWording('not-a-real-phase'), null);
  assert.equal(spinPhaseWording(null), null);
  assert.equal(spinPhaseWording(undefined), null);
  assert.equal(spinPhaseWording(''), null);
});

test('spinChipText: builds "SPUN <WORDING>" for each phase, matching the doc\'s own example exactly', () => {
  assert.equal(spinChipText('twilight', true), 'SPUN AT DUSK');
  for(const phase of PHASES){
    assert.equal(spinChipText(phase, true), ('SPUN ' + SPIN_PHASE_WORDING[phase]).toUpperCase());
  }
});

test('spinChipText: the Include switch off always suppresses the chip, even for a known phase', () => {
  for(const phase of PHASES){
    assert.equal(spinChipText(phase, false), null);
  }
});

test('spinChipText: include defaulting true (undefined) still renders, the same as explicit true', () => {
  assert.equal(spinChipText('night', undefined), spinChipText('night', true));
});

test('spinChipText: an unknown phase never renders, include on or off', () => {
  assert.equal(spinChipText('not-a-real-phase', true), null);
  assert.equal(spinChipText(null, true), null);
  assert.equal(spinChipText('not-a-real-phase', false), null);
});
