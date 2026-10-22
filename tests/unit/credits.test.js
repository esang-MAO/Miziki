import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { normKey } from '../../src/util/text.js';

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
// setQueue's own real chain now reaches queue.js's skipWithLift(), which
// imports REDUCED from util/motion.js -- read once, at module load, from
// window.matchMedia.
globalThis.window = { matchMedia(){ return { matches: false }; } };

const elCache = new Map();
// RF23's own tests need two things the pre-existing bare-bones fakeEl didn't
// track: real children (to find the appended .credit-friends holder/list)
// and a real addEventListener (to fire a button's own click handler) --
// added here as plain, additive capability. Every pre-existing test either
// doesn't touch these at all or overrides .appendChild itself on its own
// host, so neither change alters any existing test's behavior.
function fakeEl(){
  const classes = new Set();
  const kids = [];
  const listeners = {};
  return {
    textContent: '', style: {}, innerHTML: '', src: '', alt: '', value: '', hidden: false,
    classList: {
      add(...cs){ cs.forEach(c => classes.add(c)); },
      remove(...cs){ cs.forEach(c => classes.delete(c)); },
      contains(c){ return classes.has(c); },
    },
    setAttribute(){}, removeAttribute(){}, getAttribute(){ return null; },
    addEventListener(type, fn){ listeners[type] = fn; },
    _click(){ if(listeners.click) listeners.click({}); },
    appendChild(child){ kids.push(child); return child; },
    get children(){ return kids; },
  };
}
mock.module(new URL('../../src/util/dom.js', import.meta.url).href, {
  namedExports: {
    $(sel){ if(!elCache.has(sel)) elCache.set(sel, fakeEl()); return elCache.get(sel); },
    el(tag, cls, text){ const e = fakeEl(); if(cls) e.className = cls; if(text !== undefined) e.textContent = text; return e; },
  },
});

