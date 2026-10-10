import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

// credits.js calls real $/el (util/dom.js) when building the credits sheet
// and the person view -- mocked to a capable stub (appendChild,
// addEventListener, cached by selector), same approach as queue.test.js's
// renderQueueSheet tests. It also has a real import of setQueue from
// player/queue.js, which pulls in queue.js's own main.js/transport.js/
// clock.js/sleep-timer.js/audio-engine.js chain -- all mocked directly here,
// same as tags.test.js/queue.test.js, on top of credits.js's own direct
// main.js imports (closePlayer, showRoute, renderTracks, songRow).
// creditNamesCell joins multiple names with a literal document.createTextNode(',
// ') call (not through util/dom.js) -- stubbed globally since there's no real
// `document` in this test environment.
globalThis.document = { createTextNode(text){ return { nodeType: 3, textContent: text }; } };

const elCache = new Map();
function fakeEl(){
  const classes = new Set();
  return {
    textContent: '', style: {}, innerHTML: '', src: '', alt: '', value: '',
    classList: {
      add(...cs){ cs.forEach(c => classes.add(c)); },
      remove(...cs){ cs.forEach(c => classes.delete(c)); },
      contains(c){ return classes.has(c); },
    },
    setAttribute(){}, removeAttribute(){}, getAttribute(){ return null; },
    addEventListener(){}, appendChild(child){ return child; },
    get children(){ return []; },
  };
}
mock.module(new URL('../../src/util/dom.js', import.meta.url).href, {
  namedExports: {
    $(sel){ if(!elCache.has(sel)) elCache.set(sel, fakeEl()); return elCache.get(sel); },
    el(tag, cls, text){ const e = fakeEl(); if(cls) e.className = cls; if(text !== undefined) e.textContent = text; return e; },
  },
});

const songRowMock = mock.fn((i) => fakeEl());
const showRouteMock = mock.fn();
const renderTracksMock = mock.fn();
const closePlayerMock = mock.fn();
mock.module(new URL('../../src/main.js', import.meta.url).href, {
  namedExports: {
    closePlayer: closePlayerMock, showRoute: showRouteMock,
    renderTracks: renderTracksMock, songRow: songRowMock,
    runStartSequence(){}, openPlayerViaSheet(){},
    shouldPutAway(){ return false; }, putAwayInstant(){}, runPutAwaySequence(){},
    applyDiscVariant(){}, restoreThumbs: async () => {},
  },
});
mock.module(new URL('../../src/player/transport.js', import.meta.url).href, {
  namedExports: { load(){}, play(){}, pause(){}, seek(){} },
});
mock.module(new URL('../../src/player/clock.js', import.meta.url).href, {
  namedExports: { drawTime(){} },
});
mock.module(new URL('../../src/player/sleep-timer.js', import.meta.url).href, {
  namedExports: { sleepStopPlayback(){} },
});
mock.module(new URL('../../src/audio/engine.js', import.meta.url).href, {
  namedExports: { ensureContext(){} },
});
mock.module(new URL('../../src/ui/path-note.js', import.meta.url).href, {
  namedExports: { setPathNote(){} },
});

const {
  trackHasCreditsContent, openPersonOrArtist, creditRow,
  openCreditsSheet, closeCreditsSheet, updateCreditsButtonForCurrent,
  albumLinerNotes, albumCreditRoll, rebuildPeopleIndex, renderPersonView,
} = await import('../../src/library/credits.js');
const { S } = await import('../../src/state.js');
const { emptyDetails } = await import('../../src/library/tags/index.js');

function fakeTrack(id, overrides){
  return {
    id, tags: { title: id, artist: 'Artist', album: 'Album', albumArtist: 'Artist', track: 1, disc: 1 },
    details: emptyDetails(),
    ...overrides,
  };
}

function resetState(overrides){
  Object.assign(S, {
    tracks: [], index: -1, view: { mode: 'albums', group: null, artistAlbum: null, playlist: null, picking: false, person: null },
    albumSort: {}, albumOrder: {},
  }, overrides);
  elCache.clear();
  songRowMock.mock.resetCalls();
  showRouteMock.mock.resetCalls();
  renderTracksMock.mock.resetCalls();
  closePlayerMock.mock.resetCalls();
}

test('trackHasCreditsContent is false for a track with no details at all', () => {
  assert.equal(trackHasCreditsContent(null), false);
  assert.equal(trackHasCreditsContent({ details: null }), false);
  assert.equal(trackHasCreditsContent({ details: emptyDetails() }), false);
});

test('trackHasCreditsContent is true when any credit-role bucket has a name', () => {
  const d = emptyDetails(); d.composers = ['Jane Doe'];
  assert.ok(trackHasCreditsContent({ details: d }));
});

test('trackHasCreditsContent is true for genre/year/label/catalog/isrc', () => {
  assert.ok(trackHasCreditsContent({ details: { ...emptyDetails(), genre: 'Jazz' } }));
  assert.ok(trackHasCreditsContent({ details: { ...emptyDetails(), year: 1977 } }));
  assert.ok(trackHasCreditsContent({ details: { ...emptyDetails(), isrc: 'US-ABC-12-34567' } }));
});

