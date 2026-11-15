import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

// src/share/styles.js is pure DOM/canvas-free at the top level —
// document/Image are only ever touched inside a function body, and only
// once that function is actually called — no mocking needed to load it
// directly, same as library/model.js. Since SH3 (docs/18_SHARE.md), it
// also imports record-art/tiers.js's getVariantDef and record-art/
// metals.js's METAL_COLORS (for the fillShareDisc() it now exports, see
// below) — neither of those touches the DOM at its own top level either,
// so this doesn't cost styles.js its own "safe to import directly, no
// mocking" property. The one exception, TY4 (docs/22_TYPE.md): styles.js
// now imports ui/wordmark.js for drawShareWordmark's real mark, and that
// module's own top-level `?raw` asset import is a Vite-only feature
// node:test can't resolve at all — mocked away since nothing here tests
// drawShareWordmark's pixels (Canvas doesn't run in Node either, see below).
mock.module(new URL('../../src/ui/wordmark.js', import.meta.url).href, {
  namedExports: { wordmarkMarkup(){ return '<svg></svg>'; } },
});
const { SHARE_FORMATS, resolveShareStyle, shareFitLines, paperLabelTextLayout, shareTriad } = await import('../../src/share/styles.js');
import { contrastRatio } from '../../src/ui/art-color.js';

// Canvas drawing itself can't run in Node (no real 2D context), so this
// file sticks to the two genuinely pure parts of the share-image code:
// the format table (pixel dimensions) and the style resolver (a kit of
// colours/a background painter function, never drawn here). There is no
// separate, unit-testable "pick the hero record / top items" function to
// test against fixture data, per the step 6d prompt's own escape valve —
// composeShareImage/composePlayerShareImage (src/share/crate-card.js/
// now-playing-card.js) each read topAlbums()/topTracks() directly inline,
// woven into the same function that does the canvas drawing, not behind
// a separable pure helper. The selection *algorithm* those two calls
// use — count order, ties broken by most-recently-played — is already
// unit-tested in tests/unit/sealed.test.js (`topAlbums`/`topTracks` from
// history/achievements.js); restructuring composeShareImage just to carve
// out a separately-testable "pick the hero" function would be a behavior-
// risking change for a refactor step whose own rule is no behavior change,
// so it isn't done here.

test('SHARE_FORMATS: all three formats have the documented pixel dimensions', () => {
  assert.deepEqual(
    Object.keys(SHARE_FORMATS).sort(),
    ['square', 'story'],
  );
  assert.deepEqual(SHARE_FORMATS.story, {w:1080, h:1920, safeTop:250, safeBottom:1670});
  assert.deepEqual(SHARE_FORMATS.square, {w:1080, h:1080, safeTop:70, safeBottom:1010});
});

test('SHARE_FORMATS: every format\'s safe zone is a sane band inside the canvas', () => {
  for(const [name, dim] of Object.entries(SHARE_FORMATS)){
    assert.ok(dim.w > 0 && dim.h > 0, `${name}: width/height must be positive`);
    assert.ok(dim.safeTop >= 0, `${name}: safeTop must not be negative`);
    assert.ok(dim.safeTop < dim.safeBottom, `${name}: safeTop must be above safeBottom`);
    assert.ok(dim.safeBottom <= dim.h, `${name}: safeBottom must not exceed the canvas height`);
  }
});

const STYLES = ['night', 'cover', 'paper'];
const FORMATS = Object.keys(SHARE_FORMATS);

test('resolveShareStyle x SHARE_FORMATS: every one of the six style/format pairs resolves to a valid combination', async () => {
  assert.equal(STYLES.length * FORMATS.length, 6);
  for(const style of STYLES){
    // 'cover' needs art; without a real DOM Image constructor the lookup
    // inside resolveShareStyle rejects and it falls through to Night by
    // design (see its own "falls through to Night below" comment) — still
    // a valid kit, just not the Cover-specific one, so this never throws.
    const kit = await resolveShareStyle(style, style === 'cover' ? 'fake-art-url.png' : null);
    for(const format of FORMATS){
      const dim = SHARE_FORMATS[format];
      assert.ok(dim, `${style}/${format}: format must resolve to pixel dimensions`);
      assert.ok(typeof kit.ink === 'string' && kit.ink.length > 0, `${style}/${format}: kit needs an ink colour`);
      assert.ok(typeof kit.sub === 'string' && kit.sub.length > 0, `${style}/${format}: kit needs a sub colour`);
      assert.ok(typeof kit.accent === 'string' && kit.accent.length > 0, `${style}/${format}: kit needs an accent colour`);
      assert.ok(typeof kit.chipBorder === 'string', `${style}/${format}: kit needs a chip border colour`);
      assert.ok(typeof kit.chipBg === 'string', `${style}/${format}: kit needs a chip background colour`);
      assert.equal(typeof kit.paintBg, 'function', `${style}/${format}: kit needs a paintBg painter`);
    }
  }
});

