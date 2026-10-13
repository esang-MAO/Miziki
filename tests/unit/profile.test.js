import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

// src/profile/badges.js's metalBadge/collectionBadge build small DOM trees
// (el()/document.createElement) around otherwise-pure background-color
// helpers (metalBackground/variantBackground, both real here — pure CSS
// string generators, no DOM) — mocked to a tiny stub element, the same
// shape favorites.test.js/queue.test.js already use, rather than pulling
// in a real document.
function fakeEl(){
  const children = [];
  return {
    className: '', textContent: '', style: {}, src: '', alt: '',
    appendChild(child){ children.push(child); return child; },
    get childNodes(){ return children; },
  };
}
mock.module(new URL('../../src/util/dom.js', import.meta.url).href, {
  namedExports: {
    el(tag, cls, text){ const e = fakeEl(); if(cls) e.className = cls; if(text !== undefined) e.textContent = text; return e; },
    $(){ return fakeEl(); },
  },
});
globalThis.document = { createElement(){ return fakeEl(); } };

// fmtCount lives in src/profile/screens.js, which also exports the real
// profile screens — those pull in profile/storefront.js, profile/
// settings.js, share/sheet.js and history/achievements.js, each of which
// would in turn need MizikiSocial/a real document/the rest of the player
// chain. Mocked directly here, same "stop the chain at the door" reasoning
// every other test file in this suite already uses, since this file only
// wants fmtCount itself.
mock.module(new URL('../../src/profile/storefront.js', import.meta.url).href, {
  namedExports: {
    renderStorefrontSection(){}, STORE_TIER_LABEL: {}, localAlbumArt(){ return null; }, renderStoreError(){},
    storeSwitch(){}, timeAgoShort(){ return ''; },
  },
});
mock.module(new URL('../../src/profile/settings.js', import.meta.url).href, {
  namedExports: { renderSocialSettingsScreen(){} },
});
mock.module(new URL('../../src/share/sheet.js', import.meta.url).href, {
  namedExports: { openShareSheet(){} },
});
mock.module(new URL('../../src/history/achievements.js', import.meta.url).href, {
  namedExports: {
    topAlbums(){ return []; }, topTracks(){ return []; }, achievementsList(){ return []; },
    crateFilled(){ return false; }, collectionGroups(){ return {}; },
  },
});
// DA3 (docs/DAY_ARC.md): screens.js's new setTheme import (for the new
// Settings screen's Appearance control) is real, from src/ui/theme.js —
// mocked directly here, same "stop the chain at the door" reasoning as
// every other mock in this file, since the real theme.js's own real
// storage/meta.js import would otherwise reach player/background.js ->
// player/transport.js -> library/view.js's own seven-circular-pair web
// -> shell/header.js -> shell/routes.js -> social/screens/home.js ->
// social/screens/friend-store.js, whose own real storeAwning import
// would then fail against this file's already-narrow storefront.js mock.
mock.module(new URL('../../src/ui/theme.js', import.meta.url).href, {
  namedExports: { setTheme(){} },
});
// Since step 7b, screens.js's refreshLibraryTools import is a real one from
// src/shell/header.js instead of main.js — mocked there directly instead.
mock.module(new URL('../../src/shell/header.js', import.meta.url).href, {
  namedExports: { refreshLibraryTools(){} },
});

const { fmtCount } = await import('../../src/profile/screens.js');
const { metalBadge, collectionBadge } = await import('../../src/profile/badges.js');
const { METAL_COLORS } = await import('../../src/record-art/metals.js');
const { VARIANT_DEFS } = await import('../../src/record-art/tiers.js');

// fmtCount isn't a 999/1.2k-style number abbreviator — the code's actual
// rule is just singular/plural label selection: `n + ' ' + (singular or
// plural word)`. Testing what it really does, per the step 6e prompt's
// own "the code's actual rules" instruction.
test('fmtCount: picks the singular word for exactly 1, the plural word otherwise', () => {
  assert.equal(fmtCount(1, 'session', 'sessions'), '1 session');
  assert.equal(fmtCount(0, 'session', 'sessions'), '0 sessions');
  assert.equal(fmtCount(2, 'session', 'sessions'), '2 sessions');
  assert.equal(fmtCount(999, 'play', 'plays'), '999 plays');
});

test('metalBadge: rare tier with art uses the art as a background image, labeled "Rare"', () => {
  const cell = metalBadge({tier: 'rare', art: 'blob:fake-art'});
  const badge = cell.childNodes[0];
  assert.equal(badge.style.background, 'url("blob:fake-art") center/cover');
  const label = cell.childNodes[1];
  assert.equal(label.textContent, 'Rare');
});

test('metalBadge: rare tier without art falls back to a plain gradient', () => {
  const cell = metalBadge({tier: 'rare', art: null});
  const badge = cell.childNodes[0];
  assert.equal(badge.style.background, 'linear-gradient(155deg,#2A2018,#171310)');
});

test('metalBadge: a metal tier (e.g. gold) uses metalBackground() and a capitalized label', () => {
  const cell = metalBadge({tier: 'gold', art: null});
  const badge = cell.childNodes[0];
  assert.ok(badge.style.background, 'metalBackground(\'gold\') should produce some CSS background value');
  const label = cell.childNodes[1];
  assert.equal(label.textContent, 'Gold');
});

test('metalBadge: a metal tier with art appends an <img> to the badge', () => {
  const cell = metalBadge({tier: 'bronze', art: 'blob:fake-bronze'});
  const badge = cell.childNodes[0];
  assert.equal(badge.childNodes.length, 1);
  assert.equal(badge.childNodes[0].src, 'blob:fake-bronze');
});

test('collectionBadge: uses variantBackground() for the given variant and the record\'s own name as the label', () => {
  const variant = Object.keys(VARIANT_DEFS)[0];
  const cell = collectionBadge({variant, name: 'My Pressing'});
  const badge = cell.childNodes[0];
  assert.ok(badge.style.background, 'variantBackground() should produce some CSS background value');
  const label = cell.childNodes[1];
  assert.equal(label.textContent, 'My Pressing');
});

test('METAL_COLORS/VARIANT_DEFS sanity: every metal tier and variant badges can draw from has a defined entry', () => {
  // not a behavior test of badges.js itself, just confirming the fixture
  // data used above (and the real tables the app ships) stay in sync.
  assert.ok(METAL_COLORS.gold);
  assert.ok(METAL_COLORS.bronze);
  assert.ok(Object.keys(VARIANT_DEFS).length > 0);
});
