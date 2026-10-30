// src/profile/records.js — the profile's Records section (ten records, a
// disc peeking out of any sleeve with an unlocked pressing or metal) and
// the Records screen (All / Pressings). The DOM is a tiny stub; the rest of
// the profile cluster (storefront.js, screens.js) and the modules that
// would pull in a browser (thumbs, peek, achievements) are stopped at the
// door, the same way tests/unit/profile.test.js does it.
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

function fakeEl(){
  const children = [];
  const attrs = {};
  const listeners = {};
  const node = {
    style: {}, dataset: {}, className: '', textContent: '',
    appendChild(child){ children.push(child); return child; },
    get childNodes(){ return children; },
    get children(){ return children; },
    setAttribute(k, v){ attrs[k] = String(v); },
    getAttribute(k){ return k in attrs ? attrs[k] : null; },
    addEventListener(type, fn){ listeners[type] = fn; },
    click(){ if(listeners.click) listeners.click(); },
  };
  return node;
}
function el(tag, cls, text){ const e = fakeEl(); e.tag = tag; if(cls) e.className = cls; if(text !== undefined) e.textContent = text; return e; }
globalThis.document = { createElement(tag){ const e = fakeEl(); e.tag = tag; return e; } };

mock.module(new URL('../../src/util/dom.js', import.meta.url).href, {
  namedExports: { el, $(){ return fakeEl(); } },
});
let mockAchievements = [];
mock.module(new URL('../../src/history/achievements.js', import.meta.url).href, {
  namedExports: {
    achievementsList(){ return mockAchievements; },
    ownedPressingIds(){ return new Set(); },
    ownedRarePressingIds(){ return new Set(); },
    ownedZoetropePressingIds(){ return new Set(); },
  },
});
const thumbURL = {};
mock.module(new URL('../../src/library/thumbs.js', import.meta.url).href, {
  namedExports: { thumbURL },
});
mock.module(new URL('../../src/record-art/peek.js', import.meta.url).href, {
  namedExports: { peekBackgroundFor(){ return 'RARE-LOOK'; } },
});
const pressingCardCalls = [];
mock.module(new URL('../../src/profile/storefront.js', import.meta.url).href, {
  namedExports: { renderPressingCard(owned, opts){ pressingCardCalls.push(opts); return el('div','pressing-card'); } },
});
let renderProfileCalls = 0;
mock.module(new URL('../../src/profile/screens.js', import.meta.url).href, {
  namedExports: { renderProfile(){ renderProfileCalls++; } },
});
// SH1 (docs/18_SHARE.md): records.js's own new Pressings-screen Share
// button imports openShareSheet from share/sheet.js, which would otherwise
// reach the real share composer chain — stopped at the door here too.
const openShareSheetCalls = [];
mock.module(new URL('../../src/share/sheet.js', import.meta.url).href, {
  namedExports: { openShareSheet(opts){ openShareSheetCalls.push(opts); } },
});

const { S } = await import('../../src/state.js');
const { albumKey, getVariantDef, variantBackground } = await import('../../src/record-art/tiers.js');
const { metalBackground } = await import('../../src/record-art/metals.js');
const R = await import('../../src/profile/records.js');

function track(album, artist, extra = {}){
  return {id: album + '|' + artist, art: null, tags: {title: 't', artist, album, albumArtist: artist, track: 1, disc: 1}, ...extra};
}
function reset(){
  S.tracks = []; S.achievements = {}; S.collection = {}; mockAchievements = [];
  Object.keys(thumbURL).forEach(k => delete thumbURL[k]);
  S.profileView = {screen: 'home', recordsFilter: 'all'};
}
function walk(node, out = []){ out.push(node); (node.childNodes || []).forEach(c => walk(c, out)); return out; }
const byClass = (root, cls) => walk(root).filter(n => (' ' + n.className + ' ').includes(' ' + cls + ' '));

test('earnedFor: nothing unlocked is null', () => {
  reset();
  assert.equal(R.earnedFor('x'), null);
});

test('earnedFor: an unlocked pressing gives its own disc and catalogue name', () => {
  reset();
  S.collection.a = {albumId: 'a', variant: 'oxblood', pattern: 'solid', name: 'Album A'};
  const e = R.earnedFor('a');
  assert.equal(e.kind, 'pressing');
  assert.equal(e.label, 'Oxblood');
  assert.equal(e.bg, variantBackground(getVariantDef('oxblood')));
});

test('earnedFor: a metal outranks the pressing (rare > metal > pressing, like the platter)', () => {
  reset();
  S.collection.a = {albumId: 'a', variant: 'oxblood', pattern: 'solid', name: 'Album A'};
  S.achievements.a = {albumId: 'a', tier: 'gold'};
  const e = R.earnedFor('a');
  assert.equal(e.kind, 'metal');
  assert.equal(e.label, 'Gold');
  assert.equal(e.bg, metalBackground('gold'));
});

test('metalDisc: a rare uses the album\'s own look when its track is in the library, a fallback when not', () => {
  reset();
  const t = track('Rare One', 'X');
  S.tracks = [t];
  assert.equal(R.metalDisc({albumId: albumKey(t), tier: 'rare'}), 'RARE-LOOK');
  assert.match(R.metalDisc({albumId: 'gone', tier: 'rare'}), /gradient/);
});

test('recordLetter: plain letters, accents folded, everything else is #', () => {
  assert.equal(R.recordLetter('abbey road'), 'A');
  assert.equal(R.recordLetter('Élan'), 'E');
  assert.equal(R.recordLetter('"Heroes"'), 'H');
  assert.equal(R.recordLetter('1989'), '#');
  assert.equal(R.recordLetter(''), '#');
});

