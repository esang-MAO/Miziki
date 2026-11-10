import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

// PRESSING_DRAW (docs/31_PRESSINGS_AND_LOOKS.md, PR B): record-art/looks.js
// imports history/sessions.js for persistAlbumLookPref() -- real
// sessions.js imports looks.js right back (a real, established circular
// pair, see tiers.js's own header comment) plus library/thumbs.js's wide
// chain, neither of which this file's own subject (look selection/
// switching) needs. Mocked flat, the same "stop the chain at the door"
// shape chart-version.test.js already uses for this exact module.
const persistAlbumLookPrefMock = mock.fn();
mock.module(new URL('../../src/history/sessions.js', import.meta.url).href, {
  namedExports: { persistAlbumLookPref: persistAlbumLookPrefMock },
});

// shell/nav-stack.js registers the real history-based layer stack --
// stubbed to a tiny stand-in, the same shape sealed-front.test.js's own
// nav-stack mock uses, so openLookPicker() can run without a real
// browser history/document.
let registeredClose = null;
mock.module(new URL('../../src/shell/nav-stack.js', import.meta.url).href, {
  namedExports: {
    openLayer(_id, onClose){ registeredClose = onClose; },
    closeLayer(){ if(registeredClose){ const fn = registeredClose; registeredClose = null; fn(); } },
  },
});

function fakeEl(){
  const classes = new Set();
  const listeners = {};
  const dataset = {};
  return {
    textContent: '', style: { setProperty(){} }, innerHTML: '', dataset,
    classList: {
      add(...cs){ cs.forEach(c => classes.add(c)); },
      remove(...cs){ cs.forEach(c => classes.delete(c)); },
      toggle(c, on){ if(on) classes.add(c); else classes.delete(c); },
      contains(c){ return classes.has(c); },
    },
    children: [],
    appendChild(child){ this.children.push(child); return child; },
    querySelector(){ return null; },
    setAttribute(){}, getAttribute(){ return null; },
    addEventListener(type, fn){ (listeners[type] = listeners[type] || []).push(fn); },
    fire(type, evt){ (listeners[type] || []).slice().forEach(fn => fn(evt || {})); },
  };
}
const elCache = new Map();
mock.module(new URL('../../src/util/dom.js', import.meta.url).href, {
  namedExports: {
    $(sel){ if(!elCache.has(sel)) elCache.set(sel, fakeEl()); return elCache.get(sel); },
    el(tag, cls, text){ const e = fakeEl(); e.tagName = tag; if(cls) e.className = cls; if(text !== undefined) e.textContent = text; return e; },
  },
});

const {
  hasLookChoice, discLook, discLookDisplayName, openLookPicker, resolveLook,
} = await import('../../src/record-art/looks.js');
const { S } = await import('../../src/state.js');
const { albumKey } = await import('../../src/record-art/tiers.js');

function hiResTrack(id, album){ return { id, meta: { lossless: true, bits: 24, rate: 96000 }, tags: { album, artist: 'Artist', title: 'Title ' + id }, art: null }; }

function resetState(overrides){
  elCache.clear();
  registeredClose = null;
  persistAlbumLookPrefMock.mock.resetCalls();
  Object.assign(S, {
    tracks: [], collection: {}, zoetropesEnabled: true, zoetropeUnlocked: {},
    rareUnlocked: {}, mergedStats: undefined, metalEligibleSessions: {}, trackMetalEligiblePlays: {},
    albumLookPref: {}, index: -1,
  }, overrides);
}

test('hasLookChoice: false for an album with only its own pressing', () => {
  resetState({ tracks: [hiResTrack(1, 'Plain Album')] });
  assert.equal(hasLookChoice(S.tracks[0]), false);
});

test('hasLookChoice: true once a rare is earned', () => {
  const t = hiResTrack(1, 'Rare Album');
  t.art = 'data:image/png;base64,x';
  resetState({ tracks: [t], rareUnlocked: { [albumKey(t)]: true } });
  assert.equal(hasLookChoice(t), true);
});

test('hasLookChoice: ignores an earned zoetrope when S.zoetropesEnabled is false', () => {
  const t = hiResTrack(1, 'Zoetrope Album');
  resetState({ tracks: [t], zoetropesEnabled: false, zoetropeUnlocked: { [albumKey(t)]: true } });
  assert.equal(hasLookChoice(t), false);
});

test('hasLookChoice: true once a zoetrope is earned and zoetropes are enabled', () => {
  const t = hiResTrack(1, 'Zoetrope Album 2');
  resetState({ tracks: [t], zoetropesEnabled: true, zoetropeUnlocked: { [albumKey(t)]: true } });
  assert.equal(hasLookChoice(t), true);
});

