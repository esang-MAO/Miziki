"use strict";
import { S, current, SOCIAL_SUPABASE_URL, SOCIAL_SUPABASE_ANON_KEY } from './state.js';
import { $, el } from './util/dom.js';
import { sleep } from './util/async.js';
import { normKey } from './util/text.js';
import { trackTier, albumKey, trackIdentityKey, VARIANT_DEFS, selectVariant, variantBackground } from './record-art/tiers.js';
import { byName, trackSort, groupBy, allIdx, albumTracks, idxOf } from './library/model.js';
import { touchLRU, ensureBuffer } from './player/buffers.js';
import {
  setQueue, buildOrder, reorderQueue, advance, preloadNextTrack,
  playNext, addToQueue, openQueueSheet, closeQueueSheet,
} from './player/queue.js';
import { readDetails, emptyDetails } from './library/tags/index.js';
import { addFiles, filesFromDataTransferItems, addTestTone } from './library/import.js';
import { closeDupOverlay, closeDuplicateScan } from './library/duplicates-ui.js';
import {
  albumExpectedOrder, persistAlbumLookPref, invalidateActiveSessionIfAny, touchActiveSession, restoreSessions,
} from './history/sessions.js';
import { clearListeningHistory } from './history/clear.js';
import {
  loadOverlayFor, cropSquareImage, applyEdit, revertTrack, applyEditWithUndo,
  undoLastEdit, showUndoBanner, openEditSheet, closeEditSheet, saveEditSheet,
} from './library/edit.js';
import {
  countForAlbum, countForArtist, formatBytes, totalLibraryBytes,
  deleteTracks, deleteAlbum, deleteArtist, forgetLibrary,
} from './library/delete.js';
import { openDuplicateScan } from './library/duplicate-scan.js';
import {
  trackHasCreditsContent, openPersonOrArtist, creditRow, openCreditsSheet, closeCreditsSheet,
  updateCreditsButtonForCurrent, albumLinerNotes, albumCreditRoll, rebuildPeopleIndex, renderPersonView,
} from './library/credits.js';
import { isFavorite, toggleFavorite, updateFavoriteButtons } from './library/favorites.js';
import {
  librarySortBar, librarySortComparator, sortAlbumGroups, renderSearchResults,
  renderSearchChips, updateSearchChipsVisibility, closeSortMenu,
} from './library/search.js';
import { computeSun, nowClock, sunProgress, easedProgress, computeRate } from './sundown/solar.js';
import { CRATE_ORIGIN_Y, CRATE_PALETTE, CRATE_VISIBLE_A, CRATE_DPR, CRATE_ALPHABET } from './crate/constants.js';
import { askLocation, fallbackSun, toggleSleevePull, toggleMotion, applyVolume } from './sundown/location.js';
import { updateSleepUI, stopSleepState, sleepStopPlayback, sleepCheckDeadline, openSleepSheet, closeSleepSheet } from './player/sleep-timer.js';
import { ensureContext, applyCharacter, routeSource } from './audio/engine.js';
import { load, play, pause, seek } from './player/transport.js';
import { fmt, drawTime, drawSun, frame } from './player/clock.js';
import { wireSpinToScrub } from './player/scrub.js';
import { setPathNote } from './ui/path-note.js';
import { clamp } from './util/math.js';
import { DB } from './storage/idb.js';
import { serializePrefs, parsePrefs } from './storage/prefs.js';
import {
  storage, tracks, meta, achievements, collection, overlays, artwork, profile,
} from './storage/repo.js';

export const REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ================= metal tiers =================
   Play-count-driven record colors for Tier 1 (lossy) only — the one tier
   with no visual variance of its own. Two disjoint ladders: album metals
   keyed to qualifying sessions (the same counter/definition session
   tracking already uses), track metals keyed to the track's own lifetime
   play count. Metal level is always a pure function of these counters —
   nothing about "current metal" is ever stored. Thresholds live in one
   config object so they can be retuned without touching render logic. */
const ALBUM_METAL_THRESHOLDS = [
  {name:'platinum', sessions:40},
  {name:'gold',     sessions:25},
  {name:'silver',   sessions:15},
  {name:'bronze',   sessions:8}
];
const TRACK_METAL_THRESHOLDS = [
  {name:'platinum', plays:250},
  {name:'gold',     plays:125}
];
const METAL_COLORS = {bronze:'#CE8946', silver:'#797B80', gold:'#FFC30B', platinum:'#BBC2CC'};
const METAL_FADE_MS = 400;

// reads the tier-1-only shadow counter, not the true lifetime total, so a
// tier-upgraded album's metal is grandfathered (frozen) rather than
// continuing to climb thresholds it can no longer earn — see METAL spec §2
function albumMetalFor(albumId){
  const n = S.metalEligibleSessions[albumId] || 0;
  for(const lvl of ALBUM_METAL_THRESHOLDS) if(n >= lvl.sessions) return lvl.name;
  return null;
}
// takes a trackIdentityKey(), not a file id — see that function
function trackMetalFor(trackKey){
  const n = S.trackMetalEligiblePlays[trackKey] || 0;
  for(const lvl of TRACK_METAL_THRESHOLDS) if(n >= lvl.plays) return lvl.name;
  return null;
}

// incrementTrackPlay moved to src/history/played.js (step 5c), alongside
// checkTrackCompletion, its only caller.

// plated metal, not a flat fill: a conic sheen band (bright arcs near the
// light-catching angles, a darker arc opposite) over a radial base, so the
// existing groove/light overlay in .disc::before still reads as reflection
// catching the surface rather than being painted on top of a solid color
function metalBackground(name){
  const base = METAL_COLORS[name];
  // Silver's rung is both darker AND cooler than Bronze on a straight
  // luminance reading, which can misread as a downgrade rather than a step
  // up — lean harder on the highlight ("finish") here to keep it polished
  const hi = name === 'silver' ? 92 : 82, lo = name === 'silver' ? 45 : 35;
  const bright = 'color-mix(in srgb,' + base + ' ' + (100-hi) + '%, white ' + hi + '%)';
  const dark = 'color-mix(in srgb,' + base + ' ' + lo + '%, black ' + (100-lo) + '%)';
  return 'conic-gradient(from 205deg,' + bright + ' 0deg 10deg,' + base + ' 10deg 150deg,'
      + dark + ' 150deg 195deg,' + base + ' 195deg 340deg,' + bright + ' 340deg 360deg),'
    + 'radial-gradient(circle at 50% 50%,' + bright + ' 0 27%,' + base + ' 27% 88%,' + dark + ' 88% 100%)';
}

// crossfades when asked to (a same-album background change with no sleeve
// pull to cover it) and the background actually changed; otherwise applies
// immediately — either nothing was visible yet, or a sleeve/pull is already
// covering the change, so an instant swap underneath it is imperceptible
function setDiscBackground(disc, bg, crossfade){
  const fade = $('#discFade');
  const prev = disc.style.background;
  if(crossfade && prev && prev !== bg){
    fade.style.transition = 'none';
    fade.style.background = prev;
    fade.style.opacity = '1';
    disc.style.background = bg;
    void fade.offsetWidth;
    fade.style.transition = 'opacity ' + METAL_FADE_MS + 'ms ease';
    fade.style.opacity = '0';
  } else {
    disc.style.background = bg || '';
    fade.style.transition = 'none';
    fade.style.opacity = '0';
  }
}

/* ================= look switching =================
   Once an album has more than one available "look" — the rare variant, an
   earned metal, or a genuine format variant (tier 2/3 only; tier 1's plain
   black is not itself a selectable look) — the user can switch between
   them, silently and immediately, and the choice persists per album. Rare
   is the default the moment it unlocks; anything else is the opt-back. See
   METAL spec §5. */
function availableLooks(t){
  const albumId = albumKey(t);
  const tier = trackTier(t);
  const looks = [];
  if(S.rareUnlocked[albumId] && t.art) looks.push('rare');
  const metal = trackMetalFor(trackIdentityKey(t)) || albumMetalFor(albumId);
  if(metal) looks.push('metal');
  // tier 1 with nothing earned has no real alternative to fall back to, so
  // the plain format variant only counts as a genuine "look" once there's
  // either something else to switch away from, or the tier itself carries
  // real variance (2/3)
  if(tier !== 1 || looks.length === 0) looks.push('variant');
  return looks;
}

function resolveLook(t){
  const looks = availableLooks(t);
  const pref = S.albumLookPref[albumKey(t)];
  if(pref && looks.includes(pref)) return pref;
  if(looks.includes('rare')) return 'rare';
  if(looks.includes('metal')) return 'metal';
  return 'variant';
}

function setLookPref(albumId, look){
  S.albumLookPref[albumId] = look;
  persistAlbumLookPref();
  const t = current();
  if(t && albumKey(t) === albumId) applyDiscVariant(t, true);
}

function lookLabel(kind, t){
  if(kind === 'rare') return 'Rare — Art Suspended in Vinyl';
  if(kind === 'metal'){
    const m = trackMetalFor(trackIdentityKey(t)) || albumMetalFor(albumKey(t));
    return m ? (m[0].toUpperCase() + m.slice(1) + ' Metal') : 'Metal';
  }
  return 'Format Variant';
}

function openLookPicker(){
  const t = current(); if(!t) return;
  const albumId = albumKey(t);
  const looks = availableLooks(t);
  const current_ = resolveLook(t);
  const host = $('#lookOptions');
  host.innerHTML = '';
  looks.forEach(kind => {
    const b = document.createElement('button');
    b.className = 'cta' + (kind === current_ ? '' : ' ghost');
    b.textContent = lookLabel(kind, t);
    // silent and immediate — no confirmation, no animation (see METAL spec §5)
    b.addEventListener('click', () => { setLookPref(albumId, kind); closeLookPicker(); });
    host.appendChild(b);
  });
  $('#lookOverlay').classList.add('open');
  $('#lookOverlay').setAttribute('aria-hidden', 'false');
}
function closeLookPicker(){
  $('#lookOverlay').classList.remove('open');
  $('#lookOverlay').setAttribute('aria-hidden', 'true');
}

// Outside the full player the artwork travels as a plain circular label; the disc's
// tier-derived surface is scoped to this renderer only (see spec §1).
// `crossfade` should be true only for a same-album change with no sleeve
// animation to cover it — see updateShellAlbum()'s sameAlbum flag.
export function applyDiscVariant(t, crossfade){
  const disc = $('#disc'), label = $('#label');
  if(!t){ disc.classList.remove('rare'); label.classList.remove('rare'); setDiscBackground(disc, '', false); $('#lookBtn').style.display = 'none'; return; }
  $('#lookBtn').style.display = availableLooks(t).length > 1 ? '' : 'none';
  const look = resolveLook(t);
  const rare = look === 'rare';
  disc.classList.toggle('rare', rare);
  label.classList.toggle('rare', rare);
  let bg;
  if(rare){
    // "Art Suspended in Vinyl": continuous material, no paper seam — the same
    // artwork the label shows extends across the whole disc, read through the grooves
    bg = 'radial-gradient(circle at 50% 50%,rgba(0,0,0,.12),rgba(0,0,0,.55) 88%,rgba(0,0,0,.78) 100%),'
      + 'url("' + t.art + '") center/cover';
    delete disc.dataset.variant; delete disc.dataset.tier;
  } else {
    const {tier, variant} = selectVariant(t);
    // track wins over album — see METAL spec §4. Grandfathered metals are
    // no longer gated to tier===1 here: a metal earned pre-upgrade stays
    // selectable regardless of the track's current tier, since it's the
    // resolveLook() call above (via availableLooks()) that decides whether
    // 'metal' is even a candidate in the first place.
    const metal = look === 'metal' ? (trackMetalFor(trackIdentityKey(t)) || albumMetalFor(albumKey(t))) : null;
    disc.dataset.tier = tier;
    disc.dataset.variant = metal ? 'metal-' + metal : variant;
    bg = metal ? metalBackground(metal) : variantBackground(VARIANT_DEFS[variant]);
  }
  setDiscBackground(disc, bg, crossfade);
}

/* ================= profile tab =================
   Everything here reads from existing counters — session records, track
   play counts, variant assignments. No new tracking, per the spec's build
   notes. Achievements and Collection do persist lightweight pointer+tier
   records, since "has this album reached Gold" can't assume the source
   track is still in the library to read a display name/cover off of —
   albumDisplay is the one place that snapshot lives, shared by both.
   Timestamps double as the recency tie-break and, per §11, keep every
   record ready for a future account system: stable ids, no device-keyed
   identifiers, no absolute paths. persistAlbumLastPlayed moved to
   src/history/sessions.js (step 5c) — its only writer, sessionTrackComplete,
   lives there. */

/* ================= S5: sealed records =================
   S.sealed is its own saved list, independent of S.albumLastPlayed/session
   history on purpose — "Clear listening history" must never reseal an
   album (SEALED spec §2). Grandfathering: no sealedAlbums row at all means
   this feature hasn't run here yet, so nothing existing is sealed. */
async function restoreSealedAlbums(){
  const row = await meta.get('sealedAlbums');
  S.sealed = new Set(row && row.ids ? row.ids : []);
}
export async function persistSealedAlbums(){ await meta.put('sealedAlbums', {init:true, ids:[...S.sealed]}); }

function isAlbumSealed(albumId){ return S.sealedRecords && S.sealed.has(albumId); }

// "played" means playback began — no minimum duration, any track counts,
// and once removed an id can never be re-added except by a fresh import
// (SEALED spec §2, §6)
export function breakSeal(albumId){
  if(!S.sealed.has(albumId)) return;
  S.sealed.delete(albumId);
  persistSealedAlbums();
  updateSealedSheetAfterBreak(albumId);
  renderTracks();
}

// one overlay + one sticker, plain CSS gradients, no images — shared by the
// crate card, the sealed sheet's small cover and the player's sleeve
// (SEALED spec §4). sizePx sizes only the sticker's text; everything else
// is percentage-based so the same markup scales with its host.
function buildSealOverlay(sizePx){
  const frag = document.createDocumentFragment();
  const wrap = el('div','seal-wrap'); wrap.setAttribute('aria-hidden','true');
  frag.appendChild(wrap);
  const sticker = el('div','seal-sticker'); sticker.setAttribute('aria-hidden','true');
  const label = el('span', null, 'NEW');
  label.style.fontSize = Math.round(sizePx * 0.075) + 'px';
  sticker.appendChild(label);
  frag.appendChild(sticker);
  return frag;
}
export async function persistTrackLastPlayed(){ await meta.put('trackLastPlayed', S.trackLastPlayed); }
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
const thumbURL = {};        // 'album:<id>' / 'track:<key>' -> live object URL for this session
const thumbSrcSeen = {};    // which artwork URL each thumbnail was last cut from, this session

async function makeThumb(url, px){
  try{
    const blob = await (await fetch(url)).blob();
    return await cropSquareImage(blob, px);
  }catch(e){ return null; }
}

// records are saved without their runtime `art` URL
function persistableMap(map){
  const out = {};
  Object.keys(map).forEach(k => { const r = Object.assign({}, map[k]); delete r.art; out[k] = r; });
  return out;
}
function persistable(rec){ const r = Object.assign({}, rec); delete r.art; return r; }

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
      }catch(e){ resolve(null); }
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
async function healThumbs(){
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
async function healDetails(){
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
    }catch(e){ t.details = emptyDetails(); }
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
    try{ URL.revokeObjectURL(thumbURL[key]); }catch(e){}
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

// crate/sleeve/share-button first-run gating — each clears independently,
// on the metric that actually drives it (see PROFILE spec §9)
function crateFilled(){ return Object.keys(S.sessionCounts).length > 0; }
function sleeveFilled(){ return Object.keys(S.trackPlayCounts).length > 0; }

function topAlbums(n){
  return Object.keys(S.sessionCounts)
    .map(albumId => ({albumId, count:S.sessionCounts[albumId], last:S.albumLastPlayed[albumId] || 0,
      display: S.albumDisplay[albumId] || {name:albumId, artist:'', art:null}}))
    .sort((a,b) => b.count - a.count || b.last - a.last)
    .slice(0, n);
}
function topTracks(n){
  return Object.keys(S.trackPlayCounts)
    .map(trackKey => {
      const disp = S.trackDisplay[trackKey] || {title:trackKey, artist:'', art:null};
      return {trackKey, count:S.trackPlayCounts[trackKey], last:S.trackLastPlayed[trackKey] || 0,
        title: disp.title, artist: disp.artist, art: disp.art};
    })
    .sort((a,b) => b.count - a.count || b.last - a.last)
    .slice(0, n);
}

// highest tier first; 'rare' outranks platinum since it sits above the ladder
const METAL_RANK = {rare:5, platinum:4, gold:3, silver:2, bronze:1};
function achievementsList(){
  return Object.values(S.achievements).sort((a,b) => METAL_RANK[b.tier] - METAL_RANK[a.tier] || b.updatedAt - a.updatedAt);
}

// colors / splits / splatter as distinct groups, per PROFILE spec §9
function collectionGroups(){
  const groups = {solid:[], split:[], splatter:[], swirl:[]};
  Object.values(S.collection).forEach(rec => { (groups[rec.pattern] || (groups[rec.pattern] = [])).push(rec); });
  return groups;
}

/* findAllDuplicateGroups/openDuplicateScan/renderDupScan moved to
   src/library/duplicate-scan.js (step 5d). */

/* ================= persistence =================
   The rest of what gets saved, on top of the raw IndexedDB wrapper (`DB`,
   src/storage/idb.js, step 4a): queueSave()/saveMeta()/restoreMeta() and the
   various persist*() helpers below read and write through it. If storage is
   unavailable, every DB call quietly no-ops and Miziki behaves exactly as it
   did before: fully working, session-only. */

let saveTimer = null;
export function queueSave(){
  if(!storage.available()) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveMeta, 600);
}

async function saveMeta(){
  if(!storage.available()) return;
  const orders = {};
  Object.keys(S.albumOrder).forEach(a => { orders[a] = S.albumOrder[a].map(idOf).filter(Boolean); });
  await meta.put('playlists', S.playlists.map(p => ({name:p.name, items:p.items.map(idOf).filter(Boolean), system:p.system})));
  await meta.put('albumOrder', orders);
  await meta.put('albumSort', S.albumSort);
  await meta.put('prefs', serializePrefs(S));
}

async function restoreMeta(){
  const pl = await meta.get('playlists');
  if(pl) S.playlists = pl.map(p => ({name:p.name, items:p.items.map(idxOf).filter(i => i >= 0), system:p.system}));
  const ord = await meta.get('albumOrder');
  if(ord) Object.keys(ord).forEach(a => {
    const arr = ord[a].map(idxOf).filter(i => i >= 0);
    if(arr.length) S.albumOrder[a] = arr;
  });
  const srt = await meta.get('albumSort');
  if(srt) S.albumSort = srt;
  const pr = await meta.get('prefs');
  if(pr) applyPrefs(parsePrefs(pr));
}

function applyPrefs(p){
  if(p.char){ Object.keys(S.char).forEach(k => { if(typeof p.char[k] === 'number') S.char[k] = p.char[k]; }); }
  // scratch is a boolean, not a slider percentage, and a saved prefs object
  // from before F2 won't have it at all — missing must mean On, so S.char's
  // own default (true) is left alone unless a saved value says otherwise
  if(p.char && typeof p.char.scratch === 'boolean'){
    S.char.scratch = p.char.scratch;
  }
  const scratchBtn = $('#scratchBtn');
  if(scratchBtn){
    scratchBtn.textContent = S.char.scratch ? 'On' : 'Off';
    scratchBtn.setAttribute('aria-pressed', String(S.char.scratch));
  }
  if(typeof p.target === 'number') S.target = p.target;
  if(p.pace) S.pace = p.pace;
  if(typeof p.auto === 'boolean') S.auto = p.auto;
  if(p.librarySort) S.librarySort = p.librarySort;
  if(typeof p.sleevePullEnabled === 'boolean'){
    S.sleevePullEnabled = p.sleevePullEnabled;
    const b = $('#sleevePullBtn');
    b.textContent = S.sleevePullEnabled ? 'On' : 'Off';
    b.setAttribute('aria-pressed', String(S.sleevePullEnabled));
  }
  if(typeof p.bgAudio === 'boolean'){ S.bgAudio = p.bgAudio; bgUpdateUI(); applyBgAudioSetting(); }
  if(typeof p.launchIntro === 'boolean'){ S.launchIntro = p.launchIntro; attachLaunchSettingRow(); }
  if(p.libraryLayout === 'crate' || p.libraryLayout === 'list'){
    S.libraryLayout = p.libraryLayout;
    // this runs before the library's first render, while the view is still
    // at its pristine top-level default, so keep the two in sync (S1/S2 spec)
    if(S.view.mode === 'crate' || (S.view.mode === 'albums' && S.view.group === null)){
      S.view.mode = (S.libraryLayout === 'crate') ? 'crate' : 'albums';
    }
    document.querySelectorAll('#libLayoutToggle [data-layout]').forEach(b =>
      b.setAttribute('aria-pressed', String(b.dataset.layout === S.libraryLayout)));
  }
  if(p.crateGroup === 'az' || p.crateGroup === 'genre') S.crateGroup = p.crateGroup;
  if(p.crateAnchor) S.crateAnchor = p.crateAnchor;
  if(typeof p.albumSides === 'boolean'){
    S.albumSides = p.albumSides;
    document.querySelectorAll('#sidesToggle [data-sides]').forEach(b =>
      b.setAttribute('aria-pressed', String(b.dataset.sides === (S.albumSides ? 'on' : 'off'))));
  }
  if(typeof p.sealedRecords === 'boolean'){
    S.sealedRecords = p.sealedRecords;
    document.querySelectorAll('#sealedToggle [data-sealed]').forEach(b =>
      b.setAttribute('aria-pressed', String(b.dataset.sealed === (S.sealedRecords ? 'on' : 'off'))));
  }
  if(typeof p.playInFullPlayer === 'boolean'){
    S.playInFullPlayer = p.playInFullPlayer;
    document.querySelectorAll('#playFullToggle [data-playfull]').forEach(b =>
      b.setAttribute('aria-pressed', String(b.dataset.playfull === (S.playInFullPlayer ? 'on' : 'off'))));
  }
  if(p.shareStyle === 'night' || p.shareStyle === 'cover' || p.shareStyle === 'paper') S.shareStyle = p.shareStyle;
  if(p.shareFormat === 'story' || p.shareFormat === 'portrait' || p.shareFormat === 'square') S.shareFormat = p.shareFormat;
  if(p.repeat && p.repeat !== S.repeat){ S.repeat = 'off'; for(let n=0;n<3 && S.repeat!==p.repeat;n++) cycleRepeat(); }
  if(p.shuffle && !S.shuffle) toggleShuffle();
  // push the restored values back into the controls
  Object.keys(S.char).forEach(k => {
    const el2 = $('#'+k); if(el2){ el2.value = Math.round(S.char[k]*100); }
    const out = $('#'+k+'Out'); if(out) out.textContent = Math.round(S.char[k]*100) + '%';
  });
  document.querySelectorAll('[data-target]').forEach(b => b.setAttribute('aria-pressed', String(parseFloat(b.dataset.target) === S.target)));
  document.querySelectorAll('[data-pace]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.pace === S.pace)));
  if(p.mode) setMode(p.mode);
  applyCharacter();
  applyVolume();
}

/* Session tracking and played-duration tracking moved to
   src/history/sessions.js and src/history/played.js (step 5c). */

/* Metadata editing (the sidecar-overlay section: applyEdit, revertTrack,
   the undo banner, the edit sheet) moved to src/library/edit.js (step 5d). */

/* Deletion (deleteTracks, deleteAlbum/deleteArtist, forgetLibrary) moved to
   src/library/delete.js (step 5d). clearListeningHistory moved to
   src/history/clear.js (step 5c). */

/* The rest of "visible queue: reorder, remove, play next / add"
   (queueInsert/playNext/addToQueue, queueRemoveAt, queueMove, the
   queue-sheet UI) moved into src/player/queue.js (step 5e). */

function nextTrack(){ advance(1, false); }
function prevTrack(){
  if(S.pos > 4){ seek(0); return; }
  advance(-1, false);
}

function toggleShuffle(){
  S.shuffle = !S.shuffle;
  if(S.shuffle) invalidateActiveSessionIfAny();
  reorderQueue();
  const b = $('#shuffle');
  b.setAttribute('aria-pressed', String(S.shuffle));
  b.title = S.shuffle ? 'Shuffle on' : 'Shuffle off';
}

function cycleRepeat(){
  S.repeat = S.repeat === 'off' ? 'all' : S.repeat === 'all' ? 'one' : 'off';
  const b = $('#repeat');
  b.setAttribute('aria-pressed', String(S.repeat !== 'off'));
  b.dataset.mode = S.repeat;
  b.title = S.repeat === 'off' ? 'Repeat off' : S.repeat === 'all' ? 'Repeat all' : 'Repeat this track';
  $('#repeatOne').style.display = S.repeat === 'one' ? '' : 'none';
}

/* ================= navigation shell: mini-player, full-player overlay, sleeve pull =================
   Library is the landing route; Sundown and Character are peer routes reached
   via the tab bar. The full player is not a fourth tab — it only exists as an
   overlay, reached through the mini-player strip, once something is loaded. */
/* Two ways into the full player, chosen by whether a record is already on
   the platter: picking a track from Library always arrives via the SHEET
   (something is being started); tapping the mini-player always arrives via
   the MORPH (returning to what's already there). The sheet settles fully
   before any disc transition begins; the morph itself IS the disc arriving,
   so nothing else runs alongside it. Durations/easing live in one object so
   the return-to-sleeve/pull/morph ratio can be tuned without touching any
   trigger logic below. */
const SLEEVE_ANIM = {
  sheetMs: 350,      // sheet settles fully before any disc transition begins
  arriveMs: 1000,    // sleeve slides in from the right
  holdCapMs: 2000,   // longest the sleeve sits static waiting on the buffer
  emergeMs: 2000,    // disc emerges + sleeve exits, concurrently (~3s total pull)
  returnMs: 1200,    // putting a record away — quicker than pulling one out
  morphMs: 420,
  // put-away: the queue ends, the sleeve comes to collect the disc (see
  // PRESENTATION spec, put-away sequence). Shorter than the pull (2.0s total).
  putSpinMs: 500, putInMs: 700, putSlideDelayMs: 600, putSlideMs: 800, putOutMs: 600,
  // the seal peel, inserted into a sealed album's first pull only (SEALED spec §6)
  peelTearMs: 300, peelOffMs: 400,
  easing: 'cubic-bezier(.3,.66,.35,1)'   // morph only; sleeve/disc easing lives in CSS per-phase
};
document.documentElement.style.setProperty('--sheet-duration', SLEEVE_ANIM.sheetMs + 'ms');
document.documentElement.style.setProperty('--arrive-duration', SLEEVE_ANIM.arriveMs + 'ms');
document.documentElement.style.setProperty('--emerge-duration', SLEEVE_ANIM.emergeMs + 'ms');
document.documentElement.style.setProperty('--return-duration', SLEEVE_ANIM.returnMs + 'ms');
document.documentElement.style.setProperty('--putaway-in-duration', SLEEVE_ANIM.putInMs + 'ms');
document.documentElement.style.setProperty('--putaway-slide-duration', SLEEVE_ANIM.putSlideMs + 'ms');
document.documentElement.style.setProperty('--putaway-out-duration', SLEEVE_ANIM.putOutMs + 'ms');
document.documentElement.style.setProperty('--sleeve-peel-tear-duration', SLEEVE_ANIM.peelTearMs + 'ms');
document.documentElement.style.setProperty('--sleeve-peel-off-duration', SLEEVE_ANIM.peelOffMs + 'ms');

// GATEFOLD spec §A3 — total ~950ms open, ~600ms close, independent of
// SLEEVE_ANIM (opening the gatefold never touches playback or the sleeve)
const GATEFOLD_ANIM = {
  liftMs: 200, swingMs: 420, holdMs: 80, pushMs: 250,   // open: 200+420+80+250 = 950
  closeMs: 600, skipMs: 120, leftPanelMs: 250,
  swingEasing: 'cubic-bezier(.4,0,.2,1)', liftEasing: 'ease-out'
};
document.documentElement.style.setProperty('--gatefold-lift-duration', GATEFOLD_ANIM.liftMs + 'ms');
document.documentElement.style.setProperty('--gatefold-swing-duration', GATEFOLD_ANIM.swingMs + 'ms');
document.documentElement.style.setProperty('--gatefold-push-duration', GATEFOLD_ANIM.pushMs + 'ms');
document.documentElement.style.setProperty('--gatefold-close-duration', GATEFOLD_ANIM.closeMs + 'ms');
document.documentElement.style.setProperty('--gatefold-swing-easing', GATEFOLD_ANIM.swingEasing);

export function renderMiniPlayer(){
  const t = current();
  const mini = $('#miniPlayer');
  if(!t){ mini.style.display = 'none'; updateChromeInset(); return; }
  mini.style.display = 'flex';
  $('#miniTitle').textContent = t.tags ? t.tags.title : t.name;
  $('#miniArtist').textContent = t.tags ? t.tags.artist : '';
  $('#miniSquare').classList.toggle('has-art', !!t.art);
  const art = $('#miniArt');
  if(t.art) art.src = t.art; else art.removeAttribute('src');
  $('#miniIndicator').classList.toggle('playing', S.playing);
  // the mini disc surface stays plain black regardless of tier — only this
  // tiny inset label carries artwork
  const discArt = $('#miniDiscArt');
  // the put-away leaves the disc put away — the tiny indicator shows idle,
  // even though the title/artist text above it still names the track
  if(t.art && !S.platterEmpty){ discArt.src = t.art; $('#miniDisc').classList.add('has-art'); }
  else { discArt.removeAttribute('src'); $('#miniDisc').classList.remove('has-art'); }
  const btn = $('#miniPlay');
  btn.textContent = S.playing ? '❚❚' : '▶';
  btn.setAttribute('aria-label', S.playing ? 'Pause' : 'Play');
  updateChromeInset();
  bgSync();
}

// Scrollable content needs bottom padding equal to the chrome's actual
// rendered height, not a fixed guess — the mini-player strip comes and
// goes with playback, so this is re-measured every time renderMiniPlayer()
// runs rather than baked into CSS once (see LIBRARY spec §3). The tab bar's
// own box already includes its safe-area padding, so nothing is added here.
let chromeInsetRAF = null;
function updateChromeInset(){
  if(chromeInsetRAF) return;
  chromeInsetRAF = requestAnimationFrame(() => {
    chromeInsetRAF = null;
    const tabbar = $('#tabbar'), mini = $('#miniPlayer');
    const tabH = tabbar ? tabbar.offsetHeight : 0;
    const miniVisible = mini && getComputedStyle(mini).display !== 'none';
    const miniH = miniVisible ? mini.offsetHeight : 0;
    document.documentElement.style.setProperty('--chrome-inset', (tabH + miniH + 16) + 'px');
    if(typeof applyCrateMiniInset === 'function') applyCrateMiniInset();
    if(typeof centerEmptyState === 'function' && !S.tracks.length && isLibraryRouteVisible()) centerEmptyState();
  });
}

// each untagged file gets its own identity here (never a shared "Unknown Album"
// bucket) purely so state stays coherent once a real, tagged album shows up
// next — untagged tracks are excluded from the pull/return ceremony entirely,
// see updateShellAlbum()
function shellAlbumIdentity(t){
  if(!t) return null;
  if(t.tags.album === 'Unknown Album') return 'single:' + t.id;
  return albumKey(t);
}

// Always updates "what's on the platter" bookkeeping, even while the player
// is closed or shuffled, so state stays correct for whenever it's next
// shown. Returns what the disc SHOULD do, without running anything —
// callers decide whether it's currently visible/safe to actually play it.
export function updateShellAlbum(t){
  const newId = shellAlbumIdentity(t);
  const prevId = S.shellAlbumId, prevArt = S.outgoingArt, prevHasArt = S.outgoingHasArt;
  // distinct from type:'none' below — that also covers shuffle/untagged
  // suppression, where the album may genuinely have changed. This is
  // specifically "still the same album", which is what the metal-tier
  // crossfade needs (see METAL spec §4): a real sleeve pull already covers
  // any background change when the album is actually different.
  const sameAlbum = prevId !== null && prevId === newId;
  S.shellAlbumId = newId;
  S.outgoingArt = t.art; S.outgoingHasArt = !!t.art;
  // the sleeve is physically sitting over an empty platter — always pull,
  // regardless of album identity/shuffle/reduced-motion, or the disc stays
  // stuck hidden behind it with nothing left to bring it back out
  if(S.platterEmpty) return {type:'pull', sameAlbum};
  // untagged tracks don't get the ceremony — an untagged file hasn't
  // established a release identity yet, so it silently occupies the
  // platter without a pull until a genuinely tagged one arrives
  if(t.tags.album === 'Unknown Album') return {type:'none', sameAlbum};
  if(S.shuffle || REDUCED || prevId === newId) return {type:'none', sameAlbum};
  if(prevId === null) return {type:'pull', sameAlbum};
  return {type:'swap', outgoingArt:prevArt, outgoingHasArt:prevHasArt, sameAlbum};
}

// ================= start sequence: sheet/pull/return orchestration =================
// A single async, cancellable sequence drives everything from "the sheet has
// settled" (or "the player was already open") through "the record is on the
// platter and audio has started." Every await is followed by a token check
// so interruptStartSequence() can cut in cleanly at any point instead of
// racing a stale animation to the end. Playback itself is strictly gated:
// startAudio (always play()) is only ever invoked once, at the moment the
// disc actually reaches the platter — never before, never overlapping.
function waitAnimEnd(el, ms){
  return new Promise(resolve => {
    let done = false;
    const finish = () => { if(done) return; done = true; el.removeEventListener('animationend', onEnd); resolve(); };
    const onEnd = (e) => { if(e.target === el) finish(); };
    el.addEventListener('animationend', onEnd);
    setTimeout(finish, ms + 150);   // safety net if animationend never fires
  });
}

function sleeveArtFor(art, hasArt){
  const sleeve = $('#sleeve'), sleeveArt = $('#sleeveArt');
  if(hasArt){ sleeveArt.src = art; sleeve.classList.add('has-art'); }
  else { sleeveArt.removeAttribute('src'); sleeve.classList.remove('has-art'); }
}

// info comes from updateShellAlbum(). startAudio runs immediately when
// there's no ceremony to run at all (untagged/shuffled/same-album, the
// toggle is off, or reduced motion) — otherwise it runs only after the
// full return+pull (swap) or pull-only (fresh platter) sequence completes.
// the seal wrap on the incoming sleeve, shown from the moment it starts
// arriving so it arrives wrapped (SEALED spec §6)
function attachSleeveWrap(){
  removeSleeveWrap();
  const wrap = document.createElement('div');
  wrap.id = 'sleeveWrap';
  wrap.setAttribute('aria-hidden','true');
  wrap.appendChild(buildSealOverlay(278));
  wrap.appendChild(el('div','seal-tear'));
  $('#sleeve').appendChild(wrap);
}
function removeSleeveWrap(){ const w = $('#sleeveWrap'); if(w) w.remove(); }

// tear (~300ms) then slide-off (~400ms); each step is checked against the
// same cancellation token as the rest of the ceremony (SEALED spec §6)
async function runSealPeel(cancelled){
  const wrap = $('#sleeveWrap');
  if(!wrap) return;
  void wrap.offsetWidth;
  wrap.classList.add('peel-tear');
  await sleep(SLEEVE_ANIM.peelTearMs);
  if(cancelled()) return;
  wrap.classList.add('peel-off');
  await sleep(SLEEVE_ANIM.peelOffMs);
  if(cancelled()) return;
  removeSleeveWrap();
}

export async function runStartSequence(t, info, startAudio){
  const stage = $('#platterStage');
  const token = ++S.sleeveSeq;
  const cancelled = () => token !== S.sleeveSeq;
  S.platterEmpty = false;   // a pull is starting, so the sleeve no longer covers an empty platter
  clearSpinDown();

  // clear any in-flight ceremony's visuals immediately — a fresh sequence
  // (or a "nothing to show" one) always takes the stage back over from
  // whatever a just-cancelled prior invocation left behind
  stage.classList.remove('sleeve-arriving','sleeve-exiting','disc-emerging','returning','putaway-in','putaway-slide','putaway-out');
  $('#sleeve').style.display = 'none';
  removeSleeveWrap();

  if(!t || !info || info.type === 'none' || !S.sleevePullEnabled || REDUCED){
    // no ceremony to carry it — play() itself breaks a sealed album's seal
    // silently the instant it actually starts (SEALED spec §6)
    $('#platterBox').classList.remove('disc-hidden');   // nothing will emerge it, so it's just there
    startAudio();
    return;
  }

  // captured once, at the start — not re-checked mid-ceremony, so the peel
  // either runs once in full or not at all (SEALED spec §6, "once per album")
  const sealedForPeel = isAlbumSealed(albumKey(t));

  // decode ahead of time so playback can start the instant the disc lands,
  // never after — runs in parallel with the sleeve/disc motion below
  const bufferReady = ensureBuffer(S.index);
  const discBox = $('#platterBox');

  if(info.type === 'swap'){
    sleeveArtFor(info.outgoingArt, info.outgoingHasArt);
    $('#sleeve').style.display = 'flex';
    void stage.offsetWidth;
    stage.classList.add('returning');
    await waitAnimEnd($('#sleeve'), SLEEVE_ANIM.returnMs);
    if(cancelled()) return;
    stage.classList.remove('returning');
    // the outgoing disc just animated to opacity 0 via discReturn's forwards
    // fill — removing that class would otherwise snap it straight back to
    // fully visible, so this class takes over holding it hidden
    discBox.classList.add('disc-hidden');
  }
  if(cancelled()) return;

  sleeveArtFor(t.art, !!t.art);
  stage.classList.remove('sleeve-arriving','sleeve-exiting','disc-emerging');
  $('#sleeve').style.display = 'flex';
  if(sealedForPeel) attachSleeveWrap();
  void stage.offsetWidth;              // force a reflow so this restarts cleanly if triggered back-to-back
  stage.classList.add('sleeve-arriving');
  await waitAnimEnd($('#sleeve'), SLEEVE_ANIM.arriveMs);
  if(cancelled()) return;
  stage.classList.remove('sleeve-arriving');

  if(sealedForPeel){
    await runSealPeel(cancelled);
    if(cancelled()) return;
    breakSeal(albumKey(t));
  }

  // hold: the sleeve sits static on an empty platter until the buffer is
  // ready, capped so a slow decode never stalls the ceremony indefinitely
  await Promise.race([bufferReady, sleep(SLEEVE_ANIM.holdCapMs)]);
  if(cancelled()) return;

  // disc-hidden comes off exactly as the emerge animation takes over, so its
  // own 0%-opacity start frame is what the disc is actually cutting in from
  discBox.classList.remove('disc-hidden');
  stage.classList.add('sleeve-exiting','disc-emerging');
  await Promise.all([waitAnimEnd($('#sleeve'), SLEEVE_ANIM.emergeMs), waitAnimEnd(discBox, SLEEVE_ANIM.emergeMs)]);
  if(cancelled()) return;
  stage.classList.remove('sleeve-exiting','disc-emerging');
  $('#sleeve').style.display = 'none';

  startAudio();
}

// Cuts the ceremony at whatever point it's in and snaps to the end state
// instantly — no transition, per the hard rule that skipping is instant,
// never eased. Playback is clearly no longer waiting on ceremony once
// interrupted, so it starts right away if it hadn't already.
function interruptStartSequence(){
  S.sleeveSeq++;
  const stage = $('#platterStage');
  const wasPutAway = stage.classList.contains('putaway-in') || stage.classList.contains('putaway-slide') ||
    stage.classList.contains('putaway-out');
  // the peel sits in a gap between stage classes (after 'sleeve-arriving' is
  // removed, before the hold/emerge classes are added) — #sleeveWrap's
  // presence is what marks that window as "active" (SEALED spec §6)
  const wasActive = wasPutAway || stage.classList.contains('sleeve-arriving') || stage.classList.contains('sleeve-exiting') ||
    stage.classList.contains('disc-emerging') || stage.classList.contains('returning') || !!$('#sleeveWrap');
  stage.classList.remove('sleeve-arriving','sleeve-exiting','disc-emerging','returning','putaway-in','putaway-slide','putaway-out');
  clearSpinDown();
  $('#sleeve').style.display = 'none';
  // a tap during the peel snaps straight to the end state: wrap gone, no
  // eased snap (SEALED spec §6, "Interrupt") — the seal itself only breaks
  // once playback is actually about to start, same as everywhere else
  removeSleeveWrap();
  if(wasPutAway){
    // the record was mid-way into its sleeve — finish putting it away rather
    // than resurrecting the disc; pressing play afterwards is what brings it
    // back out (via the S.platterEmpty rule in updateShellAlbum())
    $('#platterBox').classList.add('disc-hidden');
    S.platterEmpty = true;
    renderMiniPlayer();
    return;
  }
  $('#platterBox').classList.remove('disc-hidden');   // skipping lands the record instantly
  if(wasActive && !S.playing) play();   // play() itself breaks the seal the instant it actually starts
}

/* ================= Part 2 §1: gatefold-to-player hand-off =================
   Replaces the sleeve pull specifically for a track picked inside an open
   gatefold whose album differs from whatever is currently playing: the one
   record travels from the gatefold's pocket to the platter instead of
   arriving/holding/emerging in the player's own sleeve. Shares S.sleeveSeq
   with the pull/put-away so only one of the three ever runs at a time, and
   a rapid second tap cancels this cleanly like any of the others. */
const HANDOFF_ANIM = {
  recedeMs: 400,        // 250-650ms: gatefold fades/scales/blurs back
  sheetFadeMs: 450,      // 350-800ms: player sheet fades up behind the flight
  flightMs: 750,         // 250-1000ms: pocket -> platter, growing 156->278px
  overshootMs: 140, settleMs: 110,   // 1000-1250ms: overshoot to 1.035, settle to 1
  overshootScale: 1.035,
  arcLift: 34,          // px the flight's midpoint lifts above a straight line
  tiltDeg: 5
};
function handoffEaseInOut(p){ return p < 0.5 ? 2*p*p : 1 - Math.pow(-2*p+2, 2)/2; }

function gfHandoffInFlight(){ return $('#gfHandoffGhost').style.display === 'block'; }

// `startRect` is measured from the gatefold's own sleeve-disc-wrap before
// anything else moves. t/info/startAudio match runStartSequence's own
// signature (info is unused here — the hand-off never reads "swap" vs
// "pull", it always flies — but kept for call-site symmetry).
async function runGatefoldHandoff(startRect, t, info, startAudio){
  const token = ++S.sleeveSeq;
  const cancelled = () => token !== S.sleeveSeq;
  S.platterEmpty = false;
  clearSpinDown();

  const ghost = $('#gfHandoffGhost'), ghostArt = $('#gfHandoffArt'), ghostLabel = $('#gfHandoffLabel');
  const ov = $('#playerOverlay'), stage = $('#platterStage'), discBox = $('#platterBox'), gf = $('#gatefold');

  const bufferReady = ensureBuffer(S.index);

  // ghost starts exactly where the gatefold's own disc currently sits, using
  // whatever L-tier art the gatefold already loaded for this same album —
  // read the attribute, not the .src property, which resolves to the page's
  // own URL (never empty) when no src was ever set
  const gfArt = $('#gfDiscArt').getAttribute('src') || t.art || '';
  ghost.style.transition = 'none';
  ghost.style.width = startRect.width + 'px';
  ghost.style.height = startRect.height + 'px';
  ghost.style.left = startRect.left + 'px';
  ghost.style.top = startRect.top + 'px';
  ghost.style.transform = 'rotate(0deg) scale(1)';
  if(gfArt) ghostArt.src = gfArt; else ghostArt.removeAttribute('src');
  ghostLabel.classList.toggle('has-art', !!gfArt);
  void ghost.offsetWidth;
  ghost.style.display = 'block';

  discBox.classList.add('disc-hidden');
  stage.classList.remove('sleeve-arriving','sleeve-exiting','disc-emerging','returning');
  $('#sleeve').style.display = 'none';

  // player sheet fades up behind the flight rather than sliding up from the
  // bottom — same transform-skip trick runMorphOpen() uses. Prepped hidden
  // now (invisible either way), the fade-to-1 itself is timed below to
  // start at the 350ms mark (spec §1 step 3), not immediately.
  const wasPlayerOpen = S.playerOpen;
  if(!wasPlayerOpen){
    S.playerOpen = true;
    ov.classList.add('instant');
    ov.style.opacity = '0';
    ov.classList.add('open');
    ov.setAttribute('aria-hidden','false');
    void ov.offsetWidth;
    ov.classList.remove('instant');
  }

  // 0-250ms: row highlight (already live via updateGatefoldNowPlaying(),
  // triggered inside the setQueue() the caller already ran) plus the record
  // rising in place — nothing else starts moving until this beat finishes
  await sleep(250);
  if(cancelled()) return;

  // the gatefold recedes behind the sheet — fade/scale/blur; the background
  // goes soft on purpose (kept per Part 2 §3), the flying record stays sharp
  gf.style.transition = 'opacity ' + HANDOFF_ANIM.recedeMs + 'ms linear,'
    + 'transform ' + HANDOFF_ANIM.recedeMs + 'ms ease-out,filter ' + HANDOFF_ANIM.recedeMs + 'ms ease-out';
  void gf.offsetWidth;
  gf.style.opacity = '0';
  gf.style.transform = 'scale(.93)';
  gf.style.filter = 'blur(2.5px)';

  // the sheet's own fade starts 100ms into this beat (350ms absolute) —
  // skipped if the player was already open, since there's nothing to fade up
  if(!wasPlayerOpen){
    setTimeout(() => {
      if(cancelled()) return;
      ov.style.transition = 'opacity ' + HANDOFF_ANIM.sheetFadeMs + 'ms ease-out';
      requestAnimationFrame(() => { if(!cancelled()) ov.style.opacity = '1'; });
    }, 100);
  }

  // FLIGHT: pocket -> platter, a gentle arc with a slight tilt, growing to
  // the platter's own size, ease-in-out (spec §1 steps 1-4)
  const endRect = discBox.getBoundingClientRect();
  const flightStart = performance.now();
  await new Promise(resolve => {
    function step(now){
      if(cancelled()){ resolve(); return; }
      const p = Math.min(1, (now - flightStart) / HANDOFF_ANIM.flightMs);
      const e = handoffEaseInOut(p);
      const w = startRect.width + (endRect.width - startRect.width) * e;
      const h = startRect.height + (endRect.height - startRect.height) * e;
      const cx0 = startRect.left + startRect.width/2, cy0 = startRect.top + startRect.height/2;
      const cx1 = endRect.left + endRect.width/2, cy1 = endRect.top + endRect.height/2;
      const cx = cx0 + (cx1 - cx0) * e;
      const arc = Math.sin(Math.PI * e) * HANDOFF_ANIM.arcLift;
      const cy = cy0 + (cy1 - cy0) * e - arc;
      const tilt = Math.sin(Math.PI * e) * HANDOFF_ANIM.tiltDeg * (cx1 >= cx0 ? 1 : -1);
      ghost.style.width = w.toFixed(1) + 'px'; ghost.style.height = h.toFixed(1) + 'px';
      ghost.style.left = (cx - w/2).toFixed(1) + 'px'; ghost.style.top = (cy - h/2).toFixed(1) + 'px';
      ghost.style.transform = 'rotate(' + tilt.toFixed(2) + 'deg)';
      if(p >= 1){ resolve(); return; }
      requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  });
  if(cancelled()) return;

  await Promise.race([bufferReady, sleep(SLEEVE_ANIM.holdCapMs)]);
  if(cancelled()) return;

  // OVERSHOOT + SETTLE: scale 1.035 then back to 1 (spec §1 step 5)
  ghost.style.transition = 'transform ' + HANDOFF_ANIM.overshootMs + 'ms ease-out';
  ghost.style.transform = 'rotate(0deg) scale(' + HANDOFF_ANIM.overshootScale + ')';
  await sleep(HANDOFF_ANIM.overshootMs);
  if(cancelled()) return;
  ghost.style.transition = 'transform ' + HANDOFF_ANIM.settleMs + 'ms ease-in-out';
  ghost.style.transform = 'rotate(0deg) scale(1)';
  await sleep(HANDOFF_ANIM.settleMs);
  if(cancelled()) return;

  ghost.style.display = 'none';
  ghost.style.transition = ''; ghost.style.transform = '';
  discBox.classList.remove('disc-hidden');
  ov.style.transition = ''; ov.style.opacity = '';
  gf.style.transition = ''; gf.style.opacity = ''; gf.style.transform = ''; gf.style.filter = '';
  closeGatefoldInstant();
  startAudio();
}

// Cuts the hand-off wherever it is and snaps to the landed state instantly —
// same hard rule as interruptStartSequence(): no eased skip, ever. Reached
// from the player overlay's existing capture-phase pointerdown listener, so
// a tap anywhere during the flight (the sheet already covers the screen)
// lands it immediately (spec §1, "Tapping anywhere during it").
function interruptGatefoldHandoff(){
  if(!gfHandoffInFlight()) return;
  S.sleeveSeq++;
  const ghost = $('#gfHandoffGhost');
  ghost.style.transition = ''; ghost.style.transform = ''; ghost.style.display = 'none';
  $('#platterBox').classList.remove('disc-hidden');
  const ov = $('#playerOverlay');
  ov.classList.remove('instant'); ov.style.transition = ''; ov.style.opacity = '';
  const gf = $('#gatefold');
  gf.style.transition = ''; gf.style.opacity = ''; gf.style.transform = ''; gf.style.filter = '';
  if(isGatefoldOpen()) closeGatefoldInstant();
  if(!S.playing) play();
}

/* ================= put-away: the record goes back in its sleeve =================
   Mirror image of the pull, run from advance()'s end-of-queue branch: the
   last track finished naturally, nothing is queued next, and repeat is off.
   Shares S.sleeveSeq with the pull on purpose — only one of them ever runs,
   and a pull picking up the token mid-sequence cancels this cleanly. */

// A track ending naturally at the end of the queue only goes away if the
// settings allow a ceremony at all — repeat 'off' is already guaranteed by
// the caller (advance()'s end-of-queue branch is unreachable for 'one', and
// 'all' wraps instead of ending), and `auto` tells manual skips apart from
// a real finish.
export function shouldPutAway(auto){ return auto && S.sleevePullEnabled && !REDUCED; }

// The disc's rotation normally snaps to 0 the instant S.playing goes false
// (see frame()). A put-away eases it down instead, over putSpinMs, read by
// the draw loop and cleared the moment it finishes or is cancelled — an
// ordinary pause is never touched by this.
export function easeOutCubic(x){ return 1 - Math.pow(1 - x, 3); }
function startSpinDown(ms){ S.spinDown = {start: performance.now(), ms, from: S.rate}; }
export function clearSpinDown(){ S.spinDown = null; }

// No player open, or the page is hidden (background playback) — nothing
// would be visible either way, so skip straight to the end state rather
// than running a ceremony no one can see (mirrors advance()'s own
// "if(S.playerOpen) runStartSequence(...) else play()" for the pull).
export function putAwayInstant(){
  S.sleeveSeq++;
  clearSpinDown();
  $('#sleeve').style.display = 'none';
  $('#platterBox').classList.add('disc-hidden');
  S.platterEmpty = true;
  renderMiniPlayer();
}

export async function runPutAwaySequence(t){
  const stage = $('#platterStage'), discBox = $('#platterBox');
  const token = ++S.sleeveSeq;
  const cancelled = () => token !== S.sleeveSeq;

  stage.classList.remove('sleeve-arriving','sleeve-exiting','disc-emerging','returning','putaway-in','putaway-slide','putaway-out');
  startSpinDown(SLEEVE_ANIM.putSpinMs);

  sleeveArtFor(t.art, !!t.art);
  $('#sleeve').style.display = 'flex';
  void stage.offsetWidth;              // force a reflow so this restarts cleanly if triggered back-to-back
  stage.classList.add('putaway-in');

  // the disc slide starts 600ms in, overlapping the sleeve's own arrival —
  // a plain timer rather than waitAnimEnd since nothing here is waiting on
  // the sleeve's animation to finish, just on the clock
  await sleep(SLEEVE_ANIM.putSlideDelayMs);
  if(cancelled()) return;
  stage.classList.add('putaway-slide');

  await waitAnimEnd(discBox, SLEEVE_ANIM.putSlideMs);
  if(cancelled()) return;
  // the disc has caught up to the sleeve's edge — it's "inside" now, so it
  // disappears exactly as the sleeve starts its own exit
  stage.classList.remove('putaway-in');
  discBox.classList.add('disc-hidden');
  stage.classList.add('putaway-out');

  await waitAnimEnd($('#sleeve'), SLEEVE_ANIM.putOutMs);
  if(cancelled()) return;
  stage.classList.remove('putaway-slide','putaway-out');
  $('#sleeve').style.display = 'none';
  S.platterEmpty = true;
  renderMiniPlayer();
}

/* ================= launch intro: crate riffle to a title screen =================
   Cold start only — see shouldShowLaunch()/runLaunchSequence(). Fully
   independent of the sleeve pull/put-away: its own token (S.launchSeq), its
   own overlay, removed from the DOM once it finishes or is skipped. Never
   delays the app — restoreLibrary() runs underneath it from the first paint. */
// resolved by restoreLibrary() once S.tracks/sessions/thumbnails are in
// place — the launch intro races this against a timeout rather than ever
// blocking on it (see runLaunchSequence, "Never delay the app")
let libraryReadyResolve;
const libraryReadyPromise = new Promise(res => { libraryReadyResolve = res; });

const LAUNCH_ANIM = {
  fadeMs: 250, accelMs: 650, cruiseMs: 800, decelMs: 800,
  catchMs: 300, pullMs: 600, titleHoldMs: 300, crossfadeMs: 600,
  skipMs: 150, readyWaitMs: 700,
  // a 2-7 album library gets a shorter "riffle" instead of the full flick
  // (about 1.35s of scroll vs 2.25s), so the whole sequence comes in around
  // 3.4s rather than 4.3s — see LAUNCH spec §1/§3
  riffleAccelMs: 300, riffleCruiseMs: 650, riffleDecelMs: 400,
  // settling the pulled title sleeve into the crate view's centre slot —
  // the crate (or the list, if that's the saved layout) is already correct
  // underneath by the time this runs, so this is just how long the handoff
  // fade takes, not anything it has to build (LAUNCH spec §3, 3700-4300ms)
  intoCrateMs: 600,
  firstRunCount: 44, stackMax: 50,
  // distance share of the scroll each phase covers, by construction summing
  // to 1 so position lands exactly on the target at the end of decel — see
  // computeFlickPosition(). Proportions come from the reference timeline
  // (about 15:21:4 records for a 40-record flick).
  accelShare: 0.375, cruiseShare: 0.525, decelShare: 0.10,
  edgePalette: ['#B8452F','#6E8F5C','#4C5FA0','#C9A24A','#8E5C8F','#3F8C8A','#A8A29A']
};
document.documentElement.style.setProperty('--launch-fade-duration', LAUNCH_ANIM.fadeMs + 'ms');
document.documentElement.style.setProperty('--launch-pull-duration', LAUNCH_ANIM.pullMs + 'ms');
document.documentElement.style.setProperty('--launch-title-duration', LAUNCH_ANIM.titleHoldMs + 'ms');
document.documentElement.style.setProperty('--launch-wordmark-duration', (LAUNCH_ANIM.catchMs + LAUNCH_ANIM.pullMs) + 'ms');
document.documentElement.style.setProperty('--launch-skip-duration', LAUNCH_ANIM.skipMs + 'ms');

function shouldShowLaunch(){ return S.launchIntro && !REDUCED && !document.hidden; }

// the 390x740 design stage scales uniformly to fit the viewport rather than
// being redrawn per size — CSS alone can't turn a viewport length into a
// unitless scale() factor, so this is computed and written as a variable
function updateLaunchScale(){
  const s = Math.min(window.innerWidth / 390, window.innerHeight / 740);
  document.documentElement.style.setProperty('--launch-scale', s);
}

// the key in S.albumLastPlayed with the largest timestamp; a library that
// has never been played falls back to the most recently added album
function resolveLastPlayedAlbum(){
  const played = Object.keys(S.albumLastPlayed).filter(id => S.tracks.some(t => albumKey(t) === id));
  if(played.length) return played.reduce((best,id) => S.albumLastPlayed[id] > S.albumLastPlayed[best] ? id : best, played[0]);
  const addedByAlbum = {};
  S.tracks.forEach(t => { const id = albumKey(t); const a = t.addedAt || 0; if(!(id in addedByAlbum) || a > addedByAlbum[id]) addedByAlbum[id] = a; });
  const addedIds = Object.keys(addedByAlbum);
  if(!addedIds.length) return null;
  return addedIds.reduce((best,id) => addedByAlbum[id] > addedByAlbum[best] ? id : best, addedIds[0]);
}

// within that album, the track key with the largest S.trackLastPlayed value;
// falls back to the album's first track (by the same order the Albums tab uses)
function resolveLastPlayedTrackIndex(albumId){
  const sample = S.tracks.find(t => albumKey(t) === albumId);
  if(!sample) return -1;
  const idx = albumTracks(sample.tags.album);
  if(!idx.length) return -1;
  let best = idx[0], bestTime = -1;
  idx.forEach(i => {
    const last = S.trackLastPlayed[trackIdentityKey(S.tracks[i])] || 0;
    if(last > bestTime){ bestTime = last; best = i; }
  });
  return best;
}

// Evenly samples down to `cap` entries, always keeping mustIncludeId among
// them (see LAUNCH spec §1, flick-length rule, A > 50 case).
function sampleStackAlbums(allIds, cap, mustIncludeId){
  const picked = [];
  const step = allIds.length / cap;
  for(let i=0;i<cap;i++) picked.push(allIds[Math.floor(i*step)]);
  if(mustIncludeId && !picked.includes(mustIncludeId)) picked[Math.floor(picked.length/2)] = mustIncludeId;
  return picked;
}

function shuffledCopy(arr){
  const out = arr.slice();
  for(let i = out.length - 1; i > 0; i--){
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = out[i]; out[i] = out[j]; out[j] = tmp;
  }
  return out;
}

// Resolves which variant to show and everything it needs, without touching
// any DOM — kept separate from rendering so it's independently testable.
// Flick-length rule: N = min(A, 50), no repeats and no padding — a small
// library just flicks through exactly its own albums. A > 50 samples 50
// evenly, always keeping the last-played one. The whole stack is shuffled
// (it should feel like digging, not a sorted list) and the last-played
// album always ends up at about index N-4, the record that gets caught
// (see LAUNCH spec §1).
function buildLaunchStack(){
  const firstRun = {variant:'first-run', count: LAUNCH_ANIM.firstRunCount, targetIndex: LAUNCH_ANIM.firstRunCount - 4};
  if(!S.tracks.length) return firstRun;
  const targetAlbumId = resolveLastPlayedAlbum();
  if(!targetAlbumId) return firstRun;
  const allAlbumIds = groupBy('album').map(([,idx]) => albumKey(S.tracks[idx[0]]));
  const A = allAlbumIds.length;
  const N = Math.min(A, LAUNCH_ANIM.stackMax);
  const picked = A > LAUNCH_ANIM.stackMax ? sampleStackAlbums(allAlbumIds, N, targetAlbumId) : allAlbumIds.slice();
  const albumIds = shuffledCopy(picked);
  const targetIndex = Math.max(0, N - 4);
  const curPos = albumIds.indexOf(targetAlbumId);
  if(curPos >= 0 && curPos !== targetIndex){
    const tmp = albumIds[targetIndex]; albumIds[targetIndex] = albumIds[curPos]; albumIds[curPos] = tmp;
  } else if(curPos < 0){
    albumIds[targetIndex] = targetAlbumId;   // the caught record is always the real last-played album
  }
  const sampleTrack = S.tracks.find(t => albumKey(t) === targetAlbumId);
  return {
    variant:'library', albumIds, targetIndex, targetAlbumId, count: N,
    targetArt: thumbURL['album:' + targetAlbumId] || null,
    targetTitle: sampleTrack ? sampleTrack.tags.album : '',
    targetArtist: sampleTrack ? (sampleTrack.tags.albumArtist || sampleTrack.tags.artist) : ''
  };
}

// one scalar drives the whole flick: ease-in over accelMs, linear cruise,
// ease-out over decelMs, landing exactly on `target` (see LAUNCH spec §3).
// `timing` is {accelMs,cruiseMs,decelMs} — the standard flick for 8+ albums
// (and the first-run variant) or the shorter riffle for a 2-7 album library.
function computeFlickPosition(elapsedMs, target, timing){
  const { accelMs, cruiseMs, decelMs } = timing;
  const { accelShare, cruiseShare } = LAUNCH_ANIM;
  const accelDist = target * accelShare, cruiseDist = target * cruiseShare;
  const decelDist = target - accelDist - cruiseDist;
  if(elapsedMs <= accelMs){
    const u = elapsedMs / accelMs;
    return accelDist * u*u*u;
  }
  if(elapsedMs <= accelMs + cruiseMs){
    const u = (elapsedMs - accelMs) / cruiseMs;
    return accelDist + cruiseDist * u;
  }
  const u = clamp((elapsedMs - accelMs - cruiseMs) / decelMs, 0, 1);
  return accelDist + cruiseDist + decelDist * (1 - Math.pow(1 - u, 3));
}
// trapezoidal 0->1->0 matching the accel/cruise/decel phases, used only to
// scale the speed-stretch cosmetics — not position itself
function flickSpeed(elapsedMs, timing){
  const { accelMs, cruiseMs, decelMs } = timing;
  if(elapsedMs < accelMs) return elapsedMs / accelMs;
  if(elapsedMs < accelMs + cruiseMs) return 1;
  if(elapsedMs < accelMs + cruiseMs + decelMs) return 1 - (elapsedMs - accelMs - cruiseMs) / decelMs;
  return 0;
}

// The 3D pose for a card at fractional distance `d` from the current
// position (negative = above/earlier, positive = below/later). Shared by
// the launch overlay and the crate (see CRATE spec §3) — one geometry
// implementation so the two views can never drift apart. `opts.originY`
// is where the stack's centre sits (launch: baked into its own CSS `top`,
// so it passes 0 here; crate: 170px, passed explicitly since the crate
// card sits at `top:0` and reads its vertical position from `pose.y`).
function flowPose(a, d, speed, opts){
  opts = opts || {};
  const originY = opts.originY || 0, spread = opts.spread == null ? 1 : opts.spread;
  const dir = d < 0 ? -1 : (d > 0 ? 1 : 0);
  const nearFactor = 1 + 0.3*speed, farFactor = 1 + 0.9*speed;
  const baseOffset = a < 1 ? 170*a*nearFactor : 170*nearFactor + (a-1)*34*farFactor;
  const offset = baseOffset * dir * spread;
  const tiltMag = 62 * Math.min(a,1);
  const rotX = dir < 0 ? -tiltMag : tiltMag;
  const scale = 0.86 - 0.06*Math.min(a,1) - 0.02*Math.max(0, Math.min(a,8)-1);
  const z = -70*Math.min(a,1) - 6*Math.max(0, a-1);
  const opacity = a <= 3 ? 1 : Math.max(0, 1 - 0.25*(a-3));
  return { y: originY + offset, rotX, scale, z, opacity };
}
// stacking order for a card at |offset| `a` from the centre — nearest on top
function flowZIndex(a){ return Math.round((9 - Math.min(a,9)) * 10); }

// thin adapter kept so every existing launch call site/shape is untouched —
// the actual geometry now lives in flowPose() alone (LAUNCH spec §3).
function launchCardPose(d, speed, spread){
  const a = Math.abs(d);
  const p = flowPose(a, d, speed, {spread});
  return { offset: p.y, tilt: p.rotX, scale: p.scale, depth: p.z, opacity: p.opacity,
    z: flowZIndex(a) };
}
function applyLaunchCardPose(el, pose, extraScale){
  const scale = pose.scale * (extraScale == null ? 1 : extraScale);
  el.style.transform = 'translateY(' + pose.offset.toFixed(1) + 'px) translateZ(' + pose.depth.toFixed(1) + 'px) '
    + 'rotateX(' + pose.tilt.toFixed(2) + 'deg) scale(' + scale.toFixed(3) + ')';
  el.style.opacity = pose.opacity;
  el.style.zIndex = pose.z;
}

// Builds one card's DOM (cover art for the library variant, the default
// cover otherwise) — only ever called for indices inside the visible
// window, never all N up front (see LAUNCH spec §3 implementation note).
function makeLaunchCard(stack, index){
  const el = document.createElement('div');
  el.className = 'launch-card';
  if(index === stack.targetIndex) el.classList.add('launch-target');
  const face = document.createElement('div');
  face.className = 'launch-card-face';
  let art = null;
  if(stack.variant === 'library'){
    const albumId = stack.albumIds[index];
    // an already-warmed crate tier (S for the flying stack, L for the
    // caught record) is sharper than the 800px thumbnail — but this never
    // waits on a build, only a synchronous cache hit (spec §B5)
    const tier = index === stack.targetIndex ? 'L' : 'S';
    art = crateArtCache[tier].get(albumId) || thumbURL['album:' + albumId];
  }
  if(art){
    const img = document.createElement('img');
    img.src = art; img.alt = '';
    img.decode().catch(() => {});
    face.appendChild(img);
  } else if(index === stack.targetIndex){
    // the caught record becomes the title screen, so it always gets a
    // presentable cover even with no thumbnail yet (see LAUNCH spec §5)
    const mark = document.createElement('div');
    mark.className = 'launch-card-mark';
    mark.innerHTML = 'Mi<span>zi</span>ki';
    face.appendChild(mark);
  } else if(stack.variant === 'library'){
    face.style.background = S.albumEdge[stack.albumIds[index]] || LAUNCH_ANIM.edgePalette[index % LAUNCH_ANIM.edgePalette.length];
  } else {
    face.style.background = LAUNCH_ANIM.edgePalette[index % LAUNCH_ANIM.edgePalette.length];
  }
  el.appendChild(face);
  return el;
}

// a plain mono "N RECORDS" label, bottom centre — no rail or position
// counter in the intro any more (the crate view has its own rail)
function updateLaunchRecordsLabel(stack){
  $('#launchRecords').textContent = stack.variant === 'library' ? (stack.count + ' RECORDS') : '';
}

async function runLaunchSequence(){
  const token = ++S.launchSeq;
  const cancelled = () => token !== S.launchSeq;
  const overlay = $('#launchOverlay');

  updateLaunchScale();
  window.addEventListener('resize', updateLaunchScale);

  // the variant choice depends on whether restoreLibrary() actually finished
  // in time, not on whatever S.tracks happens to hold at this instant — data
  // that arrives mid-way (tracks populated but sessions/thumbnails still
  // loading) is exactly the "not ready" case the 700ms cap exists for
  const ready = await Promise.race([
    libraryReadyPromise.then(() => true),
    sleep(LAUNCH_ANIM.readyWaitMs).then(() => false)
  ]);
  if(cancelled()) return;
  const stack = ready ? buildLaunchStack() : {variant:'first-run', count: LAUNCH_ANIM.firstRunCount, targetIndex: LAUNCH_ANIM.firstRunCount - 4};
  if(cancelled()) return;
  // S.launchIntro's persisted value loads inside restoreLibrary(), which by
  // now has had at least this long to resolve it — now it's known for sure
  if(!S.launchIntro){ overlay.remove(); window.removeEventListener('resize', updateLaunchScale); return; }

  const stackEl = $('#launchStack'), recordsEl = $('#launchRecords');
  updateLaunchRecordsLabel(stack);
  const cards = new Map();   // index -> element, only for the currently-visible window
  function syncCards(position, speed, spread){
    const lo = Math.max(0, Math.floor(position) - 8), hi = Math.min(stack.count - 1, Math.ceil(position) + 8);
    for(const i of Array.from(cards.keys())) if(i < lo || i > hi){ cards.get(i).remove(); cards.delete(i); }
    for(let i=lo;i<=hi;i++) if(!cards.has(i)){ const el = makeLaunchCard(stack, i); stackEl.appendChild(el); cards.set(i, el); }
    cards.forEach((el, i) => applyLaunchCardPose(el, launchCardPose(i - position, speed, spread)));
  }
  syncCards(0, 0, 1);

  // swallow the first tap anywhere on the overlay: snap to the end instantly
  // rather than letting it also press whatever is underneath
  const skip = e => {
    e.stopPropagation(); e.preventDefault();
    S.launchSeq++;   // cancel the running sequence
    finishLaunch();
  };
  overlay.addEventListener('pointerdown', skip, {capture:true});

  function finishLaunch(fadeMs){
    overlay.removeEventListener('pointerdown', skip, {capture:true});
    window.removeEventListener('resize', updateLaunchScale);
    overlay.style.transition = 'opacity ' + (fadeMs || LAUNCH_ANIM.skipMs) + 'ms linear';
    overlay.classList.add('launch-hidden');
    setTimeout(() => { if(overlay.parentNode) overlay.parentNode.removeChild(overlay); }, fadeMs || LAUNCH_ANIM.skipMs);
  }

  // STACK fades up, resting on record 0
  void stackEl.offsetWidth;
  stackEl.classList.add('launch-settled');
  await sleep(LAUNCH_ANIM.fadeMs);
  if(cancelled()) return;

  // FLICK: accelerate, cruise, decelerate — one position, driven by rAF.
  // A single record never scrolls at all ("no flick: the sleeve pulls
  // straight to the title screen"); 2-7 albums get the shorter riffle
  // timing; everything else (8+, and the first-run variant) gets the
  // standard flick (LAUNCH spec §1/§3).
  if(stack.count > 1){
    const timing = (stack.variant === 'library' && stack.count <= 7)
      ? {accelMs: LAUNCH_ANIM.riffleAccelMs, cruiseMs: LAUNCH_ANIM.riffleCruiseMs, decelMs: LAUNCH_ANIM.riffleDecelMs}
      : {accelMs: LAUNCH_ANIM.accelMs, cruiseMs: LAUNCH_ANIM.cruiseMs, decelMs: LAUNCH_ANIM.decelMs};
    const scrollMs = timing.accelMs + timing.cruiseMs + timing.decelMs;
    const flickStart = performance.now();
    await new Promise(resolve => {
      function step(now){
        if(cancelled()){ resolve(); return; }
        const elapsed = now - flickStart;
        const position = computeFlickPosition(Math.min(elapsed, scrollMs), stack.targetIndex, timing);
        const speed = flickSpeed(elapsed, timing);
        syncCards(position, speed, 1);
        if(elapsed >= scrollMs){ resolve(); return; }
        requestAnimationFrame(step);
      }
      requestAnimationFrame(step);
    });
    if(cancelled()) return;
    syncCards(stack.targetIndex, 0, 1);   // land exactly on the target, no residual speed-stretch
  }

  // CATCH: amber outline (already on the target card's class), small settle
  const targetCard = cards.get(stack.targetIndex);
  if(targetCard){
    targetCard.style.transition = 'transform ' + LAUNCH_ANIM.catchMs + 'ms ease-out';
    void targetCard.offsetWidth;
    targetCard.style.transform += ' scale(1.015)';
    await sleep(LAUNCH_ANIM.catchMs / 2);
    if(cancelled()) return;
    applyLaunchCardPose(targetCard, launchCardPose(0, 0, 1));
  }
  await sleep(LAUNCH_ANIM.catchMs / 2);
  if(cancelled()) return;

  // PULL TO CAMERA: the target scales up to face-on (it's already sitting at
  // the title's position/size — only its scale/tilt/depth are non-identity);
  // neighbours spread apart, dim and fade (opacity only, no blur); the
  // records label fades out
  recordsEl.classList.add('launch-fading');
  const wordmarkEl = $('#launchWordmark');
  wordmarkEl.classList.add('launch-grown');
  const pullStart = performance.now();
  await new Promise(resolve => {
    function step(now){
      if(cancelled()){ resolve(); return; }
      const p = clamp((now - pullStart) / LAUNCH_ANIM.pullMs, 0, 1);
      const eased = p < 0.5 ? 2*p*p : 1 - Math.pow(-2*p+2, 2)/2;   // ease-in-out
      const spread = 1 + 1.2*eased;   // neighbours spread ~1.7x-2.2x by the end
      cards.forEach((el, i) => {
        if(i === stack.targetIndex){ applyLaunchCardPose(el, launchCardPose(0, 0, 1), 0.86 + 0.14*eased); return; }
        const pose = launchCardPose(i - stack.targetIndex, 0, spread);
        pose.opacity = Math.max(0, pose.opacity) * (1 - 0.9*eased);
        applyLaunchCardPose(el, pose);
      });
      if(p >= 1){ resolve(); return; }
      requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  });
  if(cancelled()) return;

  // TITLE: holds as the title screen
  const nameEl = $('#launchTitleName'), subEl = $('#launchTitleSub'), titleEl = $('#launchTitle');
  if(stack.variant === 'library'){
    nameEl.textContent = stack.targetTitle;
    subEl.innerHTML = (stack.targetArtist || '') + '<br><span style="color:var(--accent)">LAST PLAYED</span>';
  } else {
    nameEl.innerHTML = 'Mi<span>zi</span>ki';
    subEl.textContent = 'LOCAL · LOSSLESS';
  }
  titleEl.classList.add('launch-shown');
  await sleep(LAUNCH_ANIM.titleHoldMs);
  if(cancelled()) return;

  // INTO THE CRATE: the library route (crate or list, whichever is saved —
  // restoreLibrary() already rendered it underneath, anchored on this same
  // last-played album, so there is nothing left to build) is already
  // correct behind this opaque overlay. Landing in the crate gets the
  // slower "settle" fade (LAUNCH spec §3, 3700-4300ms); a saved list layout,
  // or the first-run/empty-library variant, just crossfades the plain way.
  if(stack.variant === 'library' && S.libraryLayout !== 'list') finishLaunch(LAUNCH_ANIM.intoCrateMs);
  else finishLaunch();
}

function attachLaunchSettingRow(){
  const b = $('#launchIntroBtn');
  if(!b) return;
  b.textContent = S.launchIntro ? 'On' : 'Off';
  b.setAttribute('aria-pressed', String(S.launchIntro));
}
function toggleLaunchIntro(){
  S.launchIntro = !S.launchIntro;
  attachLaunchSettingRow();
  queueSave();
}
// F2: real scratch audio in spin-to-scrub, Vinyl only — see src/player/scrub.js.
// Lives in S.char alongside the sliders (not its own top-level S field) since
// it's saved the same way, as part of the same prefs.char object.
function toggleScratch(){
  S.char.scratch = !S.char.scratch;
  const b = $('#scratchBtn');
  b.textContent = S.char.scratch ? 'On' : 'Off';
  b.setAttribute('aria-pressed', String(S.char.scratch));
  queueSave();
}

// Library selection always arrives via the sheet — something is being
// started. The sheet must settle fully before the disc transition begins.
export function openPlayerViaSheet(t, info){
  if(!t) return;
  S.playerOpen = true;
  const ov = $('#playerOverlay');
  ov.setAttribute('aria-hidden','false');
  ov.classList.add('open');
  // under REDUCED the sheet's slide-up transition is `none` (see .player-
  // overlay's reduced-motion rule), so transitionend never fires — go
  // straight to the ceremony instead of waiting on an event that won't come
  if(REDUCED){ runStartSequence(t, info, play); return; }
  let done = false;
  const settle = () => { if(done) return; done = true; ov.removeEventListener('transitionend', settle); runStartSequence(t, info, play); };
  ov.addEventListener('transitionend', settle, {once:true});
  setTimeout(settle, SLEEVE_ANIM.sheetMs + 150);   // safety net if transitionend never fires
}

// Tapping the mini-player is always a return to what's already playing —
// never a new selection — so it arrives via the morph and never runs a
// disc transition of its own.
function openPlayer(){
  if(!current() || S.playerOpen) return;
  S.playerOpen = true;
  runMorphOpen();
}

export function closePlayer(){
  if(morphInFlight()){ interruptMorph(); return; }
  S.playerOpen = false;
  interruptStartSequence();
  const ov = $('#playerOverlay');
  ov.classList.remove('open');
  ov.setAttribute('aria-hidden','true');
}

/* ---- morph: the mini-player's disc grows and travels into the full disc's
   position. A plain FLIP: measure both rects (a shared fixed-position
   coordinate space), place a ghost at the small one, transition its
   transform to the delta+scale needed to become the large one, then hand
   off to the real disc. Must reverse cleanly if interrupted mid-flight,
   unlike the sleeve transitions, which snap straight to the end state. ---- */
function morphInFlight(){ return $('#morphDisc').style.display === 'block'; }

function runMorphOpen(){
  const t = current(); if(!t){ S.playerOpen = false; return; }
  const mini = $('#miniIndicator'), ghost = $('#morphDisc'), ov = $('#playerOverlay'),
        realDisc = $('#disc'), stage = $('#platterStage');
  const miniRect = mini.getBoundingClientRect();

  ov.classList.add('instant');
  ov.classList.add('open');
  ov.setAttribute('aria-hidden','false');
  void ov.offsetWidth;
  ov.classList.remove('instant');

  const targetRect = stage.getBoundingClientRect();
  stage.classList.add('morph-hidden');

  ghost.style.width = miniRect.width + 'px';
  ghost.style.height = miniRect.height + 'px';
  ghost.style.left = miniRect.left + 'px';
  ghost.style.top = miniRect.top + 'px';
  ghost.style.background = realDisc.style.background || '#15161B';
  ghost.style.transition = 'none';
  ghost.style.transform = 'translate(0,0) scale(1)';
  ghost.style.display = 'block';

  const scale = targetRect.width / miniRect.width;
  const dx = (targetRect.left + targetRect.width/2) - (miniRect.left + miniRect.width/2);
  const dy = (targetRect.top + targetRect.height/2) - (miniRect.top + miniRect.height/2);

  void ghost.offsetWidth;
  ghost.style.transition = 'transform ' + SLEEVE_ANIM.morphMs + 'ms ' + SLEEVE_ANIM.easing;
  ghost.style.transform = 'translate(' + dx + 'px,' + dy + 'px) scale(' + scale + ')';

  ghost.addEventListener('transitionend', function done(){
    ghost.removeEventListener('transitionend', done);
    ghost.style.display = 'none';
    ghost.style.transition = '';
    stage.classList.remove('morph-hidden');
  }, {once:true});
}

// reverses the ghost back down to the mini-player's position, then closes
// the overlay only once that shrink actually finishes
function interruptMorph(){
  const ghost = $('#morphDisc'), stage = $('#platterStage');
  const cs = getComputedStyle(ghost);
  ghost.style.transition = 'none';
  ghost.style.transform = cs.transform === 'none' ? 'translate(0,0) scale(1)' : cs.transform;
  void ghost.offsetWidth;
  ghost.style.transition = 'transform ' + Math.round(SLEEVE_ANIM.morphMs*0.6) + 'ms ' + SLEEVE_ANIM.easing;
  ghost.style.transform = 'translate(0,0) scale(1)';
  ghost.addEventListener('transitionend', function done(){
    ghost.removeEventListener('transitionend', done);
    ghost.style.display = 'none';
    ghost.style.transition = '';
    stage.classList.remove('morph-hidden');
    S.playerOpen = false;
    const ov = $('#playerOverlay');
    ov.classList.remove('open');
    ov.setAttribute('aria-hidden','true');
  }, {once:true});
}

/* ================= background playback (optional) =================
   Off by default, and when it is off none of this runs: audio goes master ->
   destination exactly as before. When on, the output goes master -> a
   MediaStreamDestination -> a hidden <audio> element instead. Browsers treat
   an <audio> element as real media playback, so the OS keeps it running when
   the app is left or the screen locks, and shows lock-screen controls through
   the Media Session API. The Pure/Vinyl chain (Sundown's rate included,
   in Vinyl) and Car Mode gain all sit in front of that destination, so
   none of them change.
   Trade-offs: the browser's media pipeline may resample to the device's output
   rate, and iOS/Android can still end playback for their own reasons (a call,
   battery saver). If the element cannot start, output falls back to the normal
   path rather than going silent. */
const BG_NOTE = "Keeps music playing when you leave the app or lock the screen, and adds lock-screen controls. Audio is routed through the browser's media player, which may convert it to the device's output rate. Pure and Vinyl still apply first.";
const BG_SUPPORTED = (function(){
  try{
    const AC = window.AudioContext || window.webkitAudioContext;
    return !!(AC && AC.prototype && typeof AC.prototype.createMediaStreamDestination === 'function'
      && typeof HTMLMediaElement !== 'undefined' && 'srcObject' in HTMLMediaElement.prototype);
  }catch(e){ return false; }
})();

export function bgRouteActive(){ return BG_SUPPORTED && S.bgAudio && !S.bg.failed; }

function bgEl(){
  if(S.bg.el) return S.bg.el;
  const el = document.createElement('audio');
  el.setAttribute('playsinline', ''); el.setAttribute('aria-hidden', 'true');
  el.preload = 'auto'; el.style.display = 'none';
  // something outside Miziki paused the stream (a call, a headset button, the OS) — follow it
  el.addEventListener('pause', () => {
    if(S.bg.swapping || !S.playing || !bgRouteActive()) return;
    pause();
  });
  document.body.appendChild(el);
  S.bg.el = el;
  return el;
}

// a quarter second of silence, used only to let the element start inside the tap
// before the real stream exists — browsers allow later source swaps on an element
// that has already played from a user gesture
function bgSilentURL(){
  if(S.bg.silentURL) return S.bg.silentURL;
  const rate = 8000, n = 2000, buf = new ArrayBuffer(44 + n), dv = new DataView(buf);
  const wr = (o, s) => { for(let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i)); };
  wr(0, 'RIFF'); dv.setUint32(4, 36 + n, true); wr(8, 'WAVE'); wr(12, 'fmt ');
  dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
  dv.setUint32(24, rate, true); dv.setUint32(28, rate, true); dv.setUint16(32, 1, true); dv.setUint16(34, 8, true);
  wr(36, 'data'); dv.setUint32(40, n, true);
  for(let i = 0; i < n; i++) dv.setUint8(44 + i, 128);
  S.bg.silentURL = URL.createObjectURL(new Blob([buf], {type:'audio/wav'}));
  return S.bg.silentURL;
}

function bgStartEl(){
  const p = bgEl().play();
  if(p && typeof p.catch === 'function') p.catch(err => {
    if(err && err.name === 'AbortError') return;   // a source swap interrupted it; the swap restarts it
    bgFallback();
  });
}

function bgFallback(){
  if(S.bg.failed) return;
  S.bg.failed = true;
  applyOutputRoute();
  bgUpdateUI();
  setPathNote('Background playback could not start on this device, so Miziki is playing normally. Turn it off and on again in Character to retry.', true);
}

// call from inside a tap that is about to start playback
export function bgPrime(){
  if(!bgRouteActive()) return;
  const el = bgEl();
  if(el.srcObject){ if(el.paused) bgStartEl(); return; }
  if(!el.paused) return;
  el.src = bgSilentURL(); el.loop = true;
  bgStartEl();
}

function bgSwapGuard(){
  S.bg.swapping = true;
  setTimeout(() => { S.bg.swapping = false; }, 400);
}

export function applyOutputRoute(){
  if(!S.ctx || !S.nodes) return;
  const n = S.nodes, want = bgRouteActive();
  if(want && !n.bgDest){
    try{
      n.bgDest = S.ctx.createMediaStreamDestination();
      n.master.disconnect();
      n.master.connect(n.bgDest);
    }catch(e){
      try{ n.master.connect(S.ctx.destination); }catch(_){}
      n.bgDest = null;
      bgFallback();
      return;
    }
    const el = bgEl();
    bgSwapGuard();
    el.loop = false; el.removeAttribute('src');
    el.srcObject = n.bgDest.stream;
    if(S.playing) bgStartEl();
  } else if(!want && n.bgDest){
    try{ n.master.disconnect(); }catch(e){}
    n.master.connect(S.ctx.destination);
    try{ n.bgDest.disconnect(); }catch(e){}
    n.bgDest = null;
    bgTeardown();
  }
}

function bgTeardown(){
  clearTimeout(S.bg.idleTimer);
  const el = S.bg.el;
  if(el){ bgSwapGuard(); el.pause(); el.srcObject = null; el.removeAttribute('src'); }
  bgRemoveHandlers();
}

// load() calls stop() and then play() a moment later, so a track change looks like a
// brief pause. Only treat it as really paused if nothing starts again quickly — that
// keeps the lock screen from flickering and the media element running across tracks
// (iOS is touchy about restarting an element outside a tap).
function bgSync(){
  if(!bgRouteActive()) return;
  clearTimeout(S.bg.idleTimer);
  if(S.playing){
    const el = bgEl();
    if(el.srcObject && el.paused) bgStartEl();
  } else {
    S.bg.idleTimer = setTimeout(() => { if(!S.playing) bgIdleNow(); }, 1500);
  }
  mediaSessionSync();
}

export function bgIdleNow(){
  const el = S.bg.el;
  if(el && el.srcObject && !el.paused) el.pause();
  if('mediaSession' in navigator){ try{ navigator.mediaSession.playbackState = 'paused'; }catch(e){} }
}

function mediaSessionSync(){
  if(!('mediaSession' in navigator)) return;
  const ms = navigator.mediaSession, t = current();
  if(!t) return;
  if(!S.bg.handlers) bgInstallHandlers();
  const key = [t.id, t.tags.title, t.tags.artist, t.tags.album, t.art || ''].join('|');
  if(key !== S.bg.msKey){
    S.bg.msKey = key;
    const base = {title:t.tags.title, artist:t.tags.artist, album:t.tags.album};
    try{
      ms.metadata = new MediaMetadata(Object.assign({}, base, {artwork: t.art ? [{src:t.art, sizes:'512x512'}] : []}));
    }catch(e){
      try{ ms.metadata = new MediaMetadata(base); }catch(_){}
    }
  }
  if(S.playing){ try{ ms.playbackState = 'playing'; }catch(e){} }
  bgPosition();
}

function bgInstallHandlers(){
  const ms = navigator.mediaSession;
  const set = (action, fn) => { try{ ms.setActionHandler(action, fn); }catch(e){} };
  set('play', async () => { if(!S.ctx) await ensureContext(null); if(!S.playing) play(); });
  set('pause', () => { if(S.playing) pause(); });
  set('stop', () => { if(S.playing) pause(); });
  set('previoustrack', prevTrack);
  set('nexttrack', nextTrack);
  set('seekto', d => { if(d && typeof d.seekTime === 'number') seek(d.seekTime); });
  // Left unset, iOS supplies its own default ±10s skip for these on the
  // lock screen, which takes over the Now Playing widget instead of the
  // previoustrack/nexttrack buttons above. Registering them as null
  // explicitly turns that default off.
  set('seekforward', null);
  set('seekbackward', null);
  S.bg.handlers = true;
}

function bgRemoveHandlers(){
  S.bg.msKey = '';
  if(!('mediaSession' in navigator) || !S.bg.handlers) return;
  const ms = navigator.mediaSession;
  ['play', 'pause', 'stop', 'previoustrack', 'nexttrack', 'seekto', 'seekforward', 'seekbackward'].forEach(a => { try{ ms.setActionHandler(a, null); }catch(e){} });
  try{ ms.metadata = null; ms.playbackState = 'none'; }catch(e){}
  S.bg.handlers = false;
}

export function bgPosition(){
  if(!bgRouteActive() || !('mediaSession' in navigator) || typeof navigator.mediaSession.setPositionState !== 'function') return;
  const t = current(); if(!t || !t.duration) return;
  try{
    navigator.mediaSession.setPositionState({duration:t.duration, playbackRate:S.rate > 0 ? S.rate : 1,
      position:clamp(S.pos, 0, t.duration)});
  }catch(e){}
}

function bgUpdateUI(){
  const b = $('#bgAudioBtn'), note = $('#bgAudioNote');
  if(!b || !note) return;
  if(!BG_SUPPORTED){
    b.style.display = 'none';
    note.textContent = "This browser can't route audio this way, so music pauses when you leave the app.";
    return;
  }
  b.style.display = '';
  b.textContent = S.bgAudio ? 'On' : 'Off';
  b.setAttribute('aria-pressed', String(S.bgAudio));
  note.textContent = (S.bgAudio && S.bg.failed)
    ? "It couldn't start on this device this session, so Miziki is playing normally. Toggle it off and on to retry."
    : BG_NOTE;
}

function applyBgAudioSetting(){
  // on iOS this also lets Web Audio play with the silent switch on
  try{ if('audioSession' in navigator) navigator.audioSession.type = bgRouteActive() ? 'playback' : 'auto'; }catch(e){}
  applyOutputRoute();
  if(bgRouteActive()) mediaSessionSync();
  else bgTeardown();
}

function toggleBgAudio(){
  S.bgAudio = !S.bgAudio;
  S.bg.failed = false;
  if(S.bgAudio) bgPrime();   // still inside the tap, which is what lets the element start later
  applyBgAudioSetting();
  bgUpdateUI();
  queueSave();
}

/* ================= library ================= */
function artFor(indices){
  const withArt = indices.find(i => S.tracks[i].art);
  return withArt === undefined ? null : S.tracks[withArt].art;
}

export function songRow(i, queue, pos, extra){
  const t = S.tracks[i];
  const li = el('li');
  li.dataset.id = t.id;
  if(i === S.index) li.setAttribute('aria-current','true');
  if(S.view.editSelecting && S.editSelection.has(t.id)) li.classList.add('picked');
  const idx = el('span','t-idx', String(pos + 1).padStart(2,'0'));
  li.appendChild(idx);
  if(t.art){ const im = el('img','t-art'); im.src = t.art; im.alt=''; li.appendChild(im); }
  else li.appendChild(el('span','t-art'));
  const name = el('span','t-name');
  name.appendChild(el('b', null, t.tags.title));
  name.appendChild(el('em', null, t.tags.artist + ' · ' + t.meta.codec
    + (t.meta.lossless ? '' : ' · lossy')));
  li.appendChild(name);
  li.appendChild(el('span','t-dur', fmt(t.duration)));
  if(!S.view.editSelecting){
    const editBtn = el('button','t-edit','⋯');
    editBtn.setAttribute('aria-label','Track options');
    editBtn.addEventListener('click', e => { e.stopPropagation(); openRowMenu(t); });
    li.appendChild(editBtn);
  }
  li.addEventListener('click', ()=>{
    if(S.view.editSelecting){ toggleEditSelect(t.id, li); return; }
    if(S.view.picking){ togglePick(i, li); return; }
    setQueue(queue, pos, true);
  });
  if(extra) extra(li, i);
  return li;
}

function toggleEditSelect(id, node){
  if(S.editSelection.has(id)) S.editSelection.delete(id); else S.editSelection.add(id);
  node.classList.toggle('picked', S.editSelection.has(id));
  updateSelectBar();
}

function enterSelectMode(){
  S.view.editSelecting = true;
  S.editSelection.clear();
  renderTracks();
  updateSelectBar();
}
export function exitSelectMode(){
  S.view.editSelecting = false;
  S.editSelection.clear();
  renderTracks();
}
function updateSelectBar(){
  $('#selectCount').textContent = S.editSelection.size + ' selected';
  $('#selectEdit').disabled = S.editSelection.size === 0;
  $('#selectNumber').disabled = S.editSelection.size === 0;
  $('#selectDelete').disabled = S.editSelection.size === 0;
}

/* ---- deletion UI: row overflow menu + shared confirm dialog ----
   No undo window (see LIBRARY spec §4) — the confirm dialog is the
   safeguard, and its copy must be unambiguous that files stay on disk. */
let rowMenuTrackId = null;
function openRowMenu(t){
  rowMenuTrackId = t.id;
  $('#rowMenuTitle').textContent = t.tags.title;
  $('#rowMenuCredits').style.display = trackHasCreditsContent(t) ? '' : 'none';
  $('#rowMenuFav').textContent = isFavorite(t.id) ? 'Remove from Favorites' : 'Add to Favorites';
  $('#rowMenuOverlay').classList.add('open');
  $('#rowMenuOverlay').setAttribute('aria-hidden','false');
}
function closeRowMenu(){
  rowMenuTrackId = null;
  $('#rowMenuOverlay').classList.remove('open');
  $('#rowMenuOverlay').setAttribute('aria-hidden','true');
}

/* Liner notes & credits (CREDITS spec §1) and credits that link: person
   view (CREDITS spec §2) moved to src/library/credits.js (step 5e). */

let confirmDeleteAction = null;
function openConfirmDelete(kind, count, name, action){
  $('#confirmTitle').textContent = kind === 'song' ? 'Remove song' :
    kind === 'album' ? 'Remove album' : kind === 'artist' ? 'Remove artist' : 'Remove songs';
  const noun = count === 1 ? 'track' : 'tracks';
  const nameBit = name ? '“' + name + '” — ' : '';
  $('#confirmBody').textContent = nameBit + count + ' ' + noun + ' will be removed from Miziki’s library. '
    + 'This removes ' + (count === 1 ? 'it' : 'them') + ' from the library only, not from disk — your files stay where they are.';
  confirmDeleteAction = action;
  $('#confirmOverlay').classList.add('open');
  $('#confirmOverlay').setAttribute('aria-hidden','false');
}
function closeConfirmDelete(){
  confirmDeleteAction = null;
  $('#confirmOverlay').classList.remove('open');
  $('#confirmOverlay').setAttribute('aria-hidden','true');
}

// numbers the current selection 1..N in whatever order it's currently
// displayed in — session tracking needs a real order, which an untagged
// hand-assembled folder otherwise has no reliable way to express
async function applyTrackNumbersInOrder(){
  const ids = [];
  document.querySelectorAll('#libBody .tracklist li').forEach(li => {
    if(S.editSelection.has(li.dataset.id)) ids.push(li.dataset.id);
  });
  if(!ids.length) return;
  const prevOverlays = {}, prevArt = {};
  for(const id of ids){ prevOverlays[id] = await overlays.get(id); prevArt[id] = await artwork.get(id); }
  for(let k = 0; k < ids.length; k++){ await applyEdit([ids[k]], {track: k + 1}, null); }
  S.lastUndo = {trackIds: ids.slice(), prevOverlays, prevArt};
  showUndoBanner(ids.length);
  exitSelectMode();
}

export function groupRow(label, sub, indices, onTap){
  const b = el('button','grouprow');
  const art = artFor(indices);
  if(art){ const im = el('img','g-art'); im.src = art; im.alt=''; b.appendChild(im); }
  else b.appendChild(el('span','g-art','◍'));
  const box = el('span','g-text');
  box.appendChild(el('b', null, label));
  box.appendChild(el('em', null, sub));
  b.appendChild(box);
  b.appendChild(el('span','g-chev','›'));
  b.addEventListener('click', onTap);
  return b;
}

function togglePick(i, node){
  const pl = S.playlists[S.view.playlist];
  if(!pl) return;
  const at = pl.items.indexOf(i);
  if(at >= 0) pl.items.splice(at,1); else pl.items.push(i);
  queueSave();
  node.classList.toggle('picked', at < 0);
}

/* Favorites (a real playlist, not a separate flag) moved to
   src/library/favorites.js (step 5e). */

function moveIn(arr, pos, dir){
  const n = pos + dir;
  if(n < 0 || n >= arr.length) return false;
  const tmp = arr[pos]; arr[pos] = arr[n]; arr[n] = tmp;
  return true;
}

/* if the reordered list is the queue you are hearing, follow the change */
function syncQueueOrder(order){
  if(S.baseQueue.length !== order.length) return;
  if(!S.baseQueue.every(i => order.indexOf(i) >= 0)) return;
  S.baseQueue = order.slice();
  if(!S.shuffle){ S.queue = order.slice(); S.qpos = Math.max(0, S.queue.indexOf(S.index)); }
}

function moverCtl(list, pos, after){
  const box = el('span','movers');
  [['▲',-1],['▼',1]].forEach(([glyph,dir]) => {
    const b = el('button','mv',glyph);
    b.setAttribute('aria-label', dir < 0 ? 'Move up' : 'Move down');
    b.addEventListener('click', e => {
      e.stopPropagation();
      if(moveIn(list, pos, dir)){ if(after) after(list); queueSave(); renderTracks(); }
    });
    box.appendChild(b);
  });
  return box;
}

function sortBar(album){
  const bar = el('div','sortbar');
  bar.appendChild(el('span', null, 'Order'));
  const seg = el('div','seg');
  const mode = S.albumSort[album] || 'auto';
  [['auto','Track no.'],['title','Title'],['manual','Manual']].forEach(([k,label]) => {
    const b = el('button', null, label);
    b.setAttribute('aria-pressed', String(mode === k));
    b.addEventListener('click', ()=>{
      if(k === 'manual' && !S.albumOrder[album]) S.albumOrder[album] = albumTracks(album);
      S.albumSort[album] = k;
      syncQueueOrder(albumTracks(album));
      queueSave();
      renderTracks();
    });
    seg.appendChild(b);
  });
  bar.appendChild(seg);
  return bar;
}

// Shared by the Albums tab's own drill-down and an artist's per-album
// drill-down (see LIBRARY spec — artist view should pick an album first,
// not flatten every song from every album into one list).
function renderAlbumDetail(host, ul, album){
  const mode = S.albumSort[album] || 'auto';
  const liner = albumLinerNotes(album);
  const roll = albumCreditRoll(album);
  if(liner || roll.size){
    const section = el('div','credit-section');
    section.appendChild(el('h3', null, 'Liner notes'));
    if(liner) section.appendChild(el('p','credit-note', liner));
    roll.forEach((names, label) => section.appendChild(creditRow(label, names)));
    host.appendChild(section);
  }
  host.appendChild(sortBar(album));
  const q = albumTracks(album);
  q.forEach((i,pos) => {
    const row = songRow(i, q, pos);
    if(mode === 'manual') row.appendChild(moverCtl(S.albumOrder[album], pos, syncQueueOrder));
    ul.appendChild(row);
  });
  host.appendChild(ul);
  if(mode === 'manual') host.appendChild(el('p','note',
    'Your order for this album holds for the session. Tap a track to play the album in this order.'));
}

/* Library-wide search + sort, and tag-aware search (CREDITS spec §3),
   moved to src/library/search.js (step 5e). */

/* ================= S4: crate image tiers (640px "S", 1200px "L") =========
   Stored in the existing `artwork` store (keyed by id, never `meta` — that
   would read hundreds of MB into memory on every launch) under prefixed
   ids `crate640:<albumId>` / `crate1200:<albumId>`, built lazily and
   fetched through a small LRU of object URLs. See the image-quality
   spec §B1-B3. No DB version bump — the store already exists. */
const CRATE_TIER_S_PX = 640, CRATE_TIER_L_PX = 1200;
const CRATE_TIER_S_Q = 0.88, CRATE_TIER_L_Q = 0.92;
const CRATE_TIER_S_CAP = 40, CRATE_TIER_L_CAP = 4;
const crateArtCache = { S: new Map(), L: new Map() };   // albumId -> object URL; Map insertion order is LRU recency
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
async function getCrateArtURL(albumId, tier){
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
async function prewarmCrateAnchorL(){
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

function titleCaseGenre(s){
  return s.split(/\s+/).filter(Boolean).map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
}
function firstGenreValue(raw){ return raw ? raw.split(/[;,]/)[0].trim() : ''; }
// normKey() already lowercases/strips diacritics/collapses to [a-z0-9 ]+;
// stripping a leading article on top of that gives the brief's sort key
function crateSortKey(name){ return normKey(name).replace(/^(the|a|an)\s+/, ''); }
function crateCompareNames(a, b){
  return crateSortKey(a).localeCompare(crateSortKey(b), undefined, {numeric:true, sensitivity:'base'});
}
function crateArtistPriority(artist){ return artist === 'Unknown Artist' ? 1 : 0; }
function compareCrateArtists(a, b){
  const pa = crateArtistPriority(a), pb = crateArtistPriority(b);
  return pa !== pb ? pa - pb : crateCompareNames(a, b);
}
function crateLetterFor(artist){
  if(artist === 'Unknown Artist') return '?';
  const c = crateSortKey(artist).charAt(0);
  return /[a-z]/.test(c) ? c.toUpperCase() : '#';
}
function crateLooseArtistId(artist){ return 'loose:' + normKey(artist); }
// oldest first, the way a record store files an artist's albums; 0 (no
// year) sorts after every dated album, alphabetically among themselves —
// so an untagged library just behaves like the plain alphabetical order
function compareCrateYear(a, b){
  const ay = a.year || 0, by = b.year || 0;
  if(!ay && !by) return 0;
  if(!ay) return 1;
  if(!by) return -1;
  return ay - by;
}
function libraryHasGenres(){ return S.tracks.some(t => t.details && firstGenreValue(t.details.genre)); }

function albumGenreFor(idx){
  const counts = new Map();
  idx.forEach((i, pos) => {
    const g = firstGenreValue(S.tracks[i].details && S.tracks[i].details.genre);
    if(!g) return;
    const key = g.toLowerCase();
    if(!counts.has(key)) counts.set(key, {count:0, display:titleCaseGenre(g), firstPos:pos});
    counts.get(key).count++;
  });
  if(!counts.size) return '';
  let best = null;
  counts.forEach(v => { if(!best || v.count > best.count || (v.count === best.count && v.firstPos < best.firstPos)) best = v; });
  return best.display;
}

// an album's year is the most common non-zero t.details.year among its
// tracks, ties going to the earliest (CRATE spec §2) — 0 means unknown
function albumYearFor(idx){
  const counts = new Map();
  idx.forEach(i => {
    const y = S.tracks[i].details && S.tracks[i].details.year;
    if(!y) return;
    counts.set(y, (counts.get(y) || 0) + 1);
  });
  if(!counts.size) return 0;
  let best = 0, bestCount = -1;
  counts.forEach((count, year) => {
    if(count > bestCount || (count === bestCount && year < best)) { best = year; bestCount = count; }
  });
  return best;
}

// one crate record per album id; loose ("Unknown Album") tracks collapse
// into one pseudo-record per artist instead of one per track (CRATE spec §2)
function buildCrateRecords(){
  const byAlbum = new Map(), looseByArtist = new Map();
  S.tracks.forEach((t, i) => {
    if(t.tags.album === 'Unknown Album'){
      const artistName = t.tags.artist || 'Unknown Artist';
      const key = normKey(artistName) || 'unknown';
      if(!looseByArtist.has(key)) looseByArtist.set(key, {artist:artistName, idx:[]});
      looseByArtist.get(key).idx.push(i);
      return;
    }
    const id = albumKey(t);
    if(!byAlbum.has(id)) byAlbum.set(id, []);
    byAlbum.get(id).push(i);
  });

  const records = [];
  byAlbum.forEach((idx, albumId) => {
    const tracks = idx.map(i => S.tracks[i]);
    const artistSet = new Set(tracks.map(t => t.tags.artist));
    const albumArtistSet = new Set(tracks.map(t => t.tags.albumArtist));
    let artist;
    if(albumArtistSet.size === 1) artist = [...albumArtistSet][0];
    else if(artistSet.size > 1) artist = 'Various Artists';   // different artists, no consistent albumArtist
    else artist = tracks[0].tags.artist || 'Unknown Artist';
    records.push({type:'rec', kind:'album', albumId, idx, artist, album: tracks[0].tags.album,
      year: albumYearFor(idx), trackCount: idx.length, genre: albumGenreFor(idx)});
  });
  looseByArtist.forEach(({artist, idx}) => {
    records.push({type:'rec', kind:'loose', albumId: crateLooseArtistId(artist), idx, artist,
      album:'Singles & loose tracks', year:0, trackCount: idx.length, genre:''});
  });
  return records;
}

function groupSortedRecords(records, keyFn){
  const groups = [];
  let cur = null;
  records.forEach(r => {
    const k = keyFn(r);
    if(!cur || cur.key !== k){ cur = {key:k, records:[]}; groups.push(cur); }
    cur.records.push(r);
  });
  return groups;
}

// builds the ordered {type:'div'|'rec', ...} array once, plus lookup maps
// for jumping by album id or by letter/genre (CRATE spec §2)
function buildCrateModel(group){
  const records = buildCrateRecords();
  const items = [], byAlbumId = new Map(), jumpIndex = new Map();
  let railEntries = [];

  if(group === 'genre'){
    records.forEach(r => { r.genreGroup = r.genre || 'Unsorted'; });
    const counts = new Map();
    records.forEach(r => { if(r.genreGroup !== 'Unsorted') counts.set(r.genreGroup, (counts.get(r.genreGroup)||0) + 1); });
    if(counts.size > 25) records.forEach(r => { if(r.genreGroup !== 'Unsorted' && counts.get(r.genreGroup) < 3) r.genreGroup = 'Other'; });
    records.sort((a,b) => {
      const pa = a.genreGroup === 'Unsorted' ? 1 : 0, pb = b.genreGroup === 'Unsorted' ? 1 : 0;
      if(pa !== pb) return pa - pb;
      return crateCompareNames(a.genreGroup, b.genreGroup) || compareCrateArtists(a.artist, b.artist)
        || compareCrateYear(a, b) || crateCompareNames(a.album, b.album);
    });
    const groups = groupSortedRecords(records, r => r.genreGroup);
    const showDividers = groups.length >= 2;
    groups.forEach(g => {
      if(showDividers){
        const artistCount = new Set(g.records.map(r => r.artist)).size;
        jumpIndex.set('key:' + g.key, items.length);
        railEntries.push({key:g.key, label: g.key.slice(0,3).toUpperCase(), itemIndex: items.length, present:true});
        items.push({type:'div', label:g.key, meta: artistCount + ' ARTISTS · ' + g.records.length + ' ALBUMS',
          panelSub:'Genre', key:g.key});
      }
      g.records.forEach(r => { byAlbumId.set(r.albumId, items.length); items.push(r); });
    });
  } else {
    records.sort((a,b) => compareCrateArtists(a.artist, b.artist) || compareCrateYear(a, b) || crateCompareNames(a.album, b.album));
    const groups = groupSortedRecords(records, r => crateLetterFor(r.artist));
    const showDividers = records.length >= 20;
    const present = new Set(groups.map(g => g.key));
    groups.forEach(g => {
      if(showDividers){
        const artistCount = new Set(g.records.map(r => r.artist)).size;
        jumpIndex.set('key:' + g.key, items.length);
        items.push({type:'div', label:g.key,
          meta: artistCount + ' ARTISTS · ' + g.records.length + ' ALBUMS',
          panelSub: g.key === '?' ? 'Unknown artist' : 'Artists beginning with ' + g.key, key:g.key});
      }
      g.records.forEach(r => { byAlbumId.set(r.albumId, items.length); items.push(r); });
    });
    if(showDividers){
      railEntries = CRATE_ALPHABET.concat(present.has('?') ? ['?'] : [])
        .map(letter => ({key:letter, label:letter, itemIndex: jumpIndex.get('key:'+letter), present: present.has(letter)}));
    }
  }
  return {items, byAlbumId, jumpIndex, railEntries, group};
}

function ensureCrateModel(){
  if(!S.crate.model || S.crate.modelGroup !== S.crateGroup || S.crate.modelDirty){
    S.crate.model = buildCrateModel(S.crateGroup);
    S.crate.modelGroup = S.crateGroup;
    S.crate.modelDirty = false;
    // item indices just shifted under whatever S.crate.pos used to mean —
    // re-resolve from the anchor (a stable album id) rather than trust a
    // now-possibly-unrelated numeric position into the rebuilt list
    S.crate.pos = null;
  }
  return S.crate.model;
}
export function invalidateCrateModel(){ S.crate.modelDirty = true; }

function isNowPlayingAlbum(item){ return item.type === 'rec' && S.index >= 0 && item.idx.includes(S.index); }

let crateAnchorSaveTimer = null;
function persistCrateAnchor(item){
  S.crateAnchor = item ? item.albumId : null;
  clearTimeout(crateAnchorSaveTimer);
  crateAnchorSaveTimer = setTimeout(queueSave, 500);
}

// the rail always lands on the first record after a letter/genre divider,
// not the divider itself, falling back to the divider if nothing follows
// it (CRATE spec §4, "Release to land on the first record")
function crateRailJumpTarget(model, key){
  const di = model.jumpIndex.get('key:' + key);
  if(di == null) return null;
  const next = di + 1;
  return (next < model.items.length && model.items[next].type === 'rec') ? next : di;
}

/* ================= S3: gatefold album view (opens from the crate) =========
   Three flat planes in one 3D stage (the cover, its own backface-hidden
   back face as the inside-left panel, and the tracklist sitting behind it
   at the same spot) — see GATEFOLD spec §A2. Entry point is the crate only;
   every other album entry point keeps renderAlbumDetail() untouched. */
let GF = null;   // ephemeral render state for the open gatefold; null when closed

function isGatefoldOpen(){ return !!GF; }

function gatefoldViewportMode(){
  const w = window.innerWidth, h = window.innerHeight;
  if(w >= 700 && h >= 500) return 'wide';
  if(h < 640) return 'short';
  return 'normal';
}

function updateGatefoldScale(){
  if(!GF) return;
  const s = GF.mode === 'wide' ? 1 : Math.min(window.innerWidth / 390, window.innerHeight / 740);
  document.documentElement.style.setProperty('--gf-page-scale', s);
}

// same ordering as renderAlbumDetail()/albumTracks() (spec §A4)
function gatefoldTrackIndices(item){ return albumTracks(item.album); }

// null (no split) or an ordered list of {label, idx:[...]} — multi-disc
// splits by disc, a single disc of 4+ tracks splits at the midpoint, 3 or
// fewer never splits (spec §A5); track numbers still count straight through
function gatefoldSideSplits(trackIdx){
  if(!S.albumSides || trackIdx.length < 4) return null;
  const discs = [...new Set(trackIdx.map(i => S.tracks[i].tags.disc || 0))];
  if(discs.length > 1){
    return discs.map((d, k) => ({label:'SIDE ' + String.fromCharCode(65 + k),
      idx: trackIdx.filter(i => (S.tracks[i].tags.disc || 0) === d)}));
  }
  const mid = Math.ceil(trackIdx.length / 2);
  return [{label:'SIDE A', idx: trackIdx.slice(0, mid)}, {label:'SIDE B', idx: trackIdx.slice(mid)}];
}

function gatefoldNowGlyph(){
  const span = el('span','gf-now-glyph');
  span.innerHTML = '<span></span><span></span><span></span>';
  return span;
}

function gatefoldTrackRow(i, pos, trackIdx, playHandler){
  const t = S.tracks[i];
  const row = document.createElement('button');
  row.className = 'gf-track-row';
  row.setAttribute('role','listitem');
  row.dataset.pos = pos;
  const isNow = i === S.index;
  row.classList.toggle('gf-now-playing', isNow);
  const num = el('span','gf-tn');
  if(isNow) num.appendChild(gatefoldNowGlyph()); else num.textContent = String(pos).padStart(2,'0');
  row.appendChild(num);
  row.appendChild(el('span','gf-tt', t.tags.title));
  row.appendChild(el('span','gf-td', fmt(t.duration)));
  row.addEventListener('click', () => (playHandler || gatefoldPlayTrack)(trackIdx, i));
  return row;
}

// playHandler lets the sealed sheet reuse this exact rendering (order, rows,
// sides) while running a different play path (SEALED spec §5) — the
// gatefold's own default stays fully quiet, no ceremony (GATEFOLD spec §A6)
function buildGatefoldTracklist(item, trackIdx, playHandler){
  const host = document.createDocumentFragment();
  host.appendChild(el('p','gf-tl-head', item.artist.toUpperCase()));
  host.appendChild(el('h2','gf-tl-title', item.album));
  const sides = gatefoldSideSplits(trackIdx);
  if(sides){
    sides.forEach(side => {
      const total = side.idx.reduce((s,i) => s + (S.tracks[i].duration || 0), 0);
      const head = el('div','gf-side-head');
      head.appendChild(el('b', null, side.label));
      head.appendChild(el('span', null, side.idx.length + (side.idx.length===1?' TRACK · ':' TRACKS · ') + fmt(total).toUpperCase()));
      host.appendChild(head);
      side.idx.forEach(i => host.appendChild(gatefoldTrackRow(i, trackIdx.indexOf(i) + 1, trackIdx, playHandler)));
    });
  } else {
    trackIdx.forEach((i,k) => host.appendChild(gatefoldTrackRow(i, k + 1, trackIdx, playHandler)));
  }
  return host;
}

// credit names close the gatefold before opening the person view, so the
// crate underneath isn't left showing a stale position when it reopens
function gatefoldCreditLink(name){
  const b = el('button','', name);
  b.style.color = 'var(--accent)'; b.style.textDecoration = 'underline';
  b.addEventListener('click', () => { closeGatefoldInstant(); openPersonOrArtist(name); });
  return b;
}

// Rating stars, sleeve note and pin toggle for YOUR OWN copy of this record
// — local-first (MizikiSocial.setRating/setNote/pin work with no server
// configured at all), published by the sync engine once signed in. Lives at
// the end of the gatefold's "Inside" panel — today's closest thing to an
// album detail view — so it's reachable from both the normal left panel and
// the short-viewport flat "Inside" tab, which both call this same builder.
function gatefoldSocialControlsHTML(item){
  const wrap = el('div','gf-social');
  wrap.appendChild(el('p','gf-social-caption','YOUR COPY'));

  const stars = el('div','gf-stars');
  stars.setAttribute('role','radiogroup');
  stars.setAttribute('aria-label','Your rating');
  for(let i = 1; i <= 5; i++){
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'gf-star-btn'; b.dataset.star = String(i);
    b.setAttribute('aria-label', i + (i === 1 ? ' star' : ' stars'));
    stars.appendChild(b);
  }
  wrap.appendChild(stars);

  const note = document.createElement('textarea');
  note.className = 'gf-note-input'; note.maxLength = 140; note.rows = 2;
  note.placeholder = 'Tap to add a sleeve note.';
  note.setAttribute('aria-label', 'Sleeve note');
  note.addEventListener('change', () => MizikiSocial.setNote(item.albumId, note.value));
  wrap.appendChild(note);

  const pinBtn = document.createElement('button');
  pinBtn.type = 'button'; pinBtn.className = 'gf-pin-btn';
  wrap.appendChild(pinBtn);

  function paint(){
    const s = MizikiSocial.getAlbumSocial(item.albumId);
    stars.querySelectorAll('.gf-star-btn').forEach(b => {
      const i = Number(b.dataset.star), on = s.rating != null && i <= s.rating;
      b.textContent = on ? '★' : '☆';
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', String(on));
    });
    if(document.activeElement !== note) note.value = s.note || '';
    const pinned = s.pinRank != null;
    pinBtn.setAttribute('aria-pressed', String(pinned));
    pinBtn.textContent = pinned ? 'Pinned to crate · #' + s.pinRank : 'Pin to crate';
  }
  stars.querySelectorAll('.gf-star-btn').forEach(b => {
    b.addEventListener('click', () => {
      const i = Number(b.dataset.star);
      const cur = MizikiSocial.getAlbumSocial(item.albumId).rating;
      MizikiSocial.setRating(item.albumId, cur === i ? null : i);   // tap the lit star again to clear
      paint();
    });
  });
  pinBtn.addEventListener('click', () => {
    const pinned = MizikiSocial.getAlbumSocial(item.albumId).pinRank != null;
    if(pinned) MizikiSocial.unpin(item.albumId);
    else if(!MizikiSocial.pin(item.albumId)){
      pinBtn.textContent = 'Staff picks full — unpin one first';
      setTimeout(paint, 1800);
      return;
    }
    paint();
  });

  paint();
  return wrap;
}

function buildGatefoldLeftPanel(item){
  const host = document.createDocumentFragment();
  const liner = albumLinerNotes(item.album);
  const roll = albumCreditRoll(item.album);
  const hasBooklet = !!(S.booklets && S.booklets[item.albumId]);
  if(!liner && !roll.size && !hasBooklet){
    host.appendChild(el('h3', null, item.album));
    const metaBits = [item.year || null, item.genre || null,
      item.trackCount + (item.trackCount===1?' track':' tracks'), fmt(item.idx.reduce((s,i)=>s+(S.tracks[i].duration||0),0))].filter(Boolean);
    host.appendChild(el('p','gf-meta-line', metaBits.join(' · ').toUpperCase()));
    host.appendChild(el('p','gf-minimal-note','No liner notes in these files.'));
    host.appendChild(gatefoldSocialControlsHTML(item));
    return host;
  }
  if(liner) host.appendChild(el('p','gf-liner', liner));
  if(roll.size){
    roll.forEach((names, label) => {
      const row = el('div','gf-credit-row');
      row.appendChild(el('em', null, label));
      const cell = el('span');
      names.forEach((n,i) => { if(i) cell.appendChild(document.createTextNode(', ')); cell.appendChild(gatefoldCreditLink(n)); });
      row.appendChild(cell);
      host.appendChild(row);
    });
  }
  const metaBits = [item.year || null, item.genre || null,
    item.trackCount + (item.trackCount===1?' track':' tracks')].filter(Boolean);
  host.appendChild(el('p','gf-meta-line', metaBits.join(' · ').toUpperCase()));
  if(hasBooklet){
    const btn = el('button','gf-booklet-btn', 'BOOKLET · ' + S.booklets[item.albumId].length + ' PAGES');
    btn.addEventListener('click', () => openBookletViewer(item.albumId));
    host.appendChild(btn);
  }
  host.appendChild(gatefoldSocialControlsHTML(item));
  return host;
}

function gatefoldOnPlatter(item){
  return S.shellAlbumId === item.albumId && !S.platterEmpty;
}

function updateGatefoldSleeveState(){
  if(!GF) return;
  $('#gfSleeveDiscWrap').classList.toggle('gf-disc-empty', gatefoldOnPlatter(GF.item));
}

// decorative only: the disc peeks out as if pulled from the pocket, then the
// pocket settles into its normal (now-empty, since this album is playing)
// state — never touches S.shellAlbumId, the pull, or the full player (§A6)
function gatefoldSleeveFlourish(){
  const wrap = $('#gfSleeveDiscWrap');
  wrap.classList.add('gf-disc-out');
  setTimeout(() => { wrap.classList.remove('gf-disc-out'); updateGatefoldSleeveState(); }, 400);
}

// A tap on a track already in the open gatefold's own album either changes
// nothing but the song (same album as whatever's playing — just a plain,
// quiet play, exactly as before) or hands the record off to the main player
// (a different album — Part 2 §1). "Different" here compares the open
// gatefold's album against whatever is CURRENTLY PLAYING, not against the
// tapped track's album (every row in this tracklist is the same album as
// the open gatefold by construction).
function gatefoldPlayTrack(trackIdx, i){
  const albumId = GF && GF.item && GF.item.albumId;
  const curr = current();
  const sameAlbum = !!albumId && !!curr && albumKey(curr) === albumId;
  if(sameAlbum || !S.playInFullPlayer){
    setQueue(trackIdx, trackIdx.indexOf(i), false);
    play();
    gatefoldSleeveFlourish();
    return;
  }
  const startRect = $('#gfSleeveDiscWrap').getBoundingClientRect();
  setQueue(trackIdx, trackIdx.indexOf(i), false);
  if(REDUCED){
    // no flight — the player opens with the record already seated, then audio
    closeGatefoldInstant();
    if(S.playerOpen) runStartSequence(current(), S.pendingShellInfo, play);
    else openPlayerViaSheet(current(), S.pendingShellInfo);
    return;
  }
  runGatefoldHandoff(startRect, current(), S.pendingShellInfo, play);
}

// a sealed album's first play runs the normal ceremony (so the peel is
// actually seen) but on the platter/mini-player only — never the full
// player sheet (SEALED spec §5: "the sleeve pull runs behind the sheet as
// usual... the player is not forced open"). Used by the crate's own Play
// affordances for a sealed record (list/crate rows) — unchanged by Part 2.
function sealedQuietPlay(trackIdx, i){
  setQueue(trackIdx, trackIdx.indexOf(i), false);
  runStartSequence(current(), S.pendingShellInfo, play);
}

// the seal sheet's own row tap: the closest equivalent to "the gatefold
// song-tap handler" for an album that can't open the gatefold yet (Part 2
// §1, "Sealed albums"). A sealed album was by definition never played, so
// this is always the "different album" case — peel first (the existing S5
// peel, reused as-is via runStartSequence), then the hand-off's spirit is
// satisfied by forcing the player open (rather than staying quiet) when the
// setting is on. There is no separate pocket to fly from here, so unlike
// gatefoldPlayTrack this reuses the ceremony wholesale instead of the flight.
function sealedHandoffPlay(trackIdx, i){
  setQueue(trackIdx, trackIdx.indexOf(i), false);
  closeSealedSheetInstant();
  if(!S.playInFullPlayer){
    runStartSequence(current(), S.pendingShellInfo, play);
    return;
  }
  if(S.playerOpen) runStartSequence(current(), S.pendingShellInfo, play);
  else openPlayerViaSheet(current(), S.pendingShellInfo);
}

function gatefoldRestoreRowNumber(row){
  const num = row.querySelector('.gf-tn');
  if(num) num.textContent = String(row.dataset.pos).padStart(2,'0');
}

// live-updates the now-playing marker without rebuilding the whole panel —
// called from load() on every track change while the gatefold is open (§A4).
// Rows are built in the same order as GF.trackIdx (sides only insert divider
// headers between them, never reorder the tracks), so position maps directly.
export function updateGatefoldNowPlaying(){
  if(!GF) return;
  updateGatefoldSleeveState();
  document.querySelectorAll('.gf-track-row.gf-now-playing').forEach(row => {
    row.classList.remove('gf-now-playing');
    gatefoldRestoreRowNumber(row);
  });
  const t = current();
  if(!t || albumKey(t) !== GF.item.albumId) return;
  let pos = -1;
  GF.trackIdx.forEach((i, k) => { if(i === S.index) pos = k; });
  const rows = document.querySelectorAll('.gf-track-row');
  if(pos < 0 || pos >= rows.length) return;
  const row = rows[pos];
  row.classList.add('gf-now-playing');
  const num = row.querySelector('.gf-tn');
  if(num){ num.innerHTML = ''; num.appendChild(gatefoldNowGlyph()); }
}

function gatefoldInfoAndSleeveHTML(item){
  const info = $('#gfInfo'); info.innerHTML = '';
  info.appendChild(el('h3','gf-info-title', item.album));
  info.appendChild(el('p','gf-info-sub', item.artist + (item.year ? ' · ' + item.year : '')));
  const metaBits = [item.genre || null, item.trackCount + (item.trackCount===1?' track':' tracks'),
    fmt(item.idx.reduce((s,i)=>s+(S.tracks[i].duration||0),0))].filter(Boolean);
  info.appendChild(el('p','gf-info-meta', metaBits.join(' · ').toUpperCase()));
}

async function gatefoldSetCoverArt(item){
  const img = $('#gfCoverArt'), discArt = $('#gfDiscArt');
  const fallback = thumbURL['album:' + item.albumId] || (S.tracks[item.idx[0]] && S.tracks[item.idx[0]].art) || '';
  if(fallback){ img.src = fallback; discArt.src = fallback; }
  const url = await getCrateArtURL(item.albumId, 'L');
  if(url && GF && GF.item === item){ img.src = url; discArt.src = url; }
}

function gatefoldSwitchPanel(panel){
  if(!GF) return;
  GF.panel = panel;
  const camera = $('#gfCamera');
  if(GF.mode !== 'wide'){
    camera.style.transition = 'transform ' + GATEFOLD_ANIM.leftPanelMs + 'ms ease';
    camera.style.setProperty('--gf-cx', panel === 'left' ? '-175px' : '175px');
  }
  document.querySelectorAll('#gfPanelToggle [data-panel], #gfFlatSeg [data-panel]').forEach(b =>
    b.setAttribute('aria-pressed', String(b.dataset.panel === panel)));
  if(GF.mode === 'short'){
    $('#gfFlatBody').innerHTML = '';
    if(panel === 'left') $('#gfFlatBody').appendChild(buildGatefoldLeftPanel(GF.item));
    else $('#gfFlatBody').appendChild(buildGatefoldTracklist(GF.item, GF.trackIdx));
  } else {
    (panel === 'left' ? $('#gfLeft') : $('#gfTracklist')).focus();
  }
}

let gfSkipHandler = null, gfDragCleanup = null;

function gatefoldTeardownGestures(){
  if(gfSkipHandler){ $('#gatefold').removeEventListener('pointerdown', gfSkipHandler, {capture:true}); gfSkipHandler = null; }
  if(gfDragCleanup){ gfDragCleanup(); gfDragCleanup = null; }
}

// swipe right/left between the tracklist and the inside-left panel in both
// normal mode (live camera pan over #gfStage) and short mode (plain panel
// swap over #gfFlatBody, since #gfFlatTracks sits on top of #gfStage there
// and would otherwise swallow the gesture) — a direction lock after ~8px
// keeps a vertical scroll from also triggering a panel switch — plus a
// drag-down on the info strip to close (§A3, §A7)
function gatefoldWireGestures(){
  let start = null;
  const onDown = e => { start = {x:e.clientX, y:e.clientY, locked:null, t:performance.now()}; };
  const onMove = e => {
    if(!start || !GF || GF.mode === 'short') return;
    const dx = e.clientX - start.x, dy = e.clientY - start.y;
    if(!start.locked && (Math.abs(dx) > 8 || Math.abs(dy) > 8)) start.locked = Math.abs(dx) > Math.abs(dy) ? 'h' : 'v';
    if(start.locked === 'h' && GF.mode !== 'wide'){
      const base = GF.panel === 'left' ? -175 : 175;
      const next = clamp(base + dx * 0.5, -175, 175);
      $('#gfCamera').style.transition = 'none';
      $('#gfCamera').style.setProperty('--gf-cx', next + 'px');
    }
  };
  const onUp = e => {
    if(!start) return;
    const dx = e.clientX - start.x;
    if(start.locked === 'h' && GF && GF.mode !== 'wide'){
      if(Math.abs(dx) > 60) gatefoldSwitchPanel(dx < 0 ? 'left' : (GF.panel === 'left' && dx > 0 ? 'right' : GF.panel));
      else gatefoldSwitchPanel(GF.panel);
    }
    start = null;
  };
  const stage = $('#gfStage');
  stage.addEventListener('pointerdown', onDown);
  stage.addEventListener('pointermove', onMove);
  stage.addEventListener('pointerup', onUp);
  stage.addEventListener('pointercancel', onUp);

  // short mode shows #gfFlatTracks as an opaque full-cover sibling of
  // #gfStage, so the stage's own listeners above never fire there — swipe
  // needs its own (simpler: no live camera pan, just swap panels on release)
  let flatStart = null;
  const onFlatDown = e => { flatStart = {x:e.clientX, y:e.clientY, locked:null}; };
  const onFlatMove = e => {
    if(!flatStart || !GF || GF.mode !== 'short') return;
    const dx = e.clientX - flatStart.x, dy = e.clientY - flatStart.y;
    if(!flatStart.locked && (Math.abs(dx) > 8 || Math.abs(dy) > 8)) flatStart.locked = Math.abs(dx) > Math.abs(dy) ? 'h' : 'v';
  };
  const onFlatUp = e => {
    if(!flatStart) return;
    const dx = e.clientX - flatStart.x;
    if(flatStart.locked === 'h' && GF && GF.mode === 'short' && Math.abs(dx) > 60)
      gatefoldSwitchPanel(dx < 0 ? 'left' : (GF.panel === 'left' && dx > 0 ? 'right' : GF.panel));
    flatStart = null;
  };
  const flatBody = $('#gfFlatBody');
  flatBody.addEventListener('pointerdown', onFlatDown);
  flatBody.addEventListener('pointermove', onFlatMove);
  flatBody.addEventListener('pointerup', onFlatUp);
  flatBody.addEventListener('pointercancel', onFlatUp);

  let infoDrag = null;
  const onInfoDown = e => { infoDrag = e.clientY; };
  const onInfoMove = e => {
    if(infoDrag == null) return;
    const dy = e.clientY - infoDrag;
    if(dy > 50) closeGatefold();
  };
  const onInfoUp = () => { infoDrag = null; };
  const info = $('#gfInfo');
  info.addEventListener('pointerdown', onInfoDown);
  info.addEventListener('pointermove', onInfoMove);
  info.addEventListener('pointerup', onInfoUp);

  gfDragCleanup = () => {
    stage.removeEventListener('pointerdown', onDown);
    stage.removeEventListener('pointermove', onMove);
    stage.removeEventListener('pointerup', onUp);
    stage.removeEventListener('pointercancel', onUp);
    flatBody.removeEventListener('pointerdown', onFlatDown);
    flatBody.removeEventListener('pointermove', onFlatMove);
    flatBody.removeEventListener('pointerup', onFlatUp);
    flatBody.removeEventListener('pointercancel', onFlatUp);
    info.removeEventListener('pointerdown', onInfoDown);
    info.removeEventListener('pointermove', onInfoMove);
    info.removeEventListener('pointerup', onInfoUp);
  };
}

function gatefoldSettledState(mode){
  const camera = $('#gfCamera'), cover = $('#gfCover');
  camera.style.transition = 'none';
  camera.style.setProperty('--gf-s', mode === 'wide' ? '1' : '.55');
  camera.style.setProperty('--gf-cx', mode === 'wide' ? '175px' : '0px');
  cover.style.transition = 'none';
  cover.style.transform = 'rotateY(-180deg)';
  $('#gfShadow').style.opacity = '0';
}

// tapping anywhere during the opening jumps straight to the settled spread,
// with a short fade, so repeat opens never feel slow (§A3)
function gatefoldSkipToSettled(mode){
  const overlay = $('#gatefold');
  overlay.style.transition = 'opacity ' + GATEFOLD_ANIM.skipMs + 'ms linear';
  gatefoldSettledState(mode);
  overlay.classList.add('gf-chrome-in');
  requestAnimationFrame(() => { $('#gfTracklist').focus(); });
}

async function runGatefoldOpen(mode){
  const overlay = $('#gatefold'), camera = $('#gfCamera'), cover = $('#gfCover');
  const seq = GF.seq;
  const skip = e => { e.stopPropagation(); e.preventDefault(); gatefoldSkipToSettled(mode); };
  gfSkipHandler = skip;
  overlay.addEventListener('pointerdown', skip, {capture:true, once:true});

  if(REDUCED || mode === 'short'){
    overlay.style.opacity = '0';
    overlay.style.transition = 'opacity 150ms linear';
    void overlay.offsetWidth;
    overlay.style.opacity = '1';
    await sleep(150);
  } else {
    camera.style.transition = 'none';
    camera.style.setProperty('--gf-s', '1');
    camera.style.setProperty('--gf-cx', '175px');
    cover.style.transition = 'none';
    cover.style.transform = 'rotateY(0deg)';
    overlay.style.opacity = '0';
    void overlay.offsetWidth;
    overlay.style.transition = 'opacity ' + GATEFOLD_ANIM.liftMs + 'ms ' + GATEFOLD_ANIM.liftEasing;
    overlay.style.opacity = '1';
    await sleep(GATEFOLD_ANIM.liftMs);
    if(!GF || GF.seq !== seq) return;

    if(mode !== 'wide'){
      camera.style.transition = 'transform ' + GATEFOLD_ANIM.swingMs + 'ms ' + GATEFOLD_ANIM.swingEasing;
      camera.style.setProperty('--gf-s', '.55'); camera.style.setProperty('--gf-cx', '0px');
    }
    cover.style.transition = 'transform ' + GATEFOLD_ANIM.swingMs + 'ms ' + GATEFOLD_ANIM.swingEasing;
    cover.style.transform = 'rotateY(-180deg)';
    $('#gfShadow').style.transition = 'opacity ' + GATEFOLD_ANIM.swingMs + 'ms linear';
    $('#gfShadow').style.opacity = '0';
    await sleep(GATEFOLD_ANIM.swingMs);
    if(!GF || GF.seq !== seq) return;

    await sleep(GATEFOLD_ANIM.holdMs);
    if(!GF || GF.seq !== seq) return;

    if(mode !== 'wide'){
      camera.style.transition = 'transform ' + GATEFOLD_ANIM.pushMs + 'ms ' + GATEFOLD_ANIM.swingEasing;
      camera.style.setProperty('--gf-s', '1'); camera.style.setProperty('--gf-cx', '175px');
    }
    overlay.classList.add('gf-chrome-in');
    await sleep(GATEFOLD_ANIM.pushMs);
    if(!GF || GF.seq !== seq) return;
  }
  overlay.removeEventListener('pointerdown', skip, {capture:true});
  gfSkipHandler = null;
  overlay.classList.add('gf-chrome-in');
  $('#gfTracklist').focus();
}

let gfSeqCounter = 0;

function openGatefold(item){
  if(GF) return;
  const mode = gatefoldViewportMode();
  const trackIdx = gatefoldTrackIndices(item);
  if(!trackIdx.length) return;
  GF = {item, trackIdx, panel:'right', seq: ++gfSeqCounter, mode, returnFocus: document.activeElement};

  const overlay = $('#gatefold');
  overlay.setAttribute('aria-label', item.album);
  overlay.classList.toggle('gf-wide', mode === 'wide');
  overlay.classList.remove('gf-chrome-in');
  overlay.style.opacity = '';

  $('#gfTracklist').innerHTML = ''; $('#gfTracklist').appendChild(buildGatefoldTracklist(item, trackIdx));
  $('#gfLeft').innerHTML = ''; $('#gfLeft').appendChild(buildGatefoldLeftPanel(item));
  gatefoldInfoAndSleeveHTML(item);
  gatefoldSetCoverArt(item).catch(() => {});
  updateGatefoldSleeveState();

  const hasLeftContent = !!(albumLinerNotes(item.album) || albumCreditRoll(item.album).size || (S.booklets && S.booklets[item.albumId]));
  $('#gfLeftCue').style.display = hasLeftContent ? '' : 'none';

  if(mode === 'short'){
    $('#gfFlatTracks').classList.add('show');
    $('#gfFlatBody').innerHTML = ''; $('#gfFlatBody').appendChild(buildGatefoldTracklist(item, trackIdx));
    document.querySelectorAll('#gfFlatSeg [data-panel]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.panel === 'right')));
  } else {
    $('#gfFlatTracks').classList.remove('show');
  }

  updateGatefoldScale();
  overlay.classList.add('open');
  overlay.setAttribute('aria-hidden','false');
  gatefoldWireGestures();
  runGatefoldOpen(mode);
}

async function closeGatefold(){
  if(!GF) return;
  const g = GF; GF = null;
  gatefoldTeardownGestures();
  const overlay = $('#gatefold'), camera = $('#gfCamera'), cover = $('#gfCover');
  overlay.classList.remove('gf-chrome-in');
  if(REDUCED || g.mode === 'short'){
    overlay.style.transition = 'opacity 150ms linear';
    overlay.style.opacity = '0';
    await sleep(150);
  } else {
    if(g.mode !== 'wide'){
      camera.style.transition = 'transform ' + Math.round(GATEFOLD_ANIM.closeMs * 0.4) + 'ms ease-in';
      camera.style.setProperty('--gf-s', '.55'); camera.style.setProperty('--gf-cx', '0px');
    }
    cover.style.transition = 'transform ' + Math.round(GATEFOLD_ANIM.closeMs * 0.6) + 'ms ' + GATEFOLD_ANIM.swingEasing;
    cover.style.transform = 'rotateY(0deg)';
    await sleep(Math.round(GATEFOLD_ANIM.closeMs * 0.6));
    overlay.style.transition = 'opacity ' + Math.round(GATEFOLD_ANIM.closeMs * 0.4) + 'ms linear';
    overlay.style.opacity = '0';
    await sleep(Math.round(GATEFOLD_ANIM.closeMs * 0.4));
  }
  overlay.classList.remove('open','gf-wide');
  $('#gfFlatTracks').classList.remove('show');
  overlay.style.opacity = ''; overlay.style.transition = '';
  overlay.setAttribute('aria-hidden','true');
  if(g.returnFocus && document.contains(g.returnFocus) && typeof g.returnFocus.focus === 'function') g.returnFocus.focus();
  else { const stage = $('.crate-stage'); if(stage) stage.focus(); }
}

// an immediate, non-animated close for when the gatefold is being replaced
// by real navigation (a credit link) rather than dismissed on its own
function closeGatefoldInstant(){
  if(!GF) return;
  GF = null;
  gatefoldTeardownGestures();
  const overlay = $('#gatefold');
  overlay.classList.remove('open','gf-wide','gf-chrome-in');
  $('#gfFlatTracks').classList.remove('show');
  overlay.style.opacity = ''; overlay.style.transition = '';
  overlay.setAttribute('aria-hidden','true');
}

let SEALSHEET = null;   // {item}, null when closed

function isSealedSheetOpen(){ return !!SEALSHEET; }

// after a seal breaks, fade the wrap off the small cover if its sheet is
// the one open right now — the sheet itself stays as it is (SEALED spec §5)
function updateSealedSheetAfterBreak(albumId){
  if(!SEALSHEET || SEALSHEET.item.albumId !== albumId) return;
  const host = $('#sealSheetCoverWrap');
  const bits = host.querySelectorAll('.seal-wrap, .seal-sticker');
  bits.forEach(elm => {
    elm.style.transition = 'opacity .3s';
    elm.style.opacity = '0';
    setTimeout(() => elm.remove(), 300);
  });
}

function openSealedSheet(item){
  if(SEALSHEET || GF) return;
  const trackIdx = gatefoldTrackIndices(item);
  if(!trackIdx.length) return;
  SEALSHEET = {item, returnFocus: document.activeElement};
  const sheet = $('#sealSheet');
  sheet.setAttribute('aria-label', item.album);
  $('#sealSheetArtist').textContent = item.artist.toUpperCase();
  $('#sealSheetTitle').textContent = item.album;
  const coverWrap = $('#sealSheetCoverWrap');
  coverWrap.querySelectorAll('.seal-wrap, .seal-sticker').forEach(n => n.remove());
  coverWrap.appendChild(buildSealOverlay(96));
  const art = thumbURL['album:' + item.albumId] || (S.tracks[item.idx[0]] && S.tracks[item.idx[0]].art) || '';
  if(art) $('#sealSheetCoverArt').src = art;
  getCrateArtURL(item.albumId, 'S').then(url => { if(url && SEALSHEET && SEALSHEET.item === item) $('#sealSheetCoverArt').src = url; });
  $('#sealSheetBody').innerHTML = '';
  $('#sealSheetBody').appendChild(buildGatefoldTracklist(item, trackIdx, sealedHandoffPlay));

  sheet.classList.add('open');
  sheet.setAttribute('aria-hidden','false');
  requestAnimationFrame(() => { sheet.classList.add('show'); $('#sealSheetBody').focus(); });
}

async function closeSealedSheet(){
  if(!SEALSHEET) return;
  const s = SEALSHEET; SEALSHEET = null;
  const sheet = $('#sealSheet');
  sheet.classList.remove('show');
  await sleep(REDUCED ? 150 : 250);
  sheet.classList.remove('open');
  sheet.setAttribute('aria-hidden','true');
  if(s.returnFocus && document.contains(s.returnFocus) && typeof s.returnFocus.focus === 'function') s.returnFocus.focus();
  else { const stage = $('.crate-stage'); if(stage) stage.focus(); }
}

// non-animated close, for when a track tap is already handing off to the
// player sheet — mirrors closeGatefoldInstant()'s role for the gatefold
function closeSealedSheetInstant(){
  if(!SEALSHEET) return;
  SEALSHEET = null;
  const sheet = $('#sealSheet');
  sheet.classList.remove('open','show');
  sheet.setAttribute('aria-hidden','true');
}

function openCrateAlbum(item){
  const v = S.view;
  if(item.kind === 'loose'){
    v.mode = 'crateLoose'; v.crateLooseArtist = item.artist; v.crateLooseIdx = item.idx.slice();
    v.group = null; v.playlist = null; v.person = null; v.artistAlbum = null;
    renderTracks();
    return;
  }
  // a sealed record can't be opened — the gatefold and its left panel only
  // unlock after the first play (SEALED spec §1, §5)
  if(isAlbumSealed(item.albumId)){ openSealedSheet(item); return; }
  // the gatefold is an overlay on top of the still-rendered crate (GATEFOLD
  // spec §A1) — nothing about S.view/S.crate changes, so closing it needs no
  // navigation back, it's simply still there
  openGatefold(item);
}

function updateCrateGroupToggleUI(){
  const hasGenres = libraryHasGenres();
  $('#crateGenreBtn').style.display = hasGenres ? '' : 'none';
  if(!hasGenres && S.crateGroup === 'genre'){ S.crateGroup = 'az'; invalidateCrateModel(); queueSave(); }
  document.querySelectorAll('#crateGroupToggle [data-group]').forEach(b =>
    b.setAttribute('aria-pressed', String(b.dataset.group === S.crateGroup)));
}

// flat, non-3D fallback for prefers-reduced-motion: a plain scrollable list,
// snap-scroll instead of momentum, cross-fade instead of the pull-to-camera
// (CRATE spec §6)
function renderCrateFlat(host, model){
  updateCrateGroupToggleUI();
  const list = el('div','crate-flat-list');
  list.setAttribute('role','listbox');
  list.setAttribute('aria-label','Crate');
  model.items.forEach(item => {
    if(item.type === 'div'){
      list.appendChild(el('div','crate-flat-divider', item.label + ' — ' + item.meta));
      return;
    }
    const row = el('div','crate-flat-item');
    row.setAttribute('role','option');
    if(isNowPlayingAlbum(item)) row.classList.add('crate-flat-current');
    const sealed = isAlbumSealed(item.albumId);
    const art = thumbURL['album:' + item.albumId] || (S.tracks[item.idx[0]] && S.tracks[item.idx[0]].art);
    if(art){ const im = document.createElement('img'); im.src = art; im.alt = ''; row.appendChild(im); }
    else { const flat = el('span','crate-flat-flat'); flat.style.background = CRATE_PALETTE[row.childElementCount % CRATE_PALETTE.length]; row.appendChild(flat); }
    const text = el('span','t-name');
    const titleEl = el('b', null, item.album);
    if(sealed) titleEl.appendChild(el('span','new-tag','NEW'));
    text.appendChild(titleEl);
    text.appendChild(el('em', null, item.artist + ' · ' + item.trackCount + (item.trackCount===1?' track':' tracks')));
    row.appendChild(text);
    const playBtn = el('button','t-edit','▶');
    playBtn.setAttribute('aria-label','Play ' + item.album);
    playBtn.addEventListener('click', e => {
      e.stopPropagation();
      if(sealed){ sealedQuietPlay(item.idx, item.idx[0]); } else setQueue(item.idx, 0, true);
    });
    row.appendChild(playBtn);
    row.addEventListener('click', () => {
      persistCrateAnchor(item);
      const host2 = $('#libBody');
      host2.style.transition = 'opacity 150ms ease'; host2.style.opacity = '0';
      setTimeout(() => { openCrateAlbum(item); $('#libBody').style.opacity = '1'; }, 150);
    });
    list.appendChild(row);
  });
  host.appendChild(list);
}

// the stage is a fixed height regardless of viewport, so on a short screen
// it (plus the info panel below it) can run into the (fixed-position) mini
// player — shrink the stage by however much the mini player + tabbar
// actually take up, rather than overlapping them (CRATE spec addendum,
// "Mini player"). Fewer distant neighbours show on a short screen; the
// centre record and info panel are unaffected. Called at mount time and
// again from updateChromeInset() whenever the mini player's own visibility
// changes later, since that happens after the crate has already rendered.
function applyCrateMiniInset(){
  const stage = document.querySelector('.crate-stage'), info = document.querySelector('.crate-info');
  const wrap = document.querySelector('.crate-wrap');
  if(!stage || !wrap) return;
  const miniEl = $('#miniPlayer'), tabbarEl = $('#tabbar');
  const miniH = (miniEl && getComputedStyle(miniEl).display !== 'none') ? miniEl.getBoundingClientRect().height : 0;
  const tabbarH = tabbarEl ? tabbarEl.getBoundingClientRect().height : 0;
  const infoReserve = info ? info.getBoundingClientRect().height : 84;
  // the "now playing elsewhere" pill sits in normal flow above the stage
  // (shown/hidden as the user scrolls past the playing album) and isn't
  // fixed-height — when shown it has to come out of this same budget, same
  // as the info panel below, or the stage claims room it doesn't have
  const topbarEl = document.querySelector('.crate-topbar');
  const topbarVisible = topbarEl && getComputedStyle(topbarEl).display !== 'none';
  // include its own margin-bottom too — getBoundingClientRect only covers
  // the border box, and the margin is exactly what separates it from the
  // stage below
  const topbarReserve = topbarVisible
    ? topbarEl.getBoundingClientRect().height + (parseFloat(getComputedStyle(topbarEl).marginBottom) || 0)
    : 0;
  const wrapTop = wrap.getBoundingClientRect().top;
  // .wrap itself already reserves tabbarH + miniH + 16px as its own
  // bottom padding (--chrome-inset, set by updateChromeInset() for every
  // route so a normally-scrolling list's last item doesn't hide under the
  // fixed tabbar/mini player) — that padding lands right after this route's
  // content regardless of what's inside it, stacking on top of whatever
  // margin this function leaves. 28 here, not just the 16 that padding
  // already covers, so after .crate-info's own 12px margin-top cancels
  // part of it, the two reservations land flush with zero net overflow —
  // verified against the actual rendered page height, not just by eye.
  const available = window.innerHeight - wrapTop - miniH - tabbarH - infoReserve - topbarReserve - 28;
  // the stage always claims all available room instead of capping and
  // banking the rest as dead space below the info panel — the info panel
  // sits flush just above the mini player, and the crate itself (the thing
  // people are actually here to flip through) gets whatever room that frees up.
  // Crucially this must never be pushed ABOVE "available": on a short
  // screen that would make the stage (plus the info panel still sitting
  // right below it) taller than the room between the header and the fixed
  // mini player/tabbar, overflowing the route and forcing the whole PAGE
  // to scroll — the one thing this layout exists to prevent. A previous
  // version enforced a floor here so the focal card wouldn't clip too much
  // against the stage's own overflow:hidden; that floor could exceed
  // "available" and is exactly what caused the page-scroll regression, so
  // on a truly cramped screen the card clips a little more instead.
  const stageHeight = Math.max(0, available);
  stage.style.height = stageHeight + 'px';
  // the rail is a sibling of the stage, absolutely positioned against
  // .crate-wrap rather than sized to the stage — it used to be a hardcoded
  // 440px (left over from when the stage itself was a fixed height) and
  // didn't shrink along with a dynamic stage, so on a short screen it could
  // poke out well past the stage's own bottom edge and inflate the page's
  // scrollable height even once the stage/info math above was correct.
  // Keep it inset the same 10px top and bottom as the stage always has.
  const railEl = document.querySelector('.crate-rail');
  if(railEl) railEl.style.height = Math.max(0, stageHeight - 20) + 'px';
}

function renderCrate(host){
  const model = ensureCrateModel();
  if(!model.items.length){ host.appendChild(el('p','note','No albums to show yet.')); return; }
  updateCrateGroupToggleUI();
  if(REDUCED){ renderCrateFlat(host, model); return; }

  let startPos = S.crate.pos;
  if(startPos == null || isNaN(startPos) || startPos < 0 || startPos >= model.items.length){
    // cold start: the last-played album wins, falling back to the saved
    // anchor, then the first record. After this first resolution, the
    // (continuously updated) anchor takes over on any later rebuild
    // (CRATE spec addendum, "Cold-start anchor")
    const lastPlayedId = !S.crate.coldStartDone ? resolveLastPlayedAlbum() : null;
    if(lastPlayedId && model.byAlbumId.has(lastPlayedId)) startPos = model.byAlbumId.get(lastPlayedId);
    else if(S.crateAnchor && model.byAlbumId.has(S.crateAnchor)) startPos = model.byAlbumId.get(S.crateAnchor);
    else startPos = model.items.findIndex(it => it.type === 'rec');
    if(startPos < 0) startPos = 0;
    S.crate.coldStartDone = true;
  }
  S.crate.pos = startPos;

  // resolved once per render — the playing album can't change while the
  // user is actively scrubbing the stage, so this doesn't need to be
  // recomputed every frame (CRATE spec §4, "Now playing")
  const nowPlayingIdx = model.items.findIndex(isNowPlayingAlbum);

  const wrap = el('div','crate-wrap');
  const nowPlayingBtn = el('button','crate-topbar');
  nowPlayingBtn.setAttribute('aria-label','Scroll to the album that is now playing');
  nowPlayingBtn.addEventListener('click', () => { if(nowPlayingIdx >= 0) snapTo(nowPlayingIdx); });
  const stage = el('div','crate-stage');
  stage.tabIndex = 0;
  stage.setAttribute('role','listbox');
  stage.setAttribute('aria-label','Crate');
  const live = el('div','sr-only'); live.id = 'crateLive'; live.setAttribute('aria-live','polite');
  stage.appendChild(live);
  const rail = el('div','crate-rail');
  const info = el('div','crate-info');
  wrap.appendChild(nowPlayingBtn); wrap.appendChild(stage); wrap.appendChild(rail); wrap.appendChild(info);
  host.appendChild(wrap);

  applyCrateMiniInset();

  const pool = new Map();      // item index -> element, only the visible window
  let animToken = 0, rafHandle = null;
  const cancelAnim = () => { animToken++; if(rafHandle){ cancelAnimationFrame(rafHandle); rafHandle = null; } };

  function itemAt(i){ return model.items[i]; }

  function makeCardEl(i){
    const item = itemAt(i);
    const card = document.createElement('div');
    card.className = 'crate-card';
    if(item.type === 'div'){
      const d = document.createElement('div'); d.className = 'crate-divider';
      const tab = document.createElement('div'); tab.className = 'crate-divider-tab'; tab.textContent = item.label;
      const label = document.createElement('div'); label.className = 'crate-divider-label'; label.textContent = item.label;
      const meta = document.createElement('div'); meta.className = 'crate-divider-meta'; meta.textContent = item.meta;
      d.appendChild(tab); d.appendChild(label); d.appendChild(meta);
      card.appendChild(d);
    } else {
      const face = document.createElement('div'); face.className = 'crate-card-face';
      face.style.background = CRATE_PALETTE[i % CRATE_PALETTE.length];
      card.appendChild(face);
      if(isNowPlayingAlbum(item)){
        const dot = document.createElement('div'); dot.className = 'crate-now-dot'; card.appendChild(dot);
      }
      if(isAlbumSealed(item.albumId)) card.appendChild(buildSealOverlay(278));
    }
    return card;
  }
  // S tier for the pool (spec §B2); falls back to the existing album
  // thumbnail, then the first track's own art, while the tier builds
  function setCardImage(i, card){
    const item = itemAt(i);
    if(item.type !== 'rec') return;
    const face = card.querySelector('.crate-card-face');
    if(!face || face.querySelector('img') || card.dataset.artPending) return;
    card.dataset.artPending = '1';
    getCrateArtURL(item.albumId, 'S').then(tierUrl => {
      delete card.dataset.artPending;
      if(pool.get(i) !== card) return;        // recycled while the lookup was in flight
      if(face.querySelector('img')) return;
      const art = tierUrl || thumbURL['album:' + item.albumId] || (S.tracks[item.idx[0]] && S.tracks[item.idx[0]].art);
      if(!art) return;
      const img = document.createElement('img');
      img.decoding = 'async'; img.alt = '';
      face.appendChild(img);
      img.src = art;
    });
  }
  function clearCardImage(card){ const img = card.querySelector('img'); if(img) img.remove(); delete card.dataset.artPending; }

  // 200ms after the stack settles, quietly decode and swap the centre
  // record's S image for the L tier — sharper at rest, nothing visibly
  // changes but the crispness (spec §B4, "swap S to L at rest")
  let largeSwapTimer = null;
  function scheduleLargeSwap(){
    clearTimeout(largeSwapTimer);
    largeSwapTimer = setTimeout(async () => {
      const idx = Math.round(S.crate.pos);
      const item = itemAt(idx);
      const card = pool.get(idx);
      if(!item || item.type !== 'rec' || !card) return;
      const url = await getCrateArtURL(item.albumId, 'L');
      if(!url || Math.round(S.crate.pos) !== idx || pool.get(idx) !== card) return;
      const img = new Image();
      img.decoding = 'async';
      img.src = url;
      try{ await img.decode(); }catch(e){ return; }
      if(Math.round(S.crate.pos) !== idx || pool.get(idx) !== card) return;
      const face = card.querySelector('.crate-card-face');
      const liveImg = face && face.querySelector('img');
      if(liveImg) liveImg.src = url; else if(face){ img.alt = ''; face.appendChild(img); }
    }, 200);
  }

  // the info panel's rendered height isn't constant while scrolling: a
  // divider item renders shorter (no play-button row) than a record, and a
  // long album/artist name can wrap to an extra line. applyCrateMiniInset
  // sized the stage against whatever the info panel measured at mount (or
  // the last topbar toggle) — if the real height grows past that while
  // scrolling, the stage doesn't shrink to compensate, and the taller info
  // panel gets pushed down behind the (fixed-position) mini player.
  // Re-measured after every updateInfoPanel call below, and only when it
  // actually changed, so this doesn't force a layout pass every frame.
  let lastInfoH = null;
  function syncInfoReserve(){
    const h = info.getBoundingClientRect().height;
    if(h !== lastInfoH){ lastInfoH = h; applyCrateMiniInset(); }
  }

  // a chip above the stage for when the playing album has been scrolled
  // away from — tapping it scrolls back (CRATE spec §4, "Now playing")
  let topbarShown = false;
  function updateNowPlayingTopBar(position){
    const shouldShow = nowPlayingIdx >= 0 && Math.round(position) !== nowPlayingIdx;
    const changed = shouldShow !== topbarShown;
    topbarShown = shouldShow;
    if(shouldShow){
      const item = itemAt(nowPlayingIdx);
      nowPlayingBtn.textContent = '● Now playing — ' + item.album;
      nowPlayingBtn.classList.add('show');
    } else {
      nowPlayingBtn.classList.remove('show');
    }
    // the pill takes up real flow space above the stage, so the stage's
    // own height budget (applyCrateMiniInset) has to be recomputed
    // whenever it appears or disappears — but only on that transition, not
    // every frame, since this runs continuously while scrubbing. This has
    // to run AFTER the show/hide class above, not before: measuring with
    // the old (stale) display state meant the stage never actually
    // reserved room for a pill that was about to pop in a moment later,
    // pushing the info panel down behind the mini player on that frame.
    if(changed) applyCrateMiniInset();
  }

  function updateInfoPanel(idx){
    const item = itemAt(idx);
    info.innerHTML = '';
    if(!item) return;
    if(item.type === 'div'){
      info.appendChild(el('h3', null, item.label));
      info.appendChild(el('p','crate-info-sub', item.panelSub || ''));
      info.appendChild(el('p','crate-info-meta', item.meta));
      return;
    }
    const sealed = isAlbumSealed(item.albumId);
    const row = el('div','crate-info-row');
    const text = el('div');
    const h3 = el('h3', null, item.album);
    if(isNowPlayingAlbum(item)) h3.appendChild(el('span','crate-now-chip','● Now playing'));
    text.appendChild(h3);
    text.appendChild(el('p','crate-info-sub', item.artist));
    const metaBits = [item.genre || null, item.year || null,
      item.trackCount + (item.trackCount === 1 ? ' track' : ' tracks')].filter(Boolean);
    text.appendChild(el('p','crate-info-meta', metaBits.join(' · ').toUpperCase()));
    if(sealed){
      text.appendChild(el('span','seal-tag','SEALED'));
      text.appendChild(el('span','sr-only','Sealed, not played yet'));
    }
    row.appendChild(text);
    const playBtn = el('button','tbtn play','▶');
    playBtn.setAttribute('aria-label','Play ' + item.album);
    // a sealed album plays quietly from track 1, same first-play rules as
    // the sealed sheet — no sheet/overlay opens from here either (§5)
    playBtn.addEventListener('click', e => {
      e.stopPropagation();
      if(sealed){ sealedQuietPlay(item.idx, item.idx[0]); } else setQueue(item.idx, 0, true);
    });
    row.appendChild(playBtn);
    info.appendChild(row);
  }

  function updateRailUI(position){
    const entries = model.railEntries;
    rail.innerHTML = '';
    if(!entries.length) return;
    // ticks spread across the rail's own current height (kept in sync with
    // the dynamic stage by applyCrateMiniInset), not a number tuned to the
    // old fixed-height stage — otherwise they'd run off the bottom of a
    // shorter rail instead of spanning it
    const h = Math.max(0, rail.getBoundingClientRect().height - 20);
    entries.forEach((e_, k) => {
      const t = entries.length > 1 ? k / (entries.length - 1) : 0;
      const tick = el('button','crate-rail-item' + (e_.present ? '' : ' crate-rail-dim'), e_.label);
      tick.style.top = (t * h) + 'px';
      tick.disabled = !e_.present;
      if(e_.present){
        const target = crateRailJumpTarget(model, e_.key);
        if(target != null && Math.abs(position - target) < 2) tick.classList.add('crate-rail-current');
        tick.addEventListener('pointerdown', ev => { ev.stopPropagation(); });
        tick.addEventListener('click', ev => { ev.stopPropagation(); snapTo(target); });
      }
      rail.appendChild(tick);
    });
  }

  function announceCurrent(){
    const item = itemAt(Math.round(S.crate.pos));
    if(!item) return;
    live.textContent = item.type === 'div' ? ('Divider ' + item.label + ', ' + item.meta.toLowerCase())
      : (item.album + ', ' + item.artist + ', ' + item.trackCount + (item.trackCount===1?' track':' tracks'));
  }

  // will-change only while the stack is actually moving, dropped 150ms
  // after the last moving frame (spec §B4, "promote only while moving")
  let moveClassTimer = null;
  function applyMovingClass(speed){
    if(speed > 0.02){
      clearTimeout(moveClassTimer); moveClassTimer = null;
      pool.forEach(card => card.classList.add('crate-moving'));
    } else if(moveClassTimer == null){
      moveClassTimer = setTimeout(() => { pool.forEach(card => card.classList.remove('crate-moving')); moveClassTimer = null; }, 150);
    }
  }

  function syncCards(position, speed){
    const lo = Math.max(0, Math.floor(position) - CRATE_VISIBLE_A), hi = Math.min(model.items.length - 1, Math.ceil(position) + CRATE_VISIBLE_A);
    for(const i of Array.from(pool.keys())) if(i < lo || i > hi){ pool.get(i).remove(); pool.delete(i); }
    for(let i = lo; i <= hi; i++) if(!pool.has(i)){ const c = makeCardEl(i); stage.appendChild(c); pool.set(i, c); }
    pool.forEach((card, i) => {
      const d = i - position, a = Math.abs(d);
      const pose = flowPose(a, d, speed, {originY: CRATE_ORIGIN_Y});
      // integer device pixels so edges don't smear at rest (spec §B4)
      const y = Math.round(pose.y * CRATE_DPR) / CRATE_DPR;
      card.style.transform = 'translateY(' + y.toFixed(2) + 'px) translateZ(' + pose.z.toFixed(1) + 'px) '
        + 'rotateX(' + pose.rotX.toFixed(2) + 'deg) scale(' + pose.scale.toFixed(3) + ')';
      card.style.opacity = pose.opacity;
      card.style.zIndex = flowZIndex(a);
      card.classList.toggle('crate-current', a < 0.02);
      if(a <= 2 && speed < 0.5) setCardImage(i, card);
      else if(a > 2) clearCardImage(card);
    });
    applyMovingClass(speed);
    updateInfoPanel(Math.round(position));
    syncInfoReserve();
    updateRailUI(position);
    updateNowPlayingTopBar(position);
  }
  function draw(speed){ syncCards(S.crate.pos, speed); }

  function onSettled(){
    const item = itemAt(Math.round(S.crate.pos));
    if(item && item.type === 'rec') persistCrateAnchor(item);
    announceCurrent();
    scheduleLargeSwap();
  }

  // the animation loop is draw-on-demand: paused outright (not just slowed)
  // whenever the library route isn't visible or the page is hidden — the
  // next interaction (or a resize/visibility change) picks up normally,
  // so a stalled frame never leaves the pose stuck mid-animation
  function pausedNow(){ return document.hidden || !isLibraryRouteVisible(); }

  function snapTo(target, ms){
    cancelAnim();
    const token = ++animToken;
    target = clamp(Math.round(target), 0, model.items.length - 1);
    const start = S.crate.pos, startTime = performance.now(), dur = ms || 250;
    function step(now){
      if(token !== animToken) return;
      if(pausedNow()){ S.crate.pos = target; draw(0); onSettled(); return; }
      const p = clamp((now - startTime) / dur, 0, 1);
      const eased = 1 - Math.pow(1 - p, 3);
      S.crate.pos = start + (target - start) * eased;
      draw((1 - p) * 0.35);
      if(p < 1){ rafHandle = requestAnimationFrame(step); }
      else { S.crate.pos = target; draw(0); onSettled(); }
    }
    rafHandle = requestAnimationFrame(step);
  }

  function momentumThenSnap(velocity){
    cancelAnim();
    const token = ++animToken;
    let v = velocity, last = performance.now();
    function step(now){
      if(token !== animToken) return;
      if(pausedNow()){ snapTo(Math.round(S.crate.pos)); return; }
      const dt = Math.min(48, now - last); last = now;
      v *= Math.exp(-0.0022 * dt);
      let pos = clamp(S.crate.pos + v * dt, 0, model.items.length - 1);
      S.crate.pos = pos;
      draw(clamp(Math.abs(v) * 40, 0, 1));
      if(Math.abs(v) > 0.00025 && pos > 0 && pos < model.items.length - 1){ rafHandle = requestAnimationFrame(step); }
      else snapTo(Math.round(pos));
    }
    rafHandle = requestAnimationFrame(step);
  }

  // ---- pointer / touch drag ----
  let dragState = null;
  stage.addEventListener('pointerdown', e => {
    if(e.button != null && e.button !== 0) return;
    cancelAnim();
    try{ stage.setPointerCapture(e.pointerId); }catch(err){}
    dragState = {startY:e.clientY, lastY:e.clientY, lastT:performance.now(), v:0, moved:false};
  });
  stage.addEventListener('pointermove', e => {
    if(!dragState) return;
    const now = performance.now();
    const dy = e.clientY - dragState.lastY;
    if(Math.abs(e.clientY - dragState.startY) > 3) dragState.moved = true;
    const dt = Math.max(1, now - dragState.lastT);
    const deltaPos = -dy / 70;
    S.crate.pos = clamp(S.crate.pos + deltaPos, 0, model.items.length - 1);
    const instV = deltaPos / dt;
    dragState.v = dragState.v * 0.7 + instV * 0.3;
    dragState.lastY = e.clientY; dragState.lastT = now;
    draw(clamp(Math.abs(dragState.v) * 60, 0, 1));
    e.preventDefault();
  });
  function endDrag(){
    if(!dragState) return;
    const v = dragState.v, moved = dragState.moved;
    dragState = null;
    if(!moved) return;   // a plain tap — the click handler below deals with it
    if(Math.abs(v) > 0.00035) momentumThenSnap(v);
    else snapTo(Math.round(S.crate.pos));
  }
  stage.addEventListener('pointerup', endDrag);
  stage.addEventListener('pointercancel', endDrag);

  // ---- wheel / trackpad ----
  let wheelSnapTimer = null;
  stage.addEventListener('wheel', e => {
    e.preventDefault();
    cancelAnim();
    const deltaPos = e.deltaY / 70;
    S.crate.pos = clamp(S.crate.pos + deltaPos, 0, model.items.length - 1);
    draw(clamp(Math.abs(deltaPos) * 3, 0, 1));
    clearTimeout(wheelSnapTimer);
    wheelSnapTimer = setTimeout(() => snapTo(Math.round(S.crate.pos)), 120);
  }, {passive:false});

  // ---- keyboard ----
  stage.addEventListener('keydown', e => {
    const cur = Math.round(S.crate.pos);
    if(e.key === 'ArrowDown'){ snapTo(cur + 1); e.preventDefault(); }
    else if(e.key === 'ArrowUp'){ snapTo(cur - 1); e.preventDefault(); }
    else if(e.key === 'PageDown'){ snapTo(cur + 5); e.preventDefault(); }
    else if(e.key === 'PageUp'){ snapTo(cur - 5); e.preventDefault(); }
    else if(e.key === 'Home'){ snapTo(0); e.preventDefault(); }
    else if(e.key === 'End'){ snapTo(model.items.length - 1); e.preventDefault(); }
    else if(e.key === 'Enter'){ const item = itemAt(cur); if(item && item.type === 'rec') openCrateAlbum(item); e.preventDefault(); }
    else if(e.key === ' '){ const item = itemAt(cur); if(item && item.type === 'rec') setQueue(item.idx, 0, true); e.preventDefault(); }
    else if(model.group === 'az' && /^[a-zA-Z]$/.test(e.key)){
      const target = crateRailJumpTarget(model, e.key.toUpperCase());
      if(target != null){ snapTo(target); e.preventDefault(); }
    }
  });

  // ---- tap a card: centre one scrolls to it, the centred one opens ----
  stage.addEventListener('click', e => {
    const cardEl = e.target.closest('.crate-card');
    if(!cardEl) return;
    let idx = null;
    pool.forEach((elC, i) => { if(elC === cardEl) idx = i; });
    if(idx == null) return;
    if(idx === Math.round(S.crate.pos)){
      const item = itemAt(idx);
      if(item.type === 'rec') openCrateAlbum(item);
    } else snapTo(idx);
  });

  // ---- rail drag-to-scrub, with the amber bubble ----
  let bubbleEl = null, scrubbing = false;
  function railEntryAtClientY(clientY){
    const entries = model.railEntries;
    if(!entries.length) return null;
    const rect = rail.getBoundingClientRect();
    const t = clamp((clientY - rect.top) / Math.max(1, rect.height), 0, 1);
    const k = Math.round(t * (entries.length - 1));
    return entries[k];
  }
  rail.addEventListener('pointerdown', e => {
    const entry = railEntryAtClientY(e.clientY);
    if(!entry) return;
    scrubbing = true;
    cancelAnim();
    try{ rail.setPointerCapture(e.pointerId); }catch(err){}
    bubbleEl = document.createElement('div');
    bubbleEl.className = 'crate-rail-bubble';
    document.body.appendChild(bubbleEl);
    scrubMove(e);
    e.preventDefault();
  });
  function scrubMove(e){
    if(!scrubbing) return;
    const entry = railEntryAtClientY(e.clientY);
    if(!entry) return;
    bubbleEl.textContent = entry.label;
    bubbleEl.style.left = (e.clientX - 34 - 60) + 'px';
    bubbleEl.style.top = (e.clientY - 34) + 'px';
    if(entry.present && entry.itemIndex != null){ S.crate.pos = clamp(entry.itemIndex, 0, model.items.length - 1); draw(0.9); }
    scrubMove.lastEntry = entry;
  }
  rail.addEventListener('pointermove', e => { if(scrubbing){ scrubMove(e); e.preventDefault(); } });
  function endScrub(){
    if(!scrubbing) return;
    scrubbing = false;
    if(bubbleEl){ bubbleEl.remove(); bubbleEl = null; }
    const entry = scrubMove.lastEntry;
    if(entry && entry.present){ const target = crateRailJumpTarget(model, entry.key); if(target != null) snapTo(target); }
  }
  rail.addEventListener('pointerup', endScrub);
  rail.addEventListener('pointercancel', endScrub);

  draw(0);
  // info started out empty when applyCrateMiniInset() first ran above, so
  // its height was measured at the CSS min-height floor rather than its
  // real content height (title + artist + meta, sometimes a wrapped "Now
  // playing" chip). Now that draw(0) has filled it in, remeasure so the
  // stage doesn't claim room the info panel actually needs — without this,
  // using all available space (rather than banking a safety margin of dead
  // space) let the info panel's true height push past the mini player.
  applyCrateMiniInset();
  announceCurrent();
  scheduleLargeSwap();
  prewarmCrateAnchorL().catch(() => {});
}

// vertically centres the empty-library placeholder in whatever room is left
// under the header and above the tab bar, rather than always hugging the
// top — a one-off static block, unlike the scrollable track lists
function centerEmptyState(){
  const empty = $('#empty');
  empty.style.marginTop = '0px';
  const tabbarEl = $('#tabbar');
  const tabbarH = tabbarEl ? tabbarEl.getBoundingClientRect().height : 0;
  const top = empty.getBoundingClientRect().top;
  const available = window.innerHeight - top - tabbarH - 16;
  const slack = available - empty.getBoundingClientRect().height;
  if(slack > 0) empty.style.marginTop = Math.round(slack / 2) + 'px';
}

export function renderTracks(){
  const host = $('#libBody'); host.innerHTML = '';
  const v = S.view;
  $('#empty').style.display = S.tracks.length ? 'none' : 'block';
  if(!S.tracks.length) centerEmptyState();
  $('#selectToggle').style.display = (S.tracks.length && v.mode !== 'crate') ? '' : 'none';
  $('#selectBar').style.display = v.editSelecting ? 'flex' : 'none';
  updateLibTabsForLayout();
  updateHeaderActionsAvailability();
  document.querySelectorAll('[data-view]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.view === v.mode)));
  refreshLibraryTools();
  if(!S.tracks.length){ setPathNote(); return; }

  // a live search takes over the whole body, grouped by type, regardless
  // of whatever songs/albums/artists/playlists/crate view is otherwise
  // selected (see PLAYBACK spec §4) — clearing it returns to that view
  // untouched
  const query = $('#librarySearch').value.trim();
  if(query){
    $('#crumb').style.display = 'none';
    renderSearchResults(host, query);
    return;
  }

  // the crate is its own tab now (replacing Albums when the layout is
  // Crate) rather than a second top-level layout over all four tabs, so
  // Songs/Artists/Playlists are never hidden by it (S1/S2 spec)
  if(v.mode === 'crate'){
    $('#crumb').style.display = 'none';
    renderCrate(host);
    setPathNote();
    return;
  }

  // breadcrumb when drilled into an album, artist (and its albums), playlist,
  // person, or an artist's loose-tracks page opened from the crate
  const crumb = $('#crumb');
  const inside = v.group !== null || v.playlist !== null || v.mode === 'person' || v.mode === 'crateLoose';
  crumb.style.display = inside ? 'flex' : 'none';
  if(inside){
    crumb.innerHTML = '';
    const atArtistAlbum = v.mode === 'artists' && v.artistAlbum !== null;
    // an album or loose-tracks page reached from the crate says so, and
    // returning lands back in the crate at the same position (CRATE spec §4)
    const fromCrate = S.libraryLayout === 'crate'
      && ((v.mode === 'albums' && v.group !== null && !atArtistAlbum) || v.mode === 'crateLoose');
    const back = el('button','crumb-back', fromCrate ? '‹ Crate' : '‹ Back');
    back.addEventListener('click', ()=>{
      if(v.mode === 'person'){
        const r = v.personReturn;
        v.person = null; v.personReturn = null;
        if(r){ v.mode = r.mode; v.group = r.group; v.artistAlbum = r.artistAlbum; v.playlist = r.playlist; }
        else v.mode = 'songs';
      }
      else if(v.mode === 'crateLoose'){ v.mode = 'songs'; v.crateLooseIdx = null; v.crateLooseArtist = null; }
      else if(atArtistAlbum) v.artistAlbum = null;
      // an album opened from the crate returns to the crate itself, not the
      // flat albums grid underneath it (S1/S2 spec: crate is its own tab)
      else if(v.mode === 'albums' && S.libraryLayout === 'crate'){ v.group = null; v.mode = 'crate'; }
      else { v.group = null; v.playlist = null; v.picking = false; }
      renderTracks();
    });
    crumb.appendChild(back);
    crumb.appendChild(el('span','crumb-label',
      v.mode === 'person' ? v.person : (v.mode === 'crateLoose' ? v.crateLooseArtist :
      (v.playlist !== null ? S.playlists[v.playlist].name : (atArtistAlbum ? v.artistAlbum : v.group)))));
    // Album/artist deletion lives right where you're looking at that album
    // or artist — offered even for a single-album artist, no conditional
    // collapsing to album deletion (see LIBRARY spec §4)
    if(v.playlist === null && v.group !== null && (v.mode === 'albums' || v.mode === 'artists')){
      const removeBtn = el('button','crumb-back', (v.mode === 'albums' || atArtistAlbum) ? 'Remove Album' : 'Remove Artist');
      removeBtn.style.marginLeft = 'auto';
      removeBtn.addEventListener('click', ()=>{
        const group = v.group;
        if(v.mode === 'albums'){
          openConfirmDelete('album', countForAlbum(group), group, async () => { deleteAlbum(group); v.group = null; renderTracks(); });
        } else if(atArtistAlbum){
          const album = v.artistAlbum;
          const artist = v.group;
          openConfirmDelete('album', countForAlbum(album), album, async () => {
            deleteAlbum(album);
            v.artistAlbum = null;
            // if that was the artist's last album, there's nothing left to
            // pick from — back out to the artist list instead of an empty screen
            if(!countForArtist(artist)) v.group = null;
            renderTracks();
          });
        } else {
          openConfirmDelete('artist', countForArtist(group), group, async () => { deleteArtist(group); v.group = null; renderTracks(); });
        }
      });
      crumb.appendChild(removeBtn);
    }
  }

  const ul = el('ul','tracklist');

  if(v.mode === 'songs'){
    host.appendChild(librarySortBar());
    const q = allIdx().sort(librarySortComparator('songs'));
    q.forEach((i,pos) => {
      const row = songRow(i, q, pos);
      if(isAlbumSealed(albumKey(S.tracks[i]))) row.querySelector('.t-name').appendChild(el('span','new-tag','NEW'));
      ul.appendChild(row);
    });
    host.appendChild(ul);
  }

  else if(v.mode === 'person'){
    renderPersonView(host, v.person);
  }

  else if(v.mode === 'crateLoose'){
    const idx = v.crateLooseIdx || [];
    idx.forEach((i,pos) => ul.appendChild(songRow(i, idx, pos)));
    host.appendChild(ul);
  }

  else if(v.mode === 'albums'){
    if(v.group === null){
      host.appendChild(librarySortBar());
      sortAlbumGroups(groupBy('album')).forEach(([album, idx]) => {
        const artist = S.tracks[idx[0]].tags.albumArtist;
        const row = groupRow(album, artist + ' · ' + idx.length + (idx.length===1?' track':' tracks'),
          idx, ()=>{ v.group = album; renderTracks(); });
        if(isAlbumSealed(albumKey(S.tracks[idx[0]]))) row.querySelector('.g-text b').appendChild(el('span','new-tag','NEW'));
        host.appendChild(row);
      });
    } else {
      renderAlbumDetail(host, ul, v.group);
    }
  }

  else if(v.mode === 'artists'){
    if(v.group === null){
      groupBy('artist').forEach(([artist, idx]) => {
        const albums = new Set(idx.map(i => S.tracks[i].tags.album)).size;
        host.appendChild(groupRow(artist, albums + (albums===1?' album · ':' albums · ') + idx.length
          + (idx.length===1?' track':' tracks'), idx, ()=>{ v.group = artist; renderTracks(); }));
      });
    } else if(v.artistAlbum === null){
      // an artist with multiple albums lands here first — pick an album
      // before seeing its tracks, same as the top-level Albums view, rather
      // than dumping every song from every album in one flat list
      const idx = allIdx().filter(i => S.tracks[i].tags.artist === v.group);
      const albums = new Map();
      idx.forEach(i => {
        const album = S.tracks[i].tags.album;
        if(!albums.has(album)) albums.set(album, []);
        albums.get(album).push(i);
      });
      [...albums.entries()].sort((a,b) => byName(a[0], b[0])).forEach(([album, aidx]) => {
        host.appendChild(groupRow(album, aidx.length + (aidx.length===1?' track':' tracks'),
          aidx, ()=>{ v.artistAlbum = album; renderTracks(); }));
      });
    } else {
      renderAlbumDetail(host, ul, v.artistAlbum);
    }
  }

  else if(v.mode === 'playlists'){
    if(v.playlist === null){
      if(!S.playlists.length) host.appendChild(el('p','note','No playlists yet. They live for this session only, since the library itself is rebuilt each time you open Miziki.'));
      // Favorites (and any other system playlist) pinned first, without
      // reordering S.playlists itself — v.playlist indexes the real array
      const order = S.playlists.map((_, n) => n).sort((a, b) => (S.playlists[a].system?0:1) - (S.playlists[b].system?0:1));
      order.forEach(n => {
        const pl = S.playlists[n];
        host.appendChild(groupRow(pl.name, pl.items.length + (pl.items.length===1?' track':' tracks'),
          pl.items, ()=>{ v.playlist = n; renderTracks(); }));
      });
      const add = el('div','stack');
      const nameIn = el('input','pl-input'); nameIn.placeholder = 'New playlist name'; nameIn.id = 'plName';
      const mk = el('button','cta','Create');
      mk.addEventListener('click', ()=>{
        const nm = nameIn.value.trim(); if(!nm) return;
        S.playlists.push({name:nm, items:[]}); queueSave();
        v.playlist = S.playlists.length - 1; v.picking = true; renderTracks();
      });
      add.appendChild(nameIn); add.appendChild(mk);
      host.appendChild(add);
    } else {
      const pl = S.playlists[v.playlist];
      if(v.picking){
        host.appendChild(el('p','note','Tap tracks to add or remove them, then tap Done.'));
        const all = allIdx().sort((a,b) => byName(S.tracks[a].tags.title, S.tracks[b].tags.title));
        all.forEach((i,pos) => {
          const row = songRow(i, all, pos);
          if(pl.items.includes(i)) row.classList.add('picked');
          ul.appendChild(row);
        });
        host.appendChild(ul);
        const done = el('button','cta','Done');
        done.addEventListener('click', ()=>{ v.picking = false; renderTracks(); });
        const wrap = el('div','stack'); wrap.appendChild(done); host.appendChild(wrap);
      } else {
        if(!pl.items.length) host.appendChild(el('p','note','This playlist is empty.'));
        pl.items.forEach((i,pos) => {
          const row = songRow(i, pl.items, pos);
          if(pl.items.length > 1) row.appendChild(moverCtl(pl.items, pos, syncQueueOrder));
          ul.appendChild(row);
        });
        host.appendChild(ul);
        const edit = el('button','cta ghost','Add or remove tracks');
        edit.addEventListener('click', ()=>{ v.picking = true; renderTracks(); });
        const wrap = el('div','stack'); wrap.appendChild(edit); host.appendChild(wrap);
      }
    }
  }

  setPathNote();
}

/* ================= profile tab rendering =================
   A stat sheet, not the app's center of gravity. Earned/discovered items
   only — no locked slots, no progress bars, no "X more until Y", no
   general listening stats. See PROFILE spec §1. */
async function persistProfile(){
  await profile.put({k:'me', name:S.profile.name, username:S.profile.username, pictureBlob:S.profile.artBlob || undefined});
}

// "John Smith" -> "John S."; a single word (or nothing) passes through as-is
function formatDisplayName(name){
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if(!parts.length) return '';
  if(parts.length === 1) return parts[0];
  return parts[0] + ' ' + parts[parts.length - 1][0].toUpperCase() + '.';
}

const fmtCount = (n, one, many) => n + ' ' + (n === 1 ? one : many);

function topTile(label, art, title, subtitle, emptyText, onTap){
  const b = el('button','profile-top-tile');
  const cover = el('span','profile-top-cover');
  if(art){ const im = document.createElement('img'); im.src = art; im.alt = ''; cover.appendChild(im); }
  else cover.appendChild(el('span','profile-empty-cover', title ? '◍' : '—'));
  b.appendChild(cover);
  if(title){
    b.appendChild(el('b', null, title));
    if(subtitle) b.appendChild(el('em', null, subtitle));
  } else {
    b.appendChild(el('b', null, label));
    b.appendChild(el('em', null, emptyText));
  }
  b.addEventListener('click', onTap);
  return b;
}

function metalBadge(rec){
  const cell = el('div','profile-badge-cell');
  const badge = el('div','profile-badge');
  if(rec.tier === 'rare'){
    badge.style.background = rec.art ? 'url("' + rec.art + '") center/cover' : 'linear-gradient(155deg,#2A2018,#171310)';
  } else {
    badge.style.background = metalBackground(rec.tier);
    if(rec.art){ const im = document.createElement('img'); im.src = rec.art; im.alt = ''; badge.appendChild(im); }
  }
  cell.appendChild(badge);
  const label = rec.tier === 'rare' ? 'Rare' : rec.tier[0].toUpperCase() + rec.tier.slice(1);
  cell.appendChild(el('span','profile-badge-label', label));
  return cell;
}

function collectionBadge(rec){
  const cell = el('div','profile-badge-cell');
  const badge = el('div','profile-badge');
  badge.style.background = variantBackground(VARIANT_DEFS[rec.variant]);
  cell.appendChild(badge);
  cell.appendChild(el('span','profile-badge-label', rec.name));
  return cell;
}

const STORE_TIER_LABEL = {1:'LOSSY', 2:'LOSSLESS', 3:'HI-RES'};
const STORE_VIS_LABEL = {private:'Only you', friends:'Friends only', public:'Everyone'};

let socialAuth = null;

function beginSocialSignIn(){
  const auth = MizikiSocial.status().auth;
  socialAuth = {
    step: auth === 'needsProfile' ? 'handle' : 'email',
    email: '', code: '', handle: '', displayName: '', visibility: 'friends',
    error: null, busy: false
  };
  $('#socialAuthOverlay').classList.add('open');
  $('#socialAuthOverlay').setAttribute('aria-hidden','false');
  renderSocialAuth();
}
function closeSocialAuth(){
  $('#socialAuthOverlay').classList.remove('open');
  $('#socialAuthOverlay').setAttribute('aria-hidden','true');
  socialAuth = null;
}

// The sign-in wizard's "Open your store" entry point exists on both the
// Profile and Home tabs; refresh whichever one is actually on screen so
// finishing sign-in doesn't leave the other tab showing its stale pre-signin state.
function refreshSocialEntryHost(){
  const homeRoute = document.getElementById('route-home');
  if(homeRoute && homeRoute.classList.contains('on')) renderHome();
  else renderProfile();
}

function socialField(labelText, value, attrs){
  const row = el('div','slider-row');
  const head = el('div','slider-head'); head.appendChild(el('span', null, labelText));
  row.appendChild(head);
  const input = el('input','pl-input');
  Object.assign(input, attrs || {});
  input.value = value || '';
  row.appendChild(input);
  return { row, input };
}

function socialPrimaryStack(label, onClick, disabled){
  const stack = el('div','stack social-stack');
  const btn = el('button','cta', label);
  if(disabled) btn.disabled = true;
  btn.addEventListener('click', onClick);
  stack.appendChild(btn);
  return stack;
}

function renderSocialAuth(){
  const title = $('#socialAuthTitle');
  const body = $('#socialAuthBody'); body.innerHTML = '';
  if(socialAuth.step === 'email') renderSocialAuthEmail(title, body);
  else if(socialAuth.step === 'code') renderSocialAuthCode(title, body);
  else if(socialAuth.step === 'handle') renderSocialAuthHandle(title, body);
  else renderSocialAuthVisibility(title, body);
}

function renderSocialAuthEmail(title, body){
  title.textContent = 'Sign in';
  body.appendChild(el('p','note','We’ll email you a 6-digit code — no password to remember.'));
  const { row, input } = socialField('Email', socialAuth.email,
    {type:'email', placeholder:'you@example.com', autocomplete:'email'});
  body.appendChild(row);
  if(socialAuth.error) body.appendChild(el('p','note', socialAuth.error));
  body.appendChild(socialPrimaryStack(socialAuth.busy ? 'Sending…' : 'Send code', async ()=>{
    const email = input.value.trim();
    socialAuth.busy = true; socialAuth.error = null; renderSocialAuth();
    const r = await MizikiSocial.sendCode(email);
    socialAuth.busy = false;
    if(!r.ok){ socialAuth.error = r.error.message; renderSocialAuth(); return; }
    socialAuth.email = email; socialAuth.step = 'code';
    renderSocialAuth();
  }, socialAuth.busy));
}

function renderSocialAuthCode(title, body){
  title.textContent = 'Check your email';
  body.appendChild(el('p','note','Enter the 6-digit code we sent to ' + socialAuth.email + '.'));
  const { row, input } = socialField('Code', socialAuth.code,
    {type:'text', inputMode:'numeric', maxLength:8, placeholder:'123456', autocomplete:'one-time-code'});
  body.appendChild(row);
  if(socialAuth.error) body.appendChild(el('p','note', socialAuth.error));
  body.appendChild(socialPrimaryStack(socialAuth.busy ? 'Verifying…' : 'Verify', async ()=>{
    const code = input.value.trim();
    socialAuth.busy = true; socialAuth.error = null; renderSocialAuth();
    const r = await MizikiSocial.verifyCode(socialAuth.email, code);
    socialAuth.busy = false;
    if(!r.ok){ socialAuth.error = r.error.message; renderSocialAuth(); return; }
    if(r.status.auth === 'ready'){ closeSocialAuth(); refreshSocialEntryHost(); return; }
    socialAuth.step = 'handle';
    renderSocialAuth();
  }, socialAuth.busy));
  const linkRow = el('div','stack');
  const resend = el('button','cta ghost','Resend code');
  resend.addEventListener('click', async ()=>{
    socialAuth.busy = true; socialAuth.error = null; renderSocialAuth();
    await MizikiSocial.sendCode(socialAuth.email);
    socialAuth.busy = false; renderSocialAuth();
  });
  const back = el('button','cta ghost','Use a different email');
  back.addEventListener('click', ()=>{ socialAuth.step = 'email'; socialAuth.error = null; renderSocialAuth(); });
  linkRow.appendChild(resend); linkRow.appendChild(back);
  body.appendChild(linkRow);
}

function renderSocialAuthHandle(title, body){
  title.textContent = 'Create your crate';
  body.appendChild(el('p','note','Your handle is how friends find you — it’s also your crate name.'));
  const { row, input } = socialField('Handle', socialAuth.handle,
    {type:'text', placeholder:'yourname', maxLength:24, autocapitalize:'none', autocorrect:'off'});
  body.appendChild(row);
  const status = el('p','note','3–24 characters: letters, numbers, underscore.');
  body.appendChild(status);
  const { row: nameRow, input: nameInput } = socialField('Display name (optional)', socialAuth.displayName,
    {type:'text', placeholder:'Shown under your handle', maxLength:50});
  body.appendChild(nameRow);
  if(socialAuth.error) body.appendChild(el('p','note', socialAuth.error));
  let seq = 0, debounceTimer = null;
  input.addEventListener('input', ()=>{
    clearTimeout(debounceTimer);
    const h = input.value.trim().toLowerCase();
    debounceTimer = setTimeout(async ()=>{
      if(!h){ status.textContent = '3–24 characters: letters, numbers, underscore.'; return; }
      const mySeq = ++seq;
      status.textContent = 'Checking…';
      const r = await MizikiSocial.checkHandle(h);
      if(mySeq !== seq) return;
      if(!r.ok){ status.textContent = r.error.message; return; }
      status.textContent = r.available ? '@' + h + ' is available.'
        : (r.reason === 'format' ? '3–24 characters: letters, numbers, underscore.' : 'That handle is taken.');
    }, 350);
  });
  body.appendChild(socialPrimaryStack(socialAuth.busy ? 'Checking…' : 'Continue', async ()=>{
    const h = input.value.trim().toLowerCase();
    socialAuth.busy = true; socialAuth.error = null; renderSocialAuth();
    const avail = await MizikiSocial.checkHandle(h);
    if(!avail.ok || !avail.available){
      socialAuth.busy = false;
      socialAuth.error = (avail.ok && avail.reason !== 'format') ? 'That handle is taken.'
        : '3–24 characters: letters, numbers, underscore.';
      socialAuth.handle = h;
      renderSocialAuth(); return;
    }
    socialAuth.handle = h; socialAuth.displayName = nameInput.value.trim(); socialAuth.busy = false;
    socialAuth.step = 'visibility';
    renderSocialAuth();
  }, socialAuth.busy));
}

function renderSocialAuthVisibility(title, body){
  title.textContent = 'Who can see your crate?';
  const opts = [
    {key:'private', label:'Only you', desc:'Nothing is visible to anyone else yet.'},
    {key:'friends', label:'Friends only', desc:'People you approve can browse your crate.'},
    {key:'public', label:'Everyone', desc:'Anyone can find and follow your crate.'}
  ];
  const list = el('div','social-vis-list');
  opts.forEach(o => {
    const row = document.createElement('button');
    row.type = 'button'; row.className = 'social-vis-option';
    row.setAttribute('aria-pressed', String(socialAuth.visibility === o.key));
    const text = el('div');
    text.appendChild(el('b', null, o.label));
    text.appendChild(el('div','note', o.desc));
    row.appendChild(text);
    row.addEventListener('click', ()=>{ socialAuth.visibility = o.key; renderSocialAuth(); });
    list.appendChild(row);
  });
  body.appendChild(list);
  if(socialAuth.error) body.appendChild(el('p','note', socialAuth.error));
  body.appendChild(socialPrimaryStack(socialAuth.busy ? 'Opening your crate…' : 'Finish', async ()=>{
    socialAuth.busy = true; socialAuth.error = null; renderSocialAuth();
    const created = await MizikiSocial.createProfile({handle: socialAuth.handle, displayName: socialAuth.displayName});
    if(!created.ok){
      socialAuth.busy = false; socialAuth.error = created.error.message; socialAuth.step = 'handle';
      renderSocialAuth(); return;
    }
    if(socialAuth.visibility !== 'friends'){
      const updated = await MizikiSocial.updateProfile({visibility: socialAuth.visibility});
      if(!updated.ok){ socialAuth.busy = false; socialAuth.error = updated.error.message; renderSocialAuth(); return; }
    }
    socialAuth.busy = false;
    closeSocialAuth();
    refreshSocialEntryHost();
  }, socialAuth.busy));
}

function timeAgoShort(ms){
  const s = Math.max(0, Math.round(ms / 1000));
  if(s < 60) return 'just now';
  const m = Math.round(s / 60);
  if(m < 60) return m + ' min' + (m === 1 ? '' : 's') + ' ago';
  const h = Math.round(m / 60);
  if(h < 24) return h + ' hour' + (h === 1 ? '' : 's') + ' ago';
  const d = Math.round(h / 24);
  return d + ' day' + (d === 1 ? '' : 's') + ' ago';
}

function socialSyncStatusLine(status){
  if(status.sync === 'syncing') return 'Syncing…';
  if(status.sync === 'offline') return 'Offline — will retry automatically.';
  if(status.sync === 'error') return 'Couldn’t sync' + (status.lastError ? ': ' + status.lastError.message : '.');
  if(status.sync === 'needsReview') return 'Paused — review removed records below.';
  if(status.lastSyncedAt) return 'Synced ' + timeAgoShort(Date.now() - status.lastSyncedAt);
  return 'Not synced yet.';
}

function renderSocialSettingsScreen(body){
  body.innerHTML = '';
  const status = MizikiSocial.status();
  if(status.sync === 'needsReview' && status.pendingRemovals > 0){
    const banner = el('div','store-open-card');
    banner.appendChild(el('h3', null, status.pendingRemovals === 1 ? '1 record disappeared from your library'
      : status.pendingRemovals + ' records disappeared from your library'));
    banner.appendChild(el('p', null, 'Remove them from your crate too, or keep them there until you’re sure.'));
    const btn = el('button','cta','Confirm removal');
    btn.addEventListener('click', async ()=>{ await MizikiSocial.confirmRemovals(); renderSocialSettingsScreen(body); });
    banner.appendChild(btn);
    body.appendChild(banner);
  }
  body.appendChild(el('p','note', socialSyncStatusLine(status)));
  if(status.skipped && (status.skipped.collisions > 0 || status.skipped.noArtist > 0)){
    if(status.skipped.collisions > 0) body.appendChild(el('p','note',
      status.skipped.collisions + ' album' + (status.skipped.collisions === 1 ? '' : 's') + ' share a title with another in your library, so only one of each made it to your crate.'));
    if(status.skipped.noArtist > 0) body.appendChild(el('p','note',
      status.skipped.noArtist + ' album' + (status.skipped.noArtist === 1 ? ' has' : 's have') + ' no artist tagged, so ' +
      (status.skipped.noArtist === 1 ? 'it' : 'they') + ' can’t be shared yet.'));
  }

  const settings = MizikiSocial.getSettings();
  const spinRow = el('div','social-setting-row');
  spinRow.appendChild(el('h2', null, 'Share what you’re spinning'));
  spinRow.appendChild(storeSwitch('Share what you’re spinning', settings.shareNowSpinning,
    on => MizikiSocial.setSetting('shareNowSpinning', on)));
  body.appendChild(spinRow);
  body.appendChild(el('p','note','Friends who follow you see the album and track while you listen.'));

  const milestoneRow = el('div','social-setting-row');
  milestoneRow.appendChild(el('h2', null, 'Share rare-pressing milestones'));
  milestoneRow.appendChild(storeSwitch('Share rare-pressing milestones', settings.shareMilestones,
    on => MizikiSocial.setSetting('shareMilestones', on)));
  body.appendChild(milestoneRow);
  body.appendChild(el('p','note','Off by default. When on, hitting a rare pressing posts to your activity for friends to see.'));

  const signOutStack = el('div','stack social-stack');
  const signOutBtn = el('button','cta ghost','Sign out');
  signOutBtn.addEventListener('click', async ()=>{
    await MizikiSocial.signOut();
    S.profileView.screen = 'home';
    renderProfile();
  });
  signOutStack.appendChild(signOutBtn);
  body.appendChild(signOutStack);
}

function renderStorefrontSection(body){
  const soc = (typeof MizikiSocial === 'undefined') ? {enabled:false} : MizikiSocial.status();
  const host = el('div','store-host');
  body.appendChild(host);
  // everything a storefront needs for staff picks, ratings, notes and the
  // crate preview already lives on this device (Step A's local engine never
  // touched the network) — so the storefront shell shows up right away,
  // with only the genuinely server-shaped pieces (followers, friend
  // requests, digging from others, sharing now-spinning) gated behind a
  // configured + signed-in account. Either way this is now the WHOLE profile
  // screen, not a storefront stacked on top of a duplicate "your library"
  // section — Top Album/Achievements/Collection/Share (renderProfileExtras)
  // just continue directly below, since nothing else shows them.
  if(!soc.enabled){
    renderLocalStorefront(host);
    body.appendChild(renderProfileExtras(false));
    return;
  }
  if(soc.auth === 'ready') loadAndRenderStorefront(host);
  else renderOpenStoreCard(host, soc.auth);
  body.appendChild(renderProfileExtras(true));
}

// Local albumId -> social metadata, by way of the same pure adapter the
// vendored client builds internally — none of this touches the network.
function localStaffPicks(){
  // DB (not the repo.js interface) is what MizikiSocial.mizikiAdapter's own
  // signature expects — this is the one call site step 4c's "no DB. calls
  // outside src/storage/" leaves alone, since the adapter is social-client
  // code, not main.js's own storage access.
  const adapter = MizikiSocial.mizikiAdapter({S, DB, albumKey, trackTier, albumMetalFor});
  return MizikiSocial.getPins().map(albumId => {
    const info = adapter.albumInfo(albumId);
    if(!info) return null;
    const social = MizikiSocial.getAlbumSocial(albumId);
    return {release_id: albumId, title: info.title, artist: info.artist, quality_tier: info.tier,
      rating: social.rating, sleeve_note: social.note, pin_rank: social.pinRank};
  }).filter(Boolean);
}

function renderLocalStorefront(host){
  host.innerHTML = '';
  host.appendChild(storeAwning());
  const header = el('div','store-header');
  const avatar = el('button','store-avatar'); avatar.setAttribute('aria-label','Change your picture');
  if(S.profile.art){
    const im = document.createElement('img'); im.src = S.profile.art; im.alt = '';
    avatar.appendChild(im);
  } else {
    const label = el('div','store-avatar-label');
    label.style.background = MizikiSocial.labelColor(S.profile.username || S.profile.name || 'me');
    avatar.appendChild(label);
  }
  avatar.addEventListener('click', ()=> $('#profilePicFile').click());
  header.appendChild(avatar);

  const idBox = el('div','store-id');
  idBox.appendChild(el('div','store-kicker','CRATE'));
  const userIn = document.createElement('input');
  userIn.className = 'store-handle-input'; userIn.type = 'text'; userIn.placeholder = 'yourname'; userIn.maxLength = 30;
  userIn.setAttribute('aria-label','Your crate username');
  userIn.value = S.profile.username || '';
  userIn.addEventListener('change', ()=>{ S.profile.username = userIn.value.trim(); persistProfile(); renderLocalStorefront(host); });
  idBox.appendChild(userIn);

  const nameDisplay = el('button','store-displayname-btn', formatDisplayName(S.profile.name) || 'Add your name');
  nameDisplay.setAttribute('aria-label','Edit your name');
  const nameIn = document.createElement('input');
  nameIn.className = 'store-displayname-input'; nameIn.type = 'text'; nameIn.placeholder = 'Your name'; nameIn.maxLength = 50;
  nameIn.value = S.profile.name || ''; nameIn.style.display = 'none';
  nameDisplay.addEventListener('click', ()=>{ nameDisplay.style.display = 'none'; nameIn.style.display = ''; nameIn.focus(); });
  const commitName = ()=>{
    S.profile.name = nameIn.value.trim(); persistProfile();
    nameDisplay.textContent = formatDisplayName(S.profile.name) || 'Add your name';
    nameIn.style.display = 'none'; nameDisplay.style.display = '';
  };
  nameIn.addEventListener('blur', commitName);
  nameIn.addEventListener('keydown', e => { if(e.key === 'Enter') nameIn.blur(); });
  idBox.appendChild(nameDisplay); idBox.appendChild(nameIn);
  header.appendChild(idBox);
  host.appendChild(header);

  const stats = el('div','store-stats');
  stats.appendChild(storeStat('Records', groupBy('album').length));
  stats.appendChild(storeStat('Staff picks', MizikiSocial.getPins().length, true));
  host.appendChild(stats);

  host.appendChild(storePicksSection({staffPicks: localStaffPicks()}));
  host.appendChild(storeCrateGrid());

  host.appendChild(el('p','note','This is a local preview — connect a Miziki account to add friends, followers, and sharing.'));
}

function renderOpenStoreCard(host, authState){
  host.innerHTML = '';
  const needsProfile = authState === 'needsProfile';
  const card = el('div','store-open-card');
  card.appendChild(el('h3', null, needsProfile ? 'Finish setting up your crate' : 'Open your crate'));
  card.appendChild(el('p', null, needsProfile
    ? 'Pick a handle to start your crate — friends will find you there.'
    : 'Sign in to pin staff picks, see what friends are spinning, and share your crate.'));
  const btn = el('button','cta', needsProfile ? 'Finish setup' : 'Sign in');
  btn.addEventListener('click', beginSocialSignIn);
  card.appendChild(btn);
  host.appendChild(card);
}

function renderStoreError(host, error, retry){
  host.innerHTML = '';
  const wrap = el('div','store-error');
  // not_found covers both a genuinely nonexistent handle and a blocked
  // viewer -- these must look identical (no retry affordance either way),
  // or blocking would leak information just by comparing the two states.
  if(error && error.code === 'not_found'){
    wrap.appendChild(el('p', null, 'No such crate.'));
    host.appendChild(wrap);
    return;
  }
  const offline = error && error.code === 'offline';
  wrap.appendChild(el('p', null, offline
    ? "You're offline — your crate will load when you're back."
    : "Couldn't load your crate."));
  const btn = el('button','cta ghost','Try again');
  btn.addEventListener('click', retry);
  wrap.appendChild(btn);
  host.appendChild(wrap);
}

async function loadAndRenderStorefront(host){
  host.innerHTML = '';
  host.appendChild(el('div','store-loading','Loading your crate…'));
  const me = await MizikiSocial.getMyProfile();
  if(!me.ok){ renderStoreError(host, me.error, ()=>loadAndRenderStorefront(host)); return; }
  if(!me.profile){ renderOpenStoreCard(host, 'needsProfile'); return; }
  const [full, reqs] = await Promise.all([
    MizikiSocial.loadProfile(me.profile.handle),
    MizikiSocial.listRequests()
  ]);
  if(!full.ok){ renderStoreError(host, full.error, ()=>loadAndRenderStorefront(host)); return; }
  renderStorefront(host, full, (reqs.ok && reqs.requests) || []);
}

function storeAwning(){
  const awning = el('div','store-awning');
  for(let i = 0; i < 10; i++) awning.appendChild(el('div'));
  return awning;
}

function storeSwitch(label, checked, onToggle){
  const sw = document.createElement('button');
  sw.type = 'button'; sw.className = 'store-switch'; sw.setAttribute('role','switch');
  sw.setAttribute('aria-label', label);
  sw.setAttribute('aria-checked', String(!!checked));
  const track = el('div','store-switch-track');
  track.appendChild(document.createElement('i'));
  sw.appendChild(track);
  sw.addEventListener('click', ()=>{
    const on = sw.getAttribute('aria-checked') !== 'true';
    sw.setAttribute('aria-checked', String(on));
    onToggle(on);
  });
  return sw;
}

function storeStat(label, value, accent){
  const s = el('div','store-stat' + (accent ? ' accent' : ''));
  s.appendChild(el('b', null, String(value)));
  s.appendChild(el('span', null, label));
  return s;
}

async function cycleStoreVisibility(profile, host){
  const order = ['private','friends','public'];
  const next = order[(order.indexOf(profile.visibility) + 1) % order.length];
  const r = await MizikiSocial.updateProfile({visibility: next});
  if(r.ok) loadAndRenderStorefront(host);
}

function storeRequestsCard(requests, onChange){
  const wrap = el('div','store-requests-wrap');
  const card = el('button','store-card store-card-btn');
  card.appendChild(el('div','store-card-count', String(requests.length)));
  const text = el('div','store-card-text');
  text.appendChild(el('b', null, requests.length === 1 ? '1 person wants to browse' : requests.length + ' people want to browse'));
  text.appendChild(el('em', null, 'Review follow requests'));
  card.appendChild(text);
  card.appendChild(el('span','store-chev','›'));
  const list = el('div','store-requests-list');
  list.style.display = 'none';
  card.setAttribute('aria-expanded','false');
  card.addEventListener('click', ()=>{
    const open = list.style.display === 'none';
    list.style.display = open ? 'block' : 'none';
    card.setAttribute('aria-expanded', String(open));
  });
  requests.forEach(r => {
    const prof = r.profiles || {};
    const row = el('div','store-dig-row store-request-row');
    const rtext = el('div','store-dig-text');
    rtext.appendChild(el('b', null, prof.display_name || prof.handle || 'Someone'));
    if(prof.handle) rtext.appendChild(el('em', null, prof.handle));
    row.appendChild(rtext);
    const accept = document.createElement('button');
    accept.type = 'button'; accept.className = 'store-dig-remove'; accept.textContent = '✓';
    accept.setAttribute('aria-label','Accept follow request from ' + (prof.handle || 'this person'));
    accept.addEventListener('click', async ()=>{ await MizikiSocial.respondToRequest(r.follower_id, true); onChange(); });
    row.appendChild(accept);
    const decline = document.createElement('button');
    decline.type = 'button'; decline.className = 'store-dig-remove'; decline.textContent = '✕';
    decline.setAttribute('aria-label','Decline follow request from ' + (prof.handle || 'this person'));
    decline.addEventListener('click', async ()=>{ await MizikiSocial.respondToRequest(r.follower_id, false); onChange(); });
    row.appendChild(decline);
    list.appendChild(row);
  });
  wrap.appendChild(card);
  wrap.appendChild(list);
  return wrap;
}

function storeNowSpinningCard(full, host){
  const settings = MizikiSocial.getSettings();
  const card = el('div','store-card');
  const count = el('div','store-card-count','♪');
  card.appendChild(count);
  const text = el('div','store-card-text');
  if(full.nowSpinning && full.nowSpinning.track_title){
    const rel = full.nowSpinning.releases || {};
    text.appendChild(el('b', null, full.nowSpinning.track_title));
    text.appendChild(el('em', null, [rel.artist, rel.title].filter(Boolean).join(' · ') || 'Now spinning'));
  } else {
    text.appendChild(el('b', null, 'Nothing spinning right now'));
    text.appendChild(el('em', null, 'Shows here while you listen'));
  }
  card.appendChild(text);
  card.appendChild(storeSwitch('Share what you’re spinning', settings.shareNowSpinning,
    on => MizikiSocial.setSetting('shareNowSpinning', on)));
  return card;
}

// Staff picks are always the viewer's own records when isMe, so the art
// already sits in the local library even though it never synced to the
// server (art/audio/filenames never leave the device, per the social spec).
function localAlbumArt(title, artist){
  const ta = normKey(title), aa = normKey(artist);
  const t = S.tracks.find(x => normKey(x.tags.album) === ta && normKey(x.tags.albumArtist || x.tags.artist) === aa);
  return t ? t.art : null;
}

function storePickTile(pick){
  const tile = el('div','store-pick');
  const cover = el('div','store-pick-cover');
  const art = localAlbumArt(pick.title, pick.artist);
  if(art){ const im = document.createElement('img'); im.src = art; im.alt = ''; cover.appendChild(im); }
  cover.appendChild(el('span','store-pick-tier', STORE_TIER_LABEL[pick.quality_tier] || ''));
  tile.appendChild(cover);
  const note = el('div','store-pick-note');
  note.appendChild(el('div','store-pick-stars', pick.rating ? '★'.repeat(pick.rating) + '☆'.repeat(5 - pick.rating) : ''));
  note.appendChild(el('div','store-pick-name', pick.title));
  if(pick.sleeve_note) note.appendChild(el('div', null, pick.sleeve_note));
  tile.appendChild(note);
  return tile;
}

function storePicksSection(full){
  const section = el('div','store-section');
  const head = el('div','store-section-head');
  head.appendChild(el('h2', null, 'Staff picks'));
  section.appendChild(head);
  const row = el('div','store-picks-row');
  full.staffPicks.forEach(p => row.appendChild(storePickTile(p)));
  for(let i = full.staffPicks.length; i < 8; i++){
    const empty = el('div','store-pick-empty');
    empty.appendChild(el('span', null, 'Pin a record'));
    empty.appendChild(el('span', null, 'Slot ' + (i + 1) + ' of 8'));
    row.appendChild(empty);
  }
  section.appendChild(row);
  return section;
}

function storeDiggingSection(full, host){
  const section = el('div','store-section');
  const head = el('div','store-section-head');
  head.appendChild(el('h2', null, 'Digging list'));
  head.appendChild(storeSwitch('Show digging list on my crate', full.profile.show_digging_list !== false,
    on => MizikiSocial.updateProfile({showDiggingList: on})));
  section.appendChild(head);
  if(!full.digging.length){
    section.appendChild(el('p','store-loading','Nothing in your digging list yet.'));
    return section;
  }
  full.digging.forEach(item => {
    const row = el('div','store-dig-row');
    row.appendChild(el('div','store-dig-cover'));
    const text = el('div','store-dig-text');
    text.appendChild(el('b', null, item.title));
    text.appendChild(el('em', null, item.artist));
    text.appendChild(el('small', null, item.source_handle ? 'Spotted in @' + item.source_handle + '’s crate' : 'Added by you'));
    row.appendChild(text);
    const rm = document.createElement('button');
    rm.type = 'button'; rm.className = 'store-dig-remove'; rm.textContent = '−';
    rm.setAttribute('aria-label','Remove ' + item.title + ' from digging list');
    rm.addEventListener('click', async ()=>{ await MizikiSocial.removeFromDigging(item.release_id); loadAndRenderStorefront(host); });
    row.appendChild(rm);
    section.appendChild(row);
  });
  return section;
}

function storeCrateGrid(){
  const section = el('div','store-section');
  const head = el('div','store-section-head');
  head.appendChild(el('h2', null, 'All records'));
  section.appendChild(head);
  const albums = groupBy('album');
  if(!albums.length){
    section.appendChild(el('p','store-loading','Nothing in the crate yet.'));
    return section;
  }
  const grid = el('div','store-crate-grid');
  albums.slice(0, 60).forEach(([name, idxs]) => {
    const t = S.tracks[idxs[0]];
    const cell = el('div');
    const cover = el('div','store-crate-cover');
    if(t && t.art){ const im = document.createElement('img'); im.src = t.art; im.alt = ''; cover.appendChild(im); }
    cell.appendChild(cover);
    cell.appendChild(el('div','store-crate-name', name));
    cell.appendChild(el('div','store-crate-artist', t ? (t.tags.albumArtist || t.tags.artist || '') : ''));
    grid.appendChild(cell);
  });
  section.appendChild(grid);
  return section;
}

function renderStorefront(host, full, requests){
  host.innerHTML = '';
  host.appendChild(storeAwning());
  const header = el('div','store-header');
  const avatar = el('div','store-avatar');
  const label = el('div','store-avatar-label');
  label.style.background = full.labelColor;
  avatar.appendChild(label);
  header.appendChild(avatar);
  const idBox = el('div','store-id');
  idBox.appendChild(el('div','store-kicker','CRATE'));
  idBox.appendChild(el('h2','store-handle', full.profile.handle));
  if(full.profile.display_name) idBox.appendChild(el('div','store-displayname', full.profile.display_name));
  header.appendChild(idBox);
  const gear = el('button','store-gear','⚙');
  gear.setAttribute('aria-label','Crate settings');
  gear.addEventListener('click', ()=>{ S.profileView.screen = 'socialSettings'; renderProfile(); });
  header.appendChild(gear);
  host.appendChild(header);
  if(full.profile.bio) host.appendChild(el('p','store-bio', full.profile.bio));
  const visRow = el('div','store-vis-row');
  const visChip = el('button','store-vis-chip', STORE_VIS_LABEL[full.profile.visibility] || 'Friends only');
  visChip.setAttribute('aria-label','Change who can see your crate — currently ' + (STORE_VIS_LABEL[full.profile.visibility] || 'Friends only'));
  visChip.addEventListener('click', ()=> cycleStoreVisibility(full.profile, host));
  visRow.appendChild(visChip);
  host.appendChild(visRow);
  const stats = el('div','store-stats');
  stats.appendChild(storeStat('Records', full.summary.records));
  stats.appendChild(storeStat('Staff picks', full.summary.pins));
  stats.appendChild(storeStat('Followers', full.summary.followers || 0, true));
  stats.appendChild(storeStat('Digging', full.diggingCount || 0));
  host.appendChild(stats);
  if(requests && requests.length) host.appendChild(storeRequestsCard(requests, ()=> loadAndRenderStorefront(host)));
  host.appendChild(storeNowSpinningCard(full, host));
  host.appendChild(storePicksSection(full));
  if(full.diggingShared) host.appendChild(storeDiggingSection(full, host));
  host.appendChild(storeCrateGrid());
}

/* ================= Social Step D: friend store, locked state, record sheet, home feed ================= */

let socialNav = [];

function pushSocialScreen(screen){
  socialNav.push(screen);
  $('#socialNavOverlay').classList.add('open');
  $('#socialNavOverlay').setAttribute('aria-hidden','false');
  renderSocialNavTop();
}
function popSocialScreen(){
  socialNav.pop();
  if(!socialNav.length){ closeSocialNav(); return; }
  renderSocialNavTop();
}
function closeSocialNav(){
  socialNav = [];
  $('#socialNavOverlay').classList.remove('open');
  $('#socialNavOverlay').setAttribute('aria-hidden','true');
}
function renderSocialNavTop(){
  const top = socialNav[socialNav.length - 1];
  const body = $('#socialNavBody'); body.innerHTML = '';
  if(top.type === 'friendStore'){
    $('#socialNavTitle').textContent = 'Browsing crate';
    loadAndRenderFriendStore(body, top.handle);
  }
}
function openFriendStore(handle){
  pushSocialScreen({type:'friendStore', handle: String(handle || '').replace(/^@/, '')});
}

async function loadAndRenderFriendStore(body, handle){
  body.innerHTML = '';
  body.appendChild(el('p','store-loading','Loading crate…'));
  const full = await MizikiSocial.loadProfile(handle);
  if(!full.ok){ renderStoreError(body, full.error, ()=>loadAndRenderFriendStore(body, handle)); return; }
  $('#socialNavTitle').textContent = 'Browsing crate';
  body.innerHTML = '';
  if(!full.canView){ renderLockedFriendStore(body, full); return; }
  renderFriendStoreContent(body, full);
}

function friendStoreHeader(full, extraBtn){
  const header = el('div','store-header');
  const avatar = el('div','store-avatar');
  const label = el('div','store-avatar-label'); label.style.background = full.labelColor;
  avatar.appendChild(label);
  header.appendChild(avatar);
  const idBox = el('div','store-id');
  idBox.appendChild(el('div','store-kicker','CRATE'));
  idBox.appendChild(el('h2','store-handle', full.profile.handle));
  if(full.profile.display_name) idBox.appendChild(el('div','store-displayname', full.profile.display_name));
  header.appendChild(idBox);
  if(extraBtn) header.appendChild(extraBtn);
  return header;
}

function renderLockedFriendStore(body, full){
  body.appendChild(storeAwning());
  body.appendChild(friendStoreHeader(full));
  if(full.profile.bio) body.appendChild(el('p','store-bio', full.profile.bio));

  const row = el('div','store-follow-row');
  const pending = full.relationship.following === 'pending';
  const btn = el('button','store-follow-btn' + (pending ? ' pending' : ''), pending ? 'Requested' : 'Request to follow');
  if(pending) btn.disabled = true;
  else btn.addEventListener('click', async ()=>{
    btn.disabled = true; btn.textContent = 'Requesting…';
    const r = await MizikiSocial.follow(full.profile.id);
    if(r.ok && r.status === 'accepted'){ loadAndRenderFriendStore(body, full.profile.handle); return; }
    btn.textContent = 'Requested'; btn.classList.add('pending');
  });
  row.appendChild(btn);
  body.appendChild(row);

  const card = el('div','store-locked-card');
  card.appendChild(el('h3', null, 'Crate is friends-only'));
  card.appendChild(el('p', null, 'Closed until ' + full.profile.handle + ' approves your request.'));
  body.appendChild(card);
  const grid = el('div','store-locked-grid');
  for(let i = 0; i < 9; i++) grid.appendChild(el('div','store-locked-slot'));
  body.appendChild(grid);
  body.appendChild(el('p','store-locked-note','Nothing on the shelves until you’re in.'));
}

async function shareFriendStore(handle){
  const text = 'Check out @' + handle + '’s crate on Miziki.';
  if(navigator.share){ try{ await navigator.share({text}); } catch(e){ /* user cancelled */ } }
  else if(navigator.clipboard){ try{ await navigator.clipboard.writeText(text); } catch(e){ /* best effort */ } }
}

function friendNowSpinningRow(full){
  const card = el('div','store-card');
  card.appendChild(el('div','store-card-count','♪'));
  const text = el('div','store-card-text');
  if(full.nowSpinning && full.nowSpinning.track_title){
    const rel = full.nowSpinning.releases || {};
    text.appendChild(el('b', null, full.nowSpinning.track_title));
    text.appendChild(el('em', null, [rel.artist, rel.title].filter(Boolean).join(' · ')));
    card.appendChild(text);
    if(full.nowSpinning.started_at) card.appendChild(el('span','store-spin-ago',
      timeAgoShort(Date.now() - new Date(full.nowSpinning.started_at).getTime())));
  } else {
    text.appendChild(el('b', null, 'Nothing spinning right now'));
    card.appendChild(text);
  }
  return card;
}

function friendPicksSection(full){
  const section = el('div','store-section');
  const head = el('div','store-section-head'); head.appendChild(el('h2', null, 'Staff picks'));
  section.appendChild(head);
  const row = el('div','store-picks-row');
  full.staffPicks.forEach((p, i) => {
    const tile = storePickTile(p);
    tile.style.cursor = 'pointer';
    tile.addEventListener('click', ()=> openRecordSheet(full, p,
      full.profile.handle.toUpperCase() + ' · STAFF PICK ' + (p.pin_rank || i + 1) + ' OF ' + full.staffPicks.length));
    row.appendChild(tile);
  });
  section.appendChild(row);
  if(full.staffPicks.length > 1){
    const dots = el('div','store-picks-dots');
    full.staffPicks.forEach((_, i) => dots.appendChild(el('span', i === 0 ? 'on' : null)));
    section.appendChild(dots);
    let raf = null;
    row.addEventListener('scroll', ()=>{
      if(raf) return;
      raf = requestAnimationFrame(()=>{
        raf = null;
        const w = row.firstChild ? row.firstChild.getBoundingClientRect().width + 12 : 1;
        const idx = Math.max(0, Math.min(full.staffPicks.length - 1, Math.round(row.scrollLeft / w)));
        Array.from(dots.children).forEach((d, i) => d.classList.toggle('on', i === idx));
      });
    });
  }
  return section;
}

function friendFreshSection(full){
  const section = el('div','store-section');
  const head = el('div','store-section-head'); head.appendChild(el('h2', null, 'Fresh for you'));
  section.appendChild(head);
  full.fresh.forEach(item => {
    const row = el('div','store-fresh-row');
    const text = el('div','store-fresh-text');
    text.appendChild(el('b', null, item.title));
    text.appendChild(el('em', null, item.artist));
    row.appendChild(text);
    const add = document.createElement('button');
    add.type = 'button'; add.className = 'store-fresh-add' + (item.in_digging ? ' added' : '');
    add.textContent = item.in_digging ? '✓' : '+';
    if(item.in_digging) add.disabled = true;
    add.setAttribute('aria-label','Add ' + item.title + ' to your digging list');
    add.addEventListener('click', async e => {
      e.stopPropagation();
      add.disabled = true; add.classList.add('added'); add.textContent = '✓';
      await MizikiSocial.addToDigging(item.release_id, full.profile.id);
    });
    row.appendChild(add);
    row.style.cursor = 'pointer';
    row.addEventListener('click', ()=> openRecordSheet(full, item, full.profile.handle.toUpperCase() + ' · FRESH FOR YOU'));
    section.appendChild(row);
  });
  return section;
}

function friendDiggingPreview(full){
  const section = el('div','store-section');
  const head = el('div','store-section-head'); head.appendChild(el('h2', null, 'Digging list'));
  section.appendChild(head);
  full.digging.forEach(item => {
    const row = el('div','store-dig-row');
    row.appendChild(el('div','store-dig-cover'));
    const text = el('div','store-dig-text');
    text.appendChild(el('b', null, item.title));
    text.appendChild(el('em', null, item.artist));
    row.appendChild(text);
    if(!item.in_my_digging && !item.in_my_crate){
      const add = document.createElement('button');
      add.type = 'button'; add.className = 'store-fresh-add'; add.textContent = '+';
      add.setAttribute('aria-label','Add ' + item.title + ' to your digging list');
      add.addEventListener('click', async ()=>{
        add.disabled = true; add.classList.add('added'); add.textContent = '✓';
        await MizikiSocial.addToDigging(item.release_id, full.profile.id);
      });
      row.appendChild(add);
    }
    section.appendChild(row);
  });
  return section;
}

async function loadFriendCrate(full, holder, limit){
  const r = await MizikiSocial.crate(full.profile.id, {offset: 0, limit});
  holder.innerHTML = '';
  if(!r.ok || !r.items.length){
    holder.appendChild(el('p','store-loading','Nothing in the crate yet.'));
    return;
  }
  const letters = [];
  const grid = el('div','store-crate-grid');
  let lastLetter = null;
  r.items.forEach(item => {
    const letter = (item.artist || '#').trim().charAt(0).toUpperCase();
    if(letter !== lastLetter){
      lastLetter = letter;
      letters.push(letter);
      grid.appendChild(el('div','store-crate-letter-head', letter));
    }
    const cell = document.createElement('button');
    cell.type = 'button'; cell.className = 'store-crate-cell';
    const art = localAlbumArt(item.title, item.artist);
    const cover = el('div','store-crate-cover');
    if(art){ const im = document.createElement('img'); im.src = art; im.alt = ''; cover.appendChild(im); }
    cell.appendChild(cover);
    cell.appendChild(el('div','store-crate-name', item.title));
    cell.appendChild(el('div','store-crate-artist', item.artist));
    cell.addEventListener('click', ()=> openRecordSheet(full, item, full.profile.handle.toUpperCase() + ' · CRATE'));
    grid.appendChild(cell);
  });
  if(letters.length > 1){
    const bar = el('div','store-letter-bar');
    const heads = Array.from(grid.querySelectorAll('.store-crate-letter-head'));
    letters.forEach(l => {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'store-letter-btn'; b.textContent = l;
      b.addEventListener('click', ()=>{
        const target = heads.find(h => h.textContent === l);
        if(target) target.scrollIntoView({block:'start'});
      });
      bar.appendChild(b);
    });
    holder.appendChild(bar);
  }
  holder.appendChild(grid);
  if(r.items.length < full.summary.records && limit < full.summary.records){
    const more = el('button','cta ghost','Browse all ' + full.summary.records + ' records');
    more.style.cssText = 'width:100%;margin-top:14px;box-sizing:border-box';
    more.addEventListener('click', ()=> loadFriendCrate(full, holder, Math.min(full.summary.records, 200)));
    holder.appendChild(more);
  }
}

function friendCrateSection(full){
  const section = el('div','store-section');
  const head = el('div','store-section-head'); head.appendChild(el('h2', null, 'All records'));
  section.appendChild(head);
  const holder = el('div');
  holder.appendChild(el('p','store-loading','Loading crate…'));
  section.appendChild(holder);
  loadFriendCrate(full, holder, 60);
  return section;
}

function friendActivitySection(full){
  const section = el('div','store-section');
  const head = el('div','store-section-head'); head.appendChild(el('h2', null, 'Recently at the counter'));
  section.appendChild(head);
  const holder = el('div');
  holder.appendChild(el('p','store-loading','Loading…'));
  section.appendChild(holder);
  MizikiSocial.homeFeed({limit:50}).then(r => {
    holder.innerHTML = '';
    const mine = (r.ok ? r.events : []).filter(e => e.actor_id === full.profile.id).slice(0, 5);
    if(!mine.length){ holder.appendChild(el('p','store-loading','Nothing recent.')); return; }
    mine.forEach(e => holder.appendChild(el('div','store-activity-row', feedEventText(e))));
  });
  return section;
}

function renderFriendStoreContent(body, full){
  body.appendChild(storeAwning());
  const share = el('button','store-share-icon','↗');
  share.setAttribute('aria-label','Share this crate');
  share.addEventListener('click', ()=> shareFriendStore(full.profile.handle));
  body.appendChild(friendStoreHeader(full, share));
  if(full.profile.bio) body.appendChild(el('p','store-bio', full.profile.bio));

  const row = el('div','store-follow-row');
  const isFollowing = full.relationship.following === 'accepted';
  const btn = el('button','store-follow-btn' + (isFollowing ? ' following' : ''), isFollowing ? 'Following' : 'Follow');
  btn.addEventListener('click', async ()=>{
    btn.disabled = true;
    if(isFollowing) await MizikiSocial.unfollow(full.profile.id);
    else await MizikiSocial.follow(full.profile.id);
    loadAndRenderFriendStore(body, full.profile.handle);
  });
  row.appendChild(btn);
  body.appendChild(row);

  const stats = el('div','store-stats');
  stats.appendChild(storeStat('Records', full.summary.records));
  stats.appendChild(storeStat('Staff picks', full.summary.pins));
  stats.appendChild(storeStat('In common', full.summary.in_common || 0, true));
  body.appendChild(stats);

  body.appendChild(friendNowSpinningRow(full));
  if(full.staffPicks.length) body.appendChild(friendPicksSection(full));
  if(full.fresh && full.fresh.length) body.appendChild(friendFreshSection(full));
  if(full.diggingShared && full.digging.length) body.appendChild(friendDiggingPreview(full));
  body.appendChild(friendCrateSection(full));
  body.appendChild(friendActivitySection(full));
}

/* ---- record sheet (frame 04) ---- */
function openRecordSheet(full, item, kicker){
  $('#recordSheetKicker').textContent = kicker || full.profile.handle.toUpperCase();
  renderRecordSheetBody(full, item);
  $('#recordSheetOverlay').classList.add('open');
  $('#recordSheetOverlay').setAttribute('aria-hidden','false');
}
function closeRecordSheet(){
  $('#recordSheetOverlay').classList.remove('open');
  $('#recordSheetOverlay').setAttribute('aria-hidden','true');
}

function renderRecordSheetBody(full, item){
  const body = $('#recordSheetBody'); body.innerHTML = '';
  const cover = el('div','record-cover');
  const art = localAlbumArt(item.title, item.artist);
  if(art){ const im = document.createElement('img'); im.src = art; im.alt = ''; cover.appendChild(im); }
  body.appendChild(cover);
  body.appendChild(el('h3','record-title', item.title));
  body.appendChild(el('p','record-artist', [item.artist, item.year].filter(Boolean).join(' · ')));
  if(item.quality_tier){
    const chips = el('div','record-chips');
    chips.appendChild(el('span','record-chip', STORE_TIER_LABEL[item.quality_tier] || ''));
    body.appendChild(chips);
  }
  if(item.rating){
    body.appendChild(el('div','record-rating-label', full.profile.handle + '’s rating'));
    body.appendChild(el('div','record-stars', '★'.repeat(item.rating) + '☆'.repeat(5 - item.rating)));
  }
  if(item.sleeve_note) body.appendChild(el('div','record-note', item.sleeve_note));
  const owned = 'in_my_crate' in item ? item.in_my_crate : false;
  const inDigging = 'in_my_digging' in item ? item.in_my_digging : false;
  body.appendChild(el('p','record-owned', owned ? 'Already in your crate.' : 'Not in your crate yet.'));
  const stack = el('div','stack social-stack');
  if(!owned){
    const addBtn = el('button','cta', inDigging ? 'In your digging list' : 'Add to digging list');
    if(inDigging) addBtn.disabled = true;
    addBtn.addEventListener('click', async ()=>{
      addBtn.disabled = true; addBtn.textContent = 'Added to digging list';
      await MizikiSocial.addToDigging(item.release_id, full.profile.id);
    });
    stack.appendChild(addBtn);
  }
  const listen = el('button','cta ghost','Listen elsewhere ↗');
  listen.addEventListener('click', ()=>{
    const q = encodeURIComponent([item.artist, item.title].filter(Boolean).join(' '));
    window.open('https://www.google.com/search?q=' + q, '_blank', 'noopener');
  });
  stack.appendChild(listen);
  body.appendChild(stack);
}

/* ---- Home tab: feed, people search, now-spinning, follow requests ---- */
function feedEventText(e){
  const title = e.title || 'a record';
  if(e.type === 'added'){
    const n = (e.payload && e.payload.count) || 1;
    return n > 1 ? ('added ' + n + ' records') : ('added ' + title);
  }
  if(e.type === 'pinned') return 'pinned ' + title + ' to staff picks';
  if(e.type === 'review'){
    const p = e.payload || {};
    if(p.rating) return 'rated ' + title + ' ' + '★'.repeat(p.rating);
    return 'wrote a sleeve note on ' + title;
  }
  if(e.type === 'unlock') return 'unlocked a ' + ((e.payload && e.payload.variant) || 'rare') + ' pressing of ' + title;
  return 'updated ' + title;
}

function groupFeedEvents(events){
  const groups = [];
  events.forEach(e => {
    const last = groups[groups.length - 1];
    if(last && last.actor_id === e.actor_id) last.events.push(e);
    else groups.push({actor_id: e.actor_id, actor_handle: e.actor_handle, actor_name: e.actor_name, events: [e]});
  });
  return groups;
}

function homeFeedGroupCard(group){
  const card = el('div','store-card');
  card.style.cssText = 'flex-direction:column;align-items:stretch;cursor:pointer';
  const head = el('div','store-card-text');
  head.appendChild(el('b', null, group.actor_name || group.actor_handle));
  head.style.marginBottom = '6px';
  card.appendChild(head);
  const shown = group.events.slice(0, 3);
  shown.forEach(e => card.appendChild(el('div','store-activity-row', feedEventText(e))));
  if(group.events.length > shown.length){
    const more = el('div','store-activity-row', '+' + (group.events.length - shown.length) + ' more');
    more.style.color = 'var(--accent)';
    card.appendChild(more);
  }
  card.addEventListener('click', ()=> openFriendStore(group.actor_handle));
  return card;
}

function homePeopleSearch(container){
  const row = el('div','slider-row');
  const input = el('input','pl-input');
  input.type = 'search'; input.placeholder = 'Find people by handle';
  input.setAttribute('aria-label','Find people by handle');
  row.appendChild(input);
  container.appendChild(row);
  const results = el('div');
  container.appendChild(results);
  let seq = 0, timer = null;
  input.addEventListener('input', ()=>{
    clearTimeout(timer);
    const q = input.value.trim();
    timer = setTimeout(async ()=>{
      results.innerHTML = '';
      if(q.length < 2) return;
      const mySeq = ++seq;
      const r = await MizikiSocial.searchProfiles(q);
      if(mySeq !== seq || !r.ok) return;
      r.profiles.forEach(p => {
        const btn = el('button','store-card-btn store-card');
        const count = el('div','store-card-count');
        count.style.background = MizikiSocial.labelColor(p.handle);
        btn.appendChild(count);
        const text = el('div','store-card-text');
        text.appendChild(el('b', null, p.display_name || p.handle));
        text.appendChild(el('em', null, p.handle));
        btn.appendChild(text);
        btn.addEventListener('click', ()=> openFriendStore(p.handle));
        results.appendChild(btn);
      });
    }, 300);
  });
}

const homeSpinState = new Map();
let homeSpinUnsub = null;
let homeFollowingHandles = new Map();

function homeNowSpinningRow(container){
  const section = el('div');
  section.id = 'homeSpinSection';
  section.style.display = 'none';
  const head = el('div','store-section-head'); head.appendChild(el('h2', null, 'Now spinning'));
  section.appendChild(head);
  const row = el('div','store-picks-row');
  row.id = 'homeSpinRow';
  section.appendChild(row);
  container.appendChild(section);
  paintHomeSpinRow();
  if(homeSpinUnsub) homeSpinUnsub();
  homeSpinUnsub = MizikiSocial.subscribeNowSpinning(evt => {
    if(evt.type === 'stopped') homeSpinState.delete(evt.userId);
    else homeSpinState.set(evt.userId, evt);
    paintHomeSpinRow();
  });
}
function paintHomeSpinRow(){
  const section = $('#homeSpinSection'); if(!section) return;
  const row = $('#homeSpinRow'); row.innerHTML = '';
  const entries = [...homeSpinState.values()];
  section.style.display = entries.length ? '' : 'none';
  entries.forEach(evt => {
    const tile = el('div','store-pick');
    const cover = el('div','store-pick-cover');
    cover.style.cssText += 'display:flex;align-items:center;justify-content:center;font-family:var(--data);font-size:11px;color:var(--accent)';
    cover.textContent = '♪ SPINNING';
    tile.appendChild(cover);
    const note = el('div','store-pick-note');
    note.appendChild(el('div','store-pick-name', (evt.release && evt.release.title) || evt.track || 'Now spinning'));
    note.appendChild(el('div', null, (evt.release && evt.release.artist) || ''));
    tile.appendChild(note);
    const handle = homeFollowingHandles.get(evt.userId);
    if(handle){
      tile.style.cursor = 'pointer';
      tile.addEventListener('click', ()=> openFriendStore(handle));
    }
    row.appendChild(tile);
  });
}

async function renderHome(){
  const container = $('#homeBody');
  container.innerHTML = '';
  const status = MizikiSocial.status();
  if(status.auth !== 'ready'){
    renderOpenStoreCard(container, status.auth);
    return;
  }
  homePeopleSearch(container);

  const [reqs, following] = await Promise.all([MizikiSocial.listRequests(), MizikiSocial.listFollowing()]);
  if(reqs.ok && reqs.requests.length){
    container.appendChild(storeRequestsCard(reqs.requests, renderHome));
  }
  homeFollowingHandles = new Map();
  if(following.ok) following.following.forEach(f => {
    if(f.status === 'accepted' && f.profiles) homeFollowingHandles.set(f.followee_id, f.profiles.handle);
  });

  homeNowSpinningRow(container);

  const feedSection = el('div','store-section');
  feedSection.appendChild(el('div','store-section-head')).appendChild(el('h2', null, 'Activity'));
  const feedHolder = el('div');
  feedHolder.appendChild(el('p','store-loading','Loading…'));
  feedSection.appendChild(feedHolder);
  container.appendChild(feedSection);
  const feed = await MizikiSocial.homeFeed({limit:50});
  feedHolder.innerHTML = '';
  if(!feed.ok || !feed.events.length){
    feedHolder.appendChild(el('p','store-loading','Nothing yet — follow some friends to see what they’re up to.'));
    return;
  }
  groupFeedEvents(feed.events).forEach(g => feedHolder.appendChild(homeFeedGroupCard(g)));
}

/* ================= Social Step E: demo mode (?social=demo, dev only) =================
   Local ratings/notes/pins/settings (setRating, pin, getAlbumSocial, getSettings, ...)
   already work with no server at all -- they only ever touch X.state, never guarded()
   or the network. So this doesn't reimplement the whole client: it leaves MizikiSocial.init()
   running in its normal inert mode (no url/anonKey, local engine still loads/saves via
   IndexedDB) and monkey-patches only the server-shaped calls (auth, profiles, follows,
   reading someone else's crate/feed/digging, now-spinning) with in-memory fixtures. This
   is reachable only behind the query flag below and is never wired into a real build. */
function installSocialDemo(){
  // see the same note on DB in localStaffPicks() above — mizikiAdapter's
  // own signature expects DB, not the repo.js interface.
  const adapter = MizikiSocial.mizikiAdapter({S, DB, albumKey, trackTier, albumMetalFor});
  const me = { handle:'', display_name:'', bio:'', visibility:'friends', show_digging_list:true };
  let auth = 'signedOut';
  const settings = { shareNowSpinning:false, shareMilestones:false, syncEnabled:true };
  const followState = new Map([['june','accepted'], ['mateo','none'], ['amy','pending'], ['nora','accepted'], ['theo','accepted']]);
  let incomingRequests = [{follower_id:'zed', created_at:new Date().toISOString(), profiles:{handle:'zed', display_name:'Zed'}}];
  const takenHandles = ['june','mateo','amy','nora','theo','zed'];
  const longWords = n => Array(n).fill('word').join(' ');

  const juneArtists = ['John Coltrane','Miles Davis','Herbie Hancock','Wayne Shorter','Art Blakey','Nina Simone','Pharoah Sanders','Alice Coltrane','McCoy Tyner','Sun Ra'];
  const juneCrate = [];
  for(let i = 0; i < 420; i++){
    const artist = juneArtists[i % juneArtists.length];
    juneCrate.push({release_id:'june-r' + i, title: artist + ' Session ' + i, artist, year: 1960 + (i % 40),
      quality_tier: 1 + (i % 3), rating: i % 7 === 0 ? 1 + (i % 5) : null, sleeve_note: null, pin_rank: null});
  }
  juneCrate.sort((a, b) => a.artist.localeCompare(b.artist));

  const FRIENDS = {
    june: {
      profile: {id:'june', handle:'june', display_name:'June Okafor', bio:'Jazz & soul digger. Mostly vinyl, some cassette.', visibility:'public', show_digging_list:true},
      staffPicks: [
        {release_id:'june-r0', title:'Blue Train', artist:'John Coltrane', quality_tier:3, rating:5, sleeve_note:'Side A on repeat this whole month, genuinely cannot stop.', pin_rank:1},
        {release_id:'june-r1', title:'A Supremely Long Album Title That Should Wrap Onto Several Lines Without Ever Breaking The Layout', artist:'An Artist With An Unusually Long Name, For Testing Purposes Only', quality_tier:2, rating:4, sleeve_note: longWords(30), pin_rank:2},
        {release_id:'june-r2', title:'Head Hunters', artist:'Herbie Hancock', quality_tier:2, rating:4, sleeve_note:null, pin_rank:3}
      ],
      crate: juneCrate,
      fresh: [
        {release_id:'june-f1', title:'Maiden Voyage', artist:'Herbie Hancock', rating:5, quality_tier:2, in_digging:false},
        {release_id:'june-f2', title:'The Köln Concert', artist:'Keith Jarrett', rating:4, quality_tier:3, in_digging:false}
      ],
      digging: [{release_id:'june-d1', title:'Water from an Ancient Well', artist:'Randy Weston', in_my_digging:false, in_my_crate:false}],
      nowSpinning: null
    },
    mateo: {
      profile: {id:'mateo', handle:'mateo', display_name:'Mateo', bio:'Vinyl hoarder, no apologies.', visibility:'friends', show_digging_list:true},
      staffPicks: [], crate: [], fresh: [], digging: [], nowSpinning: null
    },
    amy: {
      profile: {id:'amy', handle:'amy', display_name:'Amy', bio:'New to collecting, loving it so far.', visibility:'friends', show_digging_list:true},
      staffPicks: [], crate: [], fresh: [], digging: [], nowSpinning: null
    },
    nora: {
      // empty state: public (so it's viewable), but nothing in it yet
      profile: {id:'nora', handle:'nora', display_name:'Nora', bio:'', visibility:'public', show_digging_list:true},
      staffPicks: [], crate: [], fresh: [], digging: [], nowSpinning: null
    },
    theo: {
      // digging list off: section should be absent entirely, not just empty
      profile: {id:'theo', handle:'theo', display_name:'Theo', bio:'Keeps the digging list to myself.', visibility:'public', show_digging_list:false},
      staffPicks: [{release_id:'theo-r0', title:'Moon Rock', artist:'Com Truise', quality_tier:2, rating:4, sleeve_note:null, pin_rank:1}],
      crate: [{release_id:'theo-r0', title:'Moon Rock', artist:'Com Truise', year:2015, quality_tier:2, rating:4, sleeve_note:null, pin_rank:1}],
      fresh: [], digging: [], nowSpinning: null
    }
  };
  function friendByHandle(h){ return FRIENDS[h]; }
  function friendById(id){ return Object.values(FRIENDS).find(f => f.profile.id === id); }
  function relationshipFor(handle){ return {following: followState.get(handle) || 'none', followsYou: handle === 'june'}; }

  MizikiSocial.status = () => ({enabled:true, auth, sync:'idle', pendingRemovals:0,
    skipped:{noArtist:0, collisions:0}, lastSyncedAt: auth === 'ready' ? Date.now() - 60000 : null, lastError:null});
  MizikiSocial.getSettings = () => ({...settings});
  MizikiSocial.setSetting = (k, v) => { settings[k] = !!v; return true; };

  MizikiSocial.sendCode = async () => ({ok:true});
  MizikiSocial.verifyCode = async (email, code) => {
    if(String(code || '').trim() !== '123456')
      return {ok:false, error:{code:'bad_code', message:'Enter the code from the email (demo code is 123456).', retryable:false}};
    auth = me.handle ? 'ready' : 'needsProfile';
    return {ok:true, status: MizikiSocial.status()};
  };
  MizikiSocial.checkHandle = async h => {
    if(!/^[a-z0-9_]{3,24}$/.test(h)) return {ok:true, available:false, reason:'format'};
    return {ok:true, available: !takenHandles.includes(h)};
  };
  MizikiSocial.createProfile = async ({handle, displayName}) => {
    me.handle = handle; me.display_name = displayName || null; auth = 'ready';
    return {ok:true, profile:{...me, id:'me'}};
  };
  MizikiSocial.updateProfile = async patch => {
    if('displayName' in patch) me.display_name = patch.displayName;
    if('bio' in patch) me.bio = patch.bio;
    if('visibility' in patch) me.visibility = patch.visibility;
    if('showDiggingList' in patch) me.show_digging_list = patch.showDiggingList;
    return {ok:true, profile:{...me, id:'me'}};
  };
  MizikiSocial.getMyProfile = async () => ({ok:true, profile: me.handle ? {...me, id:'me'} : null});
  MizikiSocial.signOut = async () => { auth = 'signedOut'; return {ok:true}; };

  MizikiSocial.loadProfile = async handleRaw => {
    const handle = String(handleRaw || '').replace(/^@/, '').toLowerCase();
    if(handle === me.handle){
      const pins = MizikiSocial.getPins();
      return {
        ok:true, profile:{...me, id:'me'}, relationship:{following:'self', followsYou:false}, isMe:true, canView:true,
        labelColor: MizikiSocial.labelColor('me:' + me.handle),
        summary: {records: groupBy('album').length, pins: pins.length, in_common:0,
          followers:2, following:[...followState.values()].filter(s => s === 'accepted').length},
        staffPicks: pins.map(albumId => {
          const info = adapter.albumInfo(albumId); if(!info) return null;
          const social = MizikiSocial.getAlbumSocial(albumId);
          return {release_id: albumId, title: info.title, artist: info.artist, quality_tier: info.tier,
            rating: social.rating, sleeve_note: social.note, pin_rank: social.pinRank};
        }).filter(Boolean),
        nowSpinning: null, fresh: [], diggingShared: me.show_digging_list !== false, digging: [], diggingCount: 0
      };
    }
    if(handle === 'offline') return {ok:false, error:{code:'offline', message:'You appear to be offline.', retryable:true}};
    if(handle === 'broken') return {ok:false, error:{code:'error', message:'Something went wrong loading this crate.', retryable:false}};
    if(handle === 'ghost') return {ok:false, error:{code:'not_found', message:'No such crate.', retryable:false}};
    const f = friendByHandle(handle);
    if(!f) return {ok:false, error:{code:'not_found', message:'No such crate.', retryable:false}};
    const rel = relationshipFor(handle);
    const canView = f.profile.visibility === 'public' || rel.following === 'accepted';
    const out = {ok:true, profile:f.profile, relationship:rel, isMe:false, canView, labelColor: MizikiSocial.labelColor(f.profile.handle)};
    if(!canView) return out;
    out.summary = {records: f.crate.length, pins: f.staffPicks.length, in_common: Math.min(f.crate.length, 7)};
    out.staffPicks = f.staffPicks;
    out.nowSpinning = f.nowSpinning;
    out.fresh = f.fresh;
    out.diggingShared = f.profile.show_digging_list !== false;
    out.digging = out.diggingShared ? f.digging : [];
    out.diggingCount = out.digging.length;
    return out;
  };

  MizikiSocial.crate = async (userId, opts) => {
    const f = friendById(userId); if(!f) return {ok:true, items:[]};
    const offset = (opts && opts.offset) || 0, limit = (opts && opts.limit) || 60;
    return {ok:true, items: f.crate.slice(offset, offset + limit)};
  };
  MizikiSocial.inCommon = async () => ({ok:true, items:[]});
  MizikiSocial.addToDigging = async (releaseId, sourceUserId) => {
    const f = friendById(sourceUserId);
    if(f){
      const item = [...f.crate, ...f.digging, ...f.fresh, ...f.staffPicks].find(x => x.release_id === releaseId);
      if(item) item.in_digging = true;
    }
    return {ok:true};
  };
  MizikiSocial.removeFromDigging = async () => ({ok:true});
  MizikiSocial.listDigging = async () => ({ok:true, items:[]});
  MizikiSocial.diggingOf = async () => ({ok:true, items:[]});

  MizikiSocial.searchProfiles = async q => {
    const t = String(q || '').trim().toLowerCase().replace(/^@/, '');
    if(t.length < 2) return {ok:true, profiles:[]};
    return {ok:true, profiles: Object.values(FRIENDS).map(f => f.profile).filter(p => p.handle.startsWith(t))
      .map(p => ({id:p.id, handle:p.handle, display_name:p.display_name, visibility:p.visibility}))};
  };
  MizikiSocial.follow = async userId => {
    const f = friendById(userId); if(!f) return {ok:true, status:'exists'};
    const status = f.profile.visibility === 'public' ? 'accepted' : 'pending';
    followState.set(f.profile.handle, status);
    return {ok:true, status};
  };
  MizikiSocial.unfollow = async userId => {
    const f = friendById(userId); if(f) followState.set(f.profile.handle, 'none');
    return {ok:true};
  };
  MizikiSocial.respondToRequest = async followerId => {
    incomingRequests = incomingRequests.filter(r => r.follower_id !== followerId);
    return {ok:true};
  };
  MizikiSocial.removeFollower = id => MizikiSocial.respondToRequest(id);
  MizikiSocial.listRequests = async () => ({ok:true, requests: incomingRequests});
  MizikiSocial.listFollowing = async () => ({ok:true, following: [...followState.entries()].map(([handle, status]) => ({
    followee_id: FRIENDS[handle].profile.id, status, profiles: {handle, display_name: FRIENDS[handle].profile.display_name}}))});
  MizikiSocial.block = async () => ({ok:true});
  MizikiSocial.unblock = async () => ({ok:true});
  MizikiSocial.report = async () => ({ok:true});

  MizikiSocial.subscribeNowSpinning = cb => {
    const timer = setTimeout(()=> cb({type:'spinning', userId:'june', track:'So What',
      expiresAt: new Date(Date.now() + 600000).toISOString(),
      release:{id:'june-r0', title:'Kind of Blue', artist:'Miles Davis'}}), 2500);
    return () => clearTimeout(timer);
  };
  MizikiSocial.homeFeed = async () => ({ok:true, events: [
    {id:1, actor_id:'june', actor_handle:'june', actor_name:'June Okafor', type:'pinned', release_id:'june-r0', title:'Blue Train', artist:'John Coltrane', payload:{}, created_at:new Date(Date.now() - 3600e3).toISOString()},
    {id:2, actor_id:'june', actor_handle:'june', actor_name:'June Okafor', type:'review', release_id:'june-r2', title:'Head Hunters', artist:'Herbie Hancock', payload:{rating:4}, created_at:new Date(Date.now() - 3700e3).toISOString()},
    {id:3, actor_id:'theo', actor_handle:'theo', actor_name:'Theo', type:'added', release_id:null, title:null, artist:null, payload:{count:5}, created_at:new Date(Date.now() - 7200e3).toISOString()},
    {id:4, actor_id:'nora', actor_handle:'nora', actor_name:'Nora', type:'unlock', release_id:'nora-r0', title:'Some Record', artist:'Some Artist', payload:{variant:'splatter'}, created_at:new Date(Date.now() - 10000e3).toISOString()}
  ]});

  MizikiSocial.syncNow = async () => ({ok:true, pushed:0, removed:0, held:0, stats:0, firstSync:false});
  MizikiSocial.confirmRemovals = async () => ({ok:true});
  MizikiSocial.nowSpinning = () => {};
  MizikiSocial.nowSpinningPaused = () => {};
  MizikiSocial.stopSpinning = () => {};

  $('#homeTabBtn').style.display = '';
  console.info('[Miziki] social demo mode active — fixture data only, for UI development.');
}

export function renderProfile(){
  const crumb = $('#profileCrumb');
  const screen = S.profileView.screen;
  const labels = {topAlbums:'Top Albums', topSongs:'Top Songs', collection:'Collection', socialSettings:'Settings'};
  crumb.style.display = screen === 'home' ? 'none' : 'flex';
  if(screen !== 'home'){
    crumb.innerHTML = '';
    const back = el('button','crumb-back','‹ Back');
    back.addEventListener('click', ()=>{ S.profileView.screen = 'home'; renderProfile(); });
    crumb.appendChild(back);
    crumb.appendChild(el('span','crumb-label', labels[screen] || ''));
  }
  const body = $('#profileBody'); body.innerHTML = '';
  if(screen === 'topAlbums') renderTopAlbumsScreen(body);
  else if(screen === 'topSongs') renderTopSongsScreen(body);
  else if(screen === 'collection') renderCollectionScreen(body);
  else if(screen === 'socialSettings') renderSocialSettingsScreen(body);
  else renderProfileHome(body);
  refreshLibraryTools();
}

function renderProfileHome(body){
  renderStorefrontSection(body);
}

// Top Album/Top Song, Achievements, Collection and Share don't exist
// anywhere else, so every storefront state (local-only, open-store card,
// signed-in) appends this directly below its own header+stats rather than
// repeating a whole second profile header — the avatar/name editor only
// needs to appear once, inline in whichever header is actually showing.
// includeShareCardEditor is true wherever the storefront's own header isn't
// already editing S.profile.art/.name itself (i.e. everywhere except the
// local-only storefront, which edits them directly as its avatar/name).
function renderProfileExtras(includeShareCardEditor){
  const wrap = el('div','profile-extras');

  if(includeShareCardEditor){
    const header = el('div','profile-header');
    const picBtn = el('button','profile-pic'); picBtn.setAttribute('aria-label','Change share-card picture');
    if(S.profile.art) picBtn.classList.add('has-art');
    if(S.profile.art){ const im = document.createElement('img'); im.src = S.profile.art; im.alt = ''; picBtn.appendChild(im); }
    picBtn.appendChild(el('span','profile-pic-mark','+'));
    picBtn.addEventListener('click', ()=> $('#profilePicFile').click());
    header.appendChild(picBtn);
    const nameIn = el('input','profile-name-input');
    nameIn.type = 'text'; nameIn.placeholder = 'Your name'; nameIn.value = S.profile.name || '';
    nameIn.addEventListener('change', ()=>{ S.profile.name = nameIn.value.trim(); persistProfile(); });
    header.appendChild(nameIn);
    wrap.appendChild(header);
    wrap.appendChild(el('p','note','Shown on shared cards (Now Playing, My Crate) — separate from your crate.'));
  }

  const row = el('div','profile-top-row');
  const albums = topAlbums(1), tracks = topTracks(1);
  row.appendChild(topTile('Top Album', albums[0] ? albums[0].display.art : null,
    albums[0] ? albums[0].display.name : null, albums[0] ? albums[0].display.artist : null,
    'nothing in the crate yet', ()=>{ S.profileView.screen = 'topAlbums'; renderProfile(); }));
  row.appendChild(topTile('Top Song', tracks[0] ? tracks[0].art : null,
    tracks[0] ? tracks[0].title : null, tracks[0] ? tracks[0].artist : null,
    'nothing in the sleeve yet', ()=>{ S.profileView.screen = 'topSongs'; renderProfile(); }));
  wrap.appendChild(row);

  const achSection = el('div','profile-section');
  const achHead = el('div','profile-section-head'); achHead.appendChild(el('span', null, 'Achievements'));
  achSection.appendChild(achHead);
  const achList = achievementsList();
  if(achList.length){
    const grid = el('div','profile-grid');
    achList.forEach(rec => grid.appendChild(metalBadge(rec)));
    achSection.appendChild(grid);
  } else {
    const empty = el('div','profile-empty'); empty.appendChild(el('p', null, 'Nothing earned yet.'));
    achSection.appendChild(empty);
  }
  wrap.appendChild(achSection);

  const collList = Object.values(S.collection);
  const collSection = el('button','profile-section');
  const collHead = el('div','profile-section-head');
  collHead.appendChild(el('span', null, 'Collection'));
  collHead.appendChild(el('span','g-chev','›'));
  collSection.appendChild(collHead);
  if(collList.length){
    const grid = el('div','profile-grid mini');
    collList.slice(0, 6).forEach(rec => grid.appendChild(collectionBadge(rec)));
    collSection.appendChild(grid);
  } else {
    const empty = el('div','profile-empty'); empty.appendChild(el('p', null, 'Nothing in the collection yet.'));
    collSection.appendChild(empty);
  }
  collSection.addEventListener('click', ()=>{ S.profileView.screen = 'collection'; renderProfile(); });
  wrap.appendChild(collSection);

  const shareBtn = el('button','cta ghost profile-share','Share');
  shareBtn.classList.toggle('active', crateFilled());
  shareBtn.addEventListener('click', openShareSheet);
  wrap.appendChild(shareBtn);

  return wrap;
}

function renderTopAlbumsScreen(body){
  const list = topAlbums(5);
  if(!list.length){
    const empty = el('div','profile-empty'); empty.appendChild(el('p', null, 'Nothing in the crate yet.'));
    body.appendChild(empty); return;
  }
  const ul = el('ul','tracklist');
  list.forEach((a, pos) => {
    const li = el('li');
    li.appendChild(el('span','t-idx', String(pos + 1).padStart(2,'0')));
    if(a.display.art){ const im = el('img','t-art'); im.src = a.display.art; im.alt=''; li.appendChild(im); }
    else li.appendChild(el('span','t-art'));
    const name = el('span','t-name');
    name.appendChild(el('b', null, a.display.name));
    name.appendChild(el('em', null, a.display.artist + ' · ' + fmtCount(a.count, 'session', 'sessions')));
    li.appendChild(name);
    ul.appendChild(li);
  });
  body.appendChild(ul);
}

function renderTopSongsScreen(body){
  const list = topTracks(5);
  if(!list.length){
    const empty = el('div','profile-empty'); empty.appendChild(el('p', null, 'Nothing in the sleeve yet.'));
    body.appendChild(empty); return;
  }
  const ul = el('ul','tracklist');
  list.forEach((t, pos) => {
    const li = el('li');
    li.appendChild(el('span','t-idx', String(pos + 1).padStart(2,'0')));
    if(t.art){ const im = el('img','t-art'); im.src = t.art; im.alt=''; li.appendChild(im); }
    else li.appendChild(el('span','t-art'));
    const name = el('span','t-name');
    name.appendChild(el('b', null, t.title));
    name.appendChild(el('em', null, t.artist + ' · ' + fmtCount(t.count, 'play', 'plays')));
    li.appendChild(name);
    ul.appendChild(li);
  });
  body.appendChild(ul);
}

function renderCollectionScreen(body){
  const groups = collectionGroups();
  const names = {solid:'Colors', split:'Splits', splatter:'Splatter', swirl:'Swirls'};
  const any = Object.values(groups).some(g => g.length);
  if(!any){
    const empty = el('div','profile-empty'); empty.appendChild(el('p', null, 'Your pressings will show up here once you’ve played an album through.'));
    body.appendChild(empty); return;
  }
  Object.keys(names).forEach(key => {
    const items = groups[key];
    if(!items || !items.length) return;
    const section = el('div','collection-group');
    section.appendChild(el('div','collection-group-name', names[key]));
    const grid = el('div','profile-grid');
    items.forEach(rec => grid.appendChild(collectionBadge(rec)));
    section.appendChild(grid);
    body.appendChild(section);
  });
}

/* ================= share image =================
   Composed off-screen, not a screenshot of the tab — this has to work as a
   standalone object for people who don't have the app. Pure function,
   independent of the view layer (see PROFILE spec §6, §8): takes options,
   returns a canvas, touches nothing else. Front is a record sleeve: the #1
   album's art as the jacket, wordmark fallback when there is none. Stats
   read like a back-cover track listing. */
/* ---- style x format system (Part 2 §2). Styles (Night/Cover/Paper)
   resolve to a small "kit" — a background painter plus ink/sub/accent
   colours and chip styling — and formats resolve to pixel dimensions and a
   safe-zone band, kept in one table each rather than per-card magic
   numbers. Composers below take it from there. ---- */
const SHARE_BG = ['#1D2F38', '#101A20', '#07080C'];

const SHARE_FORMATS = {
  story:    {w:1080, h:1920, safeTop:250, safeBottom:1670},
  portrait: {w:1080, h:1350, safeTop:90,  safeBottom:1270},
  square:   {w:1080, h:1080, safeTop:70,  safeBottom:1010}
};

function shareFitText(ctx, text, maxWidth){
  if(ctx.measureText(text).width <= maxWidth) return text;
  let s = text;
  while(s.length > 1 && ctx.measureText(s + '…').width > maxWidth) s = s.slice(0, -1);
  return s + '…';
}

// measures and shrinks text to fit maxWidth across at most maxLines,
// wrapping on spaces, stepping the font size down before ever truncating
function shareFitLines(ctx, text, maxWidth, maxLines, baseSize, weight, family){
  const wrap = size => {
    ctx.font = weight + ' ' + size + 'px ' + family;
    const words = String(text || '').split(/\s+/).filter(Boolean);
    const lines = []; let line = '';
    for(const word of words){
      const test = line ? line + ' ' + word : word;
      if(line && ctx.measureText(test).width > maxWidth){ lines.push(line); line = word; }
      else line = test;
    }
    if(line) lines.push(line);
    return lines;
  };
  for(let size = baseSize; size >= Math.round(baseSize*0.55); size -= 2){
    const lines = wrap(size);
    if(lines.length <= maxLines) return { lines, fontSize: size };
  }
  const size = Math.round(baseSize*0.55);
  const lines = wrap(size).slice(0, maxLines);
  if(lines.length) lines[lines.length-1] = shareFitText(ctx, lines[lines.length-1], maxWidth);
  return { lines, fontSize: size };
}

function shareSwatchGradient(ctx, cx, cy, r, colors){
  const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
  g.addColorStop(0, colors[0]); g.addColorStop(0.6, colors[1]); g.addColorStop(1, colors[2]);
  return g;
}

// waits for decode() too, not just the load event, so the first draw never
// races a not-yet-decoded frame (spec §2 implementation notes)
function loadImageEl(src){
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => { if(img.decode) img.decode().then(() => resolve(img), () => resolve(img)); else resolve(img); };
    img.onerror = reject;
    img.src = src;
  });
}

// whole-pixel positions, and a step-halving downscale for large source art
// so it never samples a single too-sharp blit — never upscales past source
function drawCover(ctx, img, x, y, w, h){
  x = Math.round(x); y = Math.round(y); w = Math.round(w); h = Math.round(h);
  const scale = Math.min(1, Math.max(w / img.width, h / img.height));
  const sw = Math.min(img.width, w / scale), sh = Math.min(img.height, h / scale);
  const sx = (img.width - sw) / 2, sy = (img.height - sh) / 2;
  let src = img, srcW = img.width, srcH = img.height, cropX = sx, cropY = sy, cropW = sw, cropH = sh;
  while(cropW * scale < cropW / 2 && cropW > w * 2 && cropH > h * 2){
    const half = document.createElement('canvas');
    half.width = Math.max(1, Math.round(srcW/2)); half.height = Math.max(1, Math.round(srcH/2));
    half.getContext('2d').drawImage(src, 0, 0, half.width, half.height);
    const ratio = half.width / srcW;
    cropX *= ratio; cropY *= ratio; cropW *= ratio; cropH *= ratio;
    src = half; srcW = half.width; srcH = half.height;
  }
  ctx.drawImage(src, cropX, cropY, cropW, cropH, x, y, w, h);
}

function roundRectPath(ctx, x, y, w, h, r){
  if(ctx.roundRect){ ctx.beginPath(); ctx.roundRect(x, y, w, h, r); return; }
  ctx.beginPath();
  ctx.moveTo(x+r, y); ctx.arcTo(x+w,y,x+w,y+h,r); ctx.arcTo(x+w,y+h,x,y+h,r);
  ctx.arcTo(x,y+h,x,y,r); ctx.arcTo(x,y,x+w,y,r); ctx.closePath();
}

// the masthead wordmark, "zi" in the accent colour like the app header
function drawShareWordmark(ctx, centerX, baselineY, fontPx, ink, accent){
  ctx.save();
  ctx.font = '700 ' + Math.round(fontPx) + 'px Antonio, sans-serif';
  ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left';
  const parts = [['Mi', ink], ['zi', accent], ['ki', ink]];
  const total = parts.reduce((s,[txt]) => s + ctx.measureText(txt).width, 0);
  let x = centerX - total/2;
  parts.forEach(([txt, col]) => { ctx.fillStyle = col; ctx.fillText(txt, x, baselineY); x += ctx.measureText(txt).width; });
  ctx.restore();
}

// a tiny, cached static-noise tile for Paper's grain — generated once,
// tiled via a canvas pattern rather than redrawn per pixel
let shareGrainCanvasCache = null;
function shareGrainTile(){
  if(shareGrainCanvasCache) return shareGrainCanvasCache;
  const size = 96;
  const c = document.createElement('canvas');
  c.width = size; c.height = size;
  const cx = c.getContext('2d');
  const img = cx.createImageData(size, size);
  for(let i = 0; i < img.data.length; i += 4){
    const v = 180 + Math.floor(Math.random()*50);
    img.data[i] = v; img.data[i+1] = v; img.data[i+2] = v;
    img.data[i+3] = Math.random() < 0.5 ? 12 : 5;
  }
  cx.putImageData(img, 0, 0);
  shareGrainCanvasCache = c;
  return c;
}

// downsamples art to ~32px and buckets by hue, picking the most saturated
// mid-luminance bucket — returns null (greyscale/missing art) when nothing
// qualifies, which the caller treats as "fall back to Night" (spec §2)
function shareDominantColor(img){
  try{
    const size = 32;
    const c = document.createElement('canvas');
    c.width = size; c.height = size;
    const cx = c.getContext('2d');
    cx.drawImage(img, 0, 0, size, size);
    const data = cx.getImageData(0, 0, size, size).data;
    const buckets = {};
    for(let i = 0; i < data.length; i += 4){
      const r = data[i]/255, g = data[i+1]/255, b = data[i+2]/255;
      const max = Math.max(r,g,b), min = Math.min(r,g,b), l = (max+min)/2, d = max-min;
      const s = d === 0 ? 0 : d / (1 - Math.abs(2*l - 1));
      // only exclude true greys/near-black/near-white — a dark but saturated
      // colour (low l, high s) must still qualify, or legitimately dark art
      // would wrongly fall back to Night instead of a darkened Cover card
      if(s < 0.14 || l < 0.025 || l > 0.975) continue;
      let h = 0;
      if(d !== 0){
        if(max === r) h = ((g-b)/d) % 6;
        else if(max === g) h = (b-r)/d + 2;
        else h = (r-g)/d + 4;
        h = Math.round(h*60); if(h < 0) h += 360;
      }
      const key = Math.floor(h/24)*24;
      const bucket = buckets[key] || (buckets[key] = {h:0, s:0, l:0, n:0, score:0});
      const score = s * (1 - Math.abs(l - 0.5)*1.3);
      bucket.h += h; bucket.s += s; bucket.l += l; bucket.n++; bucket.score += score;
    }
    let best = null;
    Object.values(buckets).forEach(b => { if(!best || b.score > best.score) best = b; });
    if(!best || best.n < 4) return null;
    return { h: best.h/best.n, s: Math.min(1, best.s/best.n), l: Math.min(0.82, Math.max(0.12, best.l/best.n)) };
  }catch(e){ return null; }
}
function hslStr(h, s, l){ return 'hsl(' + h.toFixed(0) + ',' + Math.round(s*100) + '%,' + Math.round(l*100) + '%)'; }

// resolves a style name (+ optional art URL for Cover) into the kit every
// card draws with: a background painter and a consistent ink/sub/accent/
// chip palette, so cards never hand-roll per-style colours inline
async function resolveShareStyle(style, artURL){
  if(style === 'cover' && artURL){
    try{
      const img = await loadImageEl(artURL);
      const dom = shareDominantColor(img);
      if(dom){
        // the top stop tracks the art's own lightness (darkened art stays
        // dark, bright art stays bright) so ink contrast has something real
        // to react to; the bottom stop always darkens toward the footer
        const topL = Math.min(0.74, Math.max(0.2, dom.l));
        const botL = Math.max(0.05, topL - 0.3);
        const bgTop = hslStr(dom.h, Math.min(0.6, dom.s + 0.05), topL);
        const bgBot = hslStr(dom.h, Math.min(0.5, dom.s), botL);
        const accent = hslStr(dom.h, Math.min(0.8, dom.s+0.2), Math.min(0.74, topL+0.18));
        // contrast is read against the top stop, since it's lighter/closer
        // to the WCAG-binding case than the always-dark bottom (spec §2)
        const useDark = topL > 0.52;
        return {
          name:'cover', ink: useDark ? '#171310' : '#EFE9DF',
          sub: useDark ? 'rgba(23,19,16,.66)' : 'rgba(239,233,223,.66)', accent,
          chipBorder: useDark ? 'rgba(23,19,16,.4)' : 'rgba(239,233,223,.4)',
          chipBg: useDark ? 'rgba(0,0,0,.1)' : 'rgba(255,255,255,.08)',
          paintBg(ctx, w, h){
            const g = ctx.createLinearGradient(0, 0, 0, h);
            g.addColorStop(0, bgTop); g.addColorStop(1, bgBot);
            ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
          }
        };
      }
    }catch(e){ /* falls through to Night below */ }
  }
  if(style === 'paper'){
    return {
      name:'paper', ink:'#1C1816', sub:'rgba(28,24,22,.62)', accent:'#9A4B17',
      chipBorder:'rgba(28,24,22,.35)', chipBg:'rgba(28,24,22,.07)',
      paintBg(ctx, w, h){
        ctx.fillStyle = '#EDE6D6'; ctx.fillRect(0, 0, w, h);
        const pat = ctx.createPattern(shareGrainTile(), 'repeat');
        ctx.save(); ctx.globalAlpha = 0.55; ctx.fillStyle = pat; ctx.fillRect(0, 0, w, h); ctx.restore();
      }
    };
  }
  return {
    name:'night', ink:'#EFE9DF', sub:'#94A0A6', accent:'#FF9E2C',
    chipBorder:'rgba(239,233,223,.32)', chipBg:'rgba(255,255,255,.05)',
    paintBg(ctx, w, h){
      const g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, SHARE_BG[0]); g.addColorStop(0.55, SHARE_BG[1]); g.addColorStop(1, SHARE_BG[2]);
      ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    }
  };
}

// one spec chip, e.g. "FLAC · 44.1 kHz · 16-bit" or "VINYL" — `filled`
// renders it solid in the accent colour (used for the mode chip)
function shareChip(ctx, kit, text, x, y, filled){
  ctx.font = '600 22px "IBM Plex Mono", monospace';
  const padX = 22, h = 46;
  const w = ctx.measureText(text).width + padX*2;
  if(filled){
    roundRectPath(ctx, x, y, w, h, h/2);
    ctx.fillStyle = kit.accent; ctx.fill();
    ctx.fillStyle = kit.name === 'paper' ? '#EDE6D6' : '#171310';
  } else {
    roundRectPath(ctx, x, y, w, h, h/2);
    ctx.strokeStyle = kit.chipBorder; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.fillStyle = kit.ink;
  }
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(text, x + w/2, y + h/2 + 1);
  ctx.textBaseline = 'alphabetic';
  return w;
}

/* ---- My Crate card (composeShareImage) — avatar/name/counts, hero = top
   album, a grid of the next covers, top songs, metals + collection, brand.
   `opts`: {style, format, sections}. Pure: no DOM reads, only the same
   state-reading anchors the original drew from (topAlbums/topTracks/
   achievementsList/S.collection/S.profile/S.tracks). ---- */
async function composeShareImage(opts){
  const style = opts.style || 'night', format = opts.format || 'square';
  const sections = opts.sections || {};
  const dim = SHARE_FORMATS[format] || SHARE_FORMATS.square;
  const w = dim.w, h = dim.h;
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  try{ await document.fonts.ready; }catch(e){}

  const topAlbum = topAlbums(1)[0];
  const kit = await resolveShareStyle(style, topAlbum && topAlbum.display.art);
  kit.paintBg(ctx, w, h);

  const pad = Math.round(w*0.055);
  const topY = dim.safeTop, bottomY = dim.safeBottom;
  const twoCol = format !== 'story';

  ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';

  // header: avatar, name (if on), album/track counts
  const avSize = Math.round(w*0.075);
  const avX = pad, avY = topY;
  ctx.save();
  ctx.beginPath(); ctx.arc(avX+avSize/2, avY+avSize/2, avSize/2, 0, Math.PI*2); ctx.clip();
  let drewAvatar = false;
  if(S.profile.art){
    try{ const img = await loadImageEl(S.profile.art); drawCover(ctx, img, avX, avY, avSize, avSize); drewAvatar = true; }catch(e){}
  }
  if(!drewAvatar){
    ctx.fillStyle = shareSwatchGradient(ctx, avX+avSize/2, avY+avSize/2, avSize/2, ['#3E8E7E','#245048','#122623']);
    ctx.fillRect(avX, avY, avSize, avSize);
    if(S.profile.name){
      ctx.fillStyle = kit.name === 'paper' ? '#EDE6D6' : '#EFE9DF';
      ctx.font = '600 ' + Math.round(avSize*0.42) + 'px Archivo, sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(S.profile.name[0].toUpperCase(), avX+avSize/2, avY+avSize/2+1);
      ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    }
  }
  ctx.restore();

  const showName = sections.name !== false && !!S.profile.name;
  const albumCount = new Set(S.tracks.map(t => albumKey(t))).size;
  const trackCount = S.tracks.length;
  const textX = avX + avSize + Math.round(w*0.025);
  const headName = showName ? S.profile.name.toUpperCase() + "'S CRATE" : 'MY CRATE';
  ctx.font = '700 ' + Math.round(w*0.042) + 'px Antonio, sans-serif';
  ctx.fillStyle = kit.ink;
  ctx.fillText(shareFitText(ctx, headName, w - textX - pad), textX, avY + avSize*0.42);
  ctx.font = '500 ' + Math.round(w*0.02) + 'px "IBM Plex Mono", monospace';
  ctx.fillStyle = kit.sub;
  ctx.fillText(albumCount + ' ALBUMS · ' + trackCount + ' TRACKS', textX, avY + avSize*0.42 + Math.round(w*0.03));

  let y = avY + avSize + Math.round(h*0.04);
  const heroW = twoCol ? Math.round(w*0.42) : Math.round(w*0.56);
  const heroX = twoCol ? pad : Math.round((w-heroW)/2);
  const heroH = heroW;

  if(topAlbum){
    if(topAlbum.display.art){
      try{ const img = await loadImageEl(topAlbum.display.art); ctx.save(); roundRectPath(ctx, heroX, y, heroW, heroH, 6); ctx.clip(); drawCover(ctx, img, heroX, y, heroW, heroH); ctx.restore(); }
      catch(e){ drawDiagonalWordmark(ctx, heroX, y, heroW); }
    } else drawDiagonalWordmark(ctx, heroX, y, heroW);
  } else {
    ctx.fillStyle = kit.chipBg; roundRectPath(ctx, heroX, y, heroW, heroH, 6); ctx.fill();
  }

  if(twoCol){
    // 2x2 grid of the next top covers, to the right of the hero
    const gridX = heroX + heroW + Math.round(w*0.03);
    const gridW = w - pad - gridX;
    const cell = (gridW - Math.round(w*0.02)) / 2;
    const nextAlbums = topAlbums(5).slice(1, 5);
    for(let i = 0; i < 4; i++){
      const cx = gridX + (i%2)*(cell + Math.round(w*0.02));
      const cy = y + Math.floor(i/2)*(cell + Math.round(w*0.02));
      const a = nextAlbums[i];
      if(a && a.display.art){
        try{ const img = await loadImageEl(a.display.art); ctx.save(); roundRectPath(ctx, cx, cy, cell, cell, 5); ctx.clip(); drawCover(ctx, img, cx, cy, cell, cell); ctx.restore(); }
        catch(e){ ctx.fillStyle = kit.chipBg; roundRectPath(ctx, cx, cy, cell, cell, 5); ctx.fill(); }
      } else {
        ctx.fillStyle = kit.chipBg; roundRectPath(ctx, cx, cy, cell, cell, 5); ctx.fill();
        if(a){
          ctx.fillStyle = kit.sub; ctx.font = '600 20px "IBM Plex Mono", monospace';
          ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          ctx.fillText(shareFitText(ctx, a.display.name, cell-16), cx+cell/2, cy+cell/2);
          ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
        }
      }
    }
    y += heroH + Math.round(h*0.035);
  } else {
    // single column: a plain row of the next covers beneath the hero
    y += heroH + Math.round(h*0.03);
    const nextAlbums = topAlbums(5).slice(1, 5);
    if(nextAlbums.length){
      const cell = Math.round((w - pad*2 - (nextAlbums.length-1)*Math.round(w*0.025)) / 4);
      let cx = pad;
      for(const a of nextAlbums){
        if(a.display.art){
          try{ const img = await loadImageEl(a.display.art); ctx.save(); roundRectPath(ctx, cx, y, cell, cell, 5); ctx.clip(); drawCover(ctx, img, cx, y, cell, cell); ctx.restore(); }
          catch(e){ ctx.fillStyle = kit.chipBg; roundRectPath(ctx, cx, y, cell, cell, 5); ctx.fill(); }
        } else { ctx.fillStyle = kit.chipBg; roundRectPath(ctx, cx, y, cell, cell, 5); ctx.fill(); }
        cx += cell + Math.round(w*0.025);
      }
      y += cell + Math.round(h*0.03);
    }
  }

  ctx.font = '700 ' + Math.round(w*0.02) + 'px "IBM Plex Mono", monospace';
  ctx.fillStyle = kit.accent;
  ctx.fillText('01 · TOP ALBUM', twoCol ? heroX : pad, y);
  y += Math.round(w*0.04);
  ctx.font = '700 ' + Math.round(w*0.04) + 'px Archivo, sans-serif';
  ctx.fillStyle = kit.ink;
  ctx.fillText(shareFitText(ctx, topAlbum ? topAlbum.display.name : 'Nothing yet', w - pad - (twoCol?heroX:pad)), twoCol ? heroX : pad, y);
  y += Math.round(w*0.034);
  ctx.font = '400 ' + Math.round(w*0.024) + 'px Archivo, sans-serif';
  ctx.fillStyle = kit.sub;
  const subLine = topAlbum ? (topAlbum.display.artist + ' · ' + fmtCount(topAlbum.count, 'session', 'sessions')) : '';
  ctx.fillText(shareFitText(ctx, subLine, w - pad - (twoCol?heroX:pad)), twoCol ? heroX : pad, y);
  y += Math.round(h*0.05);

  // two columns (portrait/square): songs left, metals+collection stacked
  // right. Single column (story): all three stack in the one column, so
  // rightY is kept in sync with leftY between sections rather than starting
  // fresh — otherwise metals/collection would overlap songs instead of
  // continuing below it (spec §2, "Story is a single column").
  const colSplitX = twoCol ? Math.round(w/2) : null;
  let leftY = y, rightY = y;
  const leftX = pad, rightX = colSplitX != null ? colSplitX + Math.round(w*0.02) : pad;
  const colW = (colSplitX != null ? colSplitX - leftX - Math.round(w*0.03) : w - pad*2);

  if(sections.songs !== false){
    ctx.font = '700 ' + Math.round(w*0.019) + 'px "IBM Plex Mono", monospace';
    ctx.fillStyle = kit.accent;
    ctx.fillText('TOP SONGS', leftX, leftY);
    leftY += Math.round(w*0.036);
    const list = topTracks(5);
    const rows = twoCol ? list.slice(0, 4) : list.slice(0, 4);
    if(rows.length){
      rows.forEach((t, i) => {
        ctx.font = '600 ' + Math.round(w*0.027) + 'px Archivo, sans-serif'; ctx.fillStyle = kit.ink;
        const rankStr = String(i+1).padStart(2,'0') + '  ';
        ctx.fillText(rankStr, leftX, leftY);
        const rankW = ctx.measureText(rankStr).width;
        const titleW = ctx.measureText(t.title).width;
        ctx.fillText(shareFitText(ctx, t.title, colW - rankW), leftX + rankW, leftY);
        ctx.font = '400 ' + Math.round(w*0.02) + 'px Archivo, sans-serif'; ctx.fillStyle = kit.sub;
        const subX = leftX + rankW + Math.min(titleW, colW - rankW) + 8;
        ctx.fillText(shareFitText(ctx, '· ' + t.artist, Math.max(10, leftX + colW - subX)), subX, leftY);
        leftY += Math.round(w*0.042);
      });
    } else {
      ctx.font = '400 ' + Math.round(w*0.024) + 'px Archivo, sans-serif'; ctx.fillStyle = kit.sub;
      ctx.fillText('Nothing in the sleeve yet.', leftX, leftY);
      leftY += Math.round(w*0.04);
    }
  }

  if(!twoCol) rightY = leftY;
  if(sections.metals !== false){
    ctx.font = '700 ' + Math.round(w*0.019) + 'px "IBM Plex Mono", monospace';
    ctx.fillStyle = kit.accent;
    ctx.fillText('METALS', rightX, rightY);
    rightY += Math.round(w*0.036);
    const list = achievementsList();
    if(list.length){
      const counts = {};
      list.forEach(a => { counts[a.tier] = (counts[a.tier] || 0) + 1; });
      const order = ['rare','platinum','gold','silver','bronze'];
      const r = Math.round(w*0.026);
      let cx = rightX + r;
      order.filter(k => counts[k]).forEach(k => {
        ctx.beginPath(); ctx.arc(cx, rightY + r*0.2, r, 0, Math.PI*2);
        ctx.fillStyle = shareSwatchGradient(ctx, cx, rightY + r*0.2, r, [METAL_COLORS[k] || '#9c8a74', hexMix(METAL_COLORS[k]||'#9c8a74','#000',0.35), hexMix(METAL_COLORS[k]||'#9c8a74','#000',0.6)]);
        ctx.fill();
        ctx.fillStyle = '#171310'; ctx.font = '700 ' + Math.round(r*0.85) + 'px Archivo, sans-serif';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(String(counts[k]), cx, rightY + r*0.2 + 1);
        ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
        cx += r*2 + Math.round(w*0.016);
      });
      rightY += r*2 + Math.round(w*0.03);
    } else {
      ctx.font = '400 ' + Math.round(w*0.024) + 'px Archivo, sans-serif'; ctx.fillStyle = kit.sub;
      ctx.fillText('Nothing earned yet.', rightX, rightY);
      rightY += Math.round(w*0.04);
    }
  }

  if(sections.collection !== false){
    ctx.font = '700 ' + Math.round(w*0.019) + 'px "IBM Plex Mono", monospace';
    ctx.fillStyle = kit.accent;
    ctx.fillText('COLLECTION', rightX, rightY);
    rightY += Math.round(w*0.036);
    const items = Object.values(S.collection).slice(0, 6);
    if(items.length){
      const r = Math.round(w*0.024), spacing = r*2 + Math.round(w*0.012);
      items.forEach((rec, i) => {
        const cx = rightX + r + i*spacing, cy = rightY + r;
        ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI*2);
        ctx.fillStyle = shareSwatchGradient(ctx, cx, cy, r, VARIANT_DEFS[rec.variant].colors);
        ctx.fill();
        ctx.lineWidth = 1.5; ctx.strokeStyle = 'rgba(0,0,0,.4)'; ctx.stroke();
      });
      rightY += r*2 + Math.round(w*0.03);
    } else {
      ctx.font = '400 ' + Math.round(w*0.024) + 'px Archivo, sans-serif'; ctx.fillStyle = kit.sub;
      ctx.fillText('Nothing collected yet.', rightX, rightY);
      rightY += Math.round(w*0.04);
    }
  }

  ctx.textAlign = 'center';
  const markY = Math.max(leftY, rightY, Math.round(h*0.02)) + Math.round(h*0.03);
  drawShareWordmark(ctx, w/2, Math.min(markY, bottomY), Math.round(w*0.034), kit.ink, kit.accent);
  ctx.textAlign = 'left';

  return canvas;
}

function hexMix(hex, target, amt){
  const c = parseInt(hex.slice(1), 16), t = parseInt(target.slice(1), 16);
  const mix = (shift) => Math.round(((c>>shift & 255) * (1-amt)) + ((t>>shift & 255) * amt));
  return 'rgb(' + mix(16) + ',' + mix(8) + ',' + mix(0) + ')';
}

// Fills the full disc circle with whatever look is resolved for this track
// — same precedence applyDiscVariant() uses on the real platter — so the
// share image never falls back to a generic disc. `half` is true for the
// normal composition, where only the left semicircle ends up visible once
// the art square is drawn on top: asymmetric patterns need to orient
// themselves so both their colors land in that visible half instead of
// reading as one flat color (see LIBRARY spec §2, disc rendering).
async function fillShareDisc(ctx, t, look, cx, cy, r, half){
  ctx.save();
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI*2); ctx.closePath(); ctx.clip();
  ctx.fillStyle = '#15161B'; ctx.fillRect(cx - r, cy - r, r*2, r*2);
  if(look === 'rare'){
    try{
      const img = await loadImageEl(t.art);
      drawCover(ctx, img, cx - r, cy - r, r*2, r*2);
      const dark = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
      dark.addColorStop(0, 'rgba(0,0,0,.12)'); dark.addColorStop(0.88, 'rgba(0,0,0,.55)'); dark.addColorStop(1, 'rgba(0,0,0,.78)');
      ctx.fillStyle = dark; ctx.fillRect(cx - r, cy - r, r*2, r*2);
    }catch(e){}
  } else if(look === 'metal'){
    const metal = trackMetalFor(trackIdentityKey(t)) || albumMetalFor(albumKey(t));
    const base = METAL_COLORS[metal] || METAL_COLORS.bronze;
    const colors = [hexMix(base, '#ffffff', 0.45), base, hexMix(base, '#000000', 0.5)];
    ctx.fillStyle = shareSwatchGradient(ctx, cx, cy, r, colors);
    ctx.fillRect(cx - r, cy - r, r*2, r*2);
  } else {
    const {variant} = selectVariant(t);
    const def = VARIANT_DEFS[variant];
    const [a, b, c] = def.colors;
    if(def.pattern === 'split' && half){
      // a left/right split would read as one flat color once the right
      // half is occluded by the art panel — a top/bottom split instead
      // guarantees both colors land within the visible left arc
      ctx.fillStyle = a; ctx.fillRect(cx - r, cy - r, r*2, r);
      ctx.fillStyle = c; ctx.fillRect(cx - r, cy, r*2, r);
    } else if(def.pattern === 'split'){
      ctx.fillStyle = a; ctx.fillRect(cx, cy - r, r, r*2);
      ctx.fillStyle = c; ctx.fillRect(cx - r, cy - r, r, r*2);
    } else if(def.pattern === 'swirl'){
      const g = ctx.createConicGradient(0, cx, cy);
      [a, b, c, a, b, c, a].forEach((col, i) => g.addColorStop(i/6, col));
      ctx.fillStyle = g; ctx.fillRect(cx - r, cy - r, r*2, r*2);
    } else if(def.pattern === 'splatter'){
      // random enough that either half works, so no orientation care needed
      ctx.fillStyle = c; ctx.fillRect(cx - r, cy - r, r*2, r*2);
      const spots = [[30,25],[70,20],[50,50],[20,65],[80,60],[40,80],[65,40],[15,40]];
      spots.forEach(([px, py], i) => {
        const sx = cx - r + (px/100)*r*2, sy = cy - r + (py/100)*r*2;
        ctx.beginPath(); ctx.arc(sx, sy, r*0.06, 0, Math.PI*2);
        ctx.fillStyle = i % 2 ? b : a; ctx.fill();
      });
    } else {
      ctx.fillStyle = shareSwatchGradient(ctx, cx, cy, r, def.colors);
      ctx.fillRect(cx - r, cy - r, r*2, r*2);
    }
  }
  // groove rings so it still reads as a record, not a flat swatch
  ctx.strokeStyle = 'rgba(255,255,255,.06)'; ctx.lineWidth = 1;
  for(let rr = r*0.4; rr < r*0.97; rr += r*0.085){
    ctx.beginPath(); ctx.arc(cx, cy, rr, 0, Math.PI*2); ctx.stroke();
  }
  ctx.restore();
  // label
  const lr = r * 0.32;
  ctx.beginPath(); ctx.arc(cx, cy, lr, 0, Math.PI*2);
  ctx.fillStyle = '#3A2007'; ctx.fill();
  if(look === 'rare'){
    try{
      const limg = await loadImageEl(t.art);
      ctx.save(); ctx.beginPath(); ctx.arc(cx, cy, lr, 0, Math.PI*2); ctx.clip();
      drawCover(ctx, limg, cx - lr, cy - lr, lr*2, lr*2);
      ctx.restore();
    }catch(e){}
  }
}

// Black square with "Miziki" written diagonally across it — the fallback
// jacket when a track has no art at all (see LIBRARY spec §2)
function drawDiagonalWordmark(ctx, x, y, side){
  ctx.save();
  ctx.fillStyle = '#0B0C0F'; ctx.fillRect(x, y, side, side);
  ctx.beginPath(); ctx.rect(x, y, side, side); ctx.clip();
  ctx.translate(x + side/2, y + side/2);
  ctx.rotate(-Math.PI/8);
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.font = '700 ' + Math.round(side*0.16) + 'px Antonio, sans-serif';
  ctx.fillStyle = 'rgba(239,233,223,.5)';
  ctx.fillText('M I Z I K I', 0, 0);
  ctx.restore();
}

/* ---- Now Playing card (composePlayerShareImage) — the record peeking from
   behind its sleeve (fillShareDisc), kicker + title (auto-shrink to 2
   lines) + artist + album·year, a live progress line, spec chips, brand
   footer. `opts`: {style, format, data}, data gathered by the caller
   (renderPlayerShareCanvas) from current()/S.pos/resolveLook() — the
   composer itself touches nothing but its arguments. ---- */
async function composePlayerShareImage(opts){
  const style = opts.style || 'night', format = opts.format || 'story';
  const dim = SHARE_FORMATS[format] || SHARE_FORMATS.story;
  const w = dim.w, h = dim.h;
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  try{ await document.fonts.ready; }catch(e){}
  const data = opts.data;
  if(!data || !data.track) return canvas;
  const t = data.track;

  const kit = await resolveShareStyle(style, t.art || null);
  kit.paintBg(ctx, w, h);

  const pad = Math.round(w*0.06);
  let y = dim.safeTop;
  const bottomY = dim.safeBottom;
  const look = data.look;

  if(look === 'rare'){
    // full disc, standing alone — a jacket would duplicate the art already
    // suspended inside it (see the normal branch's own comment below)
    const r = Math.round(w * (format === 'story' ? 0.27 : 0.23));
    const cx = w/2, cy = y + r;
    await fillShareDisc(ctx, t, look, cx, cy, r, false);
    y = cy + r + Math.round(h*0.05);
  } else {
    // the disc sits behind an album-art square, offset so roughly half of
    // it peeks out to the left — same geometry the original player-share
    // composition used, just placed per the format's own layout now
    const side = Math.round(w * (format === 'story' ? 0.52 : format === 'square' ? 0.46 : 0.48));
    const squareLeft = Math.round((w - side)/2 + side*0.22);
    const squareTop = y;
    const discCx = squareLeft, discCy = squareTop + side/2, r = side/2;
    await fillShareDisc(ctx, t, look, discCx, discCy, r, true);
    if(t.art){
      try{
        const img = await loadImageEl(t.art);
        ctx.save(); roundRectPath(ctx, squareLeft, squareTop, side, side, 6); ctx.clip();
        drawCover(ctx, img, squareLeft, squareTop, side, side);
        ctx.restore();
      }catch(e){ drawDiagonalWordmark(ctx, squareLeft, squareTop, side); }
    } else {
      drawDiagonalWordmark(ctx, squareLeft, squareTop, side);
    }
    y = squareTop + side + Math.round(h*0.06);
  }

  ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
  ctx.font = '700 ' + Math.round(w*0.024) + 'px "IBM Plex Mono", monospace';
  ctx.fillStyle = kit.accent;
  ctx.fillText('NOW PLAYING', w/2, y);
  y += Math.round(w*0.05);

  const titleMax = w - pad*2;
  const title = t.tags ? t.tags.title : (t.name || '');
  const { lines: titleLines, fontSize: titleSize } = shareFitLines(ctx, title, titleMax, 2, Math.round(w*0.066), '700', 'Archivo, sans-serif');
  ctx.font = '700 ' + titleSize + 'px Archivo, sans-serif'; ctx.fillStyle = kit.ink;
  titleLines.forEach(line => { y += Math.round(titleSize*1.08); ctx.fillText(line, w/2, y); });
  // clearance scaled to the title's own (auto-shrunk) size, not a fixed
  // fraction of canvas height — otherwise a large title in a short format
  // leaves too little room before the descender meets the artist line
  y += Math.round(titleSize*0.85);

  ctx.font = '400 ' + Math.round(w*0.032) + 'px Archivo, sans-serif'; ctx.fillStyle = kit.sub;
  ctx.fillText(shareFitText(ctx, t.tags ? t.tags.artist : '', titleMax), w/2, y);
  y += Math.round(w*0.045);

  const albumYear = [t.tags ? t.tags.album : '', data.year || null].filter(Boolean).join(' · ');
  ctx.font = '600 ' + Math.round(w*0.021) + 'px "IBM Plex Mono", monospace'; ctx.fillStyle = kit.sub;
  ctx.fillText(shareFitText(ctx, albumYear.toUpperCase(), titleMax), w/2, y);
  y += Math.round(h*0.055);

  if(typeof data.elapsed === 'number' && data.duration > 0){
    const barW = w - pad*2, barY = y, barH = 6;
    const frac = Math.max(0, Math.min(1, data.elapsed / data.duration));
    ctx.fillStyle = kit.chipBg; roundRectPath(ctx, pad, barY, barW, barH, barH/2); ctx.fill();
    ctx.fillStyle = kit.accent; roundRectPath(ctx, pad, barY, Math.max(barH, barW*frac), barH, barH/2); ctx.fill();
    ctx.beginPath(); ctx.arc(pad + barW*frac, barY + barH/2, barH*1.5, 0, Math.PI*2); ctx.fillStyle = kit.accent; ctx.fill();
    y += Math.round(h*0.03);
    ctx.font = '500 ' + Math.round(w*0.021) + 'px "IBM Plex Mono", monospace'; ctx.fillStyle = kit.sub;
    ctx.textAlign = 'left'; ctx.fillText(fmt(data.elapsed), pad, y);
    ctx.textAlign = 'right'; ctx.fillText(fmt(data.duration), w - pad, y);
    ctx.textAlign = 'center';
    y += Math.round(h*0.05);
  }

  // spec chips: FLAC/sample-rate/bit-depth, plus the current mode — each
  // omitted outright when its data is missing (spec §2)
  const chips = [];
  const specParts = [t.meta && t.meta.codec, t.meta && t.meta.rate ? (t.meta.rate/1000).toFixed(1)+' kHz' : null,
    t.meta && t.meta.bits ? t.meta.bits+'-bit' : null].filter(Boolean);
  if(specParts.length) chips.push({text: specParts.join(' · '), filled:false});
  if(data.mode) chips.push({text: String(data.mode).toUpperCase(), filled:true});
  if(chips.length){
    ctx.font = '600 22px "IBM Plex Mono", monospace';
    const gap = Math.round(w*0.018);
    const widths = chips.map(c => ctx.measureText(c.text).width + 44);
    const totalW = widths.reduce((s,x) => s+x, 0) + gap*(chips.length-1);
    let cx = w/2 - totalW/2;
    chips.forEach(c => { const cw = shareChip(ctx, kit, c.text, cx, y, c.filled); cx += cw + gap; });
    y += 46 + Math.round(h*0.045);
  }

  ctx.textAlign = 'center';
  const markY = Math.max(y, bottomY - Math.round(h*0.05));
  drawShareWordmark(ctx, w/2, markY, Math.round(w*0.03), kit.ink, kit.accent);
  ctx.font = '600 ' + Math.round(w*0.0165) + 'px "IBM Plex Mono", monospace'; ctx.fillStyle = kit.sub;
  const lossless = !(t.meta && t.meta.lossless === false);
  ctx.fillText('LOCAL · ' + (lossless ? 'LOSSLESS' : 'LOSSY') + ' · NO STREAMING', w/2, markY + Math.round(h*0.026));

  return canvas;
}

/* ---- share sheet wiring: style/format read from the DOM (the sheet's own
   chips), everything else (the pixels) comes from the pure composers above.
   Live preview re-renders are debounced ~100ms so rapid taps don't each
   trigger a full recompose. ---- */
function shareSelectedStyle(rowId){
  const b = document.querySelector('#' + rowId + ' .share-style-chip[aria-pressed="true"]');
  return b ? b.dataset.style : 'night';
}
function shareSelectedFormat(segId, fallback){
  const b = document.querySelector('#' + segId + ' [aria-pressed="true"]');
  return b ? b.dataset.format : fallback;
}
function canShareFiles(){
  try{ return !!(navigator.canShare && navigator.share && navigator.canShare({files:[new File([''], 'x.png', {type:'image/png'})]})); }
  catch(e){ return false; }
}
function canCopyImages(){ return !!(navigator.clipboard && window.ClipboardItem); }
function updateShareActionButtons(shareBtn, saveBtn, copyBtn){
  const canShare = canShareFiles();
  shareBtn.style.display = canShare ? '' : 'none';
  saveBtn.classList.toggle('ghost', canShare);
  saveBtn.classList.toggle('share-primary', !canShare);
  copyBtn.style.display = canCopyImages() ? '' : 'none';
}
function shareExportToBlob(canvas, cb){ canvas.toBlob(cb, 'image/png'); }
function shareDoSave(canvas, filename){
  shareExportToBlob(canvas, blob => {
    if(!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  });
}
function shareDoShare(canvas, filename){
  shareExportToBlob(canvas, blob => {
    if(!blob) return;
    const file = new File([blob], filename, {type:'image/png'});
    if(navigator.canShare && navigator.canShare({files:[file]})) navigator.share({files:[file], title:'Miziki'}).catch(()=>{});
  });
}
function shareDoCopy(canvas){
  shareExportToBlob(canvas, blob => {
    if(!blob || !canCopyImages()) return;
    navigator.clipboard.write([new ClipboardItem({'image/png': blob})]).catch(()=>{});
  });
}

let shareRenderTimer = null;
async function renderShareCanvas(){
  const style = shareSelectedStyle('shareStyleRow');
  const format = shareSelectedFormat('shareFormatSeg', 'square');
  const canvas = await composeShareImage({style, format, sections: S.shareSelection});
  const target = $('#shareCanvas');
  target.width = canvas.width; target.height = canvas.height;
  target.getContext('2d').drawImage(canvas, 0, 0);
}
function queueShareRender(){ clearTimeout(shareRenderTimer); shareRenderTimer = setTimeout(renderShareCanvas, 100); }
async function openShareSheet(){
  const format = S.shareFormat || 'square';
  document.querySelectorAll('#shareStyleRow .share-style-chip').forEach(b =>
    b.setAttribute('aria-pressed', String(b.dataset.style === S.shareStyle)));
  document.querySelectorAll('#shareFormatSeg [data-format]').forEach(b =>
    b.setAttribute('aria-pressed', String(b.dataset.format === format)));
  updateShareActionButtons($('#shareShareBtn'), $('#shareSave'), $('#shareCopy'));
  $('#shareOverlay').classList.add('open');
  $('#shareOverlay').setAttribute('aria-hidden','false');
  await renderShareCanvas();
}
function closeShareSheet(){
  $('#shareOverlay').classList.remove('open');
  $('#shareOverlay').setAttribute('aria-hidden','true');
}

let playerShareRenderTimer = null;
async function renderPlayerShareCanvas(){
  const t = current();
  const style = shareSelectedStyle('playerShareStyleRow');
  const format = shareSelectedFormat('playerShareFormatSeg', 'story');
  const data = t ? { track: t, elapsed: S.pos, duration: t.duration || 0,
    look: resolveLook(t), mode: S.mode, year: t.details && t.details.year } : null;
  const canvas = await composePlayerShareImage({style, format, data});
  const target = $('#playerShareCanvas');
  target.width = canvas.width; target.height = canvas.height;
  target.getContext('2d').drawImage(canvas, 0, 0);
}
function queuePlayerShareRender(){ clearTimeout(playerShareRenderTimer); playerShareRenderTimer = setTimeout(renderPlayerShareCanvas, 100); }
async function openPlayerShareSheet(){
  if(!current()) return;
  const format = S.shareFormat || 'story';
  document.querySelectorAll('#playerShareStyleRow .share-style-chip').forEach(b =>
    b.setAttribute('aria-pressed', String(b.dataset.style === S.shareStyle)));
  document.querySelectorAll('#playerShareFormatSeg [data-format]').forEach(b =>
    b.setAttribute('aria-pressed', String(b.dataset.format === format)));
  updateShareActionButtons($('#playerShareShareBtn'), $('#playerShareSave'), $('#playerShareCopy'));
  $('#playerShareOverlay').classList.add('open');
  $('#playerShareOverlay').setAttribute('aria-hidden', 'false');
  await renderPlayerShareCanvas();
}
function closePlayerShareSheet(){
  $('#playerShareOverlay').classList.remove('open');
  $('#playerShareOverlay').setAttribute('aria-hidden', 'true');
}

function setMode(m){
  S.mode = m;
  const vinyl = m === 'vinyl';
  document.documentElement.style.setProperty('--accent', vinyl ? 'var(--amber)' : 'var(--cool)');
  $('#modeVinyl').setAttribute('aria-pressed', String(vinyl));
  $('#modePure').setAttribute('aria-pressed', String(!vinyl));
  $('#modeTag').textContent = m;
  $('#modeNote').textContent = vinyl
    ? 'Vinyl adds character on purpose: platter wobble, gentle saturation, a softer top end, a light squeeze. Dial it in under Character.'
    : 'Pure is the reference: decode straight to the output, nothing added — always at full speed. Sundown\'s slow-down is a Vinyl thing, part of the platter.';
  if(S.source) routeSource(S.source);
}

function isLibraryRouteVisible(){
  const r = document.getElementById('route-library');
  return !!(r && r.classList.contains('on'));
}
function isProfileRouteVisible(){
  const r = document.getElementById('route-profile');
  return !!(r && r.classList.contains('on'));
}

// the library tabs row (icons + the Songs/Crate/Artists/Playlists group)
// only ever shows on the library route; the icons stay even with an empty
// library (the + button is how you add your first files), but the tab
// buttons and the search icon itself only make sense once there's something
// to switch between or search (S1 §2.1)
function updateHeaderActionsAvailability(){
  const isLibrary = isLibraryRouteVisible();
  $('#libNav').style.display = isLibrary ? 'flex' : 'none';
  $('#libNavTabs').style.display = (isLibrary && S.tracks.length) ? 'flex' : 'none';
  $('#hdrSearchBtn').style.display = (isLibrary && S.tracks.length) ? '' : 'none';
}

// the crate replaces Albums as the first tab when that's the saved layout,
// so Songs/Artists/Playlists are never hidden by it (S1 §2.2, S2 §5)
function updateLibTabsForLayout(){
  const firstTab = $('#libNav [data-view="crate"]') || $('#libNav [data-view="albums"]');
  if(!firstTab) return;
  if(S.libraryLayout === 'crate'){ firstTab.dataset.view = 'crate'; firstTab.textContent = 'Crate'; }
  else { firstTab.dataset.view = 'albums'; firstTab.textContent = 'Albums'; }
}

// Library tools lives in static markup under #route-profile so re-renders
// of #profileBody never destroy its listeners (S1 §5 implementation note);
// this just refreshes its visibility, counts and row states
function refreshLibraryTools(){
  const tools = $('#libTools');
  if(!tools) return;
  const onHome = isProfileRouteVisible() && S.profileView.screen === 'home';
  tools.style.display = onHome ? 'block' : 'none';
  if(!onHome) return;
  const hasTracks = S.tracks.length > 0;
  $('#libToolsBody').style.display = hasTracks ? '' : 'none';
  $('#libToolsFooter').textContent = hasTracks
    ? (S.tracks.length + (S.tracks.length === 1 ? ' track' : ' tracks') + ' · ' + formatBytes(totalLibraryBytes()) + ' · stored on this device')
    : '';
  $('#crateGroupRow').style.display = (S.libraryLayout === 'crate') ? 'flex' : 'none';
  $('#crateGenreBtn').style.display = (typeof libraryHasGenres === 'function' && libraryHasGenres()) ? '' : 'none';
}

// header search field: swaps the library tabs row for a full-width search
// input, which lives in the header above it (S1 §2.1). Cancel clears and
// closes; the × only clears.
function openSearchField(){
  $('#libNav').style.display = 'none';
  $('#hdrSearchRow').style.display = 'flex';
  $('#hdrSearchBtn').classList.add('active');
  $('#librarySearch').focus();
  updateSearchChipsVisibility();
}
function closeSearchField(){
  updateHeaderActionsAvailability();
  $('#hdrSearchRow').style.display = 'none';
  $('#hdrSearchBtn').classList.remove('active');
  $('#searchChips').style.display = 'none';
}
function isSearchFieldOpen(){
  return $('#hdrSearchRow').style.display !== 'none';
}

// header + menu: Add songs / Add folder popover (S1 §3)
function openAddMenu(){
  // positioned from the button's own rect rather than a fixed CSS offset,
  // since the button now lives on the library tabs row instead of a fixed
  // header height above it
  const btn = $('#hdrAddBtn'), r = btn.getBoundingClientRect();
  const menu = $('#addMenu');
  menu.style.top = Math.round(r.bottom + window.scrollY + 8) + 'px';
  menu.style.right = Math.round(window.innerWidth - r.right) + 'px';
  $('#addScrim').style.top = Math.round(r.bottom) + 'px';   // position:fixed, so viewport-relative
  $('#addScrim').classList.add('open');
  menu.classList.add('open');
  btn.classList.add('add-open');
  btn.setAttribute('aria-expanded', 'true');
}
function closeAddMenu(){
  $('#addScrim').classList.remove('open');
  $('#addMenu').classList.remove('open');
  $('#hdrAddBtn').classList.remove('add-open');
  $('#hdrAddBtn').setAttribute('aria-expanded', 'false');
}
function isAddMenuOpen(){
  return $('#addMenu').classList.contains('open');
}

export function showRoute(name){
  // the gatefold is a library-only view (opened from the crate); it must
  // never persist over another tab's content since it's a fixed full-screen
  // overlay that would otherwise hide whatever route is switched to
  if(name !== 'library' && GF) closeGatefoldInstant();
  document.querySelectorAll('.tabbar-btn').forEach(b => b.setAttribute('aria-selected', String(b.dataset.route === name)));
  document.querySelectorAll('.route').forEach(p => p.classList.toggle('on', p.id === 'route-' + name));
  $('#appHeader').classList.toggle('no-border', name === 'library');
  updateHeaderActionsAvailability();
  if(name !== 'library'){ closeSearchField(); closeAddMenu(); }
  if(name === 'profile'){
    // library tools starts closed on every fresh visit to Profile (S1 §5)
    $('#libToolsPanel').classList.remove('open');
    $('#libToolsToggle').setAttribute('aria-expanded', 'false');
    renderProfile();
  }
  if(name === 'home') renderHome();
}

/* ================= wiring ================= */
(function init(){
  renderSearchChips();
  $('#play').addEventListener('click', async ()=>{
    if(!S.playing) bgPrime();
    if(!S.ctx) await ensureContext(null);
    if(S.playing) pause();
    // the sleeve is covering an empty platter — bring the disc back out
    // before playing, same ceremony as picking a track from the library
    else if(S.platterEmpty) runStartSequence(current(), updateShellAlbum(current()), play);
    else play();
  });
  $('#next').addEventListener('click', nextTrack);
  $('#prev').addEventListener('click', prevTrack);
  $('#shuffle').addEventListener('click', ()=>{ toggleShuffle(); queueSave(); });
  $('#repeat').addEventListener('click', ()=>{ cycleRepeat(); queueSave(); });
  document.querySelectorAll('[data-view]').forEach(b => b.addEventListener('click', ()=>{
    S.view.mode = b.dataset.view; S.view.group = null; S.view.artistAlbum = null; S.view.playlist = null;
    S.view.person = null; S.view.crateLooseIdx = null; S.view.picking = false;
    renderTracks();
  }));
  document.querySelectorAll('#libLayoutToggle [data-layout]').forEach(b => b.addEventListener('click', ()=>{
    S.libraryLayout = b.dataset.layout;
    document.querySelectorAll('#libLayoutToggle [data-layout]').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
    // the first tab's identity (crate vs flat albums) follows the layout —
    // if that's where the user currently is, follow it there too; otherwise
    // (Songs/Artists/Playlists, or drilled into something) leave them put
    if(S.view.mode === 'crate' || (S.view.mode === 'albums' && S.view.group === null)){
      S.view.mode = (S.libraryLayout === 'crate') ? 'crate' : 'albums';
    }
    queueSave();
    renderTracks();
  }));
  document.querySelectorAll('#crateGroupToggle [data-group]').forEach(b => b.addEventListener('click', ()=>{
    if(b.style.display === 'none') return;
    S.crateGroup = b.dataset.group;
    invalidateCrateModel();
    queueSave();
    renderTracks();
  }));
  document.querySelectorAll('#sidesToggle [data-sides]').forEach(b => b.addEventListener('click', ()=>{
    S.albumSides = b.dataset.sides === 'on';
    document.querySelectorAll('#sidesToggle [data-sides]').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
    queueSave();
  }));
  document.querySelectorAll('#sealedToggle [data-sealed]').forEach(b => b.addEventListener('click', ()=>{
    S.sealedRecords = b.dataset.sealed === 'on';
    document.querySelectorAll('#sealedToggle [data-sealed]').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
    queueSave();
    renderTracks();
  }));
  document.querySelectorAll('#playFullToggle [data-playfull]').forEach(b => b.addEventListener('click', ()=>{
    S.playInFullPlayer = b.dataset.playfull === 'on';
    document.querySelectorAll('#playFullToggle [data-playfull]').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
    queueSave();
  }));
  $('#scrub').addEventListener('input', ()=>{ S.scrubbing = true; });
  $('#scrub').addEventListener('change', e=>{
    S.scrubbing = false;
    const t = current(); if(t) seek((t.duration || 0) * e.target.value/1000);
  });
  $('#modeVinyl').addEventListener('click', ()=>{ setMode('vinyl'); queueSave(); });
  $('#modePure').addEventListener('click', ()=>{ setMode('pure'); queueSave(); });

  document.querySelectorAll('.tabbar-btn').forEach(b => b.addEventListener('click', ()=> showRoute(b.dataset.route)));

  $('#autoOn').addEventListener('click', ()=>{
    S.auto = true; $('#autoOn').setAttribute('aria-pressed','true'); $('#autoOff').setAttribute('aria-pressed','false');
    $('#manualRow').style.display = 'none';
    $('#autoDesc').textContent = 'The platter eases down across twilight.';
  });
  $('#autoOff').addEventListener('click', ()=>{
    S.auto = false; $('#autoOn').setAttribute('aria-pressed','false'); $('#autoOff').setAttribute('aria-pressed','true');
    $('#manualRow').style.display = 'block';
    $('#autoDesc').textContent = 'You are driving the platter yourself.';
  });
  $('#manual').addEventListener('input', e=>{
    S.manualRate = e.target.value/1000;
    $('#manualOut').textContent = S.manualRate.toFixed(3) + '×';
  });

  document.querySelectorAll('[data-target]').forEach(b => b.addEventListener('click', ()=>{
    S.target = parseFloat(b.dataset.target); queueSave();
    document.querySelectorAll('[data-target]').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
  }));
  document.querySelectorAll('[data-pace]').forEach(b => b.addEventListener('click', ()=>{
    S.pace = b.dataset.pace; queueSave();
    document.querySelectorAll('[data-pace]').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
    $('#pacingDesc').textContent = S.pace === 'window'
      ? 'Spread across the whole twilight window.'
      : 'Held back, then a felt drop near the end.';
  }));

  $('#preview').addEventListener('input', e=>{
    const v = +e.target.value;
    if(!S.sun.ok || v === 0){ S.previewMin = 0; $('#previewOut').textContent = 'Live'; return; }
    const span = (S.sun.dusk - S.sun.set)/60000;
    const from = (S.sun.set - Date.now())/60000 - 5;
    S.previewMin = from + (v/100) * (span + 12);
    const c = nowClock();
    $('#previewOut').textContent = c.toLocaleTimeString([], {hour:'numeric', minute:'2-digit'});
  });
  $('#liveBtn').addEventListener('click', ()=>{ S.previewMin = 0; $('#preview').value = 0; $('#previewOut').textContent = 'Live'; });

  const charMap = {wow:'wowOut', sat:'satOut', soft:'softOut', comp:'compOut'};
  Object.keys(charMap).forEach(k => {
    $('#' + k).addEventListener('input', e=>{
      S.char[k] = e.target.value/100;
      $('#' + charMap[k]).textContent = e.target.value + '%';
      applyCharacter(); queueSave();
    });
  });
  const presets = {light:{wow:.12,sat:.18,soft:.22,comp:.2}, classic:{wow:.30,sat:.35,soft:.40,comp:.35}, worn:{wow:.62,sat:.6,soft:.68,comp:.55}};
  document.querySelectorAll('[data-preset]').forEach(b => b.addEventListener('click', ()=>{
    const p = presets[b.dataset.preset];
    Object.keys(p).forEach(k => {
      S.char[k] = p[k]; $('#' + k).value = Math.round(p[k]*100);
      $('#' + charMap[k]).textContent = Math.round(p[k]*100) + '%';
    });
    applyCharacter(); queueSave();
    if(S.mode !== 'vinyl') setMode('vinyl');
  }));

  $('#scratchBtn').addEventListener('click', toggleScratch);
  $('#motionBtn').addEventListener('click', toggleMotion);
  $('#sleevePullBtn').addEventListener('click', toggleSleevePull);
  $('#launchIntroBtn').addEventListener('click', toggleLaunchIntro);
  attachLaunchSettingRow();
  $('#bgAudioBtn').addEventListener('click', toggleBgAudio);
  bgUpdateUI();
  $('#floor').addEventListener('input', e=>{ S.motion.floor = e.target.value/100; $('#floorOut').textContent = e.target.value + '%'; });
  $('#maxSpeed').addEventListener('input', e=>{
    S.motion.max = +e.target.value;
    $('#maxSpeedOut').textContent = Math.round(S.motion.max*2.23694) + ' mph';
  });

  $('#pick').addEventListener('click', ()=> $('#file').click());
  $('#pickFolder').addEventListener('click', ()=> $('#folderFile').click());
  $('#tone').addEventListener('click', addTestTone);
  $('#tone2').addEventListener('click', addTestTone);
  $('#file').addEventListener('change', e=> addFiles(e.target.files));
  $('#folderFile').addEventListener('change', e=> addFiles(e.target.files));

  // Drag-and-drop over the library route — the nearest web equivalent to
  // "Open in Miziki"/UIFileSharingEnabled, which have no web API (see
  // PLAYBACK/IMPORT spec §2). Folders dropped via the OS file manager are
  // walked recursively through the DataTransferItem entry API.
  const libRoute = $('#route-library');
  ['dragenter','dragover'].forEach(evt => libRoute.addEventListener(evt, e => {
    e.preventDefault(); libRoute.classList.add('drag-over');
  }));
  ['dragleave','drop'].forEach(evt => libRoute.addEventListener(evt, e => {
    e.preventDefault(); libRoute.classList.remove('drag-over');
  }));
  libRoute.addEventListener('drop', async e => {
    const items = e.dataTransfer && e.dataTransfer.items;
    const files = items ? await filesFromDataTransferItems(items) : Array.from(e.dataTransfer.files || []);
    if(files.length) addFiles(files);
  });

  let armed = false, armTimer = null;
  $('#forget').addEventListener('click', async e => {
    if(!armed){
      armed = true; e.target.textContent = 'TAP AGAIN';
      armTimer = setTimeout(()=>{ armed = false; e.target.textContent = 'FORGET'; }, 4000);
      return;
    }
    clearTimeout(armTimer); armed = false; e.target.textContent = 'FORGET';
    await forgetLibrary();
  });

  $('#clearHistoryBtn').addEventListener('click', ()=>{
    $('#clearHistoryOverlay').classList.add('open');
    $('#clearHistoryOverlay').setAttribute('aria-hidden', 'false');
  });
  const closeClearHistory = () => {
    $('#clearHistoryOverlay').classList.remove('open');
    $('#clearHistoryOverlay').setAttribute('aria-hidden', 'true');
  };
  $('#clearHistoryClose').addEventListener('click', closeClearHistory);
  $('#clearHistoryCancel').addEventListener('click', closeClearHistory);
  $('#clearOrphanedBtn').addEventListener('click', async ()=>{ closeClearHistory(); await clearListeningHistory(true); });
  $('#clearAllHistoryBtn').addEventListener('click', async ()=>{ closeClearHistory(); await clearListeningHistory(false); });

  $('#dupClose').addEventListener('click', ()=>closeDupOverlay('skip'));
  $('#dupKeepBoth').addEventListener('click', ()=>closeDupOverlay('keep'));
  $('#dupReplace').addEventListener('click', ()=>closeDupOverlay('replace'));
  $('#dupSkip').addEventListener('click', ()=>closeDupOverlay('skip'));

  $('#scanDuplicatesBtn').addEventListener('click', openDuplicateScan);
  $('#dupScanClose').addEventListener('click', closeDuplicateScan);

  let searchDebounce = null;
  $('#librarySearch').addEventListener('input', ()=>{
    updateSearchChipsVisibility();
    $('#hdrSearchClear').style.display = $('#librarySearch').value ? '' : 'none';
    clearTimeout(searchDebounce);
    searchDebounce = setTimeout(renderTracks, 120);
  });
  $('#librarySearch').addEventListener('focus', updateSearchChipsVisibility);
  $('#librarySearch').addEventListener('blur', ()=>{ setTimeout(updateSearchChipsVisibility, 120); });

  // header search icon / Cancel / × (S1 §2.1)
  $('#hdrSearchBtn').addEventListener('click', openSearchField);
  $('#hdrSearchCancel').addEventListener('click', ()=>{
    $('#librarySearch').value = '';
    $('#hdrSearchClear').style.display = 'none';
    closeSearchField();
    renderTracks();
  });
  $('#hdrSearchClear').addEventListener('click', ()=>{
    $('#librarySearch').value = '';
    $('#hdrSearchClear').style.display = 'none';
    $('#librarySearch').focus();
    updateSearchChipsVisibility();
    renderTracks();
  });

  // header + menu: Add songs / Add folder (S1 §3). The file-picker .click()
  // must fire synchronously inside this user-gesture handler (iOS Safari).
  $('#hdrAddBtn').addEventListener('click', ()=> isAddMenuOpen() ? closeAddMenu() : openAddMenu());
  $('#addScrim').addEventListener('click', closeAddMenu);
  $('#addSongsRow').addEventListener('click', ()=>{ closeAddMenu(); $('#file').click(); });
  $('#addFolderRow').addEventListener('click', ()=>{ closeAddMenu(); $('#folderFile').click(); });
  document.addEventListener('keydown', e => {
    if(e.key !== 'Escape') return;
    if(isGatefoldOpen()) closeGatefold();
    else if(isSealedSheetOpen()) closeSealedSheet();
    else if(isAddMenuOpen()){ closeAddMenu(); $('#hdrAddBtn').focus(); }
    else if(isSearchFieldOpen()){ $('#librarySearch').value = ''; closeSearchField(); renderTracks(); }
  });

  $('#gfBack').addEventListener('click', closeGatefold);
  $('#gfFlatBack').addEventListener('click', closeGatefold);
  $('#gfLeftCue').addEventListener('click', () => gatefoldSwitchPanel('left'));
  document.querySelectorAll('#gfPanelToggle [data-panel], #gfFlatSeg [data-panel]').forEach(b =>
    b.addEventListener('click', () => gatefoldSwitchPanel(b.dataset.panel)));
  window.addEventListener('resize', updateGatefoldScale);
  $('#sealSheetClose').addEventListener('click', closeSealedSheet);

  // Library tools disclosure panel (S1 §5)
  $('#libToolsToggle').addEventListener('click', ()=>{
    const open = $('#libToolsPanel').classList.toggle('open');
    $('#libToolsToggle').setAttribute('aria-expanded', String(open));
  });

  $('#selectToggle').addEventListener('click', enterSelectMode);
  $('#selectCancel').addEventListener('click', exitSelectMode);
  $('#selectEdit').addEventListener('click', ()=>{
    if(S.editSelection.size) openEditSheet(Array.from(S.editSelection));
  });
  $('#selectNumber').addEventListener('click', ()=>{
    if(S.editSelection.size) applyTrackNumbersInOrder();
  });
  $('#selectDelete').addEventListener('click', ()=>{
    const ids = Array.from(S.editSelection);
    if(!ids.length) return;
    openConfirmDelete('batch', ids.length, null, async () => { await deleteTracks(ids); exitSelectMode(); });
  });

  $('#rowMenuClose').addEventListener('click', closeRowMenu);
  $('#rowMenuEdit').addEventListener('click', ()=>{
    const id = rowMenuTrackId; closeRowMenu();
    if(id) openEditSheet([id]);
  });
  $('#rowMenuCredits').addEventListener('click', ()=>{
    const id = rowMenuTrackId; closeRowMenu();
    const t = S.tracks[idxOf(id)]; if(t) openCreditsSheet(t);
  });
  $('#rowMenuFav').addEventListener('click', ()=>{
    const id = rowMenuTrackId; closeRowMenu();
    if(id) toggleFavorite(id);
  });
  $('#rowMenuRemove').addEventListener('click', ()=>{
    const id = rowMenuTrackId; closeRowMenu();
    const t = S.tracks[idxOf(id)]; if(!t) return;
    openConfirmDelete('song', 1, t.tags.title, async () => { await deleteTracks([id]); });
  });
  $('#rowMenuPlayNext').addEventListener('click', ()=>{
    const id = rowMenuTrackId; closeRowMenu();
    const i = idxOf(id); if(i >= 0) playNext(i);
  });
  $('#rowMenuAddQueue').addEventListener('click', ()=>{
    const id = rowMenuTrackId; closeRowMenu();
    const i = idxOf(id); if(i >= 0) addToQueue(i);
  });

  $('#confirmClose').addEventListener('click', closeConfirmDelete);
  $('#confirmCancel').addEventListener('click', closeConfirmDelete);
  $('#confirmGo').addEventListener('click', async ()=>{
    const action = confirmDeleteAction;
    closeConfirmDelete();
    if(action) await action();
  });

  $('#editCurrentBtn').addEventListener('click', ()=>{ const t = current(); if(t) openEditSheet([t.id]); });
  $('#trackInfoBtn').addEventListener('click', ()=>{ const t = current(); if(t) openCreditsSheet(t); });
  $('#creditsClose').addEventListener('click', closeCreditsSheet);
  $('#socialAuthClose').addEventListener('click', closeSocialAuth);
  $('#socialNavBack').addEventListener('click', popSocialScreen);
  $('#recordSheetClose').addEventListener('click', closeRecordSheet);
  $('#playerFavBtn').addEventListener('click', ()=>{ const t = current(); if(t) toggleFavorite(t.id); });
  $('#miniFavBtn').addEventListener('click', e => { e.stopPropagation(); const t = current(); if(t) toggleFavorite(t.id); });
  $('#sleepTimerBtn').addEventListener('click', openSleepSheet);
  $('#sleepClose').addEventListener('click', closeSleepSheet);
  $('#editClose').addEventListener('click', closeEditSheet);
  $('#editSave').addEventListener('click', saveEditSheet);
  $('#editRevert').addEventListener('click', async ()=>{
    const target = S.editTarget;
    if(!target || target.batch) return;
    await revertTrack(target.trackIds[0]);
    closeEditSheet();
  });
  $('#editArtPick').addEventListener('click', ()=> $('#editArtFile').click());
  $('#editArtFile').addEventListener('change', async e=>{
    const file = e.target.files[0];
    e.target.value = '';
    if(!file) return;
    try{
      const blob = await cropSquareImage(file, 800);
      S.editArtBlob = blob;
      renderEditArtPreview(URL.createObjectURL(blob));
    }catch(err){ /* bad image — leave whatever preview was already showing */ }
  });
  $('#undoBtn').addEventListener('click', undoLastEdit);

  $('#profilePicFile').addEventListener('change', async e=>{
    const file = e.target.files[0];
    e.target.value = '';
    if(!file) return;
    try{
      const blob = await cropSquareImage(file, 500);
      if(S.profile.art) try{ URL.revokeObjectURL(S.profile.art); }catch(err){}
      S.profile.artBlob = blob;
      S.profile.art = URL.createObjectURL(blob);
      await persistProfile();
      renderProfile();
    }catch(err){ /* bad image — leave the existing picture as-is */ }
  });

  $('#shareClose').addEventListener('click', closeShareSheet);
  document.querySelectorAll('#shareToggles button').forEach(b => b.addEventListener('click', ()=>{
    const key = b.dataset.section;
    S.shareSelection[key] = !S.shareSelection[key];
    b.setAttribute('aria-pressed', String(S.shareSelection[key]));
    queueShareRender();
  }));
  document.querySelectorAll('#shareStyleRow .share-style-chip').forEach(b => b.addEventListener('click', ()=>{
    S.shareStyle = b.dataset.style;
    document.querySelectorAll('#shareStyleRow .share-style-chip').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
    document.querySelectorAll('#playerShareStyleRow .share-style-chip').forEach(x => x.setAttribute('aria-pressed', String(x.dataset.style === S.shareStyle)));
    queueSave(); queueShareRender();
  }));
  document.querySelectorAll('#shareFormatSeg [data-format]').forEach(b => b.addEventListener('click', ()=>{
    S.shareFormat = b.dataset.format;
    document.querySelectorAll('#shareFormatSeg [data-format]').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
    queueSave(); queueShareRender();
  }));
  $('#shareShareBtn').addEventListener('click', () => shareDoShare($('#shareCanvas'), 'miziki-crate-' + shareSelectedFormat('shareFormatSeg','square') + '.png'));
  $('#shareSave').addEventListener('click', () => shareDoSave($('#shareCanvas'), 'miziki-crate-' + shareSelectedFormat('shareFormatSeg','square') + '.png'));
  $('#shareCopy').addEventListener('click', () => shareDoCopy($('#shareCanvas')));

  $('#playerShareBtn').addEventListener('click', openPlayerShareSheet);
  $('#playerShareClose').addEventListener('click', closePlayerShareSheet);
  $('#lookBtn').addEventListener('click', openLookPicker);
  $('#queueBtn').addEventListener('click', openQueueSheet);
  $('#miniQueueBtn').addEventListener('click', openQueueSheet);
  $('#queueClose').addEventListener('click', closeQueueSheet);
  $('#lookClose').addEventListener('click', closeLookPicker);
  $('#sortMenuClose').addEventListener('click', closeSortMenu);
  document.querySelectorAll('#playerShareStyleRow .share-style-chip').forEach(b => b.addEventListener('click', ()=>{
    S.shareStyle = b.dataset.style;
    document.querySelectorAll('#playerShareStyleRow .share-style-chip').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
    document.querySelectorAll('#shareStyleRow .share-style-chip').forEach(x => x.setAttribute('aria-pressed', String(x.dataset.style === S.shareStyle)));
    queueSave(); queuePlayerShareRender();
  }));
  document.querySelectorAll('#playerShareFormatSeg [data-format]').forEach(b => b.addEventListener('click', ()=>{
    S.shareFormat = b.dataset.format;
    document.querySelectorAll('#playerShareFormatSeg [data-format]').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
    queueSave(); queuePlayerShareRender();
  }));
  $('#playerShareShareBtn').addEventListener('click', () => shareDoShare($('#playerShareCanvas'), 'miziki-now-playing-' + shareSelectedFormat('playerShareFormatSeg','story') + '.png'));
  $('#playerShareSave').addEventListener('click', () => shareDoSave($('#playerShareCanvas'), 'miziki-now-playing-' + shareSelectedFormat('playerShareFormatSeg','story') + '.png'));
  $('#playerShareCopy').addEventListener('click', () => shareDoCopy($('#playerShareCanvas')));

  // backgrounding is the last reliable moment before the OS can kill the tab —
  // write the in-progress session synchronously, not on a timer
  document.addEventListener('visibilitychange', () => {
    if(document.visibilityState === 'hidden') touchActiveSession();
  });

  wireSpinToScrub();

  $('#miniTap').addEventListener('click', openPlayer);
  $('#miniPlay').addEventListener('click', async ()=>{
    if(!S.playing) bgPrime();
    if(!S.ctx) await ensureContext(null);
    if(S.playing) pause();
    else if(S.platterEmpty && S.playerOpen) runStartSequence(current(), updateShellAlbum(current()), play);
    else if(S.platterEmpty){
      // the full player isn't open to show the pull, so there's nothing to
      // animate — skip straight to the pulled-out end state, same as
      // advance() already does for an ordinary track change with the
      // player closed, rather than running an unseen ~3-5s ceremony first
      S.platterEmpty = false;
      $('#platterBox').classList.remove('disc-hidden');
      play();
    }
    else play();
  });
  $('#playerDismiss').addEventListener('click', closePlayer);
  $('#playerOverlay').addEventListener('pointerdown', ()=>{
    interruptStartSequence();            // pull/return-to-sleeve: snap to end state
    if(morphInFlight()) interruptMorph(); // morph: reverse cleanly instead
    if(gfHandoffInFlight()) interruptGatefoldHandoff();   // hand-off flight: land instantly
  }, {capture:true});

  setMode('vinyl');
  fallbackSun();
  askLocation();
  drawSun();
  updateChromeInset();
  window.addEventListener('resize', updateChromeInset);
  requestAnimationFrame(frame);
  restoreLibrary();   // runs underneath the launch intro below; never waits on it
  // REDUCED and document.hidden are known synchronously; S.launchIntro's
  // persisted value isn't (it loads inside restoreLibrary()), so
  // runLaunchSequence() re-checks it itself once that's resolved
  if(REDUCED || document.hidden) $('#launchOverlay').remove();
  else runLaunchSequence();
})();

async function restoreLibrary(){
  const note = $('#storeNote');
  const ok = await storage.open();
  if(!ok){
    note.textContent = 'Storage is not available here, so this library lasts only for the session. '
      + 'Served from your own address and added to the Home Screen, it persists.';
    renderTracks();
    libraryReadyResolve();
    return;
  }
  try{ if(navigator.storage && navigator.storage.persist) navigator.storage.persist(); }catch(e){}
  const recs = await tracks.all();
  recs.sort((a,b) => (a.addedAt||0) - (b.addedAt||0));
  for(const r of recs){
    const t = {
      id:r.id, addedAt:r.addedAt, name:r.tags.title, tags:Object.assign({}, r.tags), details: r.details || null, meta:r.meta,
      duration:r.duration, buffer:null, blob:null, stored:true, artBlob:null,
      gaplessDelaySec:r.gaplessDelaySec || 0, gaplessPaddingSec:r.gaplessPaddingSec || 0,
      sizeBytes:r.sizeBytes || 0,
      art: r.art ? URL.createObjectURL(r.art) : null
    };
    await loadOverlayFor(t);
    S.tracks.push(t);
  }
  await restoreMeta();
  await restoreSessions();
  await restoreSealedAlbums();
  rebuildPeopleIndex();
  invalidateCrateModel();
  renderTracks();
  healThumbs().catch(() => {});
  healDetails().catch(() => {});
  healCrateArt().catch(() => {});
  libraryReadyResolve();   // from here on the launch intro's library variant has what it needs
  if(S.tracks.length){
    // the mini player should agree with the launch intro's title screen —
    // both show what was last played, not just the first file in the
    // library (see LAUNCH spec C5)
    const lastAlbum = resolveLastPlayedAlbum();
    const lastIdx = lastAlbum !== null ? resolveLastPlayedTrackIndex(lastAlbum) : -1;
    setQueue(allIdx(), lastIdx >= 0 ? lastIdx : 0, false);
    note.textContent = S.tracks.length + (S.tracks.length === 1 ? ' track' : ' tracks')
      + ' restored from this device. Tracks are decoded as you play them, so opening Miziki stays quick.';
  } else {
    note.textContent = 'Your library will be kept on this device. Add it to your Home Screen so iOS does not clear it.';
  }
  await MizikiSocial.init({ url: SOCIAL_SUPABASE_URL, anonKey: SOCIAL_SUPABASE_ANON_KEY,
    env: { S, DB, albumKey, trackTier, albumMetalFor } });
  MizikiSocial.libraryLoaded();
  $('#homeTabBtn').style.display = MizikiSocial.status().enabled ? '' : 'none';
  MizikiSocial.on('status', s => { $('#homeTabBtn').style.display = s.enabled ? '' : 'none'; });
  if(new URLSearchParams(location.search).get('social') === 'demo') installSocialDemo();
}
