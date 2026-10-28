import { S, touchBackupKey } from '../state.js';
import { $ } from '../util/dom.js';
import { sleep } from '../util/async.js';
import { albumKey, trackIdentityKey } from '../record-art/tiers.js';
import { storage, tracks, meta } from '../storage/repo.js';
import { cropSquareImage } from './edit.js';
import { readDetails, emptyDetails } from './tags/index.js';
import { rebuildPeopleIndex, updateCreditsButtonForCurrent } from './credits.js';
import { renderProfile } from '../profile/screens.js';
import { invalidateCrateModel } from '../crate/model.js';
import { decodeAudioFile } from '../audio/engine.js';
import { TRUE_PEAK_VERSION } from '../audio/loudness.js';
import { analyzeTrack } from '../audio/analysis-client.js';

/* ---- persisted artwork: thumbnails, never object URLs ----
   t.art is a URL.createObjectURL() string, which stops working the moment the
   page reloads — so anything persisted with it (Top Albums, achievements, the
   Collection, Top Songs) came back with broken images after a restart. These
   records now carry no art of their own: a small JPEG thumbnail per album and
   per track is stored once under its own key in the meta store ('thumb:album:…'
   / 'thumb:track:…'), and the `art` URL on each record is rebuilt from that
   thumbnail each session. Nothing the renderers read has changed — they still
   see a plain `art` URL — and the thumbnails survive the original file being
   removed from the library, which is what orphaned stats need. */
const ALBUM_THUMB_PX = 800, TRACK_THUMB_PX = 300;
// 'album:<id>' / 'track:<key>' -> live object URL for this session. Exported
// read-only: main.js's own crate/gatefold/sealed-sheet art fallbacks (none
// of which moved in this step) still read this map directly by key, the
// same expression shape as before the move.
export const thumbURL = {};
const thumbSrcSeen = {};   // which artwork URL each thumbnail was last cut from, this session

async function makeThumb(url, px){
  try{
    const blob = await (await fetch(url)).blob();
    return await cropSquareImage(blob, px);
  }catch(_e){ return null; }
}

/* ---- PL7 item 1 (docs/19_PLAYER.md): lock-screen artwork ----
   The Now Playing widget iOS shows on the lock screen is drawn by a
   separate OS process, not the page itself — a blob: object URL (what
   every other artwork reference in this app uses, t.art included) is
   scoped to this document and isn't guaranteed to still resolve once the
   page is backgrounded long enough for that process to actually need it.
   A data: URI has no such lifetime dependency, so lock-screen artwork is
   generated as data URLs specifically, at the three sizes PL7 calls for
   (256/512/1024), with their own `type` — never reusing t.art or a
   thumbs.js thumbnail's existing object URL as-is. */
export const LOCKSCREEN_ART_SIZES = [256, 512, 1024];
const LOCKSCREEN_ART_CACHE_MAX = 4;   // only ever the current (and maybe just-previous) track matters
const lockscreenArtCache = new Map();   // trackId -> {source, entries}

// Pure: whether a cached lock-screen artwork entry can be reused for this
// track id and artwork source, pulled out so the cache-hit logic is
// unit-testable without canvas/fetch/DOM.
export function lockscreenArtCacheHit(cached, source){
  return !!cached && !!source && cached.source === source;
}

export function peekLockscreenArtwork(t){
  if(!t || !t.art) return null;
  const cached = lockscreenArtCache.get(t.id);
  return lockscreenArtCacheHit(cached, t.art) ? cached.entries : null;
}

async function cropSquareDataURL(url, maxDim){
  const blob = await (await fetch(url)).blob();
  const bmp = await createImageBitmap(blob);
  const side = Math.min(bmp.width, bmp.height);
  const sx = (bmp.width - side) / 2, sy = (bmp.height - side) / 2;
  const out = Math.min(maxDim, side);
  const canvas = document.createElement('canvas');
  canvas.width = out; canvas.height = out;
  canvas.getContext('2d').drawImage(bmp, sx, sy, side, side, 0, 0, out, out);
  return canvas.toDataURL('image/jpeg', 0.88);
}

