import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

// gatefold/view.js has real circular imports with player/transport.js (for
// play) and shell/handoff.js (for runGatefoldHandoff) — the same peer-import
// shape already established between engine.js/transport.js — plus real,
// one-directional imports into library/credits.js, library/thumbs.js,
// crate/tiers.js, player/clock.js, player/queue.js, shell/start-sequence.js
// and shell/player-overlay.js, none of which are this file's own subject.
// All are mocked directly here, the usual "stop the chain at the door"
// reasoning, since loading any of them for real would reach wide chains
// (player/queue.js alone would reach player/buffers.js's ensureContext and
// sundown/location.js's circular queueSave import).
globalThis.window = { matchMedia(){ return { matches: false }; } };
globalThis.document = { documentElement: { style: { setProperty(){} } } };

mock.module(new URL('../../src/library/credits.js', import.meta.url).href, {
  namedExports: {
    albumLinerNotes(){ return ''; }, albumCreditRoll(){ return new Map(); },
    openPersonOrArtist(){},
  },
});
mock.module(new URL('../../src/library/thumbs.js', import.meta.url).href, {
  namedExports: { thumbURL: {} },
});
mock.module(new URL('../../src/crate/tiers.js', import.meta.url).href, {
  namedExports: { getCrateArtURL: async () => null },
});
mock.module(new URL('../../src/player/clock.js', import.meta.url).href, {
  namedExports: { fmt(s){ return String(s); } },
});
mock.module(new URL('../../src/player/queue.js', import.meta.url).href, {
  namedExports: { setQueue(){} },
});
mock.module(new URL('../../src/player/transport.js', import.meta.url).href, {
  namedExports: { play(){} },
});
mock.module(new URL('../../src/shell/start-sequence.js', import.meta.url).href, {
  namedExports: { runStartSequence(){} },
});
mock.module(new URL('../../src/shell/player-overlay.js', import.meta.url).href, {
  namedExports: { openPlayerViaSheet(){} },
});
mock.module(new URL('../../src/shell/handoff.js', import.meta.url).href, {
  namedExports: { runGatefoldHandoff(){} },
});
// sealed-sheet.js's own buildSealOverlay/runBreakChoreography imports reach
// the real library/sealed.js, which in turn reaches the real
// library/view.js — the step 7d hub module with seven real circular pairs —
// just to satisfy two names this file never exercises (isSealedSheetOpen
// only touches the module-private SEALSHEET). Mocked directly to stop that
// chain at the door.
mock.module(new URL('../../src/library/sealed.js', import.meta.url).href, {
  namedExports: { buildSealOverlay(){ return { }; }, runBreakChoreography: async () => {} },
});

const { gatefoldSideSplits, isGatefoldOpen } = await import('../../src/gatefold/view.js');
const { isSealedSheetOpen } = await import('../../src/gatefold/sealed-sheet.js');
const { S } = await import('../../src/state.js');

function fakeTrack(disc, duration){ return { tags: { disc }, duration }; }

// AU9 (docs/16_AUDIO.md §5): splitSides() (shell/ceremony-timing.js) is now
// time-balanced, not a plain midpoint cut — "one track: a single side, no
// flip; two tracks: A and B; three or more: balanced by time."
test('gatefoldSideSplits: a single track never splits', () => {
  S.albumSides = true;
  S.tracks = [fakeTrack(1, 300)];
  assert.equal(gatefoldSideSplits([0]), null);
});

test('gatefoldSideSplits: S.albumSides off never splits regardless of track count', () => {
  S.albumSides = false;
  S.tracks = [0,1,2,3,4].map(() => fakeTrack(1, 600));
  assert.equal(gatefoldSideSplits([0, 1, 2, 3, 4]), null);
});

test('gatefoldSideSplits: a single disc of equal-length tracks balances by time', () => {
  S.albumSides = true;
  S.tracks = [0,1,2,3,4].map(() => fakeTrack(1, 600));
  const sides = gatefoldSideSplits([0, 1, 2, 3, 4]);
  assert.equal(sides.length, 2);
  assert.deepEqual(sides[0], {label:'SIDE A', idx:[0,1]});
  assert.deepEqual(sides[1], {label:'SIDE B', idx:[2,3,4]});
});

// Followup (Ken, "double albums as four sides (A-D) instead of one side
// per disc"): each disc now gets its own time-balanced split -- this
// two-disc, 2-and-3-track album reads as four sides, A-D, not two.
test('gatefoldSideSplits: each disc splits into its own time-balanced sides', () => {
  S.albumSides = true;
  S.tracks = [fakeTrack(1, 600), fakeTrack(1, 600), fakeTrack(2, 600), fakeTrack(2, 600), fakeTrack(2, 600)];
  const sides = gatefoldSideSplits([0, 1, 2, 3, 4]);
  assert.equal(sides.length, 4);
  assert.deepEqual(sides[0], {label:'SIDE A', idx:[0]});
  assert.deepEqual(sides[1], {label:'SIDE B', idx:[1]});
  assert.deepEqual(sides[2], {label:'SIDE C', idx:[2]});
  assert.deepEqual(sides[3], {label:'SIDE D', idx:[3,4]});
});

test('isGatefoldOpen reads the module-private GF state (null when closed)', () => {
  assert.equal(isGatefoldOpen(), false);
});

test('isSealedSheetOpen reads the module-private SEALSHEET state (null when closed)', () => {
  assert.equal(isSealedSheetOpen(), false);
});
