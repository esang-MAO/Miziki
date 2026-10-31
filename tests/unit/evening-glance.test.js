import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eveningGlanceLevel, EVENING_GLANCE_FIRST_MS, EVENING_GLANCE_DEEP_MS, FOCUS_GLANCE_FIRST_MS } from '../../src/player/evening-glance.js';

test('never applies in daytime phases or at dawn', () => {
  for(const phase of ['dawn', 'morning', 'midday', 'afternoon', 'golden']){
    assert.equal(eveningGlanceLevel(EVENING_GLANCE_DEEP_MS * 4, phase, true), 0, phase);
  }
});

test('never applies while paused', () => {
  assert.equal(eveningGlanceLevel(EVENING_GLANCE_DEEP_MS * 4, 'night', false), 0);
  assert.equal(eveningGlanceLevel(EVENING_GLANCE_DEEP_MS * 4, 'twilight', false), 0);
});

test('nothing before the first layer is due', () => {
  assert.equal(eveningGlanceLevel(EVENING_GLANCE_FIRST_MS - 1, 'night', true), 0);
  assert.equal(eveningGlanceLevel(0, 'twilight', true), 0);
});

test('twilight only ever reaches the first layer', () => {
  assert.equal(eveningGlanceLevel(EVENING_GLANCE_FIRST_MS, 'twilight', true), 1);
  assert.equal(eveningGlanceLevel(EVENING_GLANCE_DEEP_MS * 4, 'twilight', true), 1);
});

test('night goes first layer, then deep', () => {
  assert.equal(eveningGlanceLevel(EVENING_GLANCE_FIRST_MS, 'night', true), 1);
  assert.equal(eveningGlanceLevel(EVENING_GLANCE_DEEP_MS - 1, 'night', true), 1);
  assert.equal(eveningGlanceLevel(EVENING_GLANCE_DEEP_MS, 'night', true), 2);
});

test('both layers land before a 30 s auto-lock, deep after first', () => {
  assert.ok(EVENING_GLANCE_FIRST_MS < EVENING_GLANCE_DEEP_MS);
  assert.ok(EVENING_GLANCE_DEEP_MS < 30000);
});

// FS10 point 2: Focus fades its first layer after 6s idle "at any hour" --
// a daytime phase that RW5 alone would never fade at all.
test('Focus reaches the first layer at any hour, not just twilight/night', () => {
  for(const phase of ['dawn', 'morning', 'midday', 'afternoon', 'golden']){
    assert.equal(eveningGlanceLevel(FOCUS_GLANCE_FIRST_MS, phase, true, true), 1, phase);
  }
});

test('Focus still waits for its own 6s threshold, even in daytime', () => {
  assert.equal(eveningGlanceLevel(FOCUS_GLANCE_FIRST_MS - 1, 'midday', true, true), 0);
});

test('Focus does not shortcut the deep layer -- that still needs night', () => {
  assert.equal(eveningGlanceLevel(EVENING_GLANCE_DEEP_MS, 'midday', true, true), 1);
  assert.equal(eveningGlanceLevel(EVENING_GLANCE_DEEP_MS, 'night', true, true), 2);
});

test('Focus off keeps RW5\'s own phase gating for the first layer', () => {
  assert.equal(eveningGlanceLevel(FOCUS_GLANCE_FIRST_MS, 'midday', true, false), 0);
  assert.equal(eveningGlanceLevel(EVENING_GLANCE_FIRST_MS, 'twilight', true, false), 1);
});
