/* ================= clear listening history =================
   Deliberately separate from deletion — deletion never touches listening
   history, this is the only path that does (see LIBRARY spec §1). Full
   scope wipes everything; the lighter "orphaned only" scope drops just
   the records for identities no longer in the library, leaving current
   albums untouched. */
import { S, current } from '../state.js';
import { $ } from '../util/dom.js';
import { albumKey, trackIdentityKey } from '../record-art/tiers.js';
import { achievements, collection, sessions, meta } from '../storage/repo.js';
import {
  persistSessionCounts, persistMetalEligibleSessions, persistRareUnlocked,
  persistAlbumLastPlayed, persistAlbumLookPref, persistTrackPlayCounts,
  persistTrackMetalEligiblePlays, persistPhasePlayCounts, persistAlbumPhaseCounts,
  persistPhasePlayCountsByDay,
  // PRESSINGS_110 PR7 (docs/PRESSINGS_110.md §8): zoetropeUnlocked/
  // zoetropeDayProgress are session-derived milestone state, the exact
  // same class as rareUnlocked right above — both scopes below reset/prune
  // it the same way rareUnlocked already is.
  persistZoetropeUnlocked, persistZoetropeDayProgress,
  // RW7 (docs/23_RHYTHM_AND_WEAR.md): "Clear listening history" resets
  // wear (it's history) -- same treatment as albumLastPlayed above.
  persistAlbumFirstPlayed,
} from './sessions.js';
import { persistAlbumDisplay, persistTrackDisplay, pruneThumbs } from '../library/thumbs.js';
import { applyDiscVariant } from '../record-art/looks.js';
import { persistTrackLastPlayed, renderProfile } from '../profile/screens.js';
import { scheduleBackupSync } from '../sync/backup.js';

function currentAlbumIds(){ return new Set(S.tracks.map(albumKey)); }
function currentTrackKeys(){ return new Set(S.tracks.map(trackIdentityKey)); }
function filterKeep(dict, keepSet){
  const out = {};
  Object.keys(dict).forEach(k => { if(keepSet.has(k)) out[k] = dict[k]; });
  return out;
}

// RF1 (docs/12_REFINE.md): the full-scope reset, factored out so it can be
// called from two places with the exact same effect — this module's own
// clearListeningHistory() below (a local "Clear listening history" tap),
// and sync/backup.js's applyMerged() when another device's clear turns out
// to be newer (the 'ownReset' case). Zeroes *and persists* every field a
// full clear touches — before this existed, applyMerged() only zeroed four
// counters in memory and persisted none of it, so a reload read the old
// counts straight back out of meta and the next push re-uploaded them,
// undoing the clear on every device. Deliberately leaves `historyClearedAt`
// itself untouched: a local clear stamps today's date, while adopting
// another device's clear adopts its stamp instead — see each caller.
export async function resetLocalHistory(){
  // RF17 (docs/12_REFINE.md): capture every key being wiped *before* wiping
  // it, so persistAlbumDisplay/persistAlbumLookPref/persistTrackDisplay (now
  // per-key — thumbs.js's/sessions.js's own entries) can stamp a tombstone
  // for each one, rather than touching nothing and leaving every album's
  // last stamp (and thus its merged value) unchanged on the next sync.
  const albumDisplayKeys = Object.keys(S.albumDisplay);
  const albumLookPrefKeys = Object.keys(S.albumLookPref);
  const trackDisplayKeys = Object.keys(S.trackDisplay);
  S.sessionCounts = {}; S.metalEligibleSessions = {}; S.rareUnlocked = {};
  S.zoetropeUnlocked = {}; S.zoetropeDayProgress = {};
  S.albumLastPlayed = {}; S.albumFirstPlayed = {}; S.albumDisplay = {}; S.albumLookPref = {};
  S.achievements = {}; S.collection = {}; S.sessions = {}; S.sessionActive = null;
  S.trackPlayCounts = {}; S.trackMetalEligiblePlays = {}; S.trackLastPlayed = {}; S.trackDisplay = {};
  S.phasePlayCounts = {}; S.albumPhaseCounts = {};
  // RF22 (docs/12_REFINE.md): the day-bucketed twin of phasePlayCounts —
  // same full-scope-only treatment (see the orphaned-only branch below).
  S.phasePlayCountsByDay = {};
  await achievements.clear(); await collection.clear(); await sessions.clear();
  await pruneThumbs();
  await Promise.all([
    persistSessionCounts(), persistMetalEligibleSessions(), persistRareUnlocked(),
    persistZoetropeUnlocked(), persistZoetropeDayProgress(),
    persistAlbumLastPlayed(), persistAlbumFirstPlayed(), persistAlbumDisplay(albumDisplayKeys), persistAlbumLookPref(albumLookPrefKeys),
    persistTrackPlayCounts(), persistTrackMetalEligiblePlays(), persistTrackLastPlayed(), persistTrackDisplay(trackDisplayKeys),
    persistPhasePlayCounts(), persistAlbumPhaseCounts(), persistPhasePlayCountsByDay()
  ]);
}

