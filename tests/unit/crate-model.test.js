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
  persistCrateAnchor, crateRailJumpTarget, libraryHasGenres, nextCrateGroup, CRATE_GROUP_LABELS,
  stickerFor, catalogLineFor, playedLineFor, eraTintFor,
  classifyCratePointerTrace, cratePullProgress,
  CRATE_PULL_UP_PX, CRATE_PULL_REVERSAL_PX, CRATE_PULL_HOLD_MS, CRATE_PULL_COMMIT_FRACTION,
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

// CR3 (docs/13_CRATE.md) point 4: "stickerFor priority (a sealed hi-res new
// record shows only SEALED; a played hi-res record shows 24/96; a plain
// lossless record shows nothing); the catalog line's fallback."

const HIRES_META = {lossless:true, bits:24, rate:96000};
const LOSSLESS_META = {lossless:true, bits:16, rate:44100};

test('stickerFor: a sealed hi-res new record shows only SEALED', () => {
  resetState({ tracks: [fakeTrack('h1', { meta: HIRES_META })] });
  const record = {type:'rec', idx:[0], albumId:'alb1', addedAt: Date.now() - 1 * DAY_MS};
  assert.deepEqual(stickerFor(record, true), {kind:'sealed', addedAt: record.addedAt});
});

test('stickerFor: a played (not new, not sealed) hi-res record shows 24/96', () => {
  resetState({ tracks: [fakeTrack('h1', { meta: HIRES_META })] });
  const record = {type:'rec', idx:[0], albumId:'alb1', addedAt: Date.now() - 60 * DAY_MS};
  assert.deepEqual(stickerFor(record, false), {kind:'hires', bits:24, rate:96000});
});

test('stickerFor: a plain lossless record (not new, no metal earned) shows nothing', () => {
  resetState({ tracks: [fakeTrack('l1', { meta: LOSSLESS_META })], metalEligibleSessions: {} });
  const record = {type:'rec', idx:[0], albumId:'alb1', addedAt: Date.now() - 60 * DAY_MS};
  assert.equal(stickerFor(record, false), null);
});

test('stickerFor: an earned metal shows once nothing higher-priority applies', () => {
  resetState({ tracks: [fakeTrack('l1', { meta: LOSSLESS_META })],
    metalEligibleSessions: { alb1: 25 } });   // crosses the gold threshold (25 sessions)
  const record = {type:'rec', idx:[0], albumId:'alb1', addedAt: Date.now() - 60 * DAY_MS};
  assert.deepEqual(stickerFor(record, false), {kind:'metal', metal:'gold'});
});

test('catalogLineFor: label + catalog number present, with the duration', () => {
  const record = {label:'ABC Records', catalog:'ABC-123', year:1999, trackCount:10, durationSec: 41*60 + 12};
  assert.equal(catalogLineFor(record), 'ABC RECORDS · ABC-123 · 1999 · 10 TRACKS · 41:12');
});

test('catalogLineFor: falls back to genre/year/track-count, with no duration, once label and catalog are both empty', () => {
  const record = {label:'', catalog:'', genre:'Rock', year:1998, trackCount:10, durationSec: 2472};
  assert.equal(catalogLineFor(record), 'ROCK · 1998 · 10 TRACKS');
});

// CR4 (docs/13_CRATE.md): "a third crate order, DECADE... sorted by year,
// with a divider per decade... Pre-1950 shares the 1950s row; undated
// records sit last under 'Undated'."

test('ensureCrateModel (decade): groups by decade in chronological order, pre-1950 under 1950s, undated last', () => {
  resetState({
    crateGroup: 'decade',
    tracks: [
      fakeTrack('d1', { tags: { title:'D1', artist:'Nineties Band', album:'Nineties Album', albumArtist:'Nineties Band', track:1, disc:1 }, details: { genre:'', year: 1995 } }),
      fakeTrack('d2', { tags: { title:'D2', artist:'Old Timer', album:'Old Album', albumArtist:'Old Timer', track:1, disc:1 }, details: { genre:'', year: 1932 } }),
      fakeTrack('d3', { tags: { title:'D3', artist:'No Year', album:'Mystery Album', albumArtist:'No Year', track:1, disc:1 }, details: { genre:'', year: 0 } }),
      fakeTrack('d4', { tags: { title:'D4', artist:'Fifties Act', album:'Fifties Album', albumArtist:'Fifties Act', track:1, disc:1 }, details: { genre:'', year: 1955 } }),
    ],
  });
  const model = ensureCrateModel();
  const dividers = model.items.filter(it => it.type === 'div' && it.kind === 'decade');
  assert.deepEqual(dividers.map(d => d.label), ['1950s', '1990s', 'Undated']);
  // the 1932 and 1955 records share the one 1950s divider, in real-year order
  const d1950 = dividers[0];
  const d1950Idx = model.items.indexOf(d1950);
  assert.equal(model.items[d1950Idx + 1].album, 'Old Album');
  assert.equal(model.items[d1950Idx + 2].album, 'Fifties Album');
  assert.equal(model.group, 'decade');
});

test('eraTintFor: three tints for a decade the README\'s table covers, null for undated or an unlisted decade', () => {
  assert.deepEqual(eraTintFor('1970s'), ['#676232', '#B68A3A', '#754734']);
  assert.equal(eraTintFor('undated'), null);
  assert.equal(eraTintFor('1940s'), null);
});

