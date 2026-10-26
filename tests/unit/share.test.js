import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

// src/share/styles.js has no imports of its own (pure DOM/canvas-free at
// the top level — document/Image are only ever touched inside a function
// body, and only once that function is actually called) — no mocking
// needed to load it directly, same as library/model.js or record-art/
// tiers.js.
const { SHARE_FORMATS, resolveShareStyle, shareFitLines, layoutChips, CHIP_FONT, CHIP_HEIGHT, CHIP_ROW_GAP } = await import('../../src/share/styles.js');

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
    ['portrait', 'square', 'story'],
  );
  assert.deepEqual(SHARE_FORMATS.story, {w:1080, h:1920, safeTop:250, safeBottom:1670});
  assert.deepEqual(SHARE_FORMATS.portrait, {w:1080, h:1350, safeTop:90, safeBottom:1270});
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

test('resolveShareStyle x SHARE_FORMATS: every one of the nine style/format pairs resolves to a valid combination', async () => {
  assert.equal(STYLES.length * FORMATS.length, 9);
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

/* ===================== SH2 (docs/18_SHARE.md) =====================
   "Now Playing, re-spaced" -- layoutChips(ctx, chips, maxW) is the one
   piece of the re-layout that's genuinely pure (no canvas drawing, only
   ctx.measureText), pulled out of now-playing-card.js's own
   composePlayerShareImage into styles.js specifically so it's directly
   testable here with a fake, measurement-only canvas context -- no
   mocking of any module needed, same as shareFitLines/resolveShareStyle
   above. shareFitLines itself is also exercised directly (the "long
   title" case SH2 item 5 asks for), confirming the exact per-line/
   font-size result composePlayerShareImage's own title-clearance
   calculation depends on. */

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

test('layoutChips: chips that fit stay on one row, centered around 0', () => {
  const ctx = makeFakeCtx();
  const chips = [{text:'A', filled:false}, {text:'B', filled:true}];
  const { rows, height } = layoutChips(ctx, chips, 1000);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].length, 2);
  assert.equal(height, CHIP_HEIGHT);
  const first = rows[0][0], last = rows[0][rows[0].length-1];
  assert.ok(first.x < 0, 'the row starts left of center');
  assert.ok(Math.abs((last.x + last.width) - (-first.x)) < 1, 'the row is symmetric around 0');
});

test('layoutChips: three chips that cannot all share one row wrap to a second, dropping none (SH2 item 3)', () => {
  const ctx = makeFakeCtx();
  const chips = [
    {text:'FLAC · 44.1 KHZ · 16-BIT', filled:false},
    {text:'VINYL', filled:true},
    {text:'SPUN AT DUSK', filled:false},
  ];
  ctx.font = CHIP_FONT;
  const widths = chips.map(c => Math.round(ctx.measureText(c.text).width) + 44);
  // room for exactly the first two side by side, not all three
  const narrowMaxW = widths[0] + 16 + widths[1] + 10;
  const { rows, height } = layoutChips(ctx, chips, narrowMaxW);
  assert.equal(rows.length, 2, 'three chips that do not fit one row wrap to a second');
  assert.equal(rows[0].length + rows[1].length, 3, 'every chip is kept, just wrapped');
  assert.equal(height, CHIP_HEIGHT*2 + CHIP_ROW_GAP, 'stacked height accounts for the row gap');
});

test('layoutChips: an empty chip list lays out to nothing', () => {
  const ctx = makeFakeCtx();
  const { rows, height } = layoutChips(ctx, [], 1000);
  assert.deepEqual(rows, []);
  assert.equal(height, 0);
});

/* ===================== SH1 (docs/18_SHARE.md) =====================
   "One share sheet, five entry points" -- src/share/sheet.js is now the
   one place that opens any of five cards (nowPlaying/record/pressings/
   crate/season), each through the same nav-stack.js layer id ('share').
   The real composers (crate-card.js/now-playing-card.js/record-card.js/
   pressings-card.js/season-card.js) draw real canvases nothing in Node
   can render, so -- same "stop the chain at the door" shape every other
   mock-heavy file in this suite already uses -- every one of them is
   mocked to a trivial async function returning a plain {width,height}
   object, and sheet.js's own direct DOM/global-document reads are
   stubbed rather than given a real browser. What's actually under test:
   that openShareSheet() registers its single 'share' layer with
   nav-stack.js for every card (the "open/close path through nav-stack.js
   for each card" SH1 item 6 asks for), and that S.shareSelectionByCard's
   defaults match each card's own Include-toggle table (item 3). */

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
mock.module(new URL('../../src/share/crate-card.js', import.meta.url).href, {
  namedExports: { composeShareImage: async () => ({ width:1, height:1 }) },
});
mock.module(new URL('../../src/share/now-playing-card.js', import.meta.url).href, {
  namedExports: { composePlayerShareImage: async () => ({ width:1, height:1 }) },
});
mock.module(new URL('../../src/share/record-card.js', import.meta.url).href, {
  namedExports: { composeRecordShareImage: async () => ({ width:1, height:1 }) },
});
mock.module(new URL('../../src/share/pressings-card.js', import.meta.url).href, {
  namedExports: { composePressingsShareImage: async () => ({ width:1, height:1 }) },
});
mock.module(new URL('../../src/share/season-card.js', import.meta.url).href, {
  namedExports: { composeSeasonShareImage: async () => ({ width:1, height:1 }) },
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

const ALL_CARDS = ['nowPlaying', 'record', 'pressings', 'crate', 'season'];

test('openShareSheet: every one of the five cards registers the single "share" nav-stack layer', async () => {
  for(const card of ALL_CARDS){
    openLayerCalls.length = 0;
    await openShareSheet({ card, data:{} });
    assert.equal(openLayerCalls.length, 1, `${card}: openShareSheet must register exactly one layer`);
    assert.equal(openLayerCalls[0].id, 'share', `${card}: the layer id is always 'share', never a per-card id`);
    assert.equal(shareCurrentCard(), card);
  }
});

test('openShareSheet: an unrecognized card falls back to crate (the sheet\'s own default)', async () => {
  await openShareSheet({ card:'not-a-real-card' });
  assert.equal(shareCurrentCard(), 'crate');
});

test('S.shareSelectionByCard: defaults match SH1 item 3\'s own Include-toggle table', () => {
  // nowPlaying -> Time of day
  assert.deepEqual(Object.keys(S.shareSelectionByCard.nowPlaying), ['phase']);
  assert.equal(S.shareSelectionByCard.nowPlaying.phase, true);
  // record -> Sleeve note, Friends
  assert.deepEqual(new Set(Object.keys(S.shareSelectionByCard.record)), new Set(['note', 'friends']));
  // pressings -> none
  assert.deepEqual(S.shareSelectionByCard.pressings, {});
  // crate -> every section the composer still draws, but the sheet only
  // ever shows a Name toggle for it (buildIncludeToggles reads from
  // INCLUDE_LABELS, not from this object's own key count) -- SH5's own
  // job is to actually shrink this object once crate-card.js stops
  // drawing the other five sections unconditionally.
  assert.equal(S.shareSelectionByCard.crate.name, true);
  // season -> Name
  assert.deepEqual(Object.keys(S.shareSelectionByCard.season), ['name']);
  assert.equal(S.shareSelectionByCard.season.name, true);
});

test('S.shareFormatByCard: every card has its own per-card default format (SH1 item 2)', () => {
  assert.deepEqual(S.shareFormatByCard, {
    nowPlaying:'story', record:'square', pressings:'story', crate:'square', season:'square',
  });
});