test('recordsCountLine (QC1): just the record count, singular/plural — no pressing/metal totals', () => {
  assert.equal(R.recordsCountLine(1), '1 record');
  assert.equal(R.recordsCountLine(212), '212 records');
});

test('reachedMetals (QC1): one entry per tier reached, highest tier last, nothing for tiers not reached', () => {
  mockAchievements = [
    {albumId: 'a', tier: 'silver', name: 'A', artist: '', updatedAt: 1},
    {albumId: 'b', tier: 'bronze', name: 'B', artist: '', updatedAt: 2},
    {albumId: 'c', tier: 'silver', name: 'C', artist: '', updatedAt: 3},
  ];
  const metals = R.reachedMetals();
  assert.deepEqual(metals.map(m => m.tier), ['bronze', 'silver']);
  assert.deepEqual(metals.map(m => m.label), ['Bronze', 'Silver']);
  mockAchievements = [];
  assert.deepEqual(R.reachedMetals(), []);
});

test('libraryRecords: one entry per album, A-Z, preferring the album thumbnail over embedded art', () => {
  reset();
  const b = track('Bravo', 'Y', {art: 'blob:bravo'});
  const a1 = track('Alpha', 'X'), a2 = {...track('Alpha', 'X'), id: 'second'};
  S.tracks = [b, a1, a2];
  thumbURL['album:' + albumKey(b)] = 'blob:thumb-bravo';
  const recs = R.libraryRecords();
  assert.deepEqual(recs.map(r => r.name), ['Alpha', 'Bravo']);
  assert.equal(recs[1].art, 'blob:thumb-bravo');
  assert.equal(recs[0].art, null);
});

test('storeRecordsSection: ten records, discs only where something is unlocked, and a Show all button past ten', () => {
  reset();
  const names = 'ABCDEFGHIJKL'.split('').map(c => c + ' album');
  S.tracks = names.map(n => track(n, 'Artist'));
  const first = albumKey(S.tracks[0]);
  S.collection[first] = {albumId: first, variant: 'woad-madder', pattern: 'swirl', name: 'A album'};
  const section = R.storeRecordsSection();
  const grid = byClass(section, 'records-grid')[0];
  assert.equal(grid.childNodes.length, R.RECORDS_PREVIEW_COUNT);
  assert.equal(byClass(grid, 'rec-disc').length, 1);
  assert.equal(byClass(section, 'store-records-note').length, 1);
  const more = byClass(section, 'store-records-more')[0];
  assert.match(more.textContent, /12 records/);
  more.click();
  assert.equal(S.profileView.screen, 'records');
  assert.equal(S.profileView.recordsFilter, 'all');
});

test('storeRecordsSection: no Show all button or note with ten or fewer records and nothing unlocked', () => {
  reset();
  S.tracks = [track('Only', 'One')];
  const section = R.storeRecordsSection();
  assert.equal(byClass(section, 'store-records-more').length, 0);
  assert.equal(byClass(section, 'store-records-note').length, 0);
  const row = byClass(section, 'store-records-pressings')[0];
  row.click();
  assert.equal(S.profileView.recordsFilter, 'pressings');
});

test('renderRecordsScreen(all): letter heads group the records', () => {
  reset();
  S.tracks = [track('Alpha', 'X'), track('Apple', 'X'), track('Bravo', 'Y')];
  const body = fakeEl();
  R.renderRecordsScreen(body);
  const letters = byClass(body, 'records-letter').map(n => n.textContent);
  assert.deepEqual(letters, ['A', 'B']);
  assert.equal(byClass(body, 'rec-cell').length, 3);
});

test('renderRecordsScreen(pressings): the chart, then Colors, Effects and Metals groups', () => {
  reset();
  pressingCardCalls.length = 0;
  S.profileView.recordsFilter = 'pressings';
  S.collection.a = {albumId: 'a', variant: 'oxblood', pattern: 'solid', name: 'A', artist: ''};
  S.collection.b = {albumId: 'b', variant: 'woad-madder', pattern: 'swirl', name: 'B', artist: ''};
  mockAchievements = [{albumId: 'c', tier: 'silver', name: 'C', artist: ''}];
  const body = fakeEl();
  R.renderRecordsScreen(body);
  assert.equal(pressingCardCalls.length, 1);
  assert.equal(pressingCardCalls[0].interactive, true);
  assert.deepEqual(pressingCardCalls[0].metals.map(m => m.tier), ['silver']);
  const heads = byClass(body, 'records-group-head').map(h => h.childNodes[0].textContent);
  assert.deepEqual(heads, ['Colors', 'Effects', 'Metals']);
  assert.equal(byClass(body, 'pulled').length, 3);
});

test('renderRecordsScreen(pressings): empty state when nothing is unlocked', () => {
  reset();
  S.profileView.recordsFilter = 'pressings';
  const body = fakeEl();
  R.renderRecordsScreen(body);
  const empty = byClass(body, 'profile-empty')[0];
  assert.ok(empty);
  assert.equal(empty.childNodes[0].textContent, 'Pressings and metals show up here as you listen.');
  assert.equal(byClass(body, 'records-group-head').length, 0);
});

test('renderRecordsScreen: tapping the other tab switches the filter and re-renders', () => {
  reset();
  renderProfileCalls = 0;
  const body = fakeEl();
  R.renderRecordsScreen(body);
  const tabs = byClass(body, 'records-tabs')[0].childNodes;
  assert.equal(tabs[0].getAttribute('aria-selected'), 'true');
  tabs[1].click();
  assert.equal(S.profileView.recordsFilter, 'pressings');
  assert.equal(renderProfileCalls, 1);
});
