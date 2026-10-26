import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import { DB } from '../../src/storage/idb.js';

// CR6 (docs/13_CRATE.md): library/sealed.js now imports REDUCED
// (util/motion.js) -- read once, at module load, from window.matchMedia --
// for its own reduced-motion break choreography. Stubbed here the same way
// shell.test.js/crate-model.test.js already do, since this file's real
// history/clear.js chain reaches sealed.js (via edit.js) before any mock
// of this module would apply.
globalThis.window = { matchMedia(){ return { matches: false }; } };

// played.js imports from the real src/history/sessions.js (sessionTrackComplete,
// persistTrackPlayCounts, persistTrackMetalEligiblePlays); played.js and
// sessions.js's own applyDiscVariant/restoreThumbs/snapshotAlbumDisplay/etc.
// imports are real too (looks.js/thumbs.js/achievements.js, step 6b), and
// loading those for real reaches a further real chain: thumbs.js's
// cropSquareImage import reaches library/edit.js, which reaches
// library/sealed.js and library/credits.js — and credits.js's own real
// setQueue import reaches player/queue.js, which would in turn reach
// player/buffers.js's ensureContext (audio/engine.js) and, through that,
// sundown/location.js's circular queueSave import — same reasoning
// tags.test.js/credits.test.js/search.test.js give for mocking
// audio/engine.js, transport.js and sleep-timer.js directly rather than
// loading that whole chain. Each of edit.js/sealed.js/credits.js/queue.js
// still circularly imports a few names from main.js (rule 8). Since step
// 6e, played.js's and clear.js's persistTrackLastPlayed/renderProfile are
// real imports from src/profile/screens.js instead — mocked directly
// below, same "stop the chain at the door" reasoning, since the real
// screens.js would pull in profile/storefront.js, profile/settings.js and
// the social/ screens too.
// main.js has DOM-dependent top-level code that needs a browser, so it's
// mocked directly here with the union of everything the real chain asks
// of it.
// clear.js also calls $('#route-profile') (util/dom.js), which needs a real
// `document` global -- mocked to a no-op stub rather than pulling in a DOM.
mock.module(new URL('../../src/util/dom.js', import.meta.url).href, {
  namedExports: { $(){ return null; }, el(){ return null; } },
});

