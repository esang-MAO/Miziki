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

test('applyDeluxeUrlSwitch: ?deluxe=1 turns it on', () => {
  S.deluxe = false;
  const changed = applyDeluxeUrlSwitch('?deluxe=1');
  assert.equal(S.deluxe, true);
  assert.equal(changed, true);
});

test('applyDeluxeUrlSwitch: ?deluxe=0 turns it off', () => {
  S.deluxe = true;
  const changed = applyDeluxeUrlSwitch('?deluxe=0');
  assert.equal(S.deluxe, false);
  assert.equal(changed, true);
});

test('applyDeluxeUrlSwitch: no deluxe param leaves S.deluxe untouched', () => {
  S.deluxe = true;
  const changed = applyDeluxeUrlSwitch('?social=demo');
  assert.equal(S.deluxe, true);
  assert.equal(changed, false);
  S.deluxe = false;
});
