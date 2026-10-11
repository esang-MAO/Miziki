import { S } from '../state.js';
import { $ } from '../util/dom.js';
import { sleep } from '../util/async.js';
import { albumKey, trackIdentityKey } from '../record-art/tiers.js';
import { storage, tracks, meta } from '../storage/repo.js';
import { cropSquareImage } from './edit.js';
import { readDetails, emptyDetails } from './tags/index.js';
import { rebuildPeopleIndex, updateCreditsButtonForCurrent } from './credits.js';
import { renderProfile } from '../profile/screens.js';
import { invalidateCrateModel } from '../crate/model.js';

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
async function persistAlbumEdge(){ await meta.put('albumEdge', S.albumEdge); }

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
    if(hex){ S.albumEdge[id] = hex; persistAlbumEdge(); }
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

// back-fills t.details (liner notes/credits) on libraries stored before that
// field existed — a non-blocking, batched re-read of each stored file's own
// tags, same shape as healThumbs() above (see CREDITS spec §0)
export async function healDetails(){
  if(!storage.available()) return;
  const targets = S.tracks.filter(t => t.stored && !t.details);
  for(let i = 0; i < targets.length; i++){
    while(S.playing) await sleep(500);
    const t = targets[i];
    if(!S.tracks.includes(t)) continue;   // deleted while we waited
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
    await sleep(0);
    if((i + 1) % 5 === 0) await sleep(30);
  }
  if(typeof rebuildPeopleIndex === 'function') rebuildPeopleIndex();
  if(typeof invalidateCrateModel === 'function') invalidateCrateModel();
  if(typeof updateCreditsButtonForCurrent === 'function') updateCreditsButtonForCurrent();
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

export async function persistAlbumDisplay(){ await meta.put('albumDisplay', persistableMap(S.albumDisplay)); }
export async function persistTrackDisplay(){ await meta.put('trackDisplay', persistableMap(S.trackDisplay)); }

export function snapshotAlbumDisplay(t){
  const albumId = albumKey(t);
  S.albumDisplay[albumId] = {name:t.tags.album, artist:t.tags.albumArtist || t.tags.artist,
    art:thumbURL['album:' + albumId] || null};
  persistAlbumDisplay();
  ensureThumb('album', albumId, t.art);
}

// same idea as snapshotAlbumDisplay, one level down — keeps Top Songs
// showing a real title/artist/art for a track whose file has since been
// removed from the library (see LIBRARY spec §1, orphaned stats)
export function snapshotTrackDisplay(t, key){
  S.trackDisplay[key] = {title:t.tags.title, artist:t.tags.artist, art:thumbURL['track:' + key] || null};
  persistTrackDisplay();
  ensureThumb('track', key, t.art);
}
