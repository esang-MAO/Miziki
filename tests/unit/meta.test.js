import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import { DB } from '../../src/storage/idb.js';

// src/storage/meta.js's applyPrefs() (reached via restoreMeta() whenever a
// saved prefs row exists — saveMeta() always writes one) calls real
// setMode()/applyCharacter()/applyVolume()/toggleShuffle()/cycleRepeat()/
// bgUpdateUI()/applyBgAudioSetting(), plus the bare `document.
// querySelectorAll` global and util/dom.js's `$` — none of which this test
// cares about, and all of which would otherwise need a browser (setMode
// alone touches document.documentElement.style.setProperty). Mocked
// directly, the same "stop the chain at the door" reasoning every other
// mock-heavy file in this suite already uses, so loading the real meta.js
// doesn't pull in audio/mode.js's real routeSource->audio/engine.js chain,
// player/controls.js's real advance->player/queue.js chain, or
// player/background.js's own chain.
function fakeEl(){ return { textContent: '', style: {}, setAttribute(){} }; }
mock.module(new URL('../../src/util/dom.js', import.meta.url).href, {
  namedExports: { $(){ return fakeEl(); }, el(){ return fakeEl(); } },
});
mock.module(new URL('../../src/audio/mode.js', import.meta.url).href, {
  namedExports: { setMode(){} },
});
mock.module(new URL('../../src/audio/engine.js', import.meta.url).href, {
  namedExports: { applyCharacter(){}, ensureContext(){} },
});
mock.module(new URL('../../src/sundown/location.js', import.meta.url).href, {
  namedExports: { applyVolume(){} },
});
mock.module(new URL('../../src/player/controls.js', import.meta.url).href, {
  namedExports: { toggleShuffle(){}, cycleRepeat(){} },
});
mock.module(new URL('../../src/player/background.js', import.meta.url).href, {
  namedExports: { bgUpdateUI(){}, applyBgAudioSetting(){} },
});
// Since step 7c, meta.js's attachLaunchSettingRow import is a real one from
// src/launch/intro.js instead of main.js — mocked directly here, same
// "stop the chain at the door" reasoning as the rest of this file, since
// the real intro.js would pull in crate/tiers.js/library/thumbs.js and,
// through those, the same wide chains already stopped above.
mock.module(new URL('../../src/launch/intro.js', import.meta.url).href, {
  namedExports: { attachLaunchSettingRow(){} },
});
globalThis.document = { querySelectorAll(){ return []; } };

const { queueSave, restoreMeta } = await import('../../src/storage/meta.js');
const { S } = await import('../../src/state.js');

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

function fakeTrack(id, overrides){
  return Object.assign({
    id, addedAt: 0, tags: { title: id, artist: 'A', album: 'Al', albumArtist: 'A', track: 1, disc: 0 },
  }, overrides);
}

function resetState(overrides){
  Object.assign(S, {
    tracks: [], playlists: [], albumOrder: {}, albumSort: {},
    char: { wow: 0.30, sat: 0.35, soft: 0.40, comp: 0.35, scratch: true },
    mode: 'vinyl', target: 0.80, pace: 'window', auto: true, librarySort: 'artist',
    sleevePullEnabled: true, bgAudio: false, launchIntro: true,
    libraryLayout: 'crate', crateGroup: 'az', crateAnchor: null, albumSides: false,
    sealedRecords: true, playInFullPlayer: true, shareStyle: 'night', shareFormat: null,
    shuffle: false, repeat: 'off', view: { mode: 'crate', group: null },
  }, overrides);
}

// saveMeta() isn't exported (it never was, even in main.js) — these tests
// reach it the same way the real app always does, through the debounced
// queueSave(), waiting out its 600ms timer below.
test('round trip: saveMeta()/restoreMeta() preserve playlists, album order, album sort', async () => {
  await openFresh();
  resetState({
    tracks: [fakeTrack('t1'), fakeTrack('t2'), fakeTrack('t3')],
    playlists: [{ name: 'Faves', items: [0, 2], system: undefined }],
    albumOrder: { Al: [2, 0, 1] },
    albumSort: { Al: 'manual' },
  });

  // force an immediate save rather than waiting on the 600ms debounce
  queueSave();
  await new Promise(r => setTimeout(r, 650));

  resetState({ tracks: [fakeTrack('t1'), fakeTrack('t2'), fakeTrack('t3')] });
  await restoreMeta();

  assert.equal(S.playlists.length, 1);
  assert.equal(S.playlists[0].name, 'Faves');
  assert.deepEqual(S.playlists[0].items, [0, 2]);
  assert.deepEqual(S.albumOrder.Al, [2, 0, 1]);
  assert.equal(S.albumSort.Al, 'manual');

  DB.db.close();
});

test('restoreMeta: a playlist entry whose track no longer exists is dropped, not thrown on', async () => {
  await openFresh();
  resetState({
    tracks: [fakeTrack('t1'), fakeTrack('t2'), fakeTrack('gone')],
    playlists: [{ name: 'Mix', items: [0, 1, 2], system: undefined }],
  });
  queueSave();
  await new Promise(r => setTimeout(r, 650));

  // 'gone' no longer in the library on restore
  resetState({ tracks: [fakeTrack('t1'), fakeTrack('t2')] });
  await assert.doesNotReject(() => restoreMeta());

  assert.equal(S.playlists.length, 1);
  assert.deepEqual(S.playlists[0].items, [0, 1]);

  DB.db.close();
});

// Uses a real 650ms wait rather than node:test's mock.timers: saveMeta()'s
// own body awaits fake-indexeddb requests, whose completion callbacks fire
// on the real event loop regardless of whether setTimeout is faked, so
// ticking a fake clock here would still need a real await afterward to let
// those settle — a plain real wait is simpler and no less deterministic.
test('queueSave debounces: several calls within 600ms produce exactly one save', async (t) => {
  await openFresh();
  resetState({ tracks: [fakeTrack('t1')], playlists: [{ name: 'X', items: [0], system: undefined }] });

  const { meta } = await import('../../src/storage/repo.js');
  const putSpy = t.mock.method(meta, 'put');

  queueSave(); queueSave(); queueSave();
  await new Promise(r => setTimeout(r, 650));

  // one saveMeta() run writes four keys (playlists/albumOrder/albumSort/prefs) —
  // count only the 'playlists' key to confirm saveMeta() itself ran once
  const playlistWrites = putSpy.mock.calls.filter(c => c.arguments[0] === 'playlists');
  assert.equal(playlistWrites.length, 1);

  DB.db.close();
});

test('with storage unavailable, queueSave/saveMeta/restoreMeta quietly do nothing', async () => {
  freshIndexedDB();
  resetDB(); // DB.ok stays false — storage.available() is false
  resetState({ tracks: [fakeTrack('t1')] });

  queueSave();
  await new Promise(r => setTimeout(r, 650));
  // no throw above is the main assertion; restoreMeta() must also resolve cleanly
  await assert.doesNotReject(() => restoreMeta());
  // nothing to restore, so playlists stays whatever resetState left it as
  assert.deepEqual(S.playlists, []);
});