// Generates (and caches, per track id) the 256/512/1024 MediaMetadata
// artwork entries for `t`. Async — a caller on the lock-screen-sync path
// should apply whatever MediaMetadata it already has immediately and
// patch the artwork in once this resolves, rather than block on it.
export async function ensureLockscreenArtwork(t){
  if(!t || !t.art) return [];
  const hit = peekLockscreenArtwork(t);
  if(hit) return hit;
  try{
    const entries = [];
    for(const px of LOCKSCREEN_ART_SIZES){
      const dataUrl = await cropSquareDataURL(t.art, px);
      entries.push({src: dataUrl, sizes: px + 'x' + px, type: 'image/jpeg'});
    }
    if(lockscreenArtCache.size >= LOCKSCREEN_ART_CACHE_MAX){
      lockscreenArtCache.delete(lockscreenArtCache.keys().next().value);
    }
    lockscreenArtCache.set(t.id, {source: t.art, entries});
    return entries;
  }catch(_e){ return []; }
}

// records are saved without their runtime `art` URL
function persistableMap(map){
  const out = {};
  Object.keys(map).forEach(k => { const r = Object.assign({}, map[k]); delete r.art; out[k] = r; });
  return out;
}
// exported for history/achievements.js's upsertAchievement/upsertCollectionEntry,
// which save the same shape of record (no runtime `art` URL)
export function persistable(rec){ const r = Object.assign({}, rec); delete r.art; return r; }

function applyThumbURLs(){
  Object.keys(S.albumDisplay).forEach(id => { S.albumDisplay[id].art = thumbURL['album:' + id] || null; });
  Object.keys(S.achievements).forEach(id => { S.achievements[id].art = thumbURL['album:' + id] || null; });
  Object.keys(S.collection).forEach(id => { S.collection[id].art = thumbURL['album:' + id] || null; });
  Object.keys(S.trackDisplay).forEach(k => { S.trackDisplay[k].art = thumbURL['track:' + k] || null; });
}

let profileRefreshTimer = null;
function refreshProfileIfOpen(){
  clearTimeout(profileRefreshTimer);
  profileRefreshTimer = setTimeout(() => {
    const pr = $('#route-profile');
    if(pr && pr.classList.contains('on')) renderProfile();
  }, 300);
}

// A small average colour cut from an album's thumbnail, for the launch
// sequence's crate records — one hairline-thin read per album, so the crate
// never has to decode full artwork just to pick an edge colour.
function averageColorHex(blob){
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = 8; c.height = 8;
      const cx = c.getContext('2d');
      cx.drawImage(img, 0, 0, 8, 8);
      URL.revokeObjectURL(img.src);
      try{
        const data = cx.getImageData(0, 0, 8, 8).data;
        let r=0, g=0, b=0, n=0;
        for(let i=0; i<data.length; i+=4){ r+=data[i]; g+=data[i+1]; b+=data[i+2]; n++; }
        const hex = v => Math.round(v/n).toString(16).padStart(2,'0');
        resolve('#' + hex(r) + hex(g) + hex(b));
      }catch(_e){ resolve(null); }
    };
    img.onerror = () => resolve(null);
    img.src = URL.createObjectURL(blob);
  });
}
// RF17 (docs/12_REFINE.md): touches only the key(s) that actually changed
// — present in S.<field> it's a real per-key stamp, absent (a prune/reset
// wiped it) it becomes a tombstone the next time toDoc() runs (see
// backup-doc.js's itemWriteEntries() for why the same touch call covers
// both cases). `keys` is a single key or an array; omitted touches nothing,
// for a caller with no specific key in scope to report.
function touchKeys(field, keys){
  (Array.isArray(keys) ? keys : keys != null ? [keys] : []).forEach(k => touchBackupKey(field, k));
}
async function persistAlbumEdge(key){ await meta.put('albumEdge', S.albumEdge); touchKeys('albumEdge', key); }

async function ensureThumb(kind, id, url){
  if(!url) return;                          // this track has no artwork — keep whatever thumbnail already exists
  const key = kind + ':' + id;
  if(thumbSrcSeen[key] === url) return;     // already cut from this exact artwork this session
  thumbSrcSeen[key] = url;
  const blob = await makeThumb(url, kind === 'album' ? ALBUM_THUMB_PX : TRACK_THUMB_PX);
  if(!blob){ delete thumbSrcSeen[key]; return; }
  thumbURL[key] = URL.createObjectURL(blob);
  meta.put('thumb:' + key, blob);
  if(kind === 'album'){
    const hex = await averageColorHex(blob);
    if(hex){ S.albumEdge[id] = hex; persistAlbumEdge(id); }
  }
  applyThumbURLs();
  refreshProfileIfOpen();
}

