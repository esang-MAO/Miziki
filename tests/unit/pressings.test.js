import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

/* ================= CR11: pressings between friends (docs/13_CRATE.md) =================
   renderPressingCard() lives in profile/storefront.js (shared with a
   friend's own chart, social/screens/friend-store.js — see that module's
   own comment on why). Its own chain reaches state.js, util/dom.js,
   record-art/tiers.js (real here, since this file is testing exactly
   that), record-art/metals.js, library/model.js, storage/idb.js,
   profile/screens.js, profile/settings.js, shell/pull-refresh.js,
   shell/routes.js and library/view.js — the last five mocked the same
   "stop the chain at the door" way every other mock-heavy file in this
   suite already does, since none of them are this file's own subject. */

function fakeEl(){
  const kids = [];
  const classes = new Set();
  const attrs = {};
  const listeners = {};
  return {
    tag: null, className: '', textContent: '', style: {},
    kids, attrs,
    classList: {
      add(...cs){ cs.forEach(c => classes.add(c)); },
      remove(...cs){ cs.forEach(c => classes.delete(c)); },
      contains(c){ return classes.has(c); },
    },
    setAttribute(k, v){ attrs[k] = v; },
    getAttribute(k){ return attrs[k] ?? null; },
    removeAttribute(k){ delete attrs[k]; },
    addEventListener(type, fn){ (listeners[type] = listeners[type] || []).push(fn); },
    appendChild(child){ kids.push(child); return child; },
    click(){ (listeners.click || []).forEach(fn => fn()); },
  };
}
function el(tag, cls, text){
  const e = fakeEl();
  e.tag = tag;
  if(cls) e.className = cls;
  if(text !== undefined) e.textContent = text;
  return e;
}
mock.module(new URL('../../src/util/dom.js', import.meta.url).href, {
  namedExports: { $(){ return null; }, el },
});

mock.module(new URL('../../src/storage/idb.js', import.meta.url).href, {
  namedExports: { DB: { ok: false, open: async () => false } },
});
mock.module(new URL('../../src/profile/screens.js', import.meta.url).href, {
  namedExports: { persistProfile: async () => {}, formatDisplayName(){ return ''; }, renderProfile(){} },
});
mock.module(new URL('../../src/profile/settings.js', import.meta.url).href, {
  namedExports: { beginSocialSignIn(){} },
});
const triggerProfileRefreshMock = mock.fn();
mock.module(new URL('../../src/shell/pull-refresh.js', import.meta.url).href, {
  namedExports: { triggerProfileRefresh: triggerProfileRefreshMock },
});
const showRouteMock = mock.fn();
mock.module(new URL('../../src/shell/routes.js', import.meta.url).href, {
  namedExports: { showRoute: showRouteMock },
});
const renderTracksMock = mock.fn();
mock.module(new URL('../../src/library/view.js', import.meta.url).href, {
  namedExports: { renderTracks: renderTracksMock, songRow(){}, groupRow(){} },
});
// history/achievements.js's own real chain (via library/thumbs.js) reaches
// library/edit.js and far beyond it — mocked here the exact same way
// sealed.test.js already does, since ownedPressingIds()'s own dependencies
// stop well short of any of that.
mock.module(new URL('../../src/library/thumbs.js', import.meta.url).href, {
  namedExports: { restoreThumbs: async () => {}, thumbURL: {}, persistable(rec){ return rec; }, pruneThumbs: async () => {} },
});
// SH1 (docs/18_SHARE.md): storefront.js's own pre-existing import of
// records.js (storeRecordsSection) now reaches records.js's new
// openShareSheet import (share/sheet.js), which would otherwise pull in
// the real share composer chain -- stopped at the door here too.
mock.module(new URL('../../src/share/sheet.js', import.meta.url).href, {
  namedExports: { openShareSheet(){} },
});

const { renderPressingCard } = await import('../../src/profile/storefront.js');

