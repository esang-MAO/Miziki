import { test } from 'node:test';
import assert from 'node:assert/strict';

// src/share/styles.js has no imports of its own (pure DOM/canvas-free at
// the top level — document/Image are only ever touched inside a function
// body, and only once that function is actually called) — no mocking
// needed to load it directly, same as library/model.js or record-art/
// tiers.js.
const { SHARE_FORMATS, resolveShareStyle } = await import('../../src/share/styles.js');

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
