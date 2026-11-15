import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

// PL7 item 1 (docs/19_PLAYER.md): lock-screen artwork's own cache-hit
// check (lockscreenArtCacheHit), pulled out pure so it's testable without
// canvas/fetch/createImageBitmap — none of which exist in this environment.
// library/thumbs.js's own wide real dependency chain (edit.js, credits.js,
// profile/screens.js, crate/model.js/tiers.js, audio/engine.js, and
// everything record-art/looks.js needs `el`/window for) is stopped at the
// door the same way tests/unit/clock.test.js already does for the same
// module — mocking each real import flat, rather than loading it, is what
// lets thumbs.js load here at all with no browser.
mock.module(new URL('../../src/main.js', import.meta.url).href, {
  namedExports: { queueSave(){} },
});
mock.module(new URL('../../src/library/edit.js', import.meta.url).href, {
  namedExports: { cropSquareImage: async () => null },
});
mock.module(new URL('../../src/library/credits.js', import.meta.url).href, {
  namedExports: { rebuildPeopleIndex(){}, updateCreditsButtonForCurrent(){} },
});
mock.module(new URL('../../src/profile/screens.js', import.meta.url).href, {
  namedExports: { renderProfile(){} },
});
mock.module(new URL('../../src/crate/model.js', import.meta.url).href, {
  namedExports: { invalidateCrateModel(){} },
});
mock.module(new URL('../../src/audio/engine.js', import.meta.url).href, {
  namedExports: { decodeAudioFile: async () => null },
});

const { lockscreenArtCacheHit, LOCKSCREEN_ART_SIZES } = await import('../../src/library/thumbs.js');

test('lockscreenArtCacheHit: no cached entry is a miss', () => {
  assert.equal(lockscreenArtCacheHit(null, 'blob:abc'), false);
});

test('lockscreenArtCacheHit: no source to compare against is a miss', () => {
  assert.equal(lockscreenArtCacheHit({source: 'blob:abc', entries: []}, null), false);
  assert.equal(lockscreenArtCacheHit({source: 'blob:abc', entries: []}, ''), false);
});

test('lockscreenArtCacheHit: same source as the cached entry is a hit', () => {
  assert.equal(lockscreenArtCacheHit({source: 'blob:abc', entries: []}, 'blob:abc'), true);
});

test('lockscreenArtCacheHit: a different source (custom cover replaced, track re-imported) is a miss', () => {
  assert.equal(lockscreenArtCacheHit({source: 'blob:abc', entries: []}, 'blob:def'), false);
});

test('LOCKSCREEN_ART_SIZES: the three sizes PL7 item 1 calls for', () => {
  assert.deepEqual(LOCKSCREEN_ART_SIZES, [256, 512, 1024]);
});