const checkAlbumAchievementAndCollectionMock = mock.fn();
// checkAlbumAchievementAndCollection moved to history/achievements.js
// (step 6b) — mocked there now instead of on main.js, same spy so the
// "counts once, never twice" assertions below still work unchanged.
mock.module(new URL('../../src/history/achievements.js', import.meta.url).href, {
  namedExports: { checkAlbumAchievementAndCollection: checkAlbumAchievementAndCollectionMock },
});
// Since step 7e, sealed.js's updateSealedSheetAfterBreak import is real
// (from src/gatefold/sealed-sheet.js) instead of main.js — mocked here
// rather than main.js, since the real sealed-sheet.js would otherwise
// reach gatefold/view.js's own wide real chain just to satisfy this one
// name. main.js is no longer mocked in this file at all as a result.
mock.module(new URL('../../src/gatefold/sealed-sheet.js', import.meta.url).href, {
  namedExports: { updateSealedSheetAfterBreak(){} },
});
// Since step 7d, renderTracks/exitSelectMode/songRow (reached via
// edit.js/credits.js, transitively through the chain the comment above
// describes) are all real imports from src/library/view.js instead of
// main.js — mocked directly here, same "stop the chain at the door"
// reasoning.
mock.module(new URL('../../src/library/view.js', import.meta.url).href, {
  namedExports: { renderTracks(){}, exitSelectMode(){}, songRow(){}, updateTrackRow(){ return false; } },
});
// RF23 (docs/12_REFINE.md): credits.js's new, one-directional import of
// openFriendStore (social/screens/friend-store.js) would otherwise reach
// that module's own real chain (profile/storefront.js and everything past
// it) through this file's own real credits.js chain described above —
// stopped at that new edge, the same way tests/unit/credits.test.js does.
mock.module(new URL('../../src/social/screens/friend-store.js', import.meta.url).href, {
  namedExports: { openFriendStore(){} },
});
// Since step 7c, edit.js's deleteCrateArtTiers/buildCrateTier and thumbs.js's
// invalidateCrateModel imports are real ones from src/crate/tiers.js/
// model.js instead of main.js — mocked directly here, same "stop the chain
// at the door" reasoning as the rest of this file (crate/model.js's own
// real chain reaches storage/meta.js -> audio/mode.js -> audio/engine.js's
// routeSource, which this file doesn't otherwise mock).
mock.module(new URL('../../src/crate/tiers.js', import.meta.url).href, {
  namedExports: { deleteCrateArtTiers(){}, buildCrateTier(){} },
});
mock.module(new URL('../../src/crate/model.js', import.meta.url).href, {
  namedExports: { invalidateCrateModel(){} },
});
// Since step 7b, the five screen/ceremony functions above moved off
// main.js into real src/shell/ modules — mocked there directly instead,
// same "stop the chain at the door" reasoning as every other mock in this
// file (shell/mini-player.js's own real player/background.js import would
// otherwise reach player/controls.js/storage/meta.js/audio/mode.js).
mock.module(new URL('../../src/shell/mini-player.js', import.meta.url).href, {
  namedExports: { renderMiniPlayer(){} },
});
mock.module(new URL('../../src/shell/player-overlay.js', import.meta.url).href, {
  namedExports: { closePlayer(){}, openPlayerViaSheet(){} },
});
mock.module(new URL('../../src/shell/routes.js', import.meta.url).href, {
  namedExports: { showRoute(){} },
});
mock.module(new URL('../../src/shell/start-sequence.js', import.meta.url).href, {
  namedExports: { runStartSequence(){} },
});
// CEREMONY PR 3: player/queue.js and shell/start-sequence.js import
// shell/runout.js, whose real chain reaches library/view.js — stop it here.
mock.module(new URL('../../src/shell/runout.js', import.meta.url).href, {
  namedExports: { endOfQueue(){}, maybeSideFlip(){ return false; }, cancelRunout(){}, interruptRunout(){ return false; }, clearToRest(){}, performPendingFlip(){ return false; } },
});
mock.module(new URL('../../src/shell/put-away.js', import.meta.url).href, {
  namedExports: { shouldPutAway(){ return false; }, putAwayInstant(){}, runPutAwaySequence(){} },
});
mock.module(new URL('../../src/profile/screens.js', import.meta.url).href, {
  namedExports: { persistTrackLastPlayed: async () => {}, renderProfile(){} },
});
mock.module(new URL('../../src/audio/engine.js', import.meta.url).href, {
  namedExports: { ensureContext(){}, applyCharacter(){}, applyWobbleRate(){}, applyLoudnessNorm(){} },
});
mock.module(new URL('../../src/player/transport.js', import.meta.url).href, {
  namedExports: { load(){}, pause(){}, play(){}, seek(){}, sideLetterFor(){ return ''; }, cancelPendingGapless(){} },
});
mock.module(new URL('../../src/player/sleep-timer.js', import.meta.url).href, {
  namedExports: { sleepStopPlayback(){} },
});
mock.module(new URL('../../src/player/clock.js', import.meta.url).href, {
  namedExports: { drawTime(){} },
});
// Since step 06 (B3), sessions.js's touchBackupField and played.js's/
// clear.js's scheduleBackupSync imports are real (storage/meta.js and
// sync/backup.js respectively) — mocked directly here, same "stop the
// chain at the door" reasoning as the rest of this file, since the real
// sync/backup.js would pull in library/view.js's whole wide chain and
// the real storage/meta.js would pull in audio/mode.js's routeSource.
mock.module(new URL('../../src/storage/meta.js', import.meta.url).href, {
  namedExports: { queueSave(){}, touchBackupField(){} },
});
mock.module(new URL('../../src/sync/backup.js', import.meta.url).href, {
  // queueCoverUpload: step 07 (B4)'s own addition to library/edit.js's
  // real import of this module, reached the same way scheduleBackupSync
  // already was (via the real cropSquareImage -> library/edit.js chain).
  namedExports: { scheduleBackupSync(){}, reconcileImportedTrack(){}, queueCoverUpload(){} },
});
// DA5 (docs/DAY_ARC.md): played.js's own incrementTrackPlay() calls
// realDayPosition() (sundown/solar.js) to tally S.phasePlayCounts/
// S.albumPhaseCounts -- mocked here to a settable `fakePhase`, not
// loaded for real, so these tests can pin down exactly which phase a
// play counts into rather than depending on whatever the real clock
// (or S.previewMin, which realDayPosition() itself never reads) happens
// to say when the suite runs.
let fakePhase = 'midday';
mock.module(new URL('../../src/sundown/solar.js', import.meta.url).href, {
  // PRESSINGS_110 PR3: record-art/tiers.js's Nychthemeron pattern now
  // imports nowClock from this same module too, reached transitively
  // through this file's own import chain -- stubbed here even though
  // nothing in this test ever exercises Nychthemeron rendering.
  namedExports: { realDayPosition(){ return { phase: fakePhase }; }, nowClock(){ return new Date(); } },
});

