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
  const node = {
    className: '', textContent: '', style: {}, src: '', alt: '',
    appendChild(child){ children.push(child); return child; },
    get childNodes(){ return children; },
    // NV4's own renderProfile() builds real back/link buttons (addEventListener)
    // outside of badges.js's own narrower needs — harmless no-ops here, since
    // no test in this file ever fires a click.
    addEventListener(){},
    classList: { add(){}, contains(){ return false; }, toggle(){}, remove(){} },
  };
  Object.defineProperty(node, 'innerHTML', {
    get(){ return children.length ? '…' : ''; },
    set(v){ if(v === '') children.length = 0; },
  });
  return node;
}
function el(tag, cls, text){ const e = fakeEl(); if(cls) e.className = cls; if(text !== undefined) e.textContent = text; return e; }
mock.module(new URL('../../src/util/dom.js', import.meta.url).href, {
  namedExports: {
    el,
    $(sel){ return profileHosts[sel] || fakeEl(); },
  },
});
globalThis.document = { createElement(){ return fakeEl(); } };

// NV4 (docs/11_SMOOTH_NAVIGATION.md): renderProfile()/renderProfileHome()'s
// own "build once, refresh in place" claim needs #profileCrumb/#profileBody
// to be the *same* stable elements across calls within one test, unlike the
// badges-only tests above which never cared — a small by-selector map, not
// a new element every call.
function fakeHostEl(){
  const children = [];
  const node = {
    style: {}, dataset: {},
    appendChild(child){ children.push(child); child.parent = node; return child; },
    get childNodes(){ return children; },
    get children(){ return children; },
  };
  Object.defineProperty(node, 'innerHTML', {
    get(){ return children.length ? '…' : ''; },
    set(v){ if(v === '') children.length = 0; },
  });
  return node;
}
const profileHosts = { '#profileCrumb': fakeHostEl(), '#profileBody': fakeHostEl() };
function resetProfileHosts(){
  Object.values(profileHosts).forEach(h => { h.innerHTML = ''; });
}