test('resolveShareStyle: Paper and Night each resolve to their own named kit; Cover without art falls back to Night', async () => {
  assert.equal((await resolveShareStyle('paper', null)).name, 'paper');
  assert.equal((await resolveShareStyle('night', null)).name, 'night');
  assert.equal((await resolveShareStyle('cover', null)).name, 'night');
  // an unrecognized style name is treated the same as no style at all
  assert.equal((await resolveShareStyle('not-a-real-style', null)).name, 'night');
});

/* ===================== CO6 (docs/37_COLOUR.md) =====================
   shareTriad(rgb) — a ground/type/accent triad for the cover-derived
   share-card background, built on CO4's artAnchor()/artTint(). Pure
   colour math, same as artTint()/artAnchor() themselves, so it's tested
   directly here rather than through resolveShareStyle()'s 'cover'
   branch (which needs a real Image/canvas to reach at all — see the
   'falls through to Night' comment above). */

test('shareTriad(): type clears TY1\'s 7:1 floor against its own ground', () => {
  // a saturated orange, same cover hue art-color.test.js's own artAnchor()
  // test uses — resolves to the Slate Color / Ivory Buff anchor pairing.
  const { ground, type, accent } = shareTriad({ r: 244, g: 133, b: 37 });
  assert.ok(contrastRatio(type, ground) >= 7, `type (${type}) vs ground (${ground}) — ${contrastRatio(type, ground).toFixed(2)}:1`);
  assert.ok(typeof accent === 'string' && accent.length > 0);
});

test('shareTriad(): no anchor for this hue falls back to artTint()\'s own ground and --paper for type', () => {
  // the olive/yellow-green band artAnchor() itself returns null for
  // (art-color.test.js) — shareTriad() must fall through the same way,
  // never throwing and never returning an undefined ground/type.
  const { ground, type } = shareTriad({ r: 51, g: 204, b: 51 });
  assert.equal(type, '#EFE9DF');
  assert.ok(typeof ground === 'string' && ground.startsWith('#'));
});

test('shareTriad(): the accent never lands within ΔE 10 of its own ground or type', async () => {
  const { deltaE } = await import('../../src/ui/palette-ref.js');
  for(const rgb of [{ r: 244, g: 133, b: 37 }, { r: 51, g: 204, b: 51 }, { r: 60, g: 90, b: 220 }]){
    const { ground, type, accent } = shareTriad(rgb);
    assert.ok(deltaE(accent, ground) >= 10, `accent (${accent}) too close to ground (${ground})`);
    assert.ok(deltaE(accent, type) >= 10, `accent (${accent}) too close to type (${type})`);
  }
});

// BD11 (docs/38_BEFORE_THE_DOMAIN.md) removed the Record card
// (src/share/record-card.js) and its own ratingTickCount/recordNoteText
// pure helpers along with it. friendsStickerText() lives on in
// src/share/sticker-text.js (CC3, docs/34_CARE_AND_CONTROL.md, pulled out
// before this step so src/social/sticker.js's own badge could reuse it
// without record-card.js's wide share/styles.js -> ui/wordmark.js chain)
// and is still real behavior worth covering, so its tests move there too.
const { friendsStickerText } = await import('../../src/share/sticker-text.js');

test('friendsStickerText: no friends (0, null, undefined) means no sticker at all', () => {
  assert.equal(friendsStickerText(0), null);
  assert.equal(friendsStickerText(null), null);
  assert.equal(friendsStickerText(undefined), null);
  assert.equal(friendsStickerText(-1), null);
});

test('friendsStickerText: singular and plural read grammatically ("1 friend" / "3 friends")', () => {
  assert.equal(friendsStickerText(1), '1 friend');
  assert.equal(friendsStickerText(3), '3 friends');
});