// friend-store.js's own pressingLineFor() — point 1's "Both Verdigris" /
// "Yours: X · Friend's: Y" line, exercised against the real
// selectVariantForAlbum via the module's real, exported function rather
// than a re-derivation here. Its own real chain (feedEventText/
// renderSharedRhythmCard/spinPhaseWording/openLayer/closeLayer) is mocked
// the same "stop the chain at the door" way as everything above.
mock.module(new URL('../../src/social/screens/home.js', import.meta.url).href, {
  namedExports: { feedEventText(){ return ''; } },
});
mock.module(new URL('../../src/profile/rhythm-card.js', import.meta.url).href, {
  namedExports: { renderSharedRhythmCard(){} },
});
mock.module(new URL('../../src/sundown/spin-wording.js', import.meta.url).href, {
  namedExports: { spinPhaseWording(){ return null; } },
});
mock.module(new URL('../../src/shell/nav-stack.js', import.meta.url).href, {
  namedExports: { openLayer(){}, closeLayer(){} },
});
const { pressingLineFor } = await import('../../src/social/screens/friend-store.js');
const {
  albumKey, selectVariant, selectVariantForAlbum, selectRareVariant, selectZoetropeVariant, getVariantDef,
  SOLID_IDS, EFFECT_IDS, RARE_IDS, ZOETROPE_IDS, VARIANT_DEFS,
} = await import('../../src/record-art/tiers.js');
const { ownedPressingIds, ownedRarePressingIds, ownedZoetropePressingIds } = await import('../../src/history/achievements.js');
const { S } = await import('../../src/state.js');

function albumTrack(name, meta){ return { meta, tags: { album: name } }; }

/* ---- point 5: "the chart's owned/missing set from a synthetic library" ---- */

test('CR11: ownedPressingIds() reads exactly the owned set from a synthetic library, one per album, Jet excluded', () => {
  S.tracks = [];
  const titles = ['Aurora Fade','Night Terminal','Open Water','Low Tide Radio','Field Recordings','Blue Hour','Static Kin','Paper Moon'];
  // tier 3 (24-bit) draws effect/solid/jet by the documented 25/70/5 mix —
  // enough titles to almost certainly land at least one non-jet pressing,
  // same probabilistic-but-deterministic shape CR7's own "band shares
  // converge" test already uses.
  const expected = new Set();
  titles.forEach(name => {
    const meta = { lossless: true, bits: 24, rate: 96000 };
    S.tracks.push(albumTrack(name, meta));
    S.tracks.push(albumTrack(name, meta)); // a second track in the same album — still one representative draw
    const { variant } = selectVariant(albumTrack(name, meta));
    if(variant !== 'jet') expected.add(variant);
  });
  const owned = ownedPressingIds();
  assert.deepEqual(owned, expected);
  // every id not drawn by any album in the library reads as missing —
  // renderPressingCard's own "owned" check is just ownedIds.has(id)
  for(const id of [...SOLID_IDS, ...EFFECT_IDS]){
    assert.equal(owned.has(id), expected.has(id));
  }
});

test('CR11: ownedPressingIds() is empty for an all-lossy library (every track is Jet)', () => {
  S.tracks = [albumTrack('Lossy One', { lossless: false, bits: 16, rate: 44100 }),
    albumTrack('Lossy Two', { lossless: false, bits: 16, rate: 44100 })];
  assert.deepEqual(ownedPressingIds(), new Set());
});

/* ---- PRESSINGS_110 PR8 (§7): ownedRarePressingIds()/ownedZoetropePressingIds(),
   the chart's own RARE/ZOETROPES columns, gated on the earned flag rather
   than drawn unconditionally ---- */

test('PRESSINGS_110 PR8: ownedRarePressingIds() is empty with nothing unlocked, and draws the real variant once unlocked', () => {
  S.tracks = [albumTrack('Rare Album', { lossless: true, bits: 24, rate: 96000 })];
  S.rareUnlocked = {};
  assert.deepEqual(ownedRarePressingIds(), new Set());
  const id = albumKey(S.tracks[0]);
  S.rareUnlocked = { [id]: true };
  const expected = new Set([selectRareVariant(S.tracks[0])]);
  assert.deepEqual(ownedRarePressingIds(), expected);
});

test('PRESSINGS_110 PR8: ownedZoetropePressingIds() needs both the per-album unlock and the Settings toggle on', () => {
  S.tracks = [albumTrack('Zoetrope Album', { lossless: true, bits: 24, rate: 96000 })];
  const id = albumKey(S.tracks[0]);
  S.zoetropeUnlocked = { [id]: true };
  S.zoetropesEnabled = false;
  assert.deepEqual(ownedZoetropePressingIds(), new Set(), 'hidden while the Settings toggle is off, even though it was earned');
  S.zoetropesEnabled = true;
  const expected = new Set([selectZoetropeVariant(S.tracks[0])]);
  assert.deepEqual(ownedZoetropePressingIds(), expected);
});

