// GF5 (docs/29_GATEFOLD.md §GF5): the default back cover's pure data
// builder -- sides/totals, label/year omission, the catalogue line, and
// the 10″/7″ overflow rule.
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
// TY4 (docs/22_TYPE.md): the drawn wordmark SVG — a ?raw asset import
// node:test can't resolve, and buildBackCoverData (what this file tests)
// never reads it anyway; back-cover.js imports it only for buildBackCoverEl.
mock.module(new URL('../../src/ui/wordmark.js', import.meta.url).href, {
  namedExports: { wordmarkEl(){ return { classList: { add(){} } }; } },
});
// GF6: setAlbumBackCoverImage()/clearAlbumBackCoverImage()/
// getAlbumBackCoverBlob() go through storage/repo.js's artwork store (real
// IndexedDB) and sync/backup.js's upload/claim bookkeeping (network) --
// both mocked here to an in-memory stand-in, the usual "stop the chain at
// the door" reasoning; sync/backup.js's own merge/claim logic is covered
// by tests/unit/backup-merge.test.js instead.
const artworkStore = new Map();
mock.module(new URL('../../src/storage/repo.js', import.meta.url).href, {
  namedExports: {
    artwork: {
      get(id){ return Promise.resolve(artworkStore.get(id) || null); },
      put(rec){ artworkStore.set(rec.id, rec); return Promise.resolve(); },
      del(id){ artworkStore.delete(id); return Promise.resolve(); },
    },
  },
});
const backupCalls = { uploads: [], clears: [] };
mock.module(new URL('../../src/sync/backup.js', import.meta.url).href, {
  namedExports: {
    queueBackCoverUpload(albumId, blob){ backupCalls.uploads.push({ albumId, blob }); },
    clearBackCoverClaim(albumId){ backupCalls.clears.push(albumId); },
  },
});
const {
  buildBackCoverData, getAlbumBackCoverBlob, setAlbumBackCoverImage, clearAlbumBackCoverImage,
  backCoverMenuRowsVisible,
} = await import('../../src/gatefold/back-cover.js');
const { matrixTail } = await import('../../src/record-art/etchings.js');
const { S } = await import('../../src/state.js');

function track(title, duration, overrides){
  return { tags: { title, artist: 'Test Artist', album: 'Test Album', disc: 1, ...overrides }, duration, meta: { ch: 2 } };
}

test('buildBackCoverData: sides and totals from splitSides, two tracks are A/B', () => {
  S.tracks = [track('One', 180), track('Two', 120)];
  const item = { albumId: 'rel-1', artist: 'Test Artist', album: 'Test Album', year: null };
  const data = buildBackCoverData(item, [0,1], { size: '12"', speed: 33.333 });
  assert.deepEqual(data.sides.map(s => s.label), ['SIDE A','SIDE B']);
  assert.equal(data.sides[0].total, 180);
  assert.equal(data.sides[1].total, 120);
  assert.deepEqual(data.sides[0].tracks.map(t => t.title), ['One']);
});

test('buildBackCoverData: a single track still gets one side, no split', () => {
  S.tracks = [track('Solo', 200)];
  const item = { albumId: 'rel-solo', artist: 'A', album: 'B', year: null };
  const data = buildBackCoverData(item, [0], { size: '7"', speed: 45 });
  assert.equal(data.sides.length, 1);
  assert.equal(data.sides[0].label, 'SIDE A');
  assert.equal(data.sides[0].tracks.length, 1);
});

test('buildBackCoverData: catalogue line matches matrixTail(releaseId), MZK- prefixed', () => {
  S.tracks = [track('One', 100), track('Two', 100)];
  const item = { albumId: 'some-release-id', artist: 'A', album: 'B', year: null };
  const data = buildBackCoverData(item, [0,1], { size: '12"', speed: 33.333 });
  assert.equal(data.catalogLine, 'MZK-' + matrixTail('some-release-id'));
});

test('buildBackCoverData: label/year omitted when absent, included when the tags carry them', () => {
  S.tracks = [track('One', 100)];
  const bare = buildBackCoverData({ albumId: 'r', artist: 'A', album: 'B', year: null }, [0], { size: '12"', speed: 33.333 });
  assert.equal(bare.label, null);
  assert.equal(bare.year, null);

  S.tracks = [track('One', 100, { label: 'Tidewater Records', year: 2024 })];
  const withMeta = buildBackCoverData({ albumId: 'r', artist: 'A', album: 'B', year: null }, [0], { size: '12"', speed: 33.333 });
  assert.equal(withMeta.label, 'Tidewater Records');
  assert.equal(withMeta.year, 2024);
});

test('buildBackCoverData: the format/speed/channel/total-time line', () => {
  S.tracks = [track('One', 150, { }), track('Two', 150)];
  S.tracks[0].meta = { ch: 2 };
  const data = buildBackCoverData({ albumId: 'r', artist: 'A', album: 'B', year: null }, [0,1], { size: '12"', speed: 33.333 });
  assert.equal(data.formatLine, '12″ · 33⅓ RPM · STEREO · 5:00');
});

