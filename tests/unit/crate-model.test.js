import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

// crate/constants.js's CRATE_DPR reads window.devicePixelRatio at module
// load (step 2c) -- stubbed here the same way shell.test.js stubs
// window.matchMedia for util/motion.js, since there's no browser `window`
// in Node and crate/model.js imports CRATE_ALPHABET from that same file.
globalThis.window = { devicePixelRatio: 1 };

// crate/model.js's own queueSave import (for persistCrateAnchor's debounced
// save) is mocked to a no-op, the same "stop the chain at the door"
// reasoning as every other mock-heavy file in this suite, since the real
// storage/meta.js real-chains into audio/mode.js/engine.js/sundown/
// location.js/player/controls.js/player/background.js for applyPrefs().
mock.module(new URL('../../src/storage/meta.js', import.meta.url).href, {
  namedExports: { queueSave(){} },
});

const {
  ensureCrateModel, invalidateCrateModel, isNowPlayingAlbum,
  persistCrateAnchor, crateRailJumpTarget, libraryHasGenres,
} = await import('../../src/crate/model.js');
const { S } = await import('../../src/state.js');

function fakeTrack(id, overrides){
  return Object.assign({
    id, addedAt: 0, index: 0,
    tags: { title: id, artist: 'Artist', album: 'Album', albumArtist: 'Artist', track: 1, disc: 1 },
    details: { genre: '', year: 0 },
  }, overrides);
}

function resetState(overrides){
  Object.assign(S, {
    tracks: [], index: -1,
    crate: {pos: null, model: null, modelGroup: null, modelDirty: true, coldStartDone: false},
    crateGroup: 'az', crateAnchor: null,
  }, overrides);
}

test('libraryHasGenres: false for an empty library or one with no genre tags, true once any track has one', () => {
  resetState({ tracks: [fakeTrack('t1')] });
  assert.equal(libraryHasGenres(), false);
  resetState({ tracks: [fakeTrack('t1', { details: { genre: 'Rock', year: 0 } })] });
  assert.equal(libraryHasGenres(), true);
});

test('ensureCrateModel: one record per album, alphabetically by artist, each untagged track goes in a "loose" record', () => {
  resetState({
    tracks: [
      fakeTrack('b1', { tags: { title:'B1', artist:'Bravo', album:'Album B', albumArtist:'Bravo', track:1, disc:1 } }),
      fakeTrack('a1', { tags: { title:'A1', artist:'Alpha', album:'Album A', albumArtist:'Alpha', track:1, disc:1 } }),
      fakeTrack('u1', { tags: { title:'U1', artist:'Zed', album:'Unknown Album', albumArtist:'Zed', track:1, disc:1 } }),
    ],
  });
  const model = ensureCrateModel();
  const records = model.items.filter(it => it.type === 'rec');
  assert.equal(records.length, 3);
  // Alpha before Bravo before the loose "Zed" pseudo-record's own letter
  // group -- all three are single-letter groups here (no dividers, since
  // there are far fewer than 20 albums), so plain artist order holds
  assert.deepEqual(records.map(r => r.artist), ['Alpha', 'Bravo', 'Zed']);
  assert.equal(records[2].kind, 'loose');
});

test('ensureCrateModel: rebuilds only when the group changes or invalidateCrateModel() was called, and re-resolves S.crate.pos from the anchor afterward', () => {
  resetState({ tracks: [fakeTrack('a1')] });
  const first = ensureCrateModel();
  S.crate.pos = 5;   // pretend the user scrolled
  const second = ensureCrateModel();
  assert.equal(second, first, 'same model instance, no dirty flag and same group -- no rebuild');
  assert.equal(S.crate.pos, 5, 'pos is untouched when nothing rebuilds');
  invalidateCrateModel();
  ensureCrateModel();
  assert.equal(S.crate.pos, null, 'a real rebuild resets pos for the caller to re-resolve from the anchor');
});

test('isNowPlayingAlbum: true only for the record containing S.index, never for a divider', () => {
  resetState({ tracks: [fakeTrack('a1'), fakeTrack('a2')], index: 1 });
  const rec = { type: 'rec', idx: [0, 1] };
  const div = { type: 'div', idx: [0, 1] };
  assert.equal(isNowPlayingAlbum(rec), true);
  assert.equal(isNowPlayingAlbum(div), false);
  S.index = -1;
  assert.equal(isNowPlayingAlbum(rec), false);
});

test('crateRailJumpTarget: lands on the first record after a divider, falling back to the divider itself if none follows', () => {
  const model = {
    items: [
      { type: 'div', label: 'A' },
      { type: 'rec', album: 'First A album' },
      { type: 'div', label: 'B' },   // nothing after this one
    ],
    jumpIndex: new Map([['key:A', 0], ['key:B', 2]]),
  };
  assert.equal(crateRailJumpTarget(model, 'A'), 1);
  assert.equal(crateRailJumpTarget(model, 'B'), 2);
  assert.equal(crateRailJumpTarget(model, 'Z'), null);
});

test('persistCrateAnchor: records the album id (or clears it for null) and debounces a save', async () => {
  resetState({});
  persistCrateAnchor({ albumId: 'album:alpha' });
  assert.equal(S.crateAnchor, 'album:alpha');
  persistCrateAnchor(null);
  assert.equal(S.crateAnchor, null);
});