export async function clearListeningHistory(orphanedOnly){
  if(orphanedOnly){
    const albumIds = currentAlbumIds(), trackKeys = currentTrackKeys();
    const droppedAlbums = Object.keys(S.achievements).filter(id => !albumIds.has(id));
    const droppedCollection = Object.keys(S.collection).filter(id => !albumIds.has(id));
    const droppedSessions = Object.keys(S.sessions).filter(id => !albumIds.has(id));
    // RF17: the keys actually pruned by this orphaned-only pass, for the
    // same per-key tombstone reason resetLocalHistory() captures its own
    // full-wipe keys above.
    const droppedAlbumDisplay = Object.keys(S.albumDisplay).filter(id => !albumIds.has(id));
    const droppedAlbumLookPref = Object.keys(S.albumLookPref).filter(id => !albumIds.has(id));
    const droppedTrackDisplay = Object.keys(S.trackDisplay).filter(k => !trackKeys.has(k));
    S.sessionCounts = filterKeep(S.sessionCounts, albumIds);
    S.metalEligibleSessions = filterKeep(S.metalEligibleSessions, albumIds);
    S.rareUnlocked = filterKeep(S.rareUnlocked, albumIds);
    S.zoetropeUnlocked = filterKeep(S.zoetropeUnlocked, albumIds);
    S.zoetropeDayProgress = filterKeep(S.zoetropeDayProgress, albumIds);
    S.albumLastPlayed = filterKeep(S.albumLastPlayed, albumIds);
    S.albumFirstPlayed = filterKeep(S.albumFirstPlayed, albumIds);
    S.albumDisplay = filterKeep(S.albumDisplay, albumIds);
    S.albumLookPref = filterKeep(S.albumLookPref, albumIds);
    S.achievements = filterKeep(S.achievements, albumIds);
    S.collection = filterKeep(S.collection, albumIds);
    S.sessions = filterKeep(S.sessions, albumIds);
    S.trackPlayCounts = filterKeep(S.trackPlayCounts, trackKeys);
    S.trackMetalEligiblePlays = filterKeep(S.trackMetalEligiblePlays, trackKeys);
    S.trackLastPlayed = filterKeep(S.trackLastPlayed, trackKeys);
    S.trackDisplay = filterKeep(S.trackDisplay, trackKeys);
    // DA5 (docs/DAY_ARC.md): albumPhaseCounts is keyed by album, same
    // identity shape as sessionCounts/albumLastPlayed just above — pruned
    // the same way. phasePlayCounts has no per-identity shape at all (it's
    // a pure phase aggregate with nothing to key an orphaned-only prune
    // by), so it's never touched here, the same way a full-scope clear is
    // the only thing that ever resets it below. phasePlayCountsByDay
    // (RF22, docs/12_REFINE.md) is keyed by calendar day, not by any
    // library identity either, so it's left alone here for the same
    // reason — a season has no per-album/per-track shape to prune by.
    S.albumPhaseCounts = filterKeep(S.albumPhaseCounts, albumIds);
    for(const id of droppedAlbums) await achievements.del(id);
    for(const id of droppedCollection) await collection.del(id);
    for(const id of droppedSessions) await sessions.del(id);
    await pruneThumbs();
    await Promise.all([
      persistSessionCounts(), persistMetalEligibleSessions(), persistRareUnlocked(),
      persistZoetropeUnlocked(), persistZoetropeDayProgress(),
      persistAlbumLastPlayed(), persistAlbumFirstPlayed(), persistAlbumDisplay(droppedAlbumDisplay), persistAlbumLookPref(droppedAlbumLookPref),
      persistTrackPlayCounts(), persistTrackMetalEligiblePlays(), persistTrackLastPlayed(), persistTrackDisplay(droppedTrackDisplay),
      persistPhasePlayCounts(), persistAlbumPhaseCounts()
    ]);
  } else {
    await resetLocalHistory();
    // only a *full*-scope clear counts as "I want my stats reset" for the
    // cross-device merge (B2 table) — orphaned-only just prunes identities
    // no longer in *this* device's library, which forcing onto every other
    // device could wipe stats they still have every reason to keep
    S.historyClearedAt = Date.now();
    await meta.put('historyClearedAt', S.historyClearedAt);
  }
  const t = current();
  if(t) applyDiscVariant(t, true);
  const profileRoute = $('#route-profile');
  if(profileRoute && profileRoute.classList.contains('on')) renderProfile();
  scheduleBackupSync();
}