// PRESSING_DRAW (PR B.3.1 point 5): availableLooks()/buildLookOptionContent()/
// discLook() now check the album's own metal (albumMetalFor, qualifying
// sessions) before a specific track's (trackMetalFor, that track's own
// lifetime play count) -- two disjoint ladders (metals.js's own header
// comment). The gatefold always opens the picker with the album's first
// track; the full player opens it with whichever track is actually
// playing. Before this order swap, those two entry points could name a
// different metal for the very same album; now the album-level metal
// always wins when one exists, so the gatefold and the player agree.
test('a metal earned on one specific track no longer out-ranks the album\'s own metal -- the gatefold (first track) and the player (any track) now agree', async () => {
  const first = hiResTrack(1, 'Metal Album');
  const second = hiResTrack(2, 'Metal Album');
  const { trackIdentityKey } = await import('../../src/record-art/tiers.js');
  resetState({
    tracks: [first, second],
    metalEligibleSessions: { [albumKey(first)]: 15 }, // silver, album-level
  });
  S.trackMetalEligiblePlays[trackIdentityKey(second)] = 250; // platinum, track-level, second track only
  const viaFirstTrack = discLook(first, 'metal');
  const viaSecondTrack = discLook(second, 'metal');
  assert.equal(viaFirstTrack.metal, 'silver');
  assert.equal(viaSecondTrack.metal, 'silver', 'the album\'s own metal wins even when asked via the track that separately earned a track-level metal');
});

test('discLook(t, "metal") (forced) returns the metal look without writing S.albumLookPref', async () => {
  const t = hiResTrack(1, 'Forced Metal Album');
  const { trackIdentityKey } = await import('../../src/record-art/tiers.js');
  resetState({ tracks: [t] });
  S.trackMetalEligiblePlays[trackIdentityKey(t)] = 125;
  const d = discLook(t, 'metal');
  assert.equal(d.look, 'metal');
  assert.equal(d.metal, 'gold');
  assert.deepEqual(S.albumLookPref, {}, 'a forced preview must never write a saved preference');
});

// UN11 (docs/36_UNIFORMITY.md point 2): the player's own line-two look
// name -- "Gold" for a metal, a variant's own name for rare, "Zoetrope"
// for a zoetrope, and null for the ordinary default (never announced as
// "a look" of its own).
test('discLookDisplayName: a metal capitalizes its lowercase name', () => {
  const t = hiResTrack(1, 'Metal Name Album');
  resetState({ tracks: [t] });
  const d = discLook(t, 'metal');
  d.metal = 'gold';
  assert.equal(discLookDisplayName(d), 'Gold');
});

test('discLookDisplayName: zoetrope and the ordinary default', () => {
  assert.equal(discLookDisplayName({ look: 'zoetrope' }), 'Zoetrope');
  assert.equal(discLookDisplayName({ look: 'variant' }), null);
  assert.equal(discLookDisplayName(null), null);
});

test('resolveLook: forceLook short-circuits the saved-preference/precedence logic entirely', () => {
  const t = hiResTrack(1, 'Any Album');
  resetState({ tracks: [t] });
  assert.equal(resolveLook(t, 'variant'), 'variant');
});

// PRESSING_DRAW (PR B.3.1 points 1/3): picking from the gatefold -- a
// track other than current() -- writes S.albumLookPref for that album,
// touches the backup key (persistAlbumLookPref), and calls onPicked.
test('picking a look writes S.albumLookPref[albumId], touches the backup key, and calls onPicked', () => {
  const t = hiResTrack(1, 'Pick Me Album');
  const albumId = albumKey(t);
  resetState({
    tracks: [t],
    rareUnlocked: { [albumId]: true },
  });
  t.art = 'data:image/png;base64,x';
  let picked = null;
  openLookPicker(t, { onPicked: kind => { picked = kind; } });
  const host = elCache.get('#lookOptions');
  // the rare option's button is among the host's appended children --
  // find it by which one isn't 'ghost' isn't guaranteed (rare may not be
  // the resolved default), so click the first option that isn't the
  // lossy-hint <p> and assert the resulting pref is one of the real looks.
  const optionButtons = host.children.filter(c => c.tagName === 'button');
  assert.ok(optionButtons.length >= 2, 'rare + variant should both be offered');
  optionButtons[0].fire('click');
  assert.ok(['rare', 'variant'].includes(S.albumLookPref[albumId]));
  assert.equal(persistAlbumLookPrefMock.mock.calls.length, 1);
  assert.equal(persistAlbumLookPrefMock.mock.calls[0].arguments[0], albumId);
  assert.equal(picked, S.albumLookPref[albumId]);
});

test('discLook() reflects the picked look afterwards, for the same album', () => {
  const t = hiResTrack(1, 'Reflect Album');
  const albumId = albumKey(t);
  resetState({ tracks: [t] });
  S.albumLookPref[albumId] = 'variant';
  const before = discLook(t);
  assert.equal(before.look, 'variant');
});
