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
// TR2 (docs/19_PLAYER.md): legal-links.js's legalLinksRow() calls the real
// document.createTextNode directly (not through util/dom.js's el()) --
// stubbed alongside createElement now that this file real-loads it.
globalThis.document = { createElement(){ return fakeEl(); }, createTextNode(text){ return { nodeType: 3, textContent: text }; } };

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
// The Records section/screen (records.js) has its own coverage in
// tests/unit/records.test.js — stopped at the door here like storefront.js.
const recordsCalls = [];
mock.module(new URL('../../src/profile/records.js', import.meta.url).href, {
  namedExports: {
    renderRecordsScreen(host){ recordsCalls.push({host, filter: S.profileView.recordsFilter}); },
    storeRecordsSection(){ return el('div','records-marker'); },
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
  namedExports: { renderPrivacyScreen(){} },
});
mock.module(new URL('../../src/profile/legal.js', import.meta.url).href, {
  namedExports: { renderPrivacyPolicyScreen(){}, renderTermsScreen(){} },
});
// TR2 (docs/19_PLAYER.md): wirePrivacyLink/legalLinksRow moved to their own
// tiny, DOM-free-enough leaves (profile/privacy-link.js, profile/
// legal-links.js) -- real-loaded here, like player/eq-label.js elsewhere in
// this suite, rather than mocked, since neither pulls in anything wide.
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
    // QC2 (docs/24_QUIET_COUNTS.md): the Season share card's windowed
    // top-albums pick — this file's own tests only care that the share
    // button exists and wires to openShareSheet, not what it's built from.
    topAlbumsInWindow(){ return []; },
    // FS8 (docs/25_FROM_SCRATCH.md): the Season card's "N records"
    // header figure — same posture as topAlbumsInWindow's own mock above.
    recordsInWindowCount(){ return 0; },
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
  namedExports: { setTheme(){}, setLargerText(){}, setSeasonalSky(){}, setShowWear(){}, isDaylightPhase(){ return false; } },
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
// AU6 (docs/16_AUDIO.md §3): screens.js's EQ-settings row. TR2
// (docs/19_PLAYER.md) split eqStateLabel() into the tiny, DOM-free
// player/eq-label.js (loaded for real -- no wide chain to stop at the
// door) and moved openEqSheet() behind a click-time dynamic import, so
// eq-sheet.js itself -- whose real audio/engine.js import would reach
// sundown/location.js's real computeSun/drawSun chain, the same wide web
// this file already stops at the door above -- is only mocked here in
// case a test ever exercises that click path.
mock.module(new URL('../../src/player/eq-sheet.js', import.meta.url).href, {
  namedExports: { openEqSheet(){} },
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

const { renderProfile, refreshProfileHome } = await import('../../src/profile/screens.js');
const { fmtCount } = await import('../../src/util/text.js');
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
  // TR2 (docs/19_PLAYER.md): wirePrivacyLink (now real-loaded from the tiny
  // profile/privacy-link.js leaf, not mocked away) appends its own Privacy
  // button to #profileBody alongside the storefrontHost.
  assert.equal(profileHosts['#profileBody'].children.length, 2, 'the storefrontHost plus the Privacy button');
});

test('renderProfile({refresh:true}) while already on home never wipes #profileBody -- same host, re-painted', () => {
  resetProfileState();
  renderProfile();
  const [storefrontHost] = profileHosts['#profileBody'].children;
  renderProfile({ refresh: true });
  assert.equal(storefrontCalls.length, 2, 'renderStorefrontSection ran again, to pick up fresh data');
  assert.equal(profileHosts['#profileBody'].children.length, 2, 'no new top-level host was appended');
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

// The pressing chart and Collection moved off Listening onto the Records
// screen (records.js), so a wholly new profile's Listening screen is just
// the one consolidated card even when the library has owned pressings.
test('renderProfile(listening): the pressing chart no longer shows on Listening', () => {
  resetProfileState();
  mockTopAlbums = []; mockTopTracks = []; mockAchievements = []; S.collection = {};
  mockOwnedPressingIds = new Set(['oxblood']);
  S.profileView.screen = 'listening';
  renderProfile();
  const wrap = profileHosts['#profileBody'].children[0];
  assert.equal(wrap.childNodes.length, 1, 'just the consolidated empty card');
  mockOwnedPressingIds = new Set();
});

test('renderProfile(collection): the old Collection route opens Records on its Pressings tab', () => {
  resetProfileState();
  recordsCalls.length = 0;
  S.profileView.screen = 'collection';
  S.profileView.recordsFilter = 'all';
  renderProfile();
  assert.equal(recordsCalls.length, 1);
  assert.equal(recordsCalls[0].filter, 'pressings');
  assert.equal(S.profileView.screen, 'records');
  S.profileView.screen = 'home';
});

test('renderProfile(records): renders the Records screen', () => {
  resetProfileState();
  recordsCalls.length = 0;
  S.profileView.screen = 'records';
  renderProfile();
  assert.equal(recordsCalls.length, 1);
  S.profileView.screen = 'home';
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