test('buildBackCoverData: mono reads MONO off the first track\'s own channel count', () => {
  S.tracks = [track('One', 60, {})];
  S.tracks[0].meta = { ch: 1 };
  const data = buildBackCoverData({ albumId: 'r', artist: 'A', album: 'B', year: null }, [0], { size: '7"', speed: 45 });
  assert.ok(data.formatLine.includes('MONO'));
});

test('buildBackCoverData: an oversized 7″ side caps at 4 tracks and folds the rest into "and N more"', () => {
  // one longer track pulls bestSideCut()'s balance point to put every
  // other (short, equal) track on the opposite side -- side A ends up
  // with 5 tracks, side B with just the one long one (same "very uneven
  // track" shape ceremony-timing.test.js's own splitSides tests use).
  // 700s, not 6000s: long enough to still win that balance, short enough
  // that neither side crosses CC5's 22-min double-LP cap -- this test is
  // about the back cover's own 4-track-per-side display cap, not about
  // whether the album becomes a double LP (that's covered in
  // ceremony-timing.test.js).
  S.tracks = [...Array.from({length: 5}, (_, i) => track('Track ' + i, 60)), track('The Long One', 700)];
  const item = { albumId: 'r', artist: 'A', album: 'B', year: null };
  const data = buildBackCoverData(item, [0,1,2,3,4,5], { size: '7"', speed: 45 });
  const capped = data.sides.find(s => s.overflow > 0);
  assert.ok(capped);
  assert.equal(capped.tracks.length, 4);
  assert.equal(capped.overflow, 1);
});

test('buildBackCoverData: a 12″ back never caps -- every track is shown, no overflow', () => {
  S.tracks = Array.from({length: 10}, (_, i) => track('Track ' + i, 60));
  const item = { albumId: 'r', artist: 'A', album: 'B', year: null };
  const data = buildBackCoverData(item, [0,1,2,3,4,5,6,7,8,9], { size: '12"', speed: 33.333 });
  const totalShown = data.sides.reduce((s, side) => s + side.tracks.length, 0);
  assert.equal(totalShown, 10);
  assert.ok(data.sides.every(s => s.overflow === 0));
});

// GF6 (docs/29_GATEFOLD.md §GF6): the back-cover photo's own storage --
// album-keyed ('back:<albumKey>'), no new store/schema bump.
test('GF6: getAlbumBackCoverBlob reads nothing for an album with no stored image', async () => {
  const blob = await getAlbumBackCoverBlob('no-such-album');
  assert.equal(blob, null);
});

test('GF6: setAlbumBackCoverImage stores the blob and queues the sync claim', async () => {
  backupCalls.uploads.length = 0;
  const blob = { size: 1 };
  await setAlbumBackCoverImage('album-set', blob);
  assert.equal(await getAlbumBackCoverBlob('album-set'), blob);
  assert.equal(backupCalls.uploads.length, 1);
  assert.deepEqual(backupCalls.uploads[0], { albumId: 'album-set', blob });
});

test('GF6: clearAlbumBackCoverImage ("Use Miziki default") removes the stored image and tombstones the claim', async () => {
  backupCalls.clears.length = 0;
  await setAlbumBackCoverImage('album-clear', { size: 1 });
  await clearAlbumBackCoverImage('album-clear');
  assert.equal(await getAlbumBackCoverBlob('album-clear'), null);
  assert.deepEqual(backupCalls.clears, ['album-clear']);
});

// UN10 (docs/36_UNIFORMITY.md point 2): the back-cover "⋯" rows moved
// into the gatefold's one options menu, shown only while turned over.
test('UN10: backCoverMenuRowsVisible is true only when turned over', () => {
  assert.equal(backCoverMenuRowsVisible(true), true);
  assert.equal(backCoverMenuRowsVisible(false), false);
  assert.equal(backCoverMenuRowsVisible(undefined), false);
  assert.equal(backCoverMenuRowsVisible(null), false);
});

// UN10 point 5: "the default is checked only without a custom back" --
// openGatefoldMoreMenu() checks #gfBackCoverDefaultBtn with !blob, the
// same predicate asserted directly here against the real storage calls.
test('UN10: "Use Miziki default" checked state follows getAlbumBackCoverBlob', async () => {
  const albumId = 'album-un10-checked';
  assert.equal(!(await getAlbumBackCoverBlob(albumId)), true);   // no custom back yet -- checked
  await setAlbumBackCoverImage(albumId, { size: 1 });
  assert.equal(!(await getAlbumBackCoverBlob(albumId)), false);  // custom back set -- unchecked
  await clearAlbumBackCoverImage(albumId);
  assert.equal(!(await getAlbumBackCoverBlob(albumId)), true);   // back to default -- checked again
});
