/* ================= record art: session tracking =================
   Moved out of main.js (step 5c). A "qualifying session" is one full
   play-through of an album, in order, with shuffle off, zero skips, and
   every track actually heard (not just scrubbed past) to 95%. See spec
   §7-8. Persisted one record per in-progress album so a
   backgrounded/killed app can resume within a 4-hour gap.

   persistAlbumLastPlayed moved here too, from the old "profile tab"
   section — S.albumLastPlayed is written only by sessionTrackComplete
   below, so its setter belongs beside its one writer, not beside the
   profile screen that merely reads it for display. persistSealedAlbums
   stayed in main.js's "sealed records" section instead: it's tightly
   coupled to restoreSealedAlbums/isAlbumSealed/breakSeal there, none of
   which are session-tracking, and S.sealed is deliberately independent
   of listening history (SEALED spec §2) — moving just the persist
   function away from its siblings would split a cohesive unit for no
   benefit. */
import { S, current } from '../state.js';
import { albumKey, trackTier } from '../record-art/tiers.js';
import { albumTracks } from '../library/model.js';
import { sessions, meta, achievements, collection, profile } from '../storage/repo.js';
// Temporary circular imports back to main.js (rule 8 in CLAUDE.md) —
// screen/thumbnail functions not yet extracted. Used only inside the
// functions below, never at module top level.
import { applyDiscVariant, restoreThumbs } from '../main.js';

const FOUR_HOURS = 4 * 3600 * 1000;

export function albumExpectedOrder(albumId){
  const sample = S.tracks.find(t => albumKey(t) === albumId);
  if(!sample) return [];
  return albumTracks(sample.tags.album).map(i => S.tracks[i].id);
}

async function persistSession(rec){ S.sessions[rec.albumId] = rec; await sessions.put(rec); }
export async function persistSessionCounts(){ await meta.put('sessionCounts', S.sessionCounts); }
export async function persistRareUnlocked(){ await meta.put('rareUnlocked', S.rareUnlocked); }
export async function persistTrackPlayCounts(){ await meta.put('trackPlayCounts', S.trackPlayCounts); }
export async function persistMetalEligibleSessions(){ await meta.put('metalEligibleSessions', S.metalEligibleSessions); }
export async function persistTrackMetalEligiblePlays(){ await meta.put('trackMetalEligiblePlays', S.trackMetalEligiblePlays); }
export async function persistAlbumLookPref(){ await meta.put('albumLookPref', S.albumLookPref); }
export async function persistAlbumLastPlayed(){ await meta.put('albumLastPlayed', S.albumLastPlayed); }

function startSession(albumId){
  const order = albumExpectedOrder(albumId);
  if(!order.length) return null;
  const rec = {albumId, startedAt:Date.now(), lastActivityAt:Date.now(),
    tracksCompleted:[], expectedOrder:order, invalidated:false};
  persistSession(rec);
  return rec;
}

// skip, shuffle-on, and out-of-order jumps are all "invalidating events" —
// write the flag (per spec §8), then drop it from the active set
function invalidateSession(albumId){
  const rec = S.sessions[albumId];
  if(!rec) return;
  rec.invalidated = true; rec.lastActivityAt = Date.now();
  sessions.put(rec);
  delete S.sessions[albumId];
}
function discardSession(albumId){ delete S.sessions[albumId]; sessions.put({albumId, invalidated:true, lastActivityAt:Date.now(), tracksCompleted:[], expectedOrder:[], startedAt:Date.now()}); }

export function invalidateActiveSessionIfAny(){
  if(S.sessionActive) invalidateSession(S.sessionActive);
  S.sessionActive = null;
}

export function touchActiveSession(){
  const rec = S.sessionActive && S.sessions[S.sessionActive];
  if(!rec) return;
  rec.lastActivityAt = Date.now();
  sessions.put(rec);
}

// called whenever a new track finishes loading; decides whether this track
// continues, starts, or falls outside of album session tracking
export function sessionOnLoad(t){
  if(!t){ S.sessionActive = null; return; }
  if(S.shuffle){ S.sessionActive = null; return; }
  const albumId = albumKey(t);
  const order = albumExpectedOrder(albumId);
  const idx = order.indexOf(t.id);
  let rec = S.sessions[albumId];

  if(rec && Date.now() - rec.lastActivityAt > FOUR_HOURS){
    discardSession(albumId);
    rec = null;
  }

  if(rec){
    const expectedNext = rec.tracksCompleted.length;
    if(idx === expectedNext){
      rec.lastActivityAt = Date.now();
      persistSession(rec);
      S.sessionActive = albumId;
      return;
    }
    invalidateSession(albumId);
    rec = null;
  }

  if(idx === 0){
    startSession(albumId);
    S.sessionActive = albumId;
  } else {
    S.sessionActive = null;
  }
}