export async function restoreThumbs(){
  const thumbs = await meta.thumbs();
  thumbs.forEach(({key, blob}) => { thumbURL[key] = URL.createObjectURL(blob); });
  applyThumbURLs();
}

// records saved before thumbnails existed have a dead URL and no thumbnail;
// rebuild theirs from the artwork still in the library, where there is any
export async function healThumbs(){
  const albumIds = new Set(Object.keys(S.albumDisplay).concat(Object.keys(S.achievements), Object.keys(S.collection)));
  const byAlbum = {}, byTrack = {};
  S.tracks.forEach(t => {
    if(!t.art) return;
    const a = albumKey(t); if(!byAlbum[a]) byAlbum[a] = t;
    byTrack[trackIdentityKey(t)] = t;
  });
  for(const id of albumIds){
    if(thumbURL['album:' + id]) continue;
    if(byAlbum[id]) await ensureThumb('album', id, byAlbum[id].art);
  }
  for(const k of Object.keys(S.trackDisplay)){
    if(thumbURL['track:' + k]) continue;
    if(byTrack[k]) await ensureThumb('track', k, byTrack[k].art);
  }
}

// PL6 item 2: one track per idle slot (requestIdleCallback, with a
// setTimeout fallback where it doesn't exist — the same fallback shape
// library/view.js's own scheduleIdle() already uses for chunked row
// rendering), instead of a fixed guessed delay (`sleep(0)`/`sleep(30)`)
// between tracks. Still pauses (never cancels) while something is
// playing or the user's hands are on a gesture (the scrub bar) — a real
// yield back to the browser's own scheduler, not just a shorter wait.
function scheduleIdle(fn){
  if(typeof requestIdleCallback === 'function') requestIdleCallback(fn, {timeout: 500});
  else setTimeout(fn, 0);
}

// Runs `processOne(item)` for each item in `items`, one per idle slot --
// awaited before the next one is even scheduled, so a slow track (decode
// + a worker round trip) never piles idle callbacks on top of each other.
// Every boot repair pass below (healDetails/healLoudness/healHooks) uses
// this same scheduling, not just the ones AU5/AU12 originally yielded for.
function runIdlePass(items, processOne){
  return new Promise(resolve => {
    function step(i){
      if(i >= items.length){ resolve(); return; }
      scheduleIdle(async () => {
        while(S.playing || S.scrubbing) await sleep(500);
        const item = items[i];
        if(S.tracks.includes(item)) await processOne(item);  // else deleted while we waited
        step(i + 1);
      });
    }
    step(0);
  });
}

// back-fills t.details (liner notes/credits) on libraries stored before that
// field existed — a non-blocking, resumable re-read of each stored file's
// own tags, same shape as healThumbs() above (see CREDITS spec §0)
export async function healDetails(){
  if(!storage.available()) return;
  const targets = S.tracks.filter(t => t.stored && !t.details);
  await runIdlePass(targets, async t => {
    try{
      const rec = await tracks.get(t.id);
      if(rec && rec.blob){
        const raw = await rec.blob.arrayBuffer();
        t.details = readDetails(raw);
        rec.details = t.details;
        await tracks.put(rec);
      } else {
        t.details = emptyDetails();
      }
    }catch(_e){ t.details = emptyDetails(); }
  });
  if(typeof rebuildPeopleIndex === 'function') rebuildPeopleIndex();
  if(typeof invalidateCrateModel === 'function') invalidateCrateModel();
  if(typeof updateCreditsButtonForCurrent === 'function') updateCreditsButtonForCurrent();
}

// AU5 (docs/16_AUDIO.md §4): "Run an idle-time pass over the existing
// library once" — a library imported before this feature existed has
// details.loudness still unset; this measures it the same resumable way
// healDetails() already backfills a missing details object entirely.
export async function healLoudness(){
  if(!storage.available()) return;
  // PL5 item 4: re-measure once more, even for a track already measured,
  // when its truePeakVersion doesn't match the current algorithm — the
  // one-time cost of recomputing a changed true-peak estimate on the
  // next boot repair pass, same mechanism, no separate migration.
  const targets = S.tracks.filter(t => t.stored && t.details
    && !(t.details.loudness && t.details.loudness.measured && t.details.loudness.truePeakVersion === TRUE_PEAK_VERSION));
  await runIdlePass(targets, async t => {
    try{
      const rec = await tracks.get(t.id);
      if(rec && rec.blob){
        const raw = await rec.blob.arrayBuffer();
        // Found 2026-10-26: decoded off the live S.ctx — see
        // decodeAudioFile()'s own comment — so this idle heal pass can't
        // contend with whatever's already playing.
        const buffer = await decodeAudioFile(raw);
        const channels = [];
        for(let ch = 0; ch < buffer.numberOfChannels; ch++) channels.push(buffer.getChannelData(ch));
        // PL6 item 1: off the main thread, via the analysis worker.
        const analysis = await analyzeTrack(channels, buffer.sampleRate);
        t.details.loudness = analysis.loudness;
        rec.details = t.details;
        await tracks.put(rec);
      }
    }catch(_e){ /* leave this one unmeasured — a later heal pass retries it */ }
  });
}