/* ===================== SH4 (docs/18_SHARE.md) =====================
   The Pressings card (src/share/pressings-card.js). Same reasoning as
   SH3's own Record-card tests below: canvas drawing itself can't run in
   Node, so this sticks to item 7's own pure decision logic -- the newest-
   first sort, the per-format tile count, the "+N more" line, and the
   family-counts header line. record-art/tiers.js's getVariantDef and
   styles.js are both the same "safe to import directly, no DOM at the
   top level" leaves the SHARE_FORMATS/resolveShareStyle tests above
   already rely on, so pressings-card.js needs no mocking to load for
   real either. This import has to happen before the SH1 block below
   mocks pressings-card.js wholesale (for sheet.js's own tests) --
   node:test's mock.module() replaces the module in the registry for
   every subsequent import, real or not, so the real module has to be
   loaded first. */
const { sortPressingsNewestFirst, tileCountFor, moreCountText } = await import('../../src/share/pressings-card.js');

test('sortPressingsNewestFirst: newest discoveredAt first, regardless of input order', () => {
  const a = { albumId: 'a', discoveredAt: 100 };
  const b = { albumId: 'b', discoveredAt: 300 };
  const c = { albumId: 'c', discoveredAt: 200 };
  assert.deepEqual(sortPressingsNewestFirst([a, b, c]).map(r => r.albumId), ['b', 'c', 'a']);
  assert.deepEqual(sortPressingsNewestFirst([b, a, c]).map(r => r.albumId), ['b', 'c', 'a']);
});

test('sortPressingsNewestFirst: a missing discoveredAt sorts as the oldest, and the input array is never mutated', () => {
  const input = [{ albumId: 'a', discoveredAt: 100 }, { albumId: 'b' }];
  const sorted = sortPressingsNewestFirst(input);
  assert.deepEqual(sorted.map(r => r.albumId), ['a', 'b']);
  assert.deepEqual(input.map(r => r.albumId), ['a', 'b'], 'the original array order is untouched');
});

test('tileCountFor: 3x4 (12 tiles) for Story, 3x2 (6 tiles) for Square', () => {
  assert.equal(tileCountFor('story'), 12);
  assert.equal(tileCountFor('square'), 6);
});

test('tileCountFor: an unrecognized format falls back to Square\'s own tile count', () => {
  assert.equal(tileCountFor('not-a-real-format'), 6);
});

// WS4: a crowded footer leaves room for fewer rows than the format's own
// cap allows -- maxRows caps it further, never raises it past the format.
test('tileCountFor: maxRows caps the tile count below the format\'s own row count', () => {
  assert.equal(tileCountFor('story', 2), 6);
  assert.equal(tileCountFor('square', 1), 3);
  assert.equal(tileCountFor('story', 99), 12, 'a roomy maxRows never exceeds the format\'s own cap');
  assert.equal(tileCountFor('square', 0), 0);
});

test('moreCountText: nothing shown once the collection fits the grid', () => {
  const sixRecords = Array.from({length: 6}, (_, i) => ({ albumId: String(i) }));
  assert.equal(moreCountText(sixRecords, 'square'), null);
  assert.equal(moreCountText(sixRecords, 'story'), null);
  assert.equal(moreCountText([], 'square'), null);
});

test('moreCountText: counts exactly how many are left off, newest-first framing', () => {
  const eightRecords = Array.from({length: 8}, (_, i) => ({ albumId: String(i) }));
  assert.equal(moreCountText(eightRecords, 'square'), '+ 2 MORE · NEWEST FIRST');
  assert.equal(moreCountText(eightRecords, 'story'), null);
});

// WS4: "+N MORE" counts what's actually shown once the footer leaves room
// for fewer rows than the format would otherwise allow.
test('moreCountText: maxRows narrows the grid further, so more records count as "more"', () => {
  const eightRecords = Array.from({length: 8}, (_, i) => ({ albumId: String(i) }));
  assert.equal(moreCountText(eightRecords, 'story', 2), '+ 2 MORE · NEWEST FIRST');
  assert.equal(moreCountText(eightRecords, 'square', 1), '+ 5 MORE · NEWEST FIRST');
});

// QC2 (docs/24_QUIET_COUNTS.md) removed familyCountsLine() along with the
// "N of 110"/family-counts figures it formatted — the Pressings card now
// draws an owned-chips grid instead (drawPressingChips(), real canvas
// drawing woven into composePressingsShareImage itself, the same "not
// behind a separable pure helper" shape this file's own header comment
// already describes for composeShareImage/composePlayerShareImage).

