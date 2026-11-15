// LB1 (docs/36A_LIBRARY_AND_LAUNCH.md, decision 1): "duplicates during an
// import are one decision, not one per file." These tests cover addFiles()'s
// own collect-don't-ask loop (src/library/import.js) and the pure close
// logic for the new sheet (src/library/duplicates-ui.js's
// resolveDupSheetClose()/dupSheetTitle()).
//
// addFiles()'s real chain is wide (decodeAudioFile, analyzeTrack, storage,
// crate/profile/social bookkeeping, ...) -- every one of those is mocked to
// a minimal stand-in, the same "stop the chain at the door" posture
// tests/unit/delete.test.js and tests/unit/forget-library.test.js already
// use for the sibling library-mutation chains. record-art/tiers.js and
// library/model.js are left real (pure, already imported directly by other
// suites, e.g. tiers.test.js).
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

globalThis.MizikiSocial = { libraryChanged(){} };

mock.module(new URL('../../src/audio/engine.js', import.meta.url).href, {
  namedExports: {
    ensureContext: async () => {},
    decodeAudioFile: async (raw) => raw.__buffer,
  },
});
// BD4 (docs/38_BEFORE_THE_DOMAIN.md): import.js no longer calls analyzeTrack()
// inline -- it hands loudness/hook measurement off to thumbs.js's
// healLoudness()/healHooks() once the batch ends, so those are mocked here
// instead of analysis-client.js.
const healCalls = { loudness: 0, hooks: 0 };
mock.module(new URL('../../src/library/thumbs.js', import.meta.url).href, {
  namedExports: {
    healLoudness: async () => { healCalls.loudness++; },
    healHooks: async () => { healCalls.hooks++; },
  },
});
mock.module(new URL('../../src/library/tags/index.js', import.meta.url).href, {
  namedExports: {
    readHeader: () => ({ codec: 'FLAC', rate: 44100, bits: 16, lossless: true, ch: 2 }),
    readTags: (raw) => raw.__tags,
    readDetails: () => ({}),
    findArtworkBlob: () => null,
    emptyDetails: () => ({}),
  },
});
const openDuplicatesSheetCalls = [];
mock.module(new URL('../../src/library/duplicates-ui.js', import.meta.url).href, {
  namedExports: {
    openDuplicatesSheet: (pending, imported, onResolved) => {
      openDuplicatesSheetCalls.push({ pending, imported, onResolved });
    },
  },
});
mock.module(new URL('../../src/library/edit.js', import.meta.url).href, {
  namedExports: { loadOverlayFor: async () => {} },
});
const deletedIds = [];
mock.module(new URL('../../src/library/delete.js', import.meta.url).href, {
  namedExports: {
    deleteTracks: async (ids) => {
      deletedIds.push(...ids);
      const { S } = await import('../../src/state.js');
      S.tracks = S.tracks.filter(t => !ids.includes(t.id));
    },
    formatBytes(n){
      if(!n) return '0 MB';
      const units = ['B','KB','MB','GB','TB'];
      let i = 0;
      while(n >= 1024 && i < units.length - 1){ n /= 1024; i++; }
      return n.toFixed(i === 0 ? 0 : 1) + ' ' + units[i];
    },
  },
});
// BD5: readUsage() default (null) means "nothing to check against" -- the
// fit-check tests below set usageState.result for the duration of one test.
const usageState = { result: null };
mock.module(new URL('../../src/storage/usage.js', import.meta.url).href, {
  namedExports: { readUsage: async () => usageState.result },
});
mock.module(new URL('../../src/library/credits.js', import.meta.url).href, {
  namedExports: { rebuildPeopleIndex: () => {} },
});
mock.module(new URL('../../src/library/sealed.js', import.meta.url).href, {
  namedExports: { persistSealedAlbums: () => {} },
});
mock.module(new URL('../../src/storage/meta.js', import.meta.url).href, {
  namedExports: { queueSave: () => {} },
});
mock.module(new URL('../../src/crate/model.js', import.meta.url).href, {
  namedExports: { invalidateCrateModel: () => {} },
});
mock.module(new URL('../../src/crate/tiers.js', import.meta.url).href, {
  namedExports: { healCrateArt: async () => {} },
});
mock.module(new URL('../../src/library/view.js', import.meta.url).href, {
  namedExports: { renderTracks: () => {} },
});
mock.module(new URL('../../src/sync/backup.js', import.meta.url).href, {
  namedExports: {
    reconcileImportedTrack: () => {},
    // BD10 (docs/38_BEFORE_THE_DOMAIN.md): gatefold/back-cover.js's own
    // import, pulled in transitively now that import.js calls
    // setAlbumBackCoverImage() for sidecar back covers -- "stop the chain
    // at the door" same as reconcileImportedTrack above. The claim/upload
    // logic itself is covered by tests/unit/gatefold-back-cover.test.js.
    queueBackCoverUpload: () => {},
    clearBackCoverClaim: () => {},
  },
});
const storageState = { available: false, putOk: true };
const backCoverArtworkStore = new Map();
mock.module(new URL('../../src/storage/repo.js', import.meta.url).href, {
  namedExports: {
    storage: { available: () => storageState.available },
    tracks: { put: async () => storageState.putOk },
    // BD10: gatefold/back-cover.js's own artwork-store use, same reason as
    // the sync/backup.js mock above.
    artwork: {
      get(id){ return Promise.resolve(backCoverArtworkStore.get(id) || null); },
      put(rec){ backCoverArtworkStore.set(rec.id, rec); return Promise.resolve(); },
      del(id){ backCoverArtworkStore.delete(id); return Promise.resolve(); },
    },
  },
});
// BD10: gatefold/back-cover.js imports wordmarkEl() only for
// buildBackCoverEl() (never called by addFiles()'s own back-cover path),
// but its own module still carries the data/wordmark.svg?raw asset import
// node:test can't resolve -- same mock tests/unit/gatefold-back-cover.test.js
// already uses for this exact reason.
mock.module(new URL('../../src/ui/wordmark.js', import.meta.url).href, {
  namedExports: { wordmarkEl(){ return { classList: { add(){} } }; } },
});
mock.module(new URL('../../src/player/buffers.js', import.meta.url).href, {
  namedExports: {
    touchLRU: () => {},
    decodedBytesFor: () => 0,
    DECODE_MAX_BYTES: 1.2 * 1024 * 1024 * 1024,
  },
});
mock.module(new URL('../../src/player/queue.js', import.meta.url).href, {
  namedExports: { setQueue: () => {} },
});
const pathNoteCalls = [];
mock.module(new URL('../../src/ui/path-note.js', import.meta.url).href, {
  namedExports: { setPathNote: (msg, warn) => { pathNoteCalls.push({ msg, warn }); } },
});

