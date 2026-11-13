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
  },
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
  namedExports: { reconcileImportedTrack: () => {} },
});
mock.module(new URL('../../src/library/booklet.js', import.meta.url).href, {
  namedExports: {
    isBookletPageCandidate: () => false,
    groupBookletCandidatesByAlbumFolder: () => new Map(),
    addBookletPages: async () => {},
  },
});
const storageState = { available: false };
mock.module(new URL('../../src/storage/repo.js', import.meta.url).href, {
  namedExports: {
    storage: { available: () => storageState.available },
    tracks: { put: async () => true },
  },
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
mock.module(new URL('../../src/ui/path-note.js', import.meta.url).href, {
  namedExports: { setPathNote: () => {} },
});

const { addFiles } = await import('../../src/library/import.js');
const { S } = await import('../../src/state.js');
const { resolveDupSheetClose, dupSheetTitle } = await import('../../src/library/duplicates-logic.js');

// A minimal fake File: arrayBuffer() resolves to a tiny ArrayBuffer carrying
// __tags/__buffer as non-enumerable-ish side channels the mocked
// readTags()/decodeAudioFile() above read straight back off, since nothing
// here needs a real byte-level FLAC/MP3 parse.
function fakeFile({ name, title, artist = 'Artist', album = 'Album', duration = 180, size = 1000 }){
  const raw = new ArrayBuffer(8);
  raw.__tags = { title, artist, album, track: 1, disc: 0 };
  raw.__buffer = { duration, numberOfChannels: 2, sampleRate: 44100, getChannelData: () => new Float32Array(0) };
  return {
    name, size, lastModified: 1,
    type: 'audio/flac',
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
}

test('addFiles: 0 duplicates never opens the sheet', async () => {
  resetAll();
  await addFiles([fakeFile({ name: 'a.flac', title: 'Song A' }), fakeFile({ name: 'b.flac', title: 'Song B' })]);
  assert.equal(openDuplicatesSheetCalls.length, 0);
  assert.equal(S.tracks.length, 2);
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

test('resolveDupSheetClose: closing Review right after its very first file (none decided yet) skips all of them with the right count', () => {
  const { choices, toast } = resolveDupSheetClose({ mode: 'review', finalAction: null, choices: [], reviewIndex: 0, n: 4 });
  assert.deepEqual(choices, ['skip', 'skip', 'skip', 'skip']);
  assert.equal(toast, "Skipped 4 you didn't review.");
});