const { addPlayedRange, playedCoverage, checkTrackCompletion, incrementTrackPlay } = await import('../../src/history/played.js');
const { clearListeningHistory } = await import('../../src/history/clear.js');
const { S } = await import('../../src/state.js');
// RF22 (docs/12_REFINE.md): played.js's own real sundown/rhythm.js import
// (a pure, zero-import leaf -- no mocking needed) is where dayKeyFor lives.
const { dayKeyFor } = await import('../../src/sundown/rhythm.js');

function resetState(overrides){
  Object.assign(S, {
    tracks: [], index: -1, curPlayed: [], curTrackDone: false, sessionActive: null,
    sessions: {}, sessionCounts: {}, metalEligibleSessions: {}, rareUnlocked: {},
    albumLastPlayed: {}, albumDisplay: {}, albumLookPref: {},
    achievements: {}, collection: {},
    trackPlayCounts: {}, trackMetalEligiblePlays: {}, trackLastPlayed: {}, trackDisplay: {},
    // DA5 (docs/DAY_ARC.md); phasePlayCountsByDay added RF22 (docs/12_REFINE.md)
    phasePlayCounts: {}, phasePlayCountsByDay: {}, albumPhaseCounts: {}, previewMin: 0,
  }, overrides);
  checkAlbumAchievementAndCollectionMock.mock.resetCalls();
  fakePhase = 'midday';
}

function fakeTrack(overrides){
  return Object.assign({
    id: 't1', duration: 100,
    tags: { title: 'T', artist: 'A', album: 'Al', albumArtist: 'A', track: 1, disc: 0 },
    details: {},
  }, overrides);
}

// -- addPlayedRange / playedCoverage ----------------------------------------

test('addPlayedRange: contiguous playback merges into one interval', () => {
  resetState();
  addPlayedRange(0, 10);
  addPlayedRange(10, 20);
  addPlayedRange(20, 30);
  assert.equal(S.curPlayed.length, 1);
  assert.equal(playedCoverage(), 30);
});

test('addPlayedRange: a scrub-skip leaves a real gap, not counted', () => {
  resetState();
  addPlayedRange(0, 10);
  addPlayedRange(50, 60); // scrubbed far ahead -- a real gap
  assert.equal(S.curPlayed.length, 2);
  assert.equal(playedCoverage(), 20); // 10 + 10, the gap itself isn't counted
});

test('addPlayedRange: overlapping replays are not double-counted', () => {
  resetState();
  addPlayedRange(0, 10);
  addPlayedRange(5, 15);  // overlaps the first by 5s
  addPlayedRange(3, 8);   // fully inside the merged range already
  assert.equal(playedCoverage(), 15); // union is [0,15], not 10+10+5
});