const { addFiles } = await import('../../src/library/import.js');
const { S } = await import('../../src/state.js');
const { resolveDupSheetClose, dupSheetTitle } = await import('../../src/library/duplicates-logic.js');

// A minimal fake File: arrayBuffer() resolves to a tiny ArrayBuffer carrying
// __tags/__buffer as non-enumerable-ish side channels the mocked
// readTags()/decodeAudioFile() above read straight back off, since nothing
// here needs a real byte-level FLAC/MP3 parse.
function fakeFile({ name, title, artist = 'Artist', album = 'Album', duration = 180, size = 1000, relativePath }){
  const raw = new ArrayBuffer(8);
  raw.__tags = { title, artist, album, track: 1, disc: 0 };
  raw.__buffer = { duration, numberOfChannels: 2, sampleRate: 44100, getChannelData: () => new Float32Array(0) };
  return {
    name, size, lastModified: 1,
    type: 'audio/flac',
    webkitRelativePath: relativePath || name,
    arrayBuffer: async () => raw,
  };
}
function existingTrack({ id, title, artist = 'Artist', album = 'Album', duration = 180 }){
  return {
    id, addedAt: 0, name: title, duration, art: null, artBlob: null, blob: null, stored: true,
    tags: { title, artist, album, track: 1, disc: 0 },
    details: {}, meta: { codec: 'FLAC', rate: 44100, bits: 16, lossless: true, ch: 2 },
  };
}

