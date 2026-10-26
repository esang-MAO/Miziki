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
   stayed out of this module in step 5c — it's tightly coupled to
   restoreSealedAlbums/isAlbumSealed/breakSeal, none of which are
   session-tracking, and S.sealed is deliberately independent of
   listening history (SEALED spec §2) — it moved, with the rest of that
   cohesive unit, into src/library/sealed.js in step 6b instead. */
import { S, current, touchBackupKey } from '../state.js';
import { albumKey, trackTier, selectVariant, VARIANT_DEFS, CHART_VERSION } from '../record-art/tiers.js';
import { albumTracks } from '../library/model.js';
import { sessions, meta, achievements, collection, profile } from '../storage/repo.js';
// Real circular import with looks.js (step 6b) — looks.js imports
// persistAlbumLookPref back from here, the same shape already established
// between engine.js and transport.js (step 3a). restoreThumbs is a real,
// non-circular import (step 6b) — thumbs.js doesn't depend on this module.
import { applyDiscVariant } from '../record-art/looks.js';
import { restoreThumbs, persistable } from '../library/thumbs.js';
// PRESSINGS_110 PR7 (docs/PRESSINGS_110.md §8): distinct calendar days —
// dayKeyFor() is the already-established local-calendar-day-key helper
// (RF22's own S.phasePlayCountsByDay bucketing), reused here rather than
// a second date-keying scheme.
import { dayKeyFor } from '../sundown/rhythm.js';

const FOUR_HOURS = 4 * 3600 * 1000;

// PRESSINGS_110 PR7 (docs/PRESSINGS_110.md §8): kept in its own named
// constant, per the spec's own "keep the numbers in one config block so
// they're easy to tune" instruction. Raised from the spec's original 3 to
// 10 at Ken's request (2026-10-26): "I want the zoetrope to be a bit more
// challenging to earn than the metals" — the top metal (platinum) needs
// 40 qualifying sessions with no day-spread at all, so a determined
// binge-listener could clear it in a single sitting; a zoetrope can
// never be rushed that way regardless of this number, since each day
// only ever contributes one credit no matter how many full play-throughs
// happen on it. 10 keeps that "lived with it over time" shape (Ken's own
// stated preference for the different-days mechanic) while making the
// zoetrope clearly the harder, slower-to-earn of the two.
export const ZOETROPE_DAYS_TO_EARN = 10;

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
// DA5 (docs/DAY_ARC.md) — written by history/played.js's incrementTrackPlay(),
// persisted/restored here alongside every other history counter it's a
// sibling of (the same split this module already has for trackPlayCounts).
export async function persistPhasePlayCounts(){ await meta.put('phasePlayCounts', S.phasePlayCounts); }
export async function persistAlbumPhaseCounts(){ await meta.put('albumPhaseCounts', S.albumPhaseCounts); }
// RF22 (docs/12_REFINE.md) -- device-only, never in the backup doc (see
// state.js's own S.phasePlayCountsByDay entry); persisted/restored the
// same way as every sibling counter in this file regardless.
export async function persistPhasePlayCountsByDay(){ await meta.put('phasePlayCountsByDay', S.phasePlayCountsByDay); }
// RF17 (docs/12_REFINE.md): `keys` is the album id (or ids) that actually
// changed, same per-key-stamp shape as library/thumbs.js's persistAlbumDisplay.
export async function persistAlbumLookPref(keys){
  await meta.put('albumLookPref', S.albumLookPref);
  (Array.isArray(keys) ? keys : keys != null ? [keys] : []).forEach(k => touchBackupKey('albumLookPref', k));
}
// AU9 (docs/16_AUDIO.md §5): the personal per-album format override
// (Auto/33⅓/45) — same per-key-stamp shape as persistAlbumLookPref above.
export async function persistAlbumFormat(keys){
  await meta.put('albumFormat', S.albumFormat);
  (Array.isArray(keys) ? keys : keys != null ? [keys] : []).forEach(k => touchBackupKey('albumFormat', k));
}
export async function persistAlbumLastPlayed(){ await meta.put('albumLastPlayed', S.albumLastPlayed); }
// PRESSINGS_110 PR7 (docs/PRESSINGS_110.md §8): zoetropes get their own
// session milestone pool, entirely separate from rareUnlocked above — same
// union-of-flags backed-up shape, same persist-on-every-change posture.
export async function persistZoetropeUnlocked(){ await meta.put('zoetropeUnlocked', S.zoetropeUnlocked); }
export async function persistZoetropeDayProgress(){ await meta.put('zoetropeDayProgress', S.zoetropeDayProgress); }

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
    checkZoetropeUnlock(albumId);
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