/* ---- renderPressingCard (QC1, docs/24_QUIET_COUNTS.md): owned-only chips,
   grouped by family, interactive vs. chips-only ---- */

function familyRows(card){ return card.kids.filter(k => k.className === 'pressing-family-row'); }
function familyLabel(row){ return row.kids.find(k => k.className === 'pressing-family-label').textContent; }
function familyStrip(row){ return row.kids.find(k => k.className === 'pressing-chip-strip'); }

test('QC1: renderPressingCard draws only owned chips, one row per family that has one, no counts', () => {
  const soloId = SOLID_IDS[0];
  const owned = new Set([soloId]);
  const card = renderPressingCard(owned, { interactive: true });
  assert.equal(card.kids.find(k => k.className === 'pressing-card-count'), undefined);
  assert.equal(card.kids.find(k => k.className === 'pressing-card-missing'), undefined);
  const head = card.kids.find(k => k.className === 'pressing-card-head-row');
  assert.ok(head.kids.some(k => k.className === 'pressing-card-found' && k.textContent === 'found while listening'));
  const rows = familyRows(card);
  assert.deepEqual(rows.map(familyLabel), ['Colors'], 'families with nothing found are omitted entirely');
  const strip = familyStrip(rows[0]);
  assert.equal(strip.kids.length, 1, 'only the owned chip is drawn, never the missing ones');
  const ownedChip = strip.kids[0];
  assert.equal(ownedChip.tag, 'button', 'an owned chip is a real button when interactive');
  assert.ok(ownedChip.className.includes('owned'));
  // tapping it sets the one-shot jump signal and routes to the crate
  S.view = { mode: null, group: 'x', artistAlbum: 'x', playlist: 'x', person: 'x', crateLooseIdx: 1, picking: true };
  S.crate = { pendingJumpVariant: null };
  ownedChip.click();
  assert.equal(S.view.mode, 'crate');
  assert.equal(S.view.group, null);
  assert.equal(S.crate.pendingJumpVariant, soloId);
  assert.equal(showRouteMock.mock.calls.length, 1);
  assert.equal(showRouteMock.mock.calls[0].arguments[0], 'library');
  assert.equal(renderTracksMock.mock.calls.length, 1);
});

test('QC1: renderPressingCard with nothing owned draws no family rows at all', () => {
  const card = renderPressingCard(new Set(), { interactive: true });
  assert.deepEqual(familyRows(card), []);
});

test('QC1: renderPressingCard draws a family row per found family, in family order', () => {
  const owned = new Set([SOLID_IDS[0], EFFECT_IDS[0], RARE_IDS[0]]);
  const card = renderPressingCard(owned, { interactive: true });
  assert.deepEqual(familyRows(card).map(familyLabel), ['Colors', 'Effects', 'Rare']);
});

test('CR11 point 4, QC1: a friend\'s pressing card (interactive:false) renders found chips only — no tap, their unfound pressings never drawn', () => {
  showRouteMock.mock.resetCalls();
  renderTracksMock.mock.resetCalls();
  const soloId = SOLID_IDS[0];
  const card = renderPressingCard(new Set([soloId]), { interactive: false });
  const rows = familyRows(card);
  assert.deepEqual(rows.map(familyLabel), ['Colors']);
  const strip = familyStrip(rows[0]);
  assert.equal(strip.kids.length, 1);
  const ownedChip = strip.kids[0];
  assert.equal(ownedChip.tag, 'div', 'never a button on a friend\'s card, since nothing is tappable');
  ownedChip.click ? ownedChip.click() : null; // no-op either way: no click handler was ever attached
  assert.equal(showRouteMock.mock.calls.length, 0);
  assert.equal(renderTracksMock.mock.calls.length, 0);
});