function resetAll(){
  S.tracks = [];
  S.sealed = new Set();
  S.index = -1;
  openDuplicatesSheetCalls.length = 0;
  deletedIds.length = 0;
  pathNoteCalls.length = 0;
  usageState.result = null;
  storageState.available = false;
  storageState.putOk = true;
  backCoverArtworkStore.clear();
  S.albumBackCover = {};
  S.backupUpdatedAt.albumBackCover = {};
}

// BD10 (docs/38_BEFORE_THE_DOMAIN.md): a sidecar image file, same shape
// fakeFile() builds for audio but with no decodable tags/buffer -- the
// back-cover path never reaches readTags()/decodeAudioFile() for these,
// it only ever reads .name/.size/.webkitRelativePath.
function fakeImageFile({ name, relativePath, size = 2000 }){
  return { name, size, lastModified: 1, type: 'image/jpeg', webkitRelativePath: relativePath || name,
    arrayBuffer: async () => new ArrayBuffer(0) };
}

test('addFiles: 0 duplicates never opens the sheet', async () => {
  resetAll();
  await addFiles([fakeFile({ name: 'a.flac', title: 'Song A' }), fakeFile({ name: 'b.flac', title: 'Song B' })]);
  assert.equal(openDuplicatesSheetCalls.length, 0);
  assert.equal(S.tracks.length, 2);
});

// BD5 (docs/38_BEFORE_THE_DOMAIN.md): a batch that plainly won't fit never
// starts at all, rather than failing file by file partway through.
test('addFiles: a batch over the device\'s free space never starts, and says so', async () => {
  resetAll();
  const GB = 1024 * 1024 * 1024;
  usageState.result = { usage: 58 * GB, quota: 60 * GB };   // 2 GB free
  await addFiles([fakeFile({ name: 'big.flac', title: 'Big', size: 4.1 * GB })]);
  assert.equal(S.tracks.length, 0);
  assert.equal(pathNoteCalls.length, 1);
  assert.match(pathNoteCalls[0].msg, /need 4\.1 GB/);
  assert.match(pathNoteCalls[0].msg, /2\.0 GB free/);
  assert.equal(pathNoteCalls[0].warn, true);
});

test('addFiles: a batch that fits within free space imports as normal', async () => {
  resetAll();
  const GB = 1024 * 1024 * 1024;
  usageState.result = { usage: 1 * GB, quota: 60 * GB };
  await addFiles([fakeFile({ name: 'a.flac', title: 'Song A', size: 1000 })]);
  assert.equal(S.tracks.length, 1);
});

test('addFiles: readUsage() returning null (unsupported) never blocks an import', async () => {
  resetAll();
  usageState.result = null;
  await addFiles([fakeFile({ name: 'a.flac', title: 'Song A', size: 50 * 1024 * 1024 * 1024 })]);
  assert.equal(S.tracks.length, 1);
});

// BD5: storeTrack() returning false used to be silent.
test('addFiles: a track storeTrack() fails to save is named in the end-of-batch summary', async () => {
  resetAll();
  storageState.available = true;
  storageState.putOk = false;
  await addFiles([fakeFile({ name: 'a.flac', title: 'Song A' })]);
  assert.equal(S.tracks.length, 1);
  assert.equal(S.tracks[0].stored, false);
  const note = pathNoteCalls[pathNoteCalls.length - 1];
  assert.match(note.msg, /Not saved: a\.flac/);
  assert.equal(note.warn, true);
});

