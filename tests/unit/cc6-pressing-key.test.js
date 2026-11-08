// CC6 (docs/34_CARE_AND_CONTROL.md): the file-drawn pressing's own hash
// key moves from the album title alone to artist+album (pressingKey()),
// and the hi-res tier-3 mix/band odds are rebalanced. These tests cover
// the four properties the plan's own point 6 calls out, plus the new
// pressingKey()/selectVariantForAlbum() shapes directly.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  pressingKey, selectVariant, selectVariantForAlbum, selectRareVariant, selectZoetropeVariant,
  SOLID_IDS, VARIANT_DEFS, albumKey,
} from '../../src/record-art/tiers.js';

function track(artist, album, overrides){
  return { tags: { artist, album, title: 'Side One', ...overrides }, meta: { lossless: true, bits: 24, rate: 96000 } };
}

test('CC6: pressingKey is artist+album, album artist wins over track artist', () => {
  const t1 = track('Track Artist', 'Shared Title', { albumArtist: 'Album Artist' });
  const t2 = track('Track Artist', 'Shared Title', { albumArtist: 'Different Album Artist' });
  assert.notEqual(pressingKey(t1), pressingKey(t2));
  assert.equal(pressingKey(t1), 'album artist' + '|' + albumKey(t1));
});

test('CC6: pressingKey falls back to the track artist when there is no album artist', () => {
  const t = track('Solo Artist', 'No Album Artist Here', {});
  assert.equal(pressingKey(t), 'solo artist' + '|' + albumKey(t));
});

test('CC6 point 6: two same-titled albums by different artists draw independently', () => {
  const first = selectVariant(track('Artist Alpha', 'Collision Title'));
  let differed = false;
  for(const artist of ['Artist Bravo', 'Artist Charlie', 'Artist Delta', 'Artist Echo', 'Artist Foxtrot']){
    const other = selectVariant(track(artist, 'Collision Title'));
    if(other.tier !== first.tier || other.variant !== first.variant){ differed = true; break; }
  }
  assert.ok(differed, 'at least one candidate artist draws a different pressing for the same title');
});

test('CC6 point 6: a local copy and a friend\'s copy of the same album draw the same pressing', () => {
  const t = track('Shared Artist', 'Shared Album');
  const mine = selectVariant(t);
  const theirs = selectVariantForAlbum('Shared Artist', 'Shared Album', 3);
  assert.deepEqual(mine, theirs);
});

test('CC6 point 6: rare and zoetrope draws are unchanged by the artist -- still title-only', () => {
  const t1 = track('Artist One', 'Rare Album Title');
  const t2 = track('Artist Two', 'Rare Album Title');
  assert.equal(selectRareVariant(t1), selectRareVariant(t2));
  assert.equal(selectZoetropeVariant(t1), selectZoetropeVariant(t2));
});

test('CC6 point 6: over 100,000 synthetic hi-res keys, the tier-3 mix lands within +/-1 point of 5/40/55', () => {
  const N = 100000;
  let jet = 0, solid = 0, effect = 0;
  for(let i = 0; i < N; i++){
    const { variant } = selectVariantForAlbum('Artist ' + i, 'Album ' + i, 3);
    if(variant === 'jet') jet++;
    else if(SOLID_IDS.includes(variant)) solid++;
    else effect++;
  }
  const tol = 0.01;
  assert.ok(Math.abs(jet / N - 0.05) <= tol, `jet ${(jet / N * 100).toFixed(2)}%`);
  assert.ok(Math.abs(solid / N - 0.40) <= tol, `solid ${(solid / N * 100).toFixed(2)}%`);
  assert.ok(Math.abs(effect / N - 0.55) <= tol, `effect ${(effect / N * 100).toFixed(2)}%`);
});

test('CC6 point 6: over 100,000 synthetic hi-res keys, non-Jet bands land within +/-1 point of 50/35/15', () => {
  const N = 100000;
  const counts = { common: 0, uncommon: 0, scarce: 0 };
  let total = 0;
  for(let i = 0; i < N; i++){
    const { variant } = selectVariantForAlbum('Band Artist ' + i, 'Band Album ' + i, 3);
    if(variant === 'jet') continue;
    counts[VARIANT_DEFS[variant].band]++;
    total++;
  }
  const tol = 0.01;
  assert.ok(Math.abs(counts.common / total - 0.50) <= tol, `common ${(counts.common / total * 100).toFixed(2)}%`);
  assert.ok(Math.abs(counts.uncommon / total - 0.35) <= tol, `uncommon ${(counts.uncommon / total * 100).toFixed(2)}%`);
  assert.ok(Math.abs(counts.scarce / total - 0.15) <= tol, `scarce ${(counts.scarce / total * 100).toFixed(2)}%`);
});
