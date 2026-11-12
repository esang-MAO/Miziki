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

// CO3 point 3 (docs/37_COLOUR.md, the rich-black Jet tint): resolveRichBlackJet()'s
// own art/colour pipeline (loadImageEl/shareDominantColor/artAnchor) is
// exercised directly in tests/unit/art-color.test.js -- here it's stubbed,
// same shape cube-spine.test.js's own art-color.js mock uses, so these
// tests drive resolveRichBlackJet()'s caching/candidate/fallback logic
// without a real Image/canvas. mixHex is the real implementation,
// reimplemented inline (it's pure and already covered on its own in
// art-color.test.js) since mock.module() replaces every named export.
let artColorBehavior = { dom: { h: 0, s: 0, l: 0 }, anchor: { hex: '#1b3644', name: 'Slate Color' } };
mock.module(new URL('../../src/ui/art-color.js', import.meta.url).href, {
  namedExports: {
    loadImageEl: async () => ({}),
    shareDominantColor: () => artColorBehavior.dom,
    artAnchor: () => artColorBehavior.anchor,
    mixHex(hex, toward, amt){
      const h = s => ({ r: parseInt(s.slice(1,3),16), g: parseInt(s.slice(3,5),16), b: parseInt(s.slice(5,7),16) });
      const a = h(hex), b = h(toward);
      const toHex = v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
      return '#' + toHex(a.r + (b.r-a.r)*amt) + toHex(a.g + (b.g-a.g)*amt) + toHex(a.b + (b.b-a.b)*amt);
    },
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
  isRichBlackCandidate, resolveRichBlackJet,
} = await import('../../src/record-art/looks.js');
const { S } = await import('../../src/state.js');
const { albumKey, selectVariant, getVariantDef, variantBackground } = await import('../../src/record-art/tiers.js');

function hiResTrack(id, album){ return { id, meta: { lossless: true, bits: 24, rate: 96000 }, tags: { album, artist: 'Artist', title: 'Title ' + id }, art: null }; }
// trackTier() (record-art/tiers.js): lossless and over 16-bit/44.1kHz is
// tier 3, lossless at CD quality is tier 2, anything lossy (MP3, etc.) is
// tier 1 -- the only tier that carries the "nothing earned yet" special
// case under test below.
function lossyTrack(id, album){ return { id, meta: { lossless: false }, tags: { album, artist: 'Artist', title: 'Title ' + id }, art: null }; }

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

// Bug (diagnosed during UN18's final sweep): a tier-1 record with exactly
// one earned look (rare/metal/zoetrope) was missing the 'variant' fallback
// -- availableLooks() only pushed it when looks.length === 0, so
// hasLookChoice() (length > 1) wrongly read as "no choice" even though the
// user had genuinely earned one. Zero earned looks must still mean no
// choice (variant-only, unchanged); two-plus earned looks were never
// affected (variant isn't even needed for hasLookChoice to be true there).
test('hasLookChoice: tier-1 record, zero earned looks -- still no choice (regression guard)', () => {
  const t = lossyTrack(1, 'Lossy Plain Album');
  resetState({ tracks: [t] });
  assert.equal(hasLookChoice(t), false);
});

test('hasLookChoice: tier-1 record with exactly one earned look (rare) -- a real choice exists', () => {
  const t = lossyTrack(1, 'Lossy Rare Album');
  t.art = 'data:image/png;base64,x';
  resetState({ tracks: [t], rareUnlocked: { [albumKey(t)]: true } });
  assert.equal(hasLookChoice(t), true, 'variant must be offered alongside the one earned look');
});

test('hasLookChoice: tier-1 record with exactly one earned look (zoetrope) -- a real choice exists', () => {
  const t = lossyTrack(1, 'Lossy Zoetrope Album');
  resetState({ tracks: [t], zoetropeUnlocked: { [albumKey(t)]: true } });
  assert.equal(hasLookChoice(t), true, 'variant must be offered alongside the one earned look');
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

// CO3 (docs/37_COLOUR.md, recommendation 3): a lossless (tier 2) or hi-res
// (tier 3) record that happens to draw Jet is not a lossy file, so the
// picker must not show Jet's own "a lossy file presses the same every
// time" note for it. Brute-forces a synthetic album name whose draw lands
// on Jet at each tier, deterministically (selectVariant() is pure).
function findAlbumDrawingJet(meta){
  for(let i = 0; i < 500; i++){
    const t = { meta, tags: { album: 'JetHunt ' + i, artist: 'Artist', title: 'Title' }, art: null };
    if(selectVariant(t).variant === 'jet') return t;
  }
  return null;
}
function notesIn(children, out = []){
  for(const c of children){
    if(c.className === 'look-option-note') out.push(c.textContent);
    if(c.children && c.children.length) notesIn(c.children, out);
  }
  return out;
}

test('CO3: a tier-2 record that draws Jet shows the lossless note, not the lossy-file hint', () => {
  const t = findAlbumDrawingJet({ lossless: true, bits: 16, rate: 44100 });
  assert.ok(t, 'expected at least one of 500 synthetic tier-2 names to draw Jet');
  resetState({ tracks: [t] });
  openLookPicker(t);
  const notes = notesIn(elCache.get('#lookOptions').children);
  assert.ok(notes.some(n => n.includes('simply drew black')), 'expected the CO3 lossless Jet note');
  assert.ok(!notes.some(n => n.includes('a lossy file presses')), 'the lossy-only note must not appear for a tier-2 record');
});

test('CO3: a tier-3 record that draws Jet shows the lossless note too', () => {
  const t = findAlbumDrawingJet({ lossless: true, bits: 24, rate: 96000 });
  assert.ok(t, 'expected at least one of 500 synthetic tier-3 names to draw Jet');
  resetState({ tracks: [t] });
  openLookPicker(t);
  const notes = notesIn(elCache.get('#lookOptions').children);
  assert.ok(notes.some(n => n.includes('simply drew black')), 'expected the CO3 lossless Jet note');
});

test('CO3: a tier-1 (lossy) record keeps Jet\'s original note and the lossy hint', () => {
  const t = lossyTrack(1, 'Still Lossy Album');
  resetState({ tracks: [t] });
  openLookPicker(t);
  const notes = notesIn(elCache.get('#lookOptions').children);
  assert.ok(notes.some(n => n.includes('a lossy file presses the same every time')), 'tier-1 Jet keeps its original note');
  const hints = elCache.get('#lookOptions').children.filter(c => c.className === 'note look-lossy-hint');
  assert.equal(hints.length, 1, 'tier-1 still shows the separate "a lossless copy would press in colour" hint');
});

// CO3 point 3 (recommendation 9, the deferred rich-black Jet tint):
// isRichBlackCandidate() gates resolveRichBlackJet() to exactly the same
// "lossless Jet, no metal earned" case CO3's own lossless note targets.
test('isRichBlackCandidate(): true only for a lossless (tier 2/3) Jet draw with no metal', () => {
  assert.equal(isRichBlackCandidate({ tier: 2, variant: 'jet', metal: null }), true);
  assert.equal(isRichBlackCandidate({ tier: 3, variant: 'jet', metal: null }), true);
});

test('isRichBlackCandidate(): false for a tier-1 (lossy) Jet draw -- CO3\'s plain-black case', () => {
  assert.equal(isRichBlackCandidate({ tier: 1, variant: 'jet', metal: null }), false);
});

test('isRichBlackCandidate(): false for a zoetrope/rare draw (tier is null)', () => {
  assert.equal(isRichBlackCandidate({ tier: null, variant: 'jet', metal: null }), false);
});

test('isRichBlackCandidate(): false once a metal is earned -- the metal look takes over, never Jet', () => {
  assert.equal(isRichBlackCandidate({ tier: 2, variant: 'jet', metal: 'gold' }), false);
});

test('isRichBlackCandidate(): false for any variant other than jet', () => {
  assert.equal(isRichBlackCandidate({ tier: 2, variant: 'crimson', metal: null }), false);
});

test('isRichBlackCandidate(): false/no-throw for a null discLook() result (no track)', () => {
  assert.equal(isRichBlackCandidate(null), false);
});

test('resolveRichBlackJet(): no art URL -- resolves null, never touches the colour pipeline', async () => {
  assert.equal(await resolveRichBlackJet('no-art-album', null), null);
});

test('resolveRichBlackJet(): a qualifying anchor returns a solid-pattern gradient string, not plain Jet', async () => {
  artColorBehavior = { dom: { h: 28, s: 0.9, l: 0.55 }, anchor: { hex: '#1b3644', name: 'Slate Color' } };
  const bg = await resolveRichBlackJet('rich-black-album-1', 'data:image/png;base64,x');
  assert.ok(bg, 'expected a non-null background');
  assert.ok(bg.startsWith('radial-gradient'), 'solid pattern is a radial-gradient, same as plain Jet');
  assert.notEqual(bg, variantBackground(getVariantDef('jet')), 'the rich-black bg must differ from plain Jet');
});

test('resolveRichBlackJet(): no anchor for this cover (olive/yellow-green) -- falls back to null, plain Jet stays', async () => {
  artColorBehavior = { dom: { h: 115, s: 0.6, l: 0.5 }, anchor: null };
  assert.equal(await resolveRichBlackJet('rich-black-album-2', 'data:image/png;base64,x'), null);
});

test('resolveRichBlackJet(): caches by albumId -- a second call with different art for the same id returns the first result', async () => {
  artColorBehavior = { dom: { h: 28, s: 0.9, l: 0.55 }, anchor: { hex: '#1b3644', name: 'Slate Color' } };
  const first = await resolveRichBlackJet('rich-black-album-3', 'data:image/png;base64,x');
  artColorBehavior = { dom: { h: 115, s: 0.6, l: 0.5 }, anchor: null }; // would resolve null if actually re-run
  const second = await resolveRichBlackJet('rich-black-album-3', 'data:image/png;base64,y');
  assert.equal(second, first, 'the cached result must win over the (different) second call\'s inputs');
});
