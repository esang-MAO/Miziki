/* ================= S4: crate image tiers (640px "S", 1200px "L") =========
   Moved out of main.js's "S4: crate image tiers" section (step 7c),
   unchanged. Stored in the existing `artwork` store (keyed by id, never
   `meta` — that would read hundreds of MB into memory on every launch)
   under prefixed ids `crate640:<albumId>` / `crate1200:<albumId>`, built
   lazily and fetched through a small LRU of object URLs. See the
   image-quality spec §B1-B3. No DB version bump — the store already exists. */
import { S } from '../state.js';
import { sleep } from '../util/async.js';
import { albumKey } from '../record-art/tiers.js';
import { artwork } from '../storage/repo.js';

const CRATE_TIER_S_PX = 640, CRATE_TIER_L_PX = 1200;
const CRATE_TIER_S_Q = 0.88, CRATE_TIER_L_Q = 0.92;
const CRATE_TIER_S_CAP = 40, CRATE_TIER_L_CAP = 4;
// albumId -> object URL; Map insertion order is LRU recency. Exported for
// src/launch/intro.js's makeLaunchCard(), which only ever reads a
// synchronous cache hit here — never triggers a build (spec §B5).
export const crateArtCache = { S: new Map(), L: new Map() };
const crateArtBuilding = new Set();                      // 'tier:albumId' in flight, so concurrent askers don't double-build

function crateTierKey(tier, albumId){ return (tier === 'L' ? 'crate1200:' : 'crate640:') + albumId; }

// like cropSquareImage (left untouched for the existing 800/300px thumbs),
// but halves repeatedly so a big reduction doesn't alias the way a single
// drawImage step does (spec §B3)
function cropSquareImageStepped(file, maxDim, quality){
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const side = Math.min(img.width, img.height);
      const sx = (img.width - side) / 2, sy = (img.height - side) / 2;
      const out = Math.min(maxDim, side);   // never upscale
      let canvas = document.createElement('canvas');
      canvas.width = side; canvas.height = side;
      canvas.getContext('2d').drawImage(img, sx, sy, side, side, 0, 0, side, side);
      URL.revokeObjectURL(img.src);
      let curSize = side;
      while(curSize > out * 2){
        const next = Math.max(out, Math.round(curSize / 2));
        const nextCanvas = document.createElement('canvas');
        nextCanvas.width = next; nextCanvas.height = next;
        const nextCx = nextCanvas.getContext('2d');
        nextCx.imageSmoothingEnabled = true; nextCx.imageSmoothingQuality = 'high';
        nextCx.drawImage(canvas, 0, 0, curSize, curSize, 0, 0, next, next);
        canvas = nextCanvas; curSize = next;
      }
      if(curSize !== out){
        const finalCanvas = document.createElement('canvas');
        finalCanvas.width = out; finalCanvas.height = out;
        const finalCx = finalCanvas.getContext('2d');
        finalCx.imageSmoothingEnabled = true; finalCx.imageSmoothingQuality = 'high';
        finalCx.drawImage(canvas, 0, 0, curSize, curSize, 0, 0, out, out);
        canvas = finalCanvas;
      }
      canvas.toBlob(b => b ? resolve(b) : reject(new Error('encode failed')), 'image/jpeg', quality);
    };
    img.onerror = () => reject(new Error('could not read image'));
    img.src = URL.createObjectURL(file);
  });
}

// the album's best available source art — first track with art wins (a
// user edit already wins inside t.art itself, see applyEdit()); always cut
// from this original, never from an existing 800px thumbnail (spec §B3)
function crateArtSourceFor(albumId){
  for(const t of S.tracks) if(albumKey(t) === albumId && t.art) return t.art;
  return null;
}