test('addFiles: a track storeTrack() succeeds on is never mentioned as not saved', async () => {
  resetAll();
  storageState.available = true;
  storageState.putOk = true;
  await addFiles([fakeFile({ name: 'a.flac', title: 'Song A' })]);
  assert.equal(S.tracks[0].stored, true);
  assert.equal(pathNoteCalls.some(c => /Not saved/.test(c.msg)), false);
});

// BD4 (docs/38_BEFORE_THE_DOMAIN.md): a track lands in the library and is
// playable the moment its file is decoded, with loudness/hook measurement
// left for the heal passes that run once the batch ends -- not awaited
// inline per file the way it used to be.
test('addFiles: a track is in S.tracks and stored before any loudness/hook measurement exists, then the heal pass is what fills it in', async () => {
  resetAll();
  healCalls.loudness = 0; healCalls.hooks = 0;
  storageState.available = true;
  try{
    await addFiles([fakeFile({ name: 'a.flac', title: 'Song A' })]);
    assert.equal(S.tracks.length, 1);
    assert.equal(S.tracks[0].stored, true);
    assert.equal(S.tracks[0].details.loudness, undefined);
    assert.equal(S.tracks[0].details.hookStart, undefined);
    // syncAfterImportChange() kicks off the existing healLoudness()/healHooks()
    // idle passes once the batch ends -- the real passes are mocked above
    // (thumbs.js is "stop the chain at the door" here too), so this only
    // proves addFiles() still calls them once the track is stored, not what
    // they themselves do (their own body is untouched by this step).
    assert.equal(healCalls.loudness, 1);
    assert.equal(healCalls.hooks, 1);
  }finally{ storageState.available = false; }
});

test('addFiles: 1 duplicate opens the sheet with exactly one pending item, after the non-duplicate already landed', async () => {
  resetAll();
  S.tracks = [existingTrack({ id: 'existing-1', title: 'Song A' })];
  await addFiles([
    fakeFile({ name: 'new.flac', title: 'Song B' }),          // not a duplicate
    fakeFile({ name: 'a-again.flac', title: 'Song A' }),       // duplicate of existing-1
  ]);
  // the non-duplicate is already in the library by the time the sheet opens
  assert.equal(S.tracks.some(t => t.tags.title === 'Song B'), true);
  assert.equal(openDuplicatesSheetCalls.length, 1);
  assert.equal(openDuplicatesSheetCalls[0].pending.length, 1);
  assert.equal(openDuplicatesSheetCalls[0].imported, 1);
  assert.equal(openDuplicatesSheetCalls[0].pending[0].existingTrack.id, 'existing-1');
});

test('addFiles: 12 duplicates against 3 already-imported non-duplicates opens one sheet with all 12 pending, counting the 3 as already imported', async () => {
  resetAll();
  const existing = [];
  for(let i = 0; i < 12; i++) existing.push(existingTrack({ id: 'existing-' + i, title: 'Dup ' + i }));
  S.tracks = existing;
  const files = [];
  for(let i = 0; i < 3; i++) files.push(fakeFile({ name: 'fresh' + i + '.flac', title: 'Fresh ' + i }));
  for(let i = 0; i < 12; i++) files.push(fakeFile({ name: 'dup' + i + '.flac', title: 'Dup ' + i }));
  await addFiles(files);
  assert.equal(openDuplicatesSheetCalls.length, 1);
  assert.equal(openDuplicatesSheetCalls[0].pending.length, 12);
  assert.equal(openDuplicatesSheetCalls[0].imported, 3);
  // the 3 fresh songs are already in the library, the 12 duplicates are not yet
  assert.equal(S.tracks.filter(t => t.tags.title.startsWith('Fresh')).length, 3);
  assert.equal(S.tracks.filter(t => t.tags.title.startsWith('Dup')).length, 12); // still just the originals
});

