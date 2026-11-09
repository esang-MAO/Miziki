import { test } from 'node:test';
import assert from 'node:assert/strict';
import { S } from '../../src/state.js';
import { hasDeluxe, applyDeluxeUrlSwitch } from '../../src/deluxe.js';

test('hasDeluxe() reflects S.deluxe', () => {
  S.deluxe = false;
  assert.equal(hasDeluxe(), false);
  S.deluxe = true;
  assert.equal(hasDeluxe(), true);
  S.deluxe = false;
});

test('applyDeluxeUrlSwitch: ?deluxe=1 turns it on, in dev', () => {
  S.deluxe = false;
  const changed = applyDeluxeUrlSwitch('?deluxe=1', true);
  assert.equal(S.deluxe, true);
  assert.equal(changed, true);
});

test('applyDeluxeUrlSwitch: ?deluxe=0 turns it off, in dev', () => {
  S.deluxe = true;
  const changed = applyDeluxeUrlSwitch('?deluxe=0', true);
  assert.equal(S.deluxe, false);
  assert.equal(changed, true);
});

test('applyDeluxeUrlSwitch: no deluxe param leaves S.deluxe untouched, in dev', () => {
  S.deluxe = true;
  const changed = applyDeluxeUrlSwitch('?social=demo', true);
  assert.equal(S.deluxe, true);
  assert.equal(changed, false);
  S.deluxe = false;
});

// LI1 (docs/35_LEAD_IN.md): outside dev (the production and Netlify
// preview builds), ?deluxe=1 on a live URL must not be able to grant
// Deluxe -- this is the bug the gate exists to close.
test('applyDeluxeUrlSwitch: no-op outside dev, even with ?deluxe=1', () => {
  S.deluxe = false;
  const changed = applyDeluxeUrlSwitch('?deluxe=1', false);
  assert.equal(S.deluxe, false);
  assert.equal(changed, false);
});

test('applyDeluxeUrlSwitch: no-op outside dev, even with ?deluxe=0', () => {
  S.deluxe = true;
  const changed = applyDeluxeUrlSwitch('?deluxe=0', false);
  assert.equal(S.deluxe, true);
  assert.equal(changed, false);
  S.deluxe = false;
});
