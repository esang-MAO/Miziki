import { S } from '../state.js';
import { albumKey, trackTier, trackIdentityKey, VARIANT_DEFS, selectVariant } from '../record-art/tiers.js';
import { albumMetalFor } from '../record-art/metals.js';
import { albumExpectedOrder } from './sessions.js';
import { idxOf } from '../library/model.js';
import { achievements, collection } from '../storage/repo.js';
import { thumbURL, persistable } from '../library/thumbs.js';

/* ================= profile tab =================
   Everything here reads from existing counters — session records, track
   play counts, variant assignments. No new tracking, per the spec's build
   notes. Achievements and Collection do persist lightweight pointer+tier
   records, since "has this album reached Gold" can't assume the source
   track is still in the library to read a display name/cover off of —
   albumDisplay is the one place that snapshot lives, shared by both. */

async function upsertAchievement(albumId, tier){
  const existing = S.achievements[albumId];
  if(existing && existing.tier === tier) return;
  const disp = S.albumDisplay[albumId] || {};
  const rec = {albumId, tier, name:disp.name || albumId, artist:disp.artist || '',
    art:thumbURL['album:' + albumId] || null, updatedAt:Date.now()};
  S.achievements[albumId] = rec;
  await achievements.put(persistable(rec));
}

async function upsertCollectionEntry(albumId, tier, variant, pattern){
  if(S.collection[albumId]) return;   // discovered once, stays discovered
  const disp = S.albumDisplay[albumId] || {};
  const rec = {albumId, tier, variant, pattern, name:disp.name || albumId, artist:disp.artist || '',
    art:thumbURL['album:' + albumId] || null, discoveredAt:Date.now()};
  S.collection[albumId] = rec;
  await collection.put(persistable(rec));
}

// deliberately looser than a qualifying session — every track in the album
// has been heard (95% played) at least once, in any order, across any
// number of sittings. Used for Collection discovery and the crate/sleeve
// first-run signals (see PROFILE spec §5, §10) — the bar is discovery, not
// achievement, so shuffle/skips/order don't disqualify it here
function albumPlayedThrough(albumId){
  const order = albumExpectedOrder(albumId);
  if(!order.length) return false;
  return order.every(trackId => {
    const t = S.tracks[idxOf(trackId)];
    return t && (S.trackPlayCounts[trackIdentityKey(t)] || 0) > 0;
  });
}

// checked after every track-completion event, since that's the only thing
// that can flip either condition from false to true
export function checkAlbumAchievementAndCollection(t){
  const albumId = albumKey(t);
  const tier = S.rareUnlocked[albumId] ? 'rare' : albumMetalFor(albumId);
  if(tier) upsertAchievement(albumId, tier);
  const tn = trackTier(t);
  if((tn === 2 || tn === 3) && albumPlayedThrough(albumId)){
    const {variant} = selectVariant(t);
    upsertCollectionEntry(albumId, tn, variant, VARIANT_DEFS[variant].pattern);
  }
}

// crate/share-button first-run gating — each clears independently, on the
// metric that actually drives it (see PROFILE spec §9)
export function crateFilled(){ return Object.keys(S.sessionCounts).length > 0; }

// CR11 point 3: the pressing chart's "owned" set — every solid/effect id
// any album currently in the library draws, one representative track per
// album (the same S.tracks[idx[0]]-first-occurrence convention every
// crate card/sticker already reads its variant from). Jet and the four
// session-unlock rares are left out on purpose: Jet isn't a catalogue
// pressing to collect, and rares already have their own Collection
// surface (upsertCollectionEntry, above) — this is about what the file-
// driven catalogue (CR7) looks like across the whole crate, not rares.
export function ownedPressingIds(){
  const seen = new Set(), owned = new Set();
  for(const t of S.tracks){
    const id = albumKey(t);
    if(seen.has(id)) continue;
    seen.add(id);
    const {variant} = selectVariant(t);
    if(variant !== 'jet') owned.add(variant);
  }
  return owned;
}

// RF4 (docs/12_REFINE.md): the merged cross-device total, when one exists
// (signed in, at least one pull done), in place of this device's own
// counter — see state.js's own S.mergedStats comment. Signed out, or
// before the first pull, S.mergedStats is null and both fall back to
// exactly what they read before this PR.
export function topAlbums(n){
  const counts = S.mergedStats ? S.mergedStats.sessionCounts : S.sessionCounts;
  return Object.keys(counts)
    .map(albumId => ({albumId, count:counts[albumId], last:S.albumLastPlayed[albumId] || 0,
      display: S.albumDisplay[albumId] || {name:albumId, artist:'', art:null}}))
    .sort((a,b) => b.count - a.count || b.last - a.last)
    .slice(0, n);
}
export function topTracks(n){
  const counts = S.mergedStats ? S.mergedStats.trackPlayCounts : S.trackPlayCounts;
  return Object.keys(counts)
    .map(trackKey => {
      const disp = S.trackDisplay[trackKey] || {title:trackKey, artist:'', art:null};
      return {trackKey, count:counts[trackKey], last:S.trackLastPlayed[trackKey] || 0,
        title: disp.title, artist: disp.artist, art: disp.art};
    })
    .sort((a,b) => b.count - a.count || b.last - a.last)
    .slice(0, n);
}

// highest tier first; 'rare' outranks platinum since it sits above the ladder
const METAL_RANK = {rare:5, platinum:4, gold:3, silver:2, bronze:1};
export function achievementsList(){
  return Object.values(S.achievements).sort((a,b) => METAL_RANK[b.tier] - METAL_RANK[a.tier] || b.updatedAt - a.updatedAt);
}

// colors / splits / splatter as distinct groups, per PROFILE spec §9
export function collectionGroups(){
  const groups = {solid:[], split:[], splatter:[], swirl:[]};
  Object.values(S.collection).forEach(rec => { (groups[rec.pattern] || (groups[rec.pattern] = [])).push(rec); });
  return groups;
}