test('addFiles: resolving "keep" for every pending duplicate adds all of them alongside the originals', async () => {
  resetAll();
  S.tracks = [existingTrack({ id: 'existing-1', title: 'Song A' })];
  await addFiles([fakeFile({ name: 'a-again.flac', title: 'Song A' })]);
  const { pending, onResolved } = openDuplicatesSheetCalls[0];
  await onResolved(pending.map(item => ({ item, choice: 'keep' })));
  assert.equal(S.tracks.length, 2);
  assert.ok(S.tracks.some(t => t.id === 'existing-1'));
});

test('addFiles: resolving "skip" for every pending duplicate adds none of them', async () => {
  resetAll();
  S.tracks = [existingTrack({ id: 'existing-1', title: 'Song A' })];
  await addFiles([fakeFile({ name: 'a-again.flac', title: 'Song A' })]);
  const { pending, onResolved } = openDuplicatesSheetCalls[0];
  await onResolved(pending.map(item => ({ item, choice: 'skip' })));
  assert.equal(S.tracks.length, 1);
  assert.equal(S.tracks[0].id, 'existing-1');
});

test('addFiles: resolving "replace" removes the matched existing track and adds the new one', async () => {
  resetAll();
  S.tracks = [existingTrack({ id: 'existing-1', title: 'Song A' })];
  await addFiles([fakeFile({ name: 'a-again.flac', title: 'Song A' })]);
  const { pending, onResolved } = openDuplicatesSheetCalls[0];
  await onResolved(pending.map(item => ({ item, choice: 'replace' })));
  assert.equal(S.tracks.length, 1);
  assert.deepEqual(deletedIds, ['existing-1']);
  assert.notEqual(S.tracks[0].id, 'existing-1');
  assert.equal(S.tracks[0].tags.title, 'Song A');
});

// --- pure sheet-close logic (src/library/duplicates-ui.js) ---

test('dupSheetTitle: singular vs plural wording', () => {
  assert.equal(dupSheetTitle(1), '1 possible duplicate');
  assert.equal(dupSheetTitle(0), '0 possible duplicates');
  assert.equal(dupSheetTitle(12), '12 possible duplicates');
});

test('resolveDupSheetClose: Keep both for all resolves every item to keep', () => {
  const { choices, toast } = resolveDupSheetClose({ mode: 'summary', finalAction: 'keepAll', choices: [], reviewIndex: 0, n: 3 });
  assert.deepEqual(choices, ['keep', 'keep', 'keep']);
  assert.equal(toast, null);
});

test('resolveDupSheetClose: Skip all resolves every item to skip', () => {
  const { choices, toast } = resolveDupSheetClose({ mode: 'summary', finalAction: 'skipAll', choices: [], reviewIndex: 0, n: 3 });
  assert.deepEqual(choices, ['skip', 'skip', 'skip']);
  assert.equal(toast, null);
});

test('resolveDupSheetClose: closing the summary sheet with no button pressed (X / swipe / Back) means Skip all', () => {
  const { choices, toast } = resolveDupSheetClose({ mode: 'summary', finalAction: null, choices: [null, null], reviewIndex: 0, n: 2 });
  assert.deepEqual(choices, ['skip', 'skip']);
  assert.equal(toast, null);
});

test('resolveDupSheetClose: Review run to the end keeps the per-item choices as made, no toast', () => {
  const made = ['keep', 'replace', 'skip'];
  const { choices, toast } = resolveDupSheetClose({ mode: 'review', finalAction: 'reviewed', choices: made, reviewIndex: 3, n: 3 });
  assert.deepEqual(choices, made);
  assert.equal(toast, null);
});

test('resolveDupSheetClose: Review closed part-way skips the rest and reports the toast', () => {
  // decided items 0 and 1 (Keep, Replace), closed before reaching 2..9 (7 left)
  const partial = ['keep', 'replace'];
  const { choices, toast } = resolveDupSheetClose({ mode: 'review', finalAction: null, choices: partial, reviewIndex: 2, n: 9 });
  assert.deepEqual(choices, ['keep', 'replace', 'skip', 'skip', 'skip', 'skip', 'skip', 'skip', 'skip']);
  assert.equal(toast, "Skipped 7 you didn't review.");
});