const songRowMock = mock.fn((_i) => fakeEl());
const showRouteMock = mock.fn();
const renderTracksMock = mock.fn();
const closePlayerMock = mock.fn();
// Since step 7d, credits.js's renderTracks/songRow imports are real (from
// src/library/view.js) instead of main.js — mocked directly here, same
// "stop the chain at the door" reasoning as the rest of this file, since
// the real view.js would otherwise reach back into library/credits.js
// itself (a real circular pair) plus favorites.js/search.js/sealed.js/
// edit.js/delete.js and crate/view.js's own wide chains.
mock.module(new URL('../../src/library/view.js', import.meta.url).href, {
  namedExports: {
    renderTracks: renderTracksMock, songRow: songRowMock,
  },
});
// Since step 7b, credits.js's closePlayer/showRoute moved off main.js into
// real src/shell/ modules (player-overlay.js/routes.js) — mocked there
// instead, same mock.fn()s so the test's own assertions on call args still
// work. The other three (queue.js's own shell/ imports, reached via setQueue
// below) are stubbed the same "stop the chain at the door" way the rest of
// this file's mocks are, so shell/start-sequence.js never reaches library/
// sealed.js's own circular main.js import.
mock.module(new URL('../../src/shell/player-overlay.js', import.meta.url).href, {
  namedExports: { closePlayer: closePlayerMock, openPlayerViaSheet(){} },
});
mock.module(new URL('../../src/shell/routes.js', import.meta.url).href, {
  namedExports: { showRoute: showRouteMock },
});
// RF23 (docs/12_REFINE.md): credits.js's new, one-directional import of
// openFriendStore (social/screens/friend-store.js) would otherwise reach
// that module's own real chain (profile/storefront.js, profile/
// rhythm-card.js, sundown/spin-wording.js) — stopped here the same way.
const openFriendStoreMock = mock.fn();
mock.module(new URL('../../src/social/screens/friend-store.js', import.meta.url).href, {
  namedExports: { openFriendStore: openFriendStoreMock },
});
// NV2 (docs/11_SMOOTH_NAVIGATION.md): credits.js's openCreditsSheet/
// openPersonOrArtist now register with the real history-based nav-stack
// layer stack — which reads the real browser history/document/window, none
// of which exist in this Node test environment. Stubbed to no-ops, the same
// "stop the chain at the door" reasoning as every other mock in this file;
// nav-stack.js's own push/pop/popstate behavior is covered by its own
// tests/unit/nav-stack.test.js.
mock.module(new URL('../../src/shell/nav-stack.js', import.meta.url).href, {
  namedExports: { openLayer(){}, closeLayer(){}, forceCloseLayer(){} },
});
mock.module(new URL('../../src/shell/start-sequence.js', import.meta.url).href, {
  namedExports: { runStartSequence(){} },
});
// CEREMONY PR 3: player/queue.js and shell/start-sequence.js import
// shell/runout.js, whose real chain reaches library/view.js — stop it here.
mock.module(new URL('../../src/shell/runout.js', import.meta.url).href, {
  namedExports: { endOfQueue(){}, maybeSideFlip(){ return false; }, cancelRunout(){}, interruptRunout(){ return false; }, clearToRest(){} },
});
mock.module(new URL('../../src/shell/put-away.js', import.meta.url).href, {
  namedExports: { shouldPutAway(){ return false; }, putAwayInstant(){}, runPutAwaySequence(){} },
});
// applyDiscVariant/restoreThumbs are real imports from looks.js/thumbs.js
// now (step 6b, reached via the real history/sessions.js the setQueue
// chain below pulls in) — mocked on their own modules so neither's
// further real chain (thumbs.js reaches library/edit.js, which reaches
// library/sealed.js) has to load.
mock.module(new URL('../../src/record-art/looks.js', import.meta.url).href, {
  namedExports: { applyDiscVariant(){} },
});
mock.module(new URL('../../src/library/thumbs.js', import.meta.url).href, {
  namedExports: { restoreThumbs: async () => {} },
});
mock.module(new URL('../../src/player/transport.js', import.meta.url).href, {
  namedExports: { load(){}, play(){}, pause(){}, seek(){}, sideLetterFor(){ return ''; } },
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
// Since step 06 (B3), history/sessions.js's own touchBackupField import is
// a real one from storage/meta.js, which real-chains into audio/mode.js's
// routeSource->audio/engine.js — mocked directly here, same "stop the
// chain at the door" reasoning as every other mock in this file.
mock.module(new URL('../../src/storage/meta.js', import.meta.url).href, {
  namedExports: { queueSave(){}, touchBackupField(){} },
});

const {
  trackHasCreditsContent, openPersonOrArtist, creditRow,
  openCreditsSheet, closeCreditsSheet, updateCreditsButtonForCurrent,
  albumLinerNotes, albumCreditRoll, albumCreditPairs, rebuildPeopleIndex, renderPersonView,
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
  openFriendStoreMock.mock.resetCalls();
  delete globalThis.MizikiSocial;
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

// RF23 (docs/12_REFINE.md, "credits across friends")
test('albumCreditPairs flattens albumCreditRoll into normalized {name, role} pairs', () => {
  const d1 = emptyDetails(); d1.producers = ['Jane Doe'];
  const d2 = emptyDetails(); d2.composers = ['John Roe'];
  resetState({ tracks: [fakeTrack('a', { details: d1 }), fakeTrack('b', { details: d2 })] });
  const pairs = albumCreditPairs('Album');
  assert.deepEqual(pairs.sort((a,b) => a.role.localeCompare(b.role)), [
    { name: normKey('John Roe'), role: 'Composer' },
    { name: normKey('Jane Doe'), role: 'Producer' },
  ]);
});

test('albumCreditPairs returns an empty array for an album with no credits', () => {
  resetState({ tracks: [fakeTrack('a')] });
  assert.deepEqual(albumCreditPairs('Album'), []);
});

test('renderPersonView appends no friends line when signed out / MizikiSocial is absent', async () => {
  const d = emptyDetails(); d.composers = ['Jane Doe'];
  resetState({ tracks: [fakeTrack('a', { details: d })] });
  rebuildPeopleIndex();
  const host = fakeEl();
  renderPersonView(host, 'Jane Doe');
  await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
  const section = host.children.find(c => c.className === 'credit-section');
  assert.ok(section);
  assert.equal(section.children.find(c => c.className === 'credit-friends'), undefined);
});

test('renderPersonView, signed in: appends a friends-line that lists friends on toggle and opens their store on click', async () => {
  const d = emptyDetails(); d.composers = ['Jane Doe'];
  resetState({ tracks: [fakeTrack('a', { details: d })] });
  rebuildPeopleIndex();

  let resolveCredits;
  const creditFriendsCall = [];
  globalThis.MizikiSocial = {
    status(){ return { auth: 'ready' }; },
    creditFriends(name, role){
      creditFriendsCall.push([name, role]);
      return new Promise(res => { resolveCredits = res; });
    },
  };

  const host = fakeEl();
  renderPersonView(host, 'Jane Doe');

  // the role section's own appendChild should have been called with a
  // .credit-friends holder div, synchronously, before the RPC resolves.
  const section = host.children.find(c => c.className === 'credit-section');
  assert.ok(section);

  resolveCredits({
    ok: true,
    items: [
      { user_id: 'u1', handle: 'alice', display_name: 'Alice', title: 'Album One' },
      { user_id: 'u1', handle: 'alice', display_name: 'Alice', title: 'Album Two' },
      { user_id: 'u2', handle: 'bob', display_name: null, title: 'Album Three' },
    ],
  });
  // let the .then() microtask run
  await Promise.resolve(); await Promise.resolve(); await Promise.resolve();

  assert.deepEqual(creditFriendsCall, [[normKey('Jane Doe'), 'Composer']]);

  const holder = section.children.find(c => c.className === 'credit-friends');
  assert.ok(holder);
  const btn = holder.children.find(c => c.className === 'link-btn credit-friends-btn');
  assert.ok(btn);
  assert.match(btn.textContent, /^2 friends have records Jane Doe composer$/);

  const list = holder.children.find(c => c.className === 'credit-friends-list');
  assert.ok(list);
  assert.equal(list.hidden, true);
  btn._click();
  assert.equal(list.hidden, false);

  // Alice (2 releases) sorts before Bob (1 release, falls back to handle
  // since display_name was null)
  const liLinks = list.children.map(li => li.children[0]);
  assert.equal(liLinks[0].textContent, 'Alice (2)');
  assert.equal(liLinks[1].textContent, 'bob');

  liLinks[1]._click();
  assert.equal(openFriendStoreMock.mock.calls.length, 1);
  assert.equal(openFriendStoreMock.mock.calls[0].arguments[0], 'bob');
});

test('renderPersonView, signed in but no friends: the holder stays empty (no button/list)', async () => {
  const d = emptyDetails(); d.composers = ['Jane Doe'];
  resetState({ tracks: [fakeTrack('a', { details: d })] });
  rebuildPeopleIndex();
  globalThis.MizikiSocial = {
    status(){ return { auth: 'ready' }; },
    creditFriends(){ return Promise.resolve({ ok: true, items: [] }); },
  };
  const host = fakeEl();
  renderPersonView(host, 'Jane Doe');
  await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
  const section = host.children.find(c => c.className === 'credit-section');
  assert.ok(section);
  const holder = section.children.find(c => c.className === 'credit-friends');
  assert.ok(holder); // the holder itself is always built, synchronously
  assert.equal(holder.children.length, 0); // but gets no button/list when there are no friends
});