/* ===================== FS8 (docs/25_FROM_SCRATCH.md) =====================
   The Now Playing card's own re-layout dropped the progress bar, clock,
   spec-chip row and slogan line outright (point 2) -- layoutChips()/
   shareChip()/the CHIP_* constants that used to live in styles.js for
   that chip row are gone with them (nothing left unused in share/, per
   the plan's own "Removed" note). shareFitLines itself is still
   exercised directly below, confirming the exact per-line/font-size
   result the title-clearance calculation depends on. */

// a minimal canvas 2D context stand-in: measureText's width is a plain
// function of string length and whatever px size the current ctx.font
// string carries -- deterministic and font-size-sensitive, which is all
// shareFitLines'/layoutChips' own wrapping math actually needs.
function makeFakeCtx(){
  const ctx = {
    font: '16px sans-serif',
    save(){}, restore(){},
    measureText(text){
      const m = /(\d+(?:\.\d+)?)px/.exec(ctx.font);
      const size = m ? parseFloat(m[1]) : 16;
      return { width: String(text).length * size * 0.55, actualBoundingBoxDescent: size * 0.22 };
    },
  };
  return ctx;
}

test('shareFitLines: a very long title shrinks to the font-size floor, then truncates only the last line', () => {
  const ctx = makeFakeCtx();
  // a single unsplittable word wide enough to overflow maxWidth on its
  // own at every size down to the floor, landing as the kept 2nd line
  // once wrap() is sliced to maxLines -- plus enough filler words after
  // it that the produced line count stays above maxLines at every size
  // tried, so the loop genuinely exhausts to the floor rather than
  // returning early on a line count that happens to already fit.
  const longWord = 'X'.repeat(80);
  const longTitle = ['Hi', longWord, 'more', 'words', 'after', 'that', 'keep', 'going', 'well', 'past', 'two', 'lines'].join(' ');
  const { lines, fontSize } = shareFitLines(ctx, longTitle, 200, 2, 60, '700', 'Archivo, sans-serif');
  assert.equal(fontSize, Math.round(60*0.55), 'exhausts every shrink step before truncating');
  assert.equal(lines.length, 2, 'never exceeds maxLines regardless of how long the text is');
  assert.equal(lines[0], 'Hi');
  assert.ok(lines[1].endsWith('…'), 'the last line is truncated only once shrinking alone cannot fit it');
});

test('shareFitLines: a short title never shrinks or truncates', () => {
  const ctx = makeFakeCtx();
  const { lines, fontSize } = shareFitLines(ctx, 'Short Title', 1000, 2, 60, '700', 'Archivo, sans-serif');
  assert.equal(fontSize, 60);
  assert.deepEqual(lines, ['Short Title']);
});

// WS4 fix B: a single unbreakable word (no spaces -- a no-space or
// Japanese title) that wrap() can never split still has to respect
// maxWidth. Before the fix, wrap() returning a line count within
// maxLines made the loop return early without ever checking that the
// one line it kept actually fits, so it ran off both edges.
test('shareFitLines: an unbreakable 40-char word fits maxWidth, not just the line count', () => {
  const ctx = makeFakeCtx();
  const unbreakable = 'X'.repeat(40);
  const { lines, fontSize } = shareFitLines(ctx, unbreakable, 200, 2, 60, '700', 'Archivo, sans-serif');
  assert.equal(lines.length, 1);
  ctx.font = fontSize + 'px sans-serif';
  assert.ok(ctx.measureText(lines[0]).width <= 200, 'the kept line must fit maxWidth at the fontSize returned');
});

/* ===================== WS3 (docs/33_WALL_AND_LABELS.md) =====================
   paperLabelTextLayout() -- the share-disc paper label's own printed-text
   layout: pure (measures/fits with the given ctx, never draws), so the
   "nothing crosses the hole" rule and the fit-at-size behaviour are
   testable without a real canvas, the same makeFakeCtx() the shareFitLines
   tests above already use. */

test('paperLabelTextLayout: null below the 90px floor, with or without a label', () => {
  const ctx = makeFakeCtx();
  assert.equal(paperLabelTextLayout(ctx, 89, {album: 'A', artist: 'B'}), null);
  assert.equal(paperLabelTextLayout(ctx, 200, null), null);
});