test('trackHasCreditsContent is true for a qualifying comment (long enough or multi-line)', () => {
  const d = emptyDetails(); d.comment = 'A short note that is definitely over forty characters long.';
  assert.ok(trackHasCreditsContent({ details: d }));
});

// trackHasCreditsContent only asks "is there anything to show behind the
// info button at all" -- a rip-tool signature still counts (it's junk-
// filtered out of the "Notes" section later, in renderCreditsSheet, not here).
test('trackHasCreditsContent is true even for a rip-tool signature comment (filtered later, not here)', () => {
  const d = emptyDetails(); d.comment = 'ripped and encoded by some tool, nothing else here at all';
  assert.ok(trackHasCreditsContent({ details: d }));
});

test('trackHasCreditsContent is false when the only "comment" is empty/whitespace', () => {
  const d = emptyDetails(); d.comment = '   ';
  assert.equal(trackHasCreditsContent({ details: d }), false);
});

test('openPersonOrArtist routes to the artist view when the name matches a library artist exactly', () => {
  resetState({ tracks: [fakeTrack('a')] });
  openPersonOrArtist('Artist');
  assert.equal(S.view.mode, 'artists');
  assert.equal(S.view.group, 'Artist');
  assert.equal(showRouteMock.mock.calls[0].arguments[0], 'library');
  assert.equal(renderTracksMock.mock.calls.length, 1);
});

test('openPersonOrArtist routes to the person view for a credited name that is not a library artist', () => {
  resetState({ tracks: [fakeTrack('a')] });
  openPersonOrArtist('Some Producer');
  assert.equal(S.view.mode, 'person');
  assert.equal(S.view.person, 'Some Producer');
});

test('openPersonOrArtist remembers where to return to from a non-person view', () => {
  resetState({ tracks: [fakeTrack('a')] });
  S.view.mode = 'albums'; S.view.group = 'SomeGroup';
  openPersonOrArtist('Some Producer');
  assert.deepEqual(S.view.personReturn, { mode: 'albums', group: 'SomeGroup', artistAlbum: null, playlist: null });
});

test('creditRow builds a labeled row with a clickable link per name', () => {
  const row = creditRow('Composer', ['Jane Doe', 'John Roe']);
  assert.ok(row);
});

test('openCreditsSheet/closeCreditsSheet toggle the overlay', () => {
  resetState({ tracks: [fakeTrack('a')] });
  openCreditsSheet(S.tracks[0]);
  const overlay = elCache.get('#creditsOverlay');
  assert.ok(overlay.classList.contains('open'));
  closeCreditsSheet();
  assert.ok(!overlay.classList.contains('open'));
});

test('updateCreditsButtonForCurrent hides the button when there is no current track', () => {
  resetState({ tracks: [], index: -1 });
  updateCreditsButtonForCurrent();
  assert.equal(elCache.get('#trackInfoBtn').style.display, 'none');
});

test('updateCreditsButtonForCurrent shows the button when the current track has credits content', () => {
  const d = emptyDetails(); d.composers = ['Jane Doe'];
  resetState({ tracks: [fakeTrack('a', { details: d })], index: 0 });
  updateCreditsButtonForCurrent();
  assert.equal(elCache.get('#trackInfoBtn').style.display, '');
});

test('albumLinerNotes picks the longest qualifying comment across the album', () => {
  const short = emptyDetails(); short.comment = 'A note that is exactly long enough to qualify for display here.';
  const long = emptyDetails(); long.comment = 'A much longer liner note that should win because it has more characters than the other one by a wide margin.';
  resetState({ tracks: [fakeTrack('a', { details: short }), fakeTrack('b', { details: long })] });
  assert.equal(albumLinerNotes('Album'), long.comment);
});

test('albumLinerNotes returns empty string when no track has qualifying notes', () => {
  resetState({ tracks: [fakeTrack('a')] });
  assert.equal(albumLinerNotes('Album'), '');
});

test('albumCreditRoll de-duplicates the same person+role across every track on the album', () => {
  const d1 = emptyDetails(); d1.producers = ['Jane Doe'];
  const d2 = emptyDetails(); d2.producers = ['Jane Doe', 'John Roe'];
  resetState({ tracks: [fakeTrack('a', { details: d1 }), fakeTrack('b', { details: d2 })] });
  const roll = albumCreditRoll('Album');
  assert.deepEqual(roll.get('Producer'), ['Jane Doe', 'John Roe']);
});

test('rebuildPeopleIndex + renderPersonView: a credited person resolves to every track they appear on', () => {
  const d = emptyDetails(); d.composers = ['Jane Doe'];
  resetState({ tracks: [fakeTrack('a', { details: d }), fakeTrack('b')] });
  rebuildPeopleIndex();
  const host = fakeEl();
  renderPersonView(host, 'Jane Doe');
  // songRow was called once for the one track Jane Doe appears on
  assert.equal(songRowMock.mock.calls.length, 1);
  assert.equal(songRowMock.mock.calls[0].arguments[0], 0);
});

test('renderPersonView shows a "no credits found" note for an unknown name', () => {
  resetState({ tracks: [fakeTrack('a')] });
  rebuildPeopleIndex();
  const host = fakeEl();
  let appended = null;
  host.appendChild = (child) => { appended = child; return child; };
  renderPersonView(host, 'Nobody');
  assert.ok(appended);
  assert.match(appended.textContent, /No credits found/);
});