// PRESSINGS_110 PR7 (docs/PRESSINGS_110.md §8): the zoetrope's own milestone
// pool — a full, in-order, no-skip play-through (the same completion this
// function already requires to even reach here, per spec §8's "reuse the
// existing in-order/no-skip session-completion machinery") on
// ZOETROPE_DAYS_TO_EARN distinct calendar days. "Session, never the file" —
// nothing here reads the album's hash; the zoetrope stays unreachable from
// looks.js's rendering until this flag flips, same reasoning as rareUnlocked.
function checkZoetropeUnlock(albumId){
  if(S.zoetropeUnlocked[albumId]) return;
  const days = S.zoetropeDayProgress[albumId] || (S.zoetropeDayProgress[albumId] = []);
  const today = dayKeyFor(Date.now());
  if(!days.includes(today)){
    days.push(today);
    persistZoetropeDayProgress();
  }
  if(days.length >= ZOETROPE_DAYS_TO_EARN){
    S.zoetropeUnlocked[albumId] = true;
    persistZoetropeUnlocked();
    // reveal happens on its own via the existing pressing peek (discLook()
    // is called fresh every time, record-art/peek.js) — this refresh is
    // only for the platter if this same album happens to be loaded right
    // now, the same "refresh what's already showing" shape checkRareUnlock
    // uses just below.
    const t = current();
    if(t && albumKey(t) === albumId) applyDiscVariant(t, true);
  }
}

// PRESSINGS_110 (docs/PRESSINGS_110.md §8, point 1): the effects shelf grew
// 32 -> 54, which changes where `hash % shelfSize` lands for a hi-res
// (tier 3) album whose draw happened to land on an effect. A Collection
// record discovered before this growth has no chartVersion stamp at all
// (or one below the current CHART_VERSION); re-run selectVariant() against
// a still-in-library sample track and overwrite the stored variant/pattern
// — discoveredAt is untouched, since this isn't a new discovery, just the
// one-time re-draw the spec calls for. Tier 2 (solid) records are left
// alone: the 40-solid pool/mix is unchanged by this growth, so recomputing
// one would always be a no-op. An album with no track left in the library
// (forgotten, not deleted) keeps its stale record, same as any other
// "nothing to recompute against" case elsewhere in this codebase — it'll
// be picked up the next time this runs, once a matching file reappears.
export async function migrateChartVersion(){
  for(const albumId of Object.keys(S.collection)){
    const rec = S.collection[albumId];
    if(rec.tier !== 3) continue;
    if((rec.chartVersion || 1) >= CHART_VERSION) continue;
    const sample = S.tracks.find(t => albumKey(t) === albumId);
    if(!sample) continue;
    const {variant} = selectVariant(sample);
    rec.variant = variant;
    rec.pattern = VARIANT_DEFS[variant].pattern;
    rec.chartVersion = CHART_VERSION;
    await collection.put(persistable(rec));
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
  // PRESSINGS_110 PR7 (docs/PRESSINGS_110.md §8)
  const zoetropeUnlocked = await meta.get('zoetropeUnlocked');
  if(zoetropeUnlocked) S.zoetropeUnlocked = zoetropeUnlocked;
  const zoetropeDayProgress = await meta.get('zoetropeDayProgress');
  if(zoetropeDayProgress) S.zoetropeDayProgress = zoetropeDayProgress;
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
  const phaseCounts = await meta.get('phasePlayCounts');
  if(phaseCounts) S.phasePlayCounts = phaseCounts;
  const albumPhase = await meta.get('albumPhaseCounts');
  if(albumPhase) S.albumPhaseCounts = albumPhase;
  // RF22 (docs/12_REFINE.md) -- a device that hasn't written this yet
  // (every install before this step) just reads an empty season, not a
  // thrown error; the rhythm card then simply reads as "not enough plays
  // yet" until new plays repopulate it.
  const phaseCountsByDay = await meta.get('phasePlayCountsByDay');
  if(phaseCountsByDay) S.phasePlayCountsByDay = phaseCountsByDay;
  const lookPref = await meta.get('albumLookPref');
  if(lookPref) S.albumLookPref = lookPref;
  // AU9 (docs/16_AUDIO.md §5)
  const albumFormatPref = await meta.get('albumFormat');
  if(albumFormatPref) S.albumFormat = albumFormatPref;
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
  await migrateChartVersion();
  await restoreThumbs();   // rebuilds every record's `art` from its stored thumbnail
  const prof = await profile.get('me');
  if(prof){
    S.profile.name = prof.name || '';
    S.profile.username = prof.username || '';
    if(prof.pictureBlob) S.profile.art = URL.createObjectURL(prof.pictureBlob);
  }
}