test('addPlayedRange: ranges within the 0.05s joining tolerance merge; just outside it do not', () => {
  resetState();
  addPlayedRange(0, 10);
  addPlayedRange(10.05, 15); // exactly at the tolerance -- joins
  assert.equal(S.curPlayed.length, 1);
  assert.equal(playedCoverage(), 15);

  resetState();
  addPlayedRange(0, 10);
  addPlayedRange(10.06, 15); // just past the tolerance -- a real gap
  assert.equal(S.curPlayed.length, 2);
  assert.ok(playedCoverage() < 15);
});

test('addPlayedRange: a backwards or empty range is a no-op', () => {
  resetState();
  addPlayedRange(10, 10);
  addPlayedRange(10, 5);
  assert.equal(S.curPlayed.length, 0);
});

// -- checkTrackCompletion ----------------------------------------------------

test('checkTrackCompletion: counts once at >=95% coverage', () => {
  resetState();
  const t = fakeTrack({ duration: 100 });
  addPlayedRange(0, 95);
  checkTrackCompletion(t);
  assert.equal(S.curTrackDone, true);
  assert.equal(S.trackPlayCounts['a|al|t'] !== undefined, true);
  assert.equal(checkAlbumAchievementAndCollectionMock.mock.calls.length, 1);
});

test('checkTrackCompletion: never counts twice for the same play-through', () => {
  resetState();
  const t = fakeTrack({ duration: 100 });
  addPlayedRange(0, 95);
  checkTrackCompletion(t);
  const countAfterFirst = S.trackPlayCounts['a|al|t'];
  addPlayedRange(95, 100); // keeps playing past the 95% mark
  checkTrackCompletion(t); // S.curTrackDone is already true -- no-op
  assert.equal(S.trackPlayCounts['a|al|t'], countAfterFirst);
  assert.equal(checkAlbumAchievementAndCollectionMock.mock.calls.length, 1);
});

test('checkTrackCompletion: never counts below 95% coverage, even if playback reached the end', () => {
  resetState();
  const t = fakeTrack({ duration: 100 });
  addPlayedRange(80, 100); // reached the end, but only 20% actually played (scrubbed past the rest)
  checkTrackCompletion(t);
  assert.equal(S.curTrackDone, false);
  assert.equal(S.trackPlayCounts['a|al|t'], undefined);
  assert.equal(checkAlbumAchievementAndCollectionMock.mock.calls.length, 0);
});

test('checkTrackCompletion: a track with no duration never completes', () => {
  resetState();
  const t = fakeTrack({ duration: 0 });
  addPlayedRange(0, 50);
  checkTrackCompletion(t);
  assert.equal(S.curTrackDone, false);
});

// -- DA5 (docs/DAY_ARC.md): phase-of-play counting ----------------------------

test('incrementTrackPlay: tallies the current real-clock phase into both phasePlayCounts and albumPhaseCounts', () => {
  resetState();
  fakePhase = 'golden';
  const t = fakeTrack();
  incrementTrackPlay(t);
  assert.deepEqual(S.phasePlayCounts, { golden: 1 });
  assert.deepEqual(S.albumPhaseCounts, { al: { golden: 1 } });   // albumKey(t) === normKey('Al') === 'al'
  incrementTrackPlay(t);
  assert.deepEqual(S.phasePlayCounts, { golden: 2 });
  assert.deepEqual(S.albumPhaseCounts, { al: { golden: 2 } });
});

test('incrementTrackPlay: a second play in a different phase adds its own bucket rather than replacing the first', () => {
  resetState();
  fakePhase = 'night';
  const t = fakeTrack();
  incrementTrackPlay(t);
  fakePhase = 'morning';
  incrementTrackPlay(t);
  assert.deepEqual(S.phasePlayCounts, { night: 1, morning: 1 });
  assert.deepEqual(S.albumPhaseCounts, { al: { night: 1, morning: 1 } });
});