// AU12 (docs/16_AUDIO.md §7): the same "idle pass... for a library imported
// before this feature existed" shape healLoudness() just above already
// established — a track's details object is the gate (hookStart is simply
// absent on anything detectHook() couldn't find a repeat in, so there's
// nothing to distinguish "measured, no clear hook" from "not measured
// yet" here; a track with details but no hookStart gets re-checked every
// heal pass until the library is reloaded with it set, the same harmless
// re-check healLoudness() itself accepts for a track whose measurement
// keeps failing).
export async function healHooks(){
  if(!storage.available()) return;
  const targets = S.tracks.filter(t => t.stored && t.details && typeof t.details.hookStart !== 'number');
  await runIdlePass(targets, async t => {
    try{
      const rec = await tracks.get(t.id);
      if(rec && rec.blob){
        const raw = await rec.blob.arrayBuffer();
        // Same reason as healLoudness() just above — decode off the live
        // S.ctx, not on it.
        const buffer = await decodeAudioFile(raw);
        const channels = [];
        for(let ch = 0; ch < buffer.numberOfChannels; ch++) channels.push(buffer.getChannelData(ch));
        // PL6 item 1: off the main thread, via the analysis worker.
        const analysis = await analyzeTrack(channels, buffer.sampleRate);
        if(analysis.hook){
          t.details.hookStart = analysis.hook.hookStart;
          t.details.hookEnd = analysis.hook.hookEnd;
          rec.details = t.details;
          await tracks.put(rec);
        }
      }
    }catch(_e){ /* leave this one unmeasured — a later heal pass retries it */ }
  });
}

// drops thumbnails whose records are gone (after clearing listening history)
export async function pruneThumbs(){
  for(const key of Object.keys(thumbURL)){
    const i = key.indexOf(':'), kind = key.slice(0, i), id = key.slice(i + 1);
    const keep = kind === 'album' ? (S.albumDisplay[id] || S.achievements[id] || S.collection[id]) : S.trackDisplay[id];
    if(keep) continue;
    try{ URL.revokeObjectURL(thumbURL[key]); }catch(_e){}
    delete thumbURL[key]; delete thumbSrcSeen[key];
    await meta.del('thumb:' + key);
  }
}

// RF17 (docs/12_REFINE.md): `keys` is the album id / track key (or keys)
// that actually changed — a single key, an array, or omitted when a caller
// has no specific key in scope (a bulk prune/reset that already touched
// every affected key itself before calling this, e.g. history/clear.js).
export async function persistAlbumDisplay(keys){ await meta.put('albumDisplay', persistableMap(S.albumDisplay)); touchKeys('albumDisplay', keys); }
export async function persistTrackDisplay(keys){ await meta.put('trackDisplay', persistableMap(S.trackDisplay)); touchKeys('trackDisplay', keys); }

export function snapshotAlbumDisplay(t){
  const albumId = albumKey(t);
  S.albumDisplay[albumId] = {name:t.tags.album, artist:t.tags.albumArtist || t.tags.artist,
    art:thumbURL['album:' + albumId] || null};
  persistAlbumDisplay(albumId);
  ensureThumb('album', albumId, t.art);
}

// same idea as snapshotAlbumDisplay, one level down — keeps Top Songs
// showing a real title/artist/art for a track whose file has since been
// removed from the library (see LIBRARY spec §1, orphaned stats)
export function snapshotTrackDisplay(t, key){
  S.trackDisplay[key] = {title:t.tags.title, artist:t.tags.artist, art:thumbURL['track:' + key] || null};
  persistTrackDisplay(key);
  ensureThumb('track', key, t.art);
}