test('paperLabelTextLayout: nothing crosses the hole, at every size the plan names (90/140/200)', () => {
  const ctx = makeFakeCtx();
  for(const lr of [90, 140, 200]){
    const layout = paperLabelTextLayout(ctx, lr, {album: 'Harbor Lights', artist: 'Someone', speedText: '45', sideText: 'B'});
    assert.ok(layout, 'lr=' + lr + ' is at/above the floor, so a layout must come back');
    assert.ok(layout.titleY <= -lr * 0.18, 'lr=' + lr + ': title baseline must sit at or above -lr*0.18');
    assert.ok(layout.artistTopY >= lr * 0.12, 'lr=' + lr + ': artist top must sit at or below lr*0.12 -- i.e. not higher than it');
    assert.ok(layout.kickerY < layout.titleY, 'lr=' + lr + ': the kicker sits above the title, never overlapping it');
  }
});

test('paperLabelTextLayout: each line fits its own stated max width (title/kicker/side to lr*1.6, artist to lr*1.4)', () => {
  const ctx = makeFakeCtx();
  const longAlbum = 'A Genuinely Extremely Long Album Title That Keeps Going';
  const longArtist = 'An Equally Long Artist Name That Also Keeps Going On';
  const lr = 140;
  const layout = paperLabelTextLayout(ctx, lr, {album: longAlbum, artist: longArtist, speedText: '33⅓', sideText: 'A'});
  ctx.font = '700 ' + layout.titleSize + 'px Antonio, sans-serif';
  assert.ok(ctx.measureText(layout.title).width <= lr * 1.6 + 0.5);
  ctx.font = '500 ' + layout.subSize + 'px Archivo, sans-serif';
  assert.ok(ctx.measureText(layout.artist).width <= lr * 1.4 + 0.5);
  assert.ok(layout.title.endsWith('…'), 'sanity: this title really was too long to fit as-is');
  assert.ok(layout.artist.endsWith('…'), 'sanity: this artist really was too long to fit as-is');
});

// BD11 (docs/38_BEFORE_THE_DOMAIN.md) removed the Season card
// (src/share/season-card.js) and its own legendOrder/verdictSentence pure
// helpers along with it. The lock-threshold constant (RHYTHM_MIN_PLAYS)
// and windowedCounts()/topAlbumsInWindow() they used stay covered by
// their own existing tests elsewhere (sundown/rhythm.js, history/
// achievements.js) -- they never belonged to season-card.js itself.

/* ===================== SH1 (docs/18_SHARE.md) =====================
   "One share sheet, two entry points" -- src/share/sheet.js is the one
   place that opens either remaining card (nowPlaying/pressings), each
   through the same nav-stack.js layer id ('share'). BD11 (docs/
   38_BEFORE_THE_DOMAIN.md) removed the other three (Record, Crate,
   Season). The real composers (now-playing-card.js/pressings-card.js)
   draw real canvases nothing in Node can render, so -- same "stop the
   chain at the door" shape every other mock-heavy file in this suite
   already uses -- both are mocked to a trivial async function returning
   a plain {width,height} object, and sheet.js's own direct DOM/global-
   document reads are stubbed rather than given a real browser. What's
   actually under test: that openShareSheet() registers its single
   'share' layer with nav-stack.js for every card (the "open/close path
   through nav-stack.js for each card" SH1 item 6 asks for), and that
   S.shareSelectionByCard's defaults match each remaining card's own
   Include-toggle table (item 3). */

const openLayerCalls = [];
mock.module(new URL('../../src/shell/nav-stack.js', import.meta.url).href, {
  namedExports: {
    openLayer(id, closeFn, opts){ openLayerCalls.push({ id, closeFn, opts }); },
    closeLayer(){},
    forceCloseLayer(){},
  },
});
mock.module(new URL('../../src/storage/meta.js', import.meta.url).href, {
  namedExports: { queueSave(){} },
});
mock.module(new URL('../../src/record-art/looks.js', import.meta.url).href, {
  namedExports: { resolveLook(){ return 'none'; } },
});
mock.module(new URL('../../src/sundown/solar.js', import.meta.url).href, {
  namedExports: { currentDayPosition(){ return { phase:'midday' }; } },
});
mock.module(new URL('../../src/share/now-playing-card.js', import.meta.url).href, {
  namedExports: { composePlayerShareImage: async () => ({ width:1, height:1 }) },
});
mock.module(new URL('../../src/share/pressings-card.js', import.meta.url).href, {
  namedExports: { composePressingsShareImage: async () => ({ width:1, height:1 }) },
});