test('checkTrackCompletion: the counted phase comes from realDayPosition(), never S.previewMin -- dragging Preview the day can never create or change this stat', () => {
  resetState();
  fakePhase = 'twilight';   // what the mocked realDayPosition() itself reports
  S.previewMin = 600;       // "Preview the day" dragged ten hours ahead -- irrelevant here, since
                            // realDayPosition() (unlike currentDayPosition()) never reads this at all
  const t = fakeTrack({ duration: 100 });
  addPlayedRange(0, 95);
  checkTrackCompletion(t);
  assert.deepEqual(S.phasePlayCounts, { twilight: 1 });
});

test('incrementTrackPlay: RF22 — also tallies the same phase into phasePlayCountsByDay, bucketed by today\'s local calendar day', () => {
  resetState();
  fakePhase = 'golden';
  const t = fakeTrack();
  incrementTrackPlay(t);
  const today = dayKeyFor(Date.now());
  assert.deepEqual(Object.keys(S.phasePlayCountsByDay), [today]);
  assert.deepEqual(S.phasePlayCountsByDay[today], { golden: 1 });
  incrementTrackPlay(t);
  assert.deepEqual(S.phasePlayCountsByDay[today], { golden: 2 });
  // same lifetime counters as before, untouched by the new day-bucketed one
  assert.deepEqual(S.phasePlayCounts, { golden: 2 });
});

test('a second track in a different album gets its own albumPhaseCounts entry, phasePlayCounts stays one shared tally', () => {
  resetState();
  fakePhase = 'dawn';
  incrementTrackPlay(fakeTrack({ id:'t1', tags:{title:'T1', artist:'A', album:'Al1', albumArtist:'A', track:1, disc:0} }));
  incrementTrackPlay(fakeTrack({ id:'t2', tags:{title:'T2', artist:'A', album:'Al2', albumArtist:'A', track:1, disc:0} }));
  assert.deepEqual(S.phasePlayCounts, { dawn: 2 });
  assert.deepEqual(S.albumPhaseCounts, { al1: { dawn: 1 }, al2: { dawn: 1 } });
});

test('clearListeningHistory: full scope resets phasePlayCounts/albumPhaseCounts/phasePlayCountsByDay too', async () => {
  await openFresh();
  const today = dayKeyFor(Date.now());
  resetState({
    tracks: [fakeTrack({ id:'t1' })],
    phasePlayCounts: { night: 7 }, albumPhaseCounts: { al: { night: 7 } },
    phasePlayCountsByDay: { [today]: { night: 7 } },
  });
  await clearListeningHistory(false);
  assert.deepEqual(S.phasePlayCounts, {});
  assert.deepEqual(S.albumPhaseCounts, {});
  assert.deepEqual(S.phasePlayCountsByDay, {});
  DB.db.close();
});

test('clearListeningHistory: orphaned-only scope prunes albumPhaseCounts by identity, but leaves phasePlayCounts/phasePlayCountsByDay alone (neither has a per-identity shape to prune by)', async () => {
  await openFresh();
  const today = dayKeyFor(Date.now());
  resetState({
    tracks: [fakeTrack({ id:'t1', tags:{title:'T', artist:'A', album:'Al', albumArtist:'A', track:1, disc:0} })],
    // albumKey() is normKey(album) alone -- "al" for the still-present track, "goneAlbum" for one that's gone
    phasePlayCounts: { night: 5, golden: 2 },   // never touched by the orphaned-only scope -- see the doc comment in state.js
    phasePlayCountsByDay: { [today]: { night: 5, golden: 2 } },   // same reasoning, RF22's own addition
    albumPhaseCounts: { al: { night: 5 }, goneAlbum: { golden: 2 } },
  });
  await clearListeningHistory(true);
  assert.deepEqual(S.phasePlayCounts, { night: 5, golden: 2 });
  assert.deepEqual(S.phasePlayCountsByDay, { [today]: { night: 5, golden: 2 } });
  assert.ok('al' in S.albumPhaseCounts);
  assert.ok(!('goneAlbum' in S.albumPhaseCounts));
  DB.db.close();
});