// fmtCount lives in src/profile/screens.js, which also exports the real
// profile screens — those pull in profile/storefront.js, profile/
// settings.js, share/sheet.js and history/achievements.js, each of which
// would in turn need MizikiSocial/a real document/the rest of the player
// chain. Mocked directly here, same "stop the chain at the door" reasoning
// every other test file in this suite already uses, since this file only
// wants fmtCount itself.
// NV4: tracked (not a bare no-op) so a test can tell whether
// renderProfile({refresh:true}) actually reused the same storefront/rhythm
// hosts across calls versus tearing them down and rebuilding fresh ones —
// each call records the exact host object it was given.
const storefrontCalls = [];
const rhythmCalls = [];
mock.module(new URL('../../src/profile/storefront.js', import.meta.url).href, {
  namedExports: {
    renderStorefrontSection(host){ storefrontCalls.push(host); host.appendChild(el('span','storefront-marker')); },
    STORE_TIER_LABEL: {}, localAlbumArt(){ return null; }, renderStoreError(){},
    storeSwitch(){}, timeAgoShort(){ return ''; },
    // CR11 point 3: renderPressingCard itself has its own test coverage
    // (tests/unit/pressings.test.js) — mocked here the same "stop the
    // chain at the door" way as every other storefront.js export this
    // file doesn't exercise. Returns a real element each call so the
    // wholly-new-profile test below can tell it apart from the empty card.
    renderPressingCard(){ return el('div','pressing-card-marker'); },
  },
});
mock.module(new URL('../../src/profile/rhythm-card.js', import.meta.url).href, {
  namedExports: {
    renderRhythmCard(host){ rhythmCalls.push(host); },
  },
});
mock.module(new URL('../../src/profile/settings.js', import.meta.url).href, {
  namedExports: { renderSocialSettingsScreen(){} },
});
mock.module(new URL('../../src/profile/privacy.js', import.meta.url).href, {
  namedExports: { renderPrivacyScreen(){}, wirePrivacyLink(){} },
});
mock.module(new URL('../../src/profile/legal.js', import.meta.url).href, {
  namedExports: { renderPrivacyPolicyScreen(){}, renderTermsScreen(){}, legalLinksRow(){ return fakeEl(); } },
});
mock.module(new URL('../../src/sync/backup.js', import.meta.url).href, {
  namedExports: { queueAvatarUpload(){} },
});
mock.module(new URL('../../src/share/sheet.js', import.meta.url).href, {
  namedExports: { openShareSheet(){} },
});
// Mutable per-test so the renderListeningScreen() tests below can exercise
// both its empty-profile branch (RF11 point 2) and its ordinary one without
// a second mock.module registration (node:test doesn't support re-mocking
// mid-file).
let mockTopAlbums = [], mockTopTracks = [], mockAchievements = [], mockOwnedPressingIds = new Set();
mock.module(new URL('../../src/history/achievements.js', import.meta.url).href, {
  namedExports: {
    topAlbums(){ return mockTopAlbums; }, topTracks(){ return mockTopTracks; }, achievementsList(){ return mockAchievements; },
    crateFilled(){ return false; }, collectionGroups(){ return {}; },
    // CR11 point 3: ownedPressingIds() has its own coverage in
    // tests/unit/pressings.test.js — mocked here since this file's own
    // renderListeningScreen() tests only care that the card gets built,
    // not what set it was built from. Mutable so the wholly-new-profile
    // test below can exercise the one case where a pressing chart shows
    // even though every play-driven stat is empty.
    ownedPressingIds(){ return mockOwnedPressingIds; },
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
// CEREMONY §6: screens.js's Slipmat row; its real module reaches
// storage/meta.js's wide chain, so it stops at the door like the rest.
mock.module(new URL('../../src/profile/slipmat-editor.js', import.meta.url).href, {
  namedExports: { renderSlipmatRow(){} },
});
// DA4 added isDaylightPhase, screens.js's own Nychthemeron-caption-text
// helper's one call into theme.js -- same mock, one more name.
mock.module(new URL('../../src/ui/theme.js', import.meta.url).href, {
  namedExports: { setTheme(){}, isDaylightPhase(){ return false; } },
});
// PR7 (DAY_ARC_BRIEF.md) swapped screens.js's own Nychthemeron-caption
// helper from solar.js's currentDayPosition() to nowClock() + arc.js's
// phaseAt() -- sundown/solar.js is itself DOM-free (and already
// real-loaded elsewhere in this suite with no mock needed), but mocked
// here anyway for the same "stop the chain at the door" reasoning, since
// this file's own fakeEl()/document stubs have no reason to also support
// whatever a real solar.js/day.js call site might eventually need from a
// document.
mock.module(new URL('../../src/sundown/solar.js', import.meta.url).href, {
  namedExports: { nowClock(){ return new Date(); } },
});
mock.module(new URL('../../src/sundown/arc.js', import.meta.url).href, {
  namedExports: { phaseAt(){ return 'day'; } },
});
// Since step 7b, screens.js's refreshLibraryTools import is a real one from
// src/shell/header.js instead of main.js — mocked there directly instead.
mock.module(new URL('../../src/shell/header.js', import.meta.url).href, {
  namedExports: { refreshLibraryTools(){} },
});
// RF26 (docs/12_REFINE.md): the new Settings › Sundown row's own import —
// the real shell/sundown-sheet.js reaches shell/routes.js, which reaches
// social/screens/home.js for real, which reaches friend-store.js, which
// reaches this file's own rhythm-card.js mock above (missing
// renderSharedRhythmCard, since nothing in this file needs it) — stopped
// at the door the same way every other wide chain in this suite is.
mock.module(new URL('../../src/shell/sundown-sheet.js', import.meta.url).href, {
  namedExports: { openSundownSheet(){} },
});

const { fmtCount, renderProfile, refreshProfileHome } = await import('../../src/profile/screens.js');
const { S } = await import('../../src/state.js');
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

// --- NV4 (docs/11_SMOOTH_NAVIGATION.md): renderProfile/refreshProfileHome's
// own "build once, refresh in place" claim for the Profile home screen ----

function resetProfileState(){
  resetProfileHosts();
  storefrontCalls.length = 0;
  rhythmCalls.length = 0;
  S.profileView.screen = 'home';
}

// RF11 (docs/12_REFINE.md, "Profile is your crate") moved the rhythm card
// off the home screen onto the new routed Listening sub-screen (reached
// from storeListeningRow(), mocked away above as part of renderStorefrontSection) —
// renderRhythmCard is no longer called from renderProfileHome at all, so
// rhythmCalls stays empty throughout this suite's home-screen tests; only
// the storefront host is tracked here now.
test('renderProfile: a plain call on the home screen builds a fresh storefront host', () => {
  resetProfileState();
  renderProfile();
  assert.equal(storefrontCalls.length, 1);
  assert.equal(rhythmCalls.length, 0, 'the rhythm card lives on the Listening screen now, not home');
  assert.equal(profileHosts['#profileBody'].children.length, 1, 'just the storefrontHost');
});

test('renderProfile({refresh:true}) while already on home never wipes #profileBody -- same host, re-painted', () => {
  resetProfileState();
  renderProfile();
  const [storefrontHost] = profileHosts['#profileBody'].children;
  renderProfile({ refresh: true });
  assert.equal(storefrontCalls.length, 2, 'renderStorefrontSection ran again, to pick up fresh data');
  assert.equal(profileHosts['#profileBody'].children.length, 1, 'no new top-level host was appended');
  assert.equal(profileHosts['#profileBody'].children[0], storefrontHost, 'same storefront host, not torn down');
});

test('refreshProfileHome: is a no-op when a different screen is showing', () => {
  resetProfileState();
  S.profileView.screen = 'topAlbums';
  refreshProfileHome();
  assert.equal(storefrontCalls.length, 0);
});

test('refreshProfileHome: refreshes in place when the home screen is showing', () => {
  resetProfileState();
  renderProfile();
  refreshProfileHome();
  assert.equal(storefrontCalls.length, 2);
});

test('renderProfile: leaving home for another screen and back rebuilds fresh hosts (not stale ones)', () => {
  resetProfileState();
  renderProfile();
  const [firstStorefrontHost] = profileHosts['#profileBody'].children;
  S.profileView.screen = 'topAlbums';
  renderProfile();
  S.profileView.screen = 'home';
  renderProfile();
  const [secondStorefrontHost] = profileHosts['#profileBody'].children;
  assert.notEqual(secondStorefrontHost, firstStorefrontHost, 'a genuine screen change always rebuilds fresh, even back on home');
});

// --- RF11 (docs/12_REFINE.md, "Profile is your crate") point 1/2: the
// Listening sub-screen (formerly renderProfileExtras(), inlined on the
// home screen) and its empty-state consolidation --------------------------

test('renderProfile(listening): a wholly new profile shows one consolidated empty card, not several', () => {
  resetProfileState();
  mockTopAlbums = []; mockTopTracks = []; mockAchievements = []; S.collection = {};
  S.profileView.screen = 'listening';
  renderProfile();
  assert.equal(rhythmCalls.length, 0, 'nothing is rendered past the one empty card for a brand-new profile');
  const body = profileHosts['#profileBody'];
  assert.equal(body.children.length, 1, 'just the one wrap div');
  const wrap = body.children[0];
  assert.equal(wrap.childNodes.length, 1, 'exactly one child -- the consolidated empty card');
  assert.equal(wrap.childNodes[0].className, 'profile-empty profile-empty-first');
});

// CR11 point 3: a pressing is drawn from the library alone (no play
// needed), so it still shows on an otherwise wholly-new profile — the one
// case RF11's "one consolidated empty card" rule above doesn't cover,
// since this isn't a play-driven stat at all.
test('renderProfile(listening): a pressing chart still shows on a wholly new profile when the library has owned pressings', () => {
  resetProfileState();
  mockTopAlbums = []; mockTopTracks = []; mockAchievements = []; S.collection = {};
  mockOwnedPressingIds = new Set(['oxblood']);
  S.profileView.screen = 'listening';
  renderProfile();
  const wrap = profileHosts['#profileBody'].children[0];
  assert.equal(wrap.childNodes.length, 2, 'the empty card, plus the pressing chart');
  assert.equal(wrap.childNodes[0].className, 'profile-empty profile-empty-first');
  mockOwnedPressingIds = new Set();
});

test('renderProfile(listening): once anything exists, the full breakdown (top row, rhythm, achievements, collection, share) renders', () => {
  resetProfileState();
  mockTopAlbums = [{display:{name:'A', artist:'B', art:null}}]; mockTopTracks = []; mockAchievements = []; S.collection = {};
  S.profileView.screen = 'listening';
  renderProfile();
  assert.equal(rhythmCalls.length, 1, 'the rhythm card renders once anything is present, not only a brand-new profile');
  const wrap = profileHosts['#profileBody'].children[0];
  assert.ok(wrap.childNodes.length > 1, 'more than just the empty card once there is something to show');
});