// sheet.js reads/writes the DOM two ways: through util/dom.js's $/el (every
// id-keyed element the sheet touches), and through the bare `document`
// global directly (shareSelectedStyle/shareSelectedFormat's own
// querySelector, and openShareSheet's two querySelectorAll calls) --
// both stubbed here rather than given a real browser.
const elCache = new Map();
function fakeEl(){
  const classes = new Set();
  return {
    textContent: '', hidden: false, style: {}, dataset: {}, width: 0, height: 0,
    classList: {
      add(...cs){ cs.forEach(c => classes.add(c)); },
      remove(...cs){ cs.forEach(c => classes.delete(c)); },
      contains(c){ return classes.has(c); },
      toggle(c, on){ if(on === undefined) on = !classes.has(c); if(on) classes.add(c); else classes.delete(c); return on; },
    },
    setAttribute(){}, removeAttribute(){}, getAttribute(){ return null; },
    addEventListener(){}, appendChild(child){ return child; },
    getContext(){ return { drawImage(){} }; },
  };
}
mock.module(new URL('../../src/util/dom.js', import.meta.url).href, {
  namedExports: {
    $(sel){ if(!elCache.has(sel)) elCache.set(sel, fakeEl()); return elCache.get(sel); },
    el(tag, cls, text){ const e = fakeEl(); if(cls) e.className = cls; if(text !== undefined) e.textContent = text; return e; },
  },
});

function makeChip(dataset){
  const attrs = {};
  return { dataset, setAttribute(k, v){ attrs[k] = v; }, getAttribute(k){ return attrs[k]; }, _attrs: attrs };
}
const fakeStyleChips = [makeChip({ style:'night' }), makeChip({ style:'cover' }), makeChip({ style:'paper' })];
const fakeFormatChips = [makeChip({ format:'story' }), makeChip({ format:'square' })];
globalThis.document = {
  querySelector(sel){
    if(sel.includes('shareStyleRow')) return fakeStyleChips.find(c => c._attrs['aria-pressed'] === 'true') || null;
    if(sel.includes('shareFormatSeg') || sel.includes('FormatSeg')) return fakeFormatChips.find(c => c._attrs['aria-pressed'] === 'true') || null;
    return null;
  },
  querySelectorAll(sel){
    if(sel.includes('shareStyleRow')) return fakeStyleChips;
    if(sel.includes('shareFormatSeg')) return fakeFormatChips;
    return [];
  },
};

const { S } = await import('../../src/state.js');
const { openShareSheet, shareCurrentCard } = await import('../../src/share/sheet.js');

const ALL_CARDS = ['nowPlaying', 'pressings'];

test('openShareSheet: every one of the remaining cards registers the single "share" nav-stack layer', async () => {
  for(const card of ALL_CARDS){
    openLayerCalls.length = 0;
    await openShareSheet({ card, data:{} });
    assert.equal(openLayerCalls.length, 1, `${card}: openShareSheet must register exactly one layer`);
    assert.equal(openLayerCalls[0].id, 'share', `${card}: the layer id is always 'share', never a per-card id`);
    assert.equal(shareCurrentCard(), card);
  }
});

test('openShareSheet: an unrecognized card falls back to Now Playing (the sheet\'s own default)', async () => {
  await openShareSheet({ card:'not-a-real-card' });
  assert.equal(shareCurrentCard(), 'nowPlaying');
});

test('S.shareSelectionByCard: defaults match SH1 item 3\'s own Include-toggle table', () => {
  // nowPlaying -> Time of day
  assert.deepEqual(Object.keys(S.shareSelectionByCard.nowPlaying), ['phase']);
  assert.equal(S.shareSelectionByCard.nowPlaying.phase, true);
  // pressings -> none
  assert.deepEqual(S.shareSelectionByCard.pressings, {});
});

// BD11 (docs/38_BEFORE_THE_DOMAIN.md point 3): parsePrefs/serializePrefs
// keep round-tripping the record/crate/season keys unchanged -- a format
// saved under one of those now-dead keys is just inert, not migrated.
test('S.shareFormatByCard: every card (including the three BD11 removed) keeps its per-card default format', () => {
  assert.deepEqual(S.shareFormatByCard, {
    nowPlaying:'story', record:'square', pressings:'story', crate:'square', season:'square',
  });
});