// Forget library (F3) never touches history/* at all -- src/library/delete.js's
// forgetLibrary() only clears the tracks store, crate-art tiers and
// thumbnails, confirmed by that module's own test (tests/unit/forget-
// library.test.js) asserting every history counter -- phasePlayCounts/
// albumPhaseCounts included, since forgetLibrary() never imports anything
// from src/history/ at all -- persists its *current* value unchanged
// across a Forget. Nothing to add here that that file doesn't already
// cover by construction.

// -- clearListeningHistory ----------------------------------------------------

function freshIndexedDB(){
  const factory = new IDBFactory();
  globalThis.indexedDB = factory;
  return factory;
}
function resetDB(){ DB.db = null; DB.ok = false; }
async function openFresh(){
  freshIndexedDB();
  resetDB();
  const { storage } = await import('../../src/storage/repo.js');
  await storage.open();
}

test('clearListeningHistory: full scope wipes session/play counters and leaves the library, edits and playlists alone', async () => {
  await openFresh();
  resetState({
    tracks: [fakeTrack({ id:'t1' })],
    sessionCounts: { al1: 3 }, metalEligibleSessions: { al1: 2 }, rareUnlocked: { al1: true },
    albumLastPlayed: { al1: Date.now() }, albumDisplay: { al1: {name:'x'} }, albumLookPref: { al1: 'rare' },
    achievements: { al1: { albumId:'al1', tier:2 } }, collection: { al1: { albumId:'al1' } },
    sessions: { al1: { albumId:'al1' } },
    trackPlayCounts: { tk1: 5 }, trackMetalEligiblePlays: { tk1: 3 }, trackLastPlayed: { tk1: Date.now() },
    trackDisplay: { tk1: {name:'y'} },
  });
  // library/edits/playlists/settings are not S.* fields this function touches at all --
  // confirm it leaves the library (S.tracks) and an arbitrary "setting" untouched
  S.libraryLayout = 'crate'; S.favorites = ['t1'];

  await clearListeningHistory(false);

  assert.deepEqual(S.sessionCounts, {});
  assert.deepEqual(S.metalEligibleSessions, {});
  assert.deepEqual(S.rareUnlocked, {});
  assert.deepEqual(S.albumLastPlayed, {});
  assert.deepEqual(S.albumDisplay, {});
  assert.deepEqual(S.albumLookPref, {});
  assert.deepEqual(S.achievements, {});
  assert.deepEqual(S.collection, {});
  assert.deepEqual(S.sessions, {});
  assert.equal(S.sessionActive, null);
  assert.deepEqual(S.trackPlayCounts, {});
  assert.deepEqual(S.trackMetalEligiblePlays, {});
  assert.deepEqual(S.trackLastPlayed, {});
  assert.deepEqual(S.trackDisplay, {});

  // untouched by this function
  assert.equal(S.tracks.length, 1);
  assert.equal(S.libraryLayout, 'crate');
  assert.deepEqual(S.favorites, ['t1']);

  DB.db.close();
});

test('clearListeningHistory: orphaned-only scope drops only identities no longer in the library', async () => {
  await openFresh();
  resetState({
    tracks: [fakeTrack({ id:'t1', tags:{title:'T', artist:'A', album:'Al', albumArtist:'A', track:1, disc:0} })],
    // albumKey() is normKey(album) alone ("al" for this track); trackIdentityKey()
    // is normKey(artist)|albumKey|normKey(title) ("a|al|t" for this track)
    sessionCounts: { al: 3, goneAlbum: 7 },
    albumLastPlayed: { al: 1, goneAlbum: 1 },
    achievements: {}, collection: {}, sessions: {},
    trackPlayCounts: { 'a|al|t': 2, 'gone|key|x': 9 },
  });

  await clearListeningHistory(true);

  // the still-in-library album/track identity survives
  assert.ok('al' in S.sessionCounts);
  assert.ok('a|al|t' in S.trackPlayCounts);
  // the orphaned ones (no longer in S.tracks) are dropped
  assert.ok(!('goneAlbum' in S.sessionCounts));
  assert.ok(!('gone|key|x' in S.trackPlayCounts));

  DB.db.close();
});
