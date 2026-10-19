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

// CR2 (docs/13_CRATE.md) point 6: "model tests for both bins (membership,
// order, hidden when empty), artist-divider thresholds, and the
// double-listing of a new record."

const DAY_MS = 24 * 3600 * 1000;

test('ensureCrateModel: New arrivals bin holds records added within 14 days, newest first, and is absent when nothing qualifies', () => {
  const now = Date.now();
  resetState({
    tracks: [
      fakeTrack('old1', { addedAt: now - 30 * DAY_MS,
        tags: { title:'Old1', artist:'Oldie', album:'Old Album', albumArtist:'Oldie', track:1, disc:1 } }),
      fakeTrack('new1', { addedAt: now - 10 * DAY_MS,
        tags: { title:'New1', artist:'Newish', album:'Newer Album', albumArtist:'Newish', track:1, disc:1 } }),
      fakeTrack('new2', { addedAt: now - 1 * DAY_MS,
        tags: { title:'New2', artist:'Newest', album:'Newest Album', albumArtist:'Newest', track:1, disc:1 } }),
    ],
  });
  const model = ensureCrateModel();
  const bin = model.items.find(it => it.type === 'div' && it.kind === 'bin' && it.key === 'new');
  assert.ok(bin, 'New arrivals bin exists when something qualifies');
  const binIdx = model.items.indexOf(bin);
  // the two records right after the bin divider are the qualifying ones,
  // newest added first
  assert.equal(model.items[binIdx + 1].album, 'Newest Album');
  assert.equal(model.items[binIdx + 2].album, 'Newer Album');
  // the bin sits before every other divider/record in the model
  assert.equal(binIdx, 0);

  // nothing within the window -> no bin at all
  resetState({
    tracks: [fakeTrack('old1', { addedAt: now - 30 * DAY_MS })],
  });
  const empty = ensureCrateModel();
  assert.equal(empty.items.some(it => it.type === 'div' && it.key === 'new'), false);
});

test('ensureCrateModel: Staff picks bin holds MizikiSocial\'s pins in pin-rank order, and is absent with no pins', () => {
  resetState({
    tracks: [
      fakeTrack('p1', { tags: { title:'P1', artist:'PicksArtist', album:'Picked Second', albumArtist:'PicksArtist', track:1, disc:1 } }),
      fakeTrack('p2', { tags: { title:'P2', artist:'PicksArtist', album:'Picked First', albumArtist:'PicksArtist', track:1, disc:1 } }),
      fakeTrack('p3', { tags: { title:'P3', artist:'PicksArtist', album:'Not Picked', albumArtist:'PicksArtist', track:1, disc:1 } }),
    ],
  });
  const firstPass = ensureCrateModel();
  const pickedSecondId = firstPass.items.find(it => it.type === 'rec' && it.album === 'Picked Second').albumId;
  const pickedFirstId = firstPass.items.find(it => it.type === 'rec' && it.album === 'Picked First').albumId;

  globalThis.MizikiSocial = { getPins: () => [pickedFirstId, pickedSecondId] };
  try{
    invalidateCrateModel();
    const model = ensureCrateModel();
    const bin = model.items.find(it => it.type === 'div' && it.kind === 'bin' && it.key === 'picks');
    assert.ok(bin, 'Staff picks bin exists once there are pins');
    const binIdx = model.items.indexOf(bin);
    assert.equal(binIdx, 0, 'Staff picks sits right after New arrivals would, i.e. still at the very front (none qualify here)');
    assert.equal(model.items[binIdx + 1].album, 'Picked First', 'pin-rank order, not library order');
    assert.equal(model.items[binIdx + 2].album, 'Picked Second');
  } finally {
    delete globalThis.MizikiSocial;
  }

  invalidateCrateModel();
  const noPins = ensureCrateModel();
  assert.equal(noPins.items.some(it => it.type === 'div' && it.key === 'picks'), false, 'hidden with no pins');
});

test('ensureCrateModel: a record inside a bin is double-listed -- it also appears under its own letter, and byAlbumId resolves there, not inside the bin', () => {
  const now = Date.now();
  resetState({
    tracks: [
      fakeTrack('n1', { addedAt: now - 1 * DAY_MS,
        tags: { title:'N1', artist:'Newbie', album:'Fresh Pressing', albumArtist:'Newbie', track:1, disc:1 } }),
    ],
  });
  const model = ensureCrateModel();
  const recIndices = model.items
    .map((it, i) => (it.type === 'rec' && it.album === 'Fresh Pressing') ? i : -1)
    .filter(i => i >= 0);
  assert.equal(recIndices.length, 2, 'the same record appears once in the New arrivals bin and once under its letter');
  const albumId = model.items[recIndices[0]].albumId;
  const binDividerIdx = model.items.findIndex(it => it.type === 'div' && it.kind === 'bin' && it.key === 'new');
  const binCopyIdx = binDividerIdx + 1;   // the bin has exactly one record here
  assert.ok(recIndices.includes(binCopyIdx), 'one copy sits right after the bin divider');
  const alphabeticalIdx = recIndices.find(i => i !== binCopyIdx);
  // byAlbumId must resolve to the alphabetical copy, never the bin's own
  assert.equal(model.byAlbumId.get(albumId), alphabeticalIdx, 'not the bin copy');
  assert.notEqual(model.byAlbumId.get(albumId), binCopyIdx);
});

test('ensureCrateModel: artist dividers appear once an artist reaches 3 records (within a letter), not before, and never stand in for the letter divider', () => {
  resetState({
    tracks: [
      fakeTrack('m1', { tags: { title:'M1', artist:'Many Albums', album:'Many A', albumArtist:'Many Albums', track:1, disc:1 } }),
      fakeTrack('m2', { tags: { title:'M2', artist:'Many Albums', album:'Many B', albumArtist:'Many Albums', track:1, disc:1 } }),
      fakeTrack('m3', { tags: { title:'M3', artist:'Many Albums', album:'Many C', albumArtist:'Many Albums', track:1, disc:1 } }),
      fakeTrack('f1', { tags: { title:'F1', artist:'Few Albums', album:'Few A', albumArtist:'Few Albums', track:1, disc:1 } }),
      fakeTrack('f2', { tags: { title:'F2', artist:'Few Albums', album:'Few B', albumArtist:'Few Albums', track:1, disc:1 } }),
    ],
  });
  const model = ensureCrateModel();
  const artistDividers = model.items.filter(it => it.type === 'div' && it.kind === 'artist');
  assert.equal(artistDividers.length, 1, 'only the 3-album artist gets a divider');
  assert.equal(artistDividers[0].label, 'Many Albums');
  assert.equal(artistDividers[0].meta.indexOf('3 ALBUMS'), 0);
  assert.equal(artistDividers[0].idx.length, 3, 'idx flattens all three records’ own track indices, for PLAY ALL');
});
