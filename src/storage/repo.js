/* ================= storage interface =================
   A small domain interface on top of the raw IndexedDB wrapper (`DB`,
   src/storage/idb.js, step 4a), replacing ~100 direct `DB.put`/`DB.get`/etc.
   calls spread across main.js (step 4c). Code asks for *what* it needs
   ("the overlay for this track", "this album's play counts") rather than
   *how* it's stored — when Miziki becomes an App Store app, only the
   inside of this module should need to change (see the note at the bottom
   of this file).

   One small object per store, with only the methods something in main.js
   actually calls — no method here that nothing uses. `storage.available()`
   replaces direct reads of `DB.ok`; `storage.open()` is the one call that
   opens the database at boot. Every store keeps today's "storage
   unavailable" behavior exactly, because it's just forwarding to `DB`,
   which already handles that: `get`/`del`/`open` resolve `false`/`null`,
   `all` resolves `[]`, `put`/`clear` no-op — nothing here throws. */
import { DB } from './idb.js';

export const storage = {
  available(){ return DB.ok; },
  open(){ return DB.open(); },
};

export const tracks = {
  get(id){ return DB.get('tracks', id); },
  put(rec){ return DB.put('tracks', rec); },
  all(){ return DB.all('tracks'); },
  del(id){ return DB.del('tracks', id); },
  clear(){ return DB.clear('tracks'); },
};

// `meta` is the one store where DB's own shape ({k, v}, read back from
// DB.get as the whole row) isn't what callers actually want — every call
// site immediately unwrapped `.v` (or checked it was there before using
// it). `meta.get` does that unwrapping once, here, returning the bare
// value (or null, same as a missing key or storage being unavailable —
// callers never had a reason to tell those apart). `meta.put` takes the
// key and value as separate arguments and builds the `{k, v}` row itself.
export const meta = {
  async get(key){
    const row = await DB.get('meta', key);
    return row ? row.v : null;
  },
  put(key, value){ return DB.put('meta', { k: key, v: value }); },
  del(key){ return DB.del('meta', key); },
  clear(){ return DB.clear('meta'); },
  // artwork thumbnails live as their own meta rows, keyed 'thumb:<kind>:<id>'
  // (see main.js's ensureThumb/restoreThumbs) — the only place main.js reads
  // `meta` by scanning all its rows rather than by one key, so it gets its
  // own named method instead of a generic `all()` nothing else would call.
  // Keys come back with the 'thumb:' prefix already stripped, matching what
  // restoreThumbs has always done with the slice itself.
  async thumbs(){
    const rows = await DB.all('meta');
    return rows
      .filter(r => r && typeof r.k === 'string' && r.k.indexOf('thumb:') === 0 && r.v instanceof Blob)
      .map(r => ({ key: r.k.slice(6), blob: r.v }));
  },
};

export const sessions = {
  put(rec){ return DB.put('sessions', rec); },
  all(){ return DB.all('sessions'); },
  del(id){ return DB.del('sessions', id); },
  clear(){ return DB.clear('sessions'); },
};

export const achievements = {
  put(rec){ return DB.put('achievements', rec); },
  all(){ return DB.all('achievements'); },
  del(id){ return DB.del('achievements', id); },
  clear(){ return DB.clear('achievements'); },
};

export const collection = {
  put(rec){ return DB.put('collection', rec); },
  all(){ return DB.all('collection'); },
  del(id){ return DB.del('collection', id); },
  clear(){ return DB.clear('collection'); },
};

export const overlays = {
  get(id){ return DB.get('overlays', id); },
  put(rec){ return DB.put('overlays', rec); },
  del(id){ return DB.del('overlays', id); },
  clear(){ return DB.clear('overlays'); },
};

export const artwork = {
  get(id){ return DB.get('artwork', id); },
  put(rec){ return DB.put('artwork', rec); },
  del(id){ return DB.del('artwork', id); },
  clear(){ return DB.clear('artwork'); },
};

export const profile = {
  get(key){ return DB.get('profile', key); },
  put(rec){ return DB.put('profile', rec); },
};

/* App Store plan (a note only — not built here): in a native shell, the
   audio bytes (tracks.blob), artwork blobs (artwork.*.blob) and the
   thumb:* blobs currently kept inside meta rows should live as files on
   the device, with only small records left in the database (paths/ids,
   not bytes). This module is where that split would happen — callers
   already never touch a blob's storage directly, they go through
   tracks.get/put, artwork.get/put and meta.thumbs()/get/put, so swapping
   what's behind those methods is the only change a future step would need
   to make. */