test('CR11 point 3: a scarce-band chip carries the dot marker', () => {
  const allIds = [...SOLID_IDS, ...EFFECT_IDS, ...RARE_IDS, ...ZOETROPE_IDS];
  const scarceId = allIds.find(id => VARIANT_DEFS[id].band === 'scarce');
  const card = renderPressingCard(new Set([scarceId]), { interactive: false });
  const strip = familyStrip(familyRows(card)[0]);
  assert.ok(strip.kids[0].kids.some(k => k.className === 'pressing-chip-dot'));
});

test('QC1: renderPressingCard draws a Metals row only for tiers reached, none when opts.metals is empty/omitted', () => {
  const owned = new Set([SOLID_IDS[0]]);
  const noMetals = renderPressingCard(owned, { interactive: true });
  assert.equal(noMetals.kids.find(k => k.className === 'pressing-metals'), undefined, 'no Metals row at all with nothing reached');

  const metals = [{ tier: 'bronze', label: 'Bronze', bg: 'BRONZE-BG' }, { tier: 'gold', label: 'Gold', bg: 'GOLD-BG' }];
  const withMetals = renderPressingCard(owned, { interactive: true, metals });
  const block = withMetals.kids.find(k => k.className === 'pressing-metals');
  assert.ok(block);
  const row = block.kids.find(k => k.className === 'pressing-metals-row');
  assert.equal(row.kids.length, 2);
  assert.deepEqual(row.kids.map(cell => cell.kids.find(k => k.className === 'pressing-metal-name').textContent), ['Bronze', 'Gold']);
});

/* ---- point 1: "Both Verdigris" / "Yours: X · Friend's: Y" — same shared
   derivation friend-store.js's own pressingLineFor() uses, exercised here
   directly against selectVariantForAlbum since that function has no DOM
   of its own to mock around. ---- */

test('CR11 point 1: same tier on both sides always draws the same pressing', () => {
  const a = selectVariantForAlbum('Shared Album Title', 2);
  const b = selectVariantForAlbum('Shared Album Title', 2);
  assert.deepEqual(a, b);
});

test('CR11 point 1: selectVariantForAlbum agrees with selectVariant for a real track of the same album+tier', () => {
  const t = albumTrack('Agreement Check', { lossless: true, bits: 24, rate: 96000 });
  assert.deepEqual(selectVariantForAlbum('Agreement Check', 3), selectVariant(t));
});

test('CR11 point 1: a lossy-tier copy always draws Jet regardless of album', () => {
  assert.equal(selectVariantForAlbum('Any Album At All', 1).variant, 'jet');
});

/* ---- point 2: the in-common line, same-tier vs. different-tier ---- */

test('CR11 point 2: same tier on both sides reads "Both <name>"', () => {
  const item = { title: 'Common Ground', my_quality_tier: 2, their_quality_tier: 2 };
  const line = pressingLineFor(item, 'ken');
  const def = getVariantDef(selectVariantForAlbum('Common Ground', 2).variant);
  assert.equal(line, 'Both ' + def.name);
});

test('CR11 point 2: different tiers that happen to draw different pressings read "Yours: X · <handle>’s: Y"', () => {
  // tier 1 is always Jet (point 1) and tier 2/3 almost never are (15%/5%
  // mix) -- pairing a tier-1 "their" side against a tier-3 "my" side on
  // an album not already known to draw Jet at tier 3 guarantees a real,
  // visible difference without any retry loop.
  let title = null;
  for(const candidate of ['Alpha Pressing','Beta Pressing','Gamma Pressing','Delta Pressing']){
    if(selectVariantForAlbum(candidate, 3).variant !== 'jet'){ title = candidate; break; }
  }
  assert.ok(title, 'at least one of the four candidates draws a non-Jet tier-3 pressing');
  const item = { title, my_quality_tier: 3, their_quality_tier: 1 };
  const line = pressingLineFor(item, 'ken');
  const mine = getVariantDef(selectVariantForAlbum(title, 3).variant);
  assert.equal(line, 'Yours: ' + mine.name + ' · ken’s: Jet');
});

test('CR11 point 2: a missing tier on either side (an old, unmigrated row) shows no line at all', () => {
  assert.equal(pressingLineFor({ title: 'No Tiers Yet', my_quality_tier: null, their_quality_tier: 2 }, 'ken'), null);
  assert.equal(pressingLineFor({ title: 'No Tiers Yet', my_quality_tier: 2, their_quality_tier: null }, 'ken'), null);
});
