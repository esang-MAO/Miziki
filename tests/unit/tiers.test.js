import { test } from 'node:test';
import assert from 'node:assert/strict';
import { trackTier } from '../../src/record-art/tiers.js';

function track(meta){ return { meta, tags: {} }; }

test('trackTier: lossy is tier 1', () => {
  assert.equal(trackTier(track({ lossless: false, bits: 16, rate: 44100 })), 1);
});

test('trackTier: lossless 16-bit/44.1kHz is tier 2', () => {
  assert.equal(trackTier(track({ lossless: true, bits: 16, rate: 44100 })), 2);
});

test('trackTier: lossless 24-bit is tier 3', () => {
  assert.equal(trackTier(track({ lossless: true, bits: 24, rate: 44100 })), 3);
});

test('trackTier: lossless 96kHz is tier 3', () => {
  assert.equal(trackTier(track({ lossless: true, bits: 16, rate: 96000 })), 3);
});

test('trackTier: missing metadata never reaches tier 3', () => {
  assert.equal(trackTier(track({ lossless: true })), 2);
  assert.equal(trackTier(track({})), 1);
  assert.equal(trackTier(track(undefined)), 1);
});