export async function buildCrateTier(albumId, tier){
  const buildKey = tier + ':' + albumId;
  if(crateArtBuilding.has(buildKey)) return false;
  crateArtBuilding.add(buildKey);
  try{
    const key = crateTierKey(tier, albumId);
    const existing = await artwork.get(key);
    if(existing) return true;   // resumable: a heal pass just skips what's already built
    const srcUrl = crateArtSourceFor(albumId);
    if(!srcUrl) return false;
    const blob = await (await fetch(srcUrl)).blob();
    const px = tier === 'L' ? CRATE_TIER_L_PX : CRATE_TIER_S_PX;
    const q = tier === 'L' ? CRATE_TIER_L_Q : CRATE_TIER_S_Q;
    const out = await cropSquareImageStepped(blob, px, q);
    await artwork.put({id: key, blob: out});
    return true;
  }catch(e){ return false; }
  finally{ crateArtBuilding.delete(buildKey); }
}

function crateArtCacheSet(tier, albumId, url){
  const cache = crateArtCache[tier], cap = tier === 'L' ? CRATE_TIER_L_CAP : CRATE_TIER_S_CAP;
  cache.delete(albumId);
  cache.set(albumId, url);
  while(cache.size > cap){
    const oldestId = cache.keys().next().value;
    try{ URL.revokeObjectURL(cache.get(oldestId)); }catch(e){}
    cache.delete(oldestId);
  }
}

// looks up (building on demand) an album's crate-tier object URL, through
// a small LRU so a long flick never accumulates hundreds of live object
// URLs (spec §B2)
export async function getCrateArtURL(albumId, tier){
  const cache = crateArtCache[tier];
  if(cache.has(albumId)){
    const url = cache.get(albumId);
    crateArtCacheSet(tier, albumId, url);   // bump recency
    return url;
  }
  const key = crateTierKey(tier, albumId);
  let rec = await artwork.get(key);
  if(!rec){
    if(!(await buildCrateTier(albumId, tier))) return null;
    rec = await artwork.get(key);
    if(!rec) return null;
  }
  const url = URL.createObjectURL(rec.blob);
  crateArtCacheSet(tier, albumId, url);
  return url;
}

function revokeCrateArtTier(albumId, tier){
  const cache = crateArtCache[tier];
  if(cache.has(albumId)){ try{ URL.revokeObjectURL(cache.get(albumId)); }catch(e){} cache.delete(albumId); }
}

export async function deleteCrateArtTiers(albumId){
  revokeCrateArtTier(albumId, 'S'); revokeCrateArtTier(albumId, 'L');
  await artwork.del(crateTierKey('S', albumId));
  await artwork.del(crateTierKey('L', albumId));
}

// background S-tier pass for the whole library, starting at the crate
// anchor and working outward, yielding between albums so it never blocks a
// frame, and resumable (buildCrateTier skips anything already built) —
// spec §B3. Triggered from restoreLibrary() and after imports/art edits.
let healCrateArtToken = 0;
export async function healCrateArt(){
  const token = ++healCrateArtToken;
  const seen = new Set(), ids = [];
  S.tracks.forEach(t => { const id = albumKey(t); if(!seen.has(id)){ seen.add(id); ids.push(id); } });
  if(!ids.length) return;
  const anchorPos = Math.max(0, S.crateAnchor ? ids.indexOf(S.crateAnchor) : 0);
  const ordered = [];
  for(let d = 0; d < ids.length; d++){
    if(anchorPos + d < ids.length) ordered.push(ids[anchorPos + d]);
    if(d > 0 && anchorPos - d >= 0) ordered.push(ids[anchorPos - d]);
  }
  for(const albumId of ordered){
    if(token !== healCrateArtToken) return;   // superseded by a newer pass
    await buildCrateTier(albumId, 'S');
    await sleep(0);
  }
}

// a quiet pre-warm of the L tier around the crate anchor, so the centre
// record (and a quick flick either way) is usually already sharp the first
// time it's looked at (spec §B2, "plus a quiet pre-warm")
export async function prewarmCrateAnchorL(){
  if(!S.crate || !S.crate.model || !S.crate.model.items.length) return;
  const items = S.crate.model.items;
  const pos = Math.round(S.crate.pos != null ? S.crate.pos : 0);
  const ids = [];
  for(let d = -3; d <= 3; d++){
    const item = items[pos + d];
    if(item && item.type === 'rec' && !ids.includes(item.albumId)) ids.push(item.albumId);
  }
  for(const albumId of ids) await buildCrateTier(albumId, 'L');
}
