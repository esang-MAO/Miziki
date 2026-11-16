import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import { DB } from '../../src/storage/idb.js';

// healAnalysis() (src/library/thumbs.js) replaces what used to be two
// separate heal passes, healLoudness() and healHooks() -- each
// independently decoding the same track's full audio when it needed both
// measurements, and run concurrently (unawaited) from main.js/import.js.
// That meant two full PCM decodes of the same long track alive in memory
// at once, which crashed real libraries with several 10-15 minute tracks
// (2026-11-16, Ken). analyzeTrack() already returns both measurements
// from one decode, so this file's main job is proving the merged pass
// decodes each qualifying track exactly once.
//
// thumbs.js's own wide real dependency chain (edit.js, credits.js,
// profile/screens.js, crate/model.js, audio/engine.js) is stopped at the
// door the same way tests/unit/lockscreen-artwork.test.js already does for
// the same module.
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

const decodeCalls = [];
mock.module(new URL('../../src/audio/engine.js', import.meta.url).href, {
  namedExports: {
    decodeAudioFile: async (raw) => { decodeCalls.push(raw); return { numberOfChannels: 1, sampleRate: 44100, getChannelData(){ return new Float32Array(4); } }; },
    ensureContext: async () => {},
  },
});

const analyzeCalls = [];
let analyzeResult = { loudness: { measured: true, truePeakVersion: 2 }, hook: { hookStart: 10, hookEnd: 20 } };
mock.module(new URL('../../src/audio/analysis-client.js', import.meta.url).href, {
  namedExports: {
    analyzeTrack: async (channels, sampleRate) => { analyzeCalls.push({ channels, sampleRate }); return analyzeResult; },
  },
});

const { healAnalysis } = await import('../../src/library/thumbs.js');
const { S } = await import('../../src/state.js');
const { tracks } = await import('../../src/storage/repo.js');

function fakeTrack(overrides){
  return Object.assign({
    id: 't1', stored: true, duration: 60, meta: { ch: 2 },
    tags: { title: 'T', artist: 'A', album: 'Al', albumArtist: 'A', track: 1 },
    details: {},
  }, overrides);
}

function freshIndexedDB(){
  const factory = new IDBFactory();
  globalThis.indexedDB = factory;
  return factory;
}
function resetDB(){ DB.db = null; DB.ok = false; }
async function openFresh(){
  freshIndexedDB();
  resetDB();
  const { storage } = await import('../../src/storage/repo.js');
  await storage.open();
}

function resetState(overrides){
  Object.assign(S, { tracks: [] }, overrides);
  decodeCalls.length = 0;
  analyzeCalls.length = 0;
  analyzeResult = { loudness: { measured: true, truePeakVersion: 2 }, hook: { hookStart: 10, hookEnd: 20 } };
}

test('healAnalysis: a track missing both loudness and hookStart is decoded exactly once, not twice', async () => {
  await openFresh();
  const t = fakeTrack({ id: 't1', details: {} });
  resetState({ tracks: [t] });
  await tracks.put({ id: 't1', blob: new Blob(['x']) });

  await healAnalysis();

  assert.equal(decodeCalls.length, 1);
  assert.equal(analyzeCalls.length, 1);
  assert.deepEqual(t.details.loudness, { measured: true, truePeakVersion: 2 });
  assert.equal(t.details.hookStart, 10);
  assert.equal(t.details.hookEnd, 20);
  DB.db.close();
});

test('healAnalysis: a track that only needs hookStart still gets a single decode and both fields written', async () => {
  await openFresh();
  const t = fakeTrack({ id: 't1', details: { loudness: { measured: true, truePeakVersion: 2 } } });
  resetState({ tracks: [t] });
  await tracks.put({ id: 't1', blob: new Blob(['x']) });

  await healAnalysis();

  assert.equal(decodeCalls.length, 1);
  assert.equal(t.details.hookStart, 10);
  DB.db.close();
});

test('healAnalysis: a fully-measured track (current loudness version and a hookStart) is skipped entirely', async () => {
  await openFresh();
  const t = fakeTrack({ id: 't1', details: { loudness: { measured: true, truePeakVersion: 2 }, hookStart: 5, hookEnd: 15 } });
  resetState({ tracks: [t] });
  await tracks.put({ id: 't1', blob: new Blob(['x']) });

  await healAnalysis();

  assert.equal(decodeCalls.length, 0);
  assert.equal(t.details.hookStart, 5);
  DB.db.close();
});

test('healAnalysis: a track with no details object yet is left for healDetails() first', async () => {
  await openFresh();
  const t = fakeTrack({ id: 't1', details: null });
  resetState({ tracks: [t] });
  await tracks.put({ id: 't1', blob: new Blob(['x']) });

  await healAnalysis();

  assert.equal(decodeCalls.length, 0);
  DB.db.close();
});

test('healAnalysis: an estimated-too-long track is never decoded, even if unmeasured', async () => {
  await openFresh();
  // ~70 minutes stereo at the heal pass's 48kHz estimate rate -- well past
  // DECODE_MAX_BYTES (~52 minutes) -- so tooLongToHeal() excludes it.
  const t = fakeTrack({ id: 't1', duration: 70 * 60, details: {} });
  resetState({ tracks: [t] });
  await tracks.put({ id: 't1', blob: new Blob(['x']) });

  await healAnalysis();

  assert.equal(decodeCalls.length, 0);
  DB.db.close();
});