// --- BD10 (docs/38_BEFORE_THE_DOMAIN.md): sidecar back-cover auto-detection ---

test('addFiles: a back-cover-named sidecar image beside an album folder is stored as that album\'s back cover', async () => {
  resetAll();
  await addFiles([
    fakeFile({ name: 'song.flac', title: 'Song A', album: 'My Album', relativePath: 'My Album/song.flac' }),
    fakeImageFile({ name: 'back.jpg', relativePath: 'My Album/back.jpg' }),
  ]);
  assert.equal(S.tracks.length, 1);
  const { albumKey } = await import('../../src/record-art/tiers.js');
  const { getAlbumBackCoverBlob } = await import('../../src/gatefold/back-cover.js');
  const aid = albumKey(S.tracks[0]);
  assert.ok(await getAlbumBackCoverBlob(aid));
});

test('addFiles: the sidecar image never reaches the decode loop (not counted as failed/imported)', async () => {
  resetAll();
  await addFiles([
    fakeFile({ name: 'song.flac', title: 'Song A', album: 'My Album', relativePath: 'My Album/song.flac' }),
    fakeImageFile({ name: 'back.jpg', relativePath: 'My Album/back.jpg' }),
  ]);
  assert.equal(S.tracks.length, 1);
  assert.equal(pathNoteCalls.some(c => /Could not decode/.test(c.msg)), false);
});

test('addFiles: several back-cover candidates in one folder -- the largest file wins', async () => {
  resetAll();
  const { albumKey } = await import('../../src/record-art/tiers.js');
  const { getAlbumBackCoverBlob } = await import('../../src/gatefold/back-cover.js');
  await addFiles([
    fakeFile({ name: 'song.flac', title: 'Song A', album: 'My Album', relativePath: 'My Album/song.flac' }),
    fakeImageFile({ name: 'rear.jpg', relativePath: 'My Album/rear.jpg', size: 100 }),
    fakeImageFile({ name: 'rear cover.jpg', relativePath: 'My Album/rear cover.jpg', size: 9000 }),
  ]);
  const aid = albumKey(S.tracks[0]);
  const blob = await getAlbumBackCoverBlob(aid);
  assert.ok(blob);
  assert.equal(blob.size, 9000);
});

test('addFiles: an album that already has a back cover is left alone', async () => {
  resetAll();
  const { albumKey } = await import('../../src/record-art/tiers.js');
  const { setAlbumBackCoverImage, getAlbumBackCoverBlob } = await import('../../src/gatefold/back-cover.js');
  // import the audio first so albumKey() has a track to compute from, then
  // hand-pick a cover before the (second) batch that carries the sidecar image
  await addFiles([fakeFile({ name: 'song.flac', title: 'Song A', album: 'My Album', relativePath: 'My Album/song.flac' })]);
  const aid = albumKey(S.tracks[0]);
  const picked = { size: 1, __picked: true };
  await setAlbumBackCoverImage(aid, picked);
  await addFiles([
    fakeFile({ name: 'song2.flac', title: 'Song B', album: 'My Album', relativePath: 'My Album/song2.flac' }),
    fakeImageFile({ name: 'back.jpg', relativePath: 'My Album/back.jpg', size: 9999 }),
  ]);
  assert.equal(await getAlbumBackCoverBlob(aid), picked);
});

test('resolveDupSheetClose: closing Review right after its very first file (none decided yet) skips all of them with the right count', () => {
  const { choices, toast } = resolveDupSheetClose({ mode: 'review', finalAction: null, choices: [], reviewIndex: 0, n: 4 });
  assert.deepEqual(choices, ['skip', 'skip', 'skip', 'skip']);
  assert.equal(toast, "Skipped 4 you didn't review.");
});