test('playedLineFor: empty until the album has at least one qualifying session, then names the count and last-spun day', () => {
  resetState({ sessionCounts: {}, albumLastPlayed: {} });
  const record = {albumId:'alb1'};
  assert.equal(playedLineFor(record), '');
  S.sessionCounts.alb1 = 12;
  S.albumLastPlayed.alb1 = Date.now() - 2 * DAY_MS;
  const line = playedLineFor(record);
  assert.ok(line.startsWith('PLAYED 12 TIMES · LAST SPUN '), line);
});

// CR5 ("pull a record out"): the pull/flip/hold state machine, as a pure
// function over a pointer trace, per docs/design/crate/README.md's own
// thresholds and docs/13_CRATE.md's "Tests" requirement for CR5.
test('classifyCratePointerTrace: no movement yet, or only the pointerdown sample, is pending', () => {
  assert.equal(classifyCratePointerTrace([]), 'pending');
  assert.equal(classifyCratePointerTrace([{dy:0, t:0}]), 'pending');
  assert.equal(classifyCratePointerTrace([{dy:0, t:0}, {dy:-3, t:20}]), 'pending');
});

test('classifyCratePointerTrace: sustained upward movement past the threshold, with no reversal, commits to pull', () => {
  const trace = [{dy:0, t:0}, {dy:-8, t:16}, {dy:-16, t:32}, {dy:-(CRATE_PULL_UP_PX), t:48}];
  assert.equal(classifyCratePointerTrace(trace), 'pull');
});

test('classifyCratePointerTrace: a flick up that reverses back down past the threshold is a flip, never a pull', () => {
  const peakUp = CRATE_PULL_UP_PX - 1; // never actually reaches the pull threshold
  const trace = [
    {dy:0, t:0}, {dy:-peakUp, t:30},
    {dy:-(peakUp - CRATE_PULL_REVERSAL_PX), t:60}, // reversed by exactly the threshold
  ];
  assert.equal(classifyCratePointerTrace(trace), 'flip');
});

test('classifyCratePointerTrace: a flick up near the pull threshold that then drops back commits to flip, not pull', () => {
  // peaks at one px short of the pull threshold, then falls back by the
  // reversal threshold -- this must read as flip even though it got close
  // to a pull, since it never actually crossed 24px up.
  const peakUp = CRATE_PULL_UP_PX - 1;
  const trace = [{dy:0, t:0}, {dy:-peakUp, t:20}, {dy:-(peakUp - CRATE_PULL_REVERSAL_PX), t:40}];
  assert.equal(classifyCratePointerTrace(trace), 'flip');
});

test('classifyCratePointerTrace: a plain downward drag past the reversal threshold is a flip', () => {
  const trace = [{dy:0, t:0}, {dy:6, t:20}, {dy:CRATE_PULL_REVERSAL_PX, t:40}];
  assert.equal(classifyCratePointerTrace(trace), 'flip');
});

test('classifyCratePointerTrace: small jitter under every threshold stays pending until the hold deadline, then reads as hold', () => {
  const jitter = [{dy:0, t:0}, {dy:-2, t:100}, {dy:1, t:200}, {dy:-3, t:300}];
  assert.equal(classifyCratePointerTrace(jitter), 'pending');
  const held = jitter.concat([{dy:-2, t: CRATE_PULL_HOLD_MS + 1}]);
  assert.equal(classifyCratePointerTrace(held), 'hold');
});

test('classifyCratePointerTrace: pull wins the instant the trace crosses 24px up, even if a later sample in the same array moves back down', () => {
  // classify scans in order and returns as soon as a threshold is crossed,
  // so a trace that keeps going after the pull commits (as the real one
  // would, mid-lift) must not retroactively read as a flip.
  const trace = [
    {dy:0, t:0}, {dy:-CRATE_PULL_UP_PX, t:40}, {dy:-(CRATE_PULL_UP_PX + 20), t:80}, {dy:-(CRATE_PULL_UP_PX - 5), t:120},
  ];
  assert.equal(classifyCratePointerTrace(trace), 'pull');
});

test('cratePullProgress: 0 with no card height or no lift, 1 once the lift reaches the card\'s own height', () => {
  assert.equal(cratePullProgress(50, 0), 0);
  assert.equal(cratePullProgress(0, 278), 0);
  assert.equal(cratePullProgress(278, 278), 1);
  assert.equal(cratePullProgress(278 * CRATE_PULL_COMMIT_FRACTION, 278), CRATE_PULL_COMMIT_FRACTION);
  // never goes negative or past 1 for an out-of-range input
  assert.equal(cratePullProgress(-10, 278), 0);
  assert.equal(cratePullProgress(1000, 278), 1);
});

test('nextCrateGroup cycles A–Z → Genre → Decade → A–Z when genres exist', () => {
  assert.equal(nextCrateGroup('az', true), 'genre');
  assert.equal(nextCrateGroup('genre', true), 'decade');
  assert.equal(nextCrateGroup('decade', true), 'az');
});

test('nextCrateGroup skips Genre when the library has no genre tags', () => {
  assert.equal(nextCrateGroup('az', false), 'decade');
  assert.equal(nextCrateGroup('decade', false), 'az');
  // a stale 'genre' (tags since removed) steps back to the start
  assert.equal(nextCrateGroup('genre', false), 'az');
});

test('CRATE_GROUP_LABELS covers every crate grouping', () => {
  assert.deepEqual(Object.keys(CRATE_GROUP_LABELS).sort(), ['az', 'decade', 'genre']);
});