export function sessionTrackComplete(t){
  const albumId = albumKey(t);
  if(S.sessionActive !== albumId) return;
  const rec = S.sessions[albumId];
  if(!rec) return;
  const nextIdx = rec.tracksCompleted.length;
  if(rec.expectedOrder[nextIdx] !== t.id) return;
  rec.tracksCompleted.push(t.id);
  rec.lastActivityAt = Date.now();
  if(rec.tracksCompleted.length >= rec.expectedOrder.length){
    delete S.sessions[albumId];
    sessions.put(rec);
    S.sessionActive = null;
    S.sessionCounts[albumId] = (S.sessionCounts[albumId] || 0) + 1;
    if(trackTier(t) === 1) S.metalEligibleSessions[albumId] = (S.metalEligibleSessions[albumId] || 0) + 1;
    S.albumLastPlayed[albumId] = Date.now();
    persistSessionCounts();
    persistMetalEligibleSessions();
    persistAlbumLastPlayed();
    checkRareUnlock(albumId);
    MizikiSocial.listeningChanged();
    // the album metal (if any) is a pure function of the count that just
    // changed — re-render the platter if this album is still what's showing
    const cur = current();
    if(cur && albumKey(cur) === albumId) applyDiscVariant(cur, true);
  } else {
    persistSession(rec);
  }
}

// no indicator, no progress display — the unlock is silent by design
// sits above Platinum (40 sessions) as the true ceiling of the album ladder —
// see METAL spec §5: Bronze 8 -> Silver 15 -> Gold 25 -> Platinum 40 -> Rare 50
function checkRareUnlock(albumId){
  if(S.rareUnlocked[albumId]) return;
  if((S.sessionCounts[albumId] || 0) >= 50){
    S.rareUnlocked[albumId] = true;
    persistRareUnlocked();
    const t = current();
    if(t && albumKey(t) === albumId) applyDiscVariant(t, true);
  }
}

export async function restoreSessions(){
  const recs = await sessions.all();
  const now = Date.now();
  recs.forEach(r => {
    if(r.invalidated) return;
    if(now - r.lastActivityAt > FOUR_HOURS) return;
    S.sessions[r.albumId] = r;
  });
  const counts = await meta.get('sessionCounts');
  if(counts) S.sessionCounts = counts;
  const unlocked = await meta.get('rareUnlocked');
  if(unlocked) S.rareUnlocked = unlocked;
  const plays = await meta.get('trackPlayCounts');
  if(plays) S.trackPlayCounts = plays;
  // fall back to a copy of the true lifetime counters if this is the first
  // load since the metal-eligible shadow counters were introduced — correct
  // for anyone who hasn't upgraded a tier-1 album yet, which is the common
  // case, and only diverges going forward for those who have
  const metalSessions = await meta.get('metalEligibleSessions');
  S.metalEligibleSessions = metalSessions || Object.assign({}, S.sessionCounts);
  const metalPlays = await meta.get('trackMetalEligiblePlays');
  S.trackMetalEligiblePlays = metalPlays || Object.assign({}, S.trackPlayCounts);
  const lookPref = await meta.get('albumLookPref');
  if(lookPref) S.albumLookPref = lookPref;
  const albumLast = await meta.get('albumLastPlayed');
  if(albumLast) S.albumLastPlayed = albumLast;
  const trackLast = await meta.get('trackLastPlayed');
  if(trackLast) S.trackLastPlayed = trackLast;
  const display = await meta.get('albumDisplay');
  if(display) S.albumDisplay = display;
  const trackDisp = await meta.get('trackDisplay');
  if(trackDisp) S.trackDisplay = trackDisp;
  const edge = await meta.get('albumEdge');
  if(edge) S.albumEdge = edge;
  (await achievements.all()).forEach(r => { S.achievements[r.albumId] = r; });
  (await collection.all()).forEach(r => { S.collection[r.albumId] = r; });
  await restoreThumbs();   // rebuilds every record's `art` from its stored thumbnail
  const prof = await profile.get('me');
  if(prof){
    S.profile.name = prof.name || '';
    S.profile.username = prof.username || '';
    if(prof.pictureBlob) S.profile.art = URL.createObjectURL(prof.pictureBlob);
  }
}
