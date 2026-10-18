/* ================= clear listening history =================
   Moved out of main.js (step 5c; the decoded-audio cache that used to
   sit in this section moved separately, in 5a). Deliberately separate
   from deletion — deletion never touches listening history, this is
   the only path that does (see LIBRARY spec §1). Full scope wipes
   everything; the lighter "orphaned only" scope drops just the records
   for identities no longer in the library, leaving current albums
   untouched. */
import { S, current } from '../state.js';
import { $ } from '../util/dom.js';
import { albumKey, trackIdentityKey } from '../record-art/tiers.js';
import { achievements, collection, sessions, meta } from '../storage/repo.js';
import {
  persistSessionCounts, persistMetalEligibleSessions, persistRareUnlocked,
  persistAlbumLastPlayed, persistAlbumLookPref, persistTrackPlayCounts,
  persistTrackMetalEligiblePlays, persistPhasePlayCounts, persistAlbumPhaseCounts,
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
  S.sessionCounts = {}; S.metalEligibleSessions = {}; S.rareUnlocked = {};
  S.albumLastPlayed = {}; S.albumDisplay = {}; S.albumLookPref = {};
  S.achievements = {}; S.collection = {}; S.sessions = {}; S.sessionActive = null;
  S.trackPlayCounts = {}; S.trackMetalEligiblePlays = {}; S.trackLastPlayed = {}; S.trackDisplay = {};
  S.phasePlayCounts = {}; S.albumPhaseCounts = {};
  await achievements.clear(); await collection.clear(); await sessions.clear();
  await pruneThumbs();
  await Promise.all([
    persistSessionCounts(), persistMetalEligibleSessions(), persistRareUnlocked(),
    persistAlbumLastPlayed(), persistAlbumDisplay(), persistAlbumLookPref(),
    persistTrackPlayCounts(), persistTrackMetalEligiblePlays(), persistTrackLastPlayed(), persistTrackDisplay(),
    persistPhasePlayCounts(), persistAlbumPhaseCounts()
  ]);
}

export async function clearListeningHistory(orphanedOnly){
  if(orphanedOnly){
    const albumIds = currentAlbumIds(), trackKeys = currentTrackKeys();
    const droppedAlbums = Object.keys(S.achievements).filter(id => !albumIds.has(id));
    const droppedCollection = Object.keys(S.collection).filter(id => !albumIds.has(id));
    const droppedSessions = Object.keys(S.sessions).filter(id => !albumIds.has(id));
    S.sessionCounts = filterKeep(S.sessionCounts, albumIds);
    S.metalEligibleSessions = filterKeep(S.metalEligibleSessions, albumIds);
    S.rareUnlocked = filterKeep(S.rareUnlocked, albumIds);
    S.albumLastPlayed = filterKeep(S.albumLastPlayed, albumIds);
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
    // the only thing that ever resets it below.
    S.albumPhaseCounts = filterKeep(S.albumPhaseCounts, albumIds);
    for(const id of droppedAlbums) await achievements.del(id);
    for(const id of droppedCollection) await collection.del(id);
    for(const id of droppedSessions) await sessions.del(id);
    await pruneThumbs();
    await Promise.all([
      persistSessionCounts(), persistMetalEligibleSessions(), persistRareUnlocked(),
      persistAlbumLastPlayed(), persistAlbumDisplay(), persistAlbumLookPref(),
      persistTrackPlayCounts(), persistTrackMetalEligiblePlays(), persistTrackLastPlayed(), persistTrackDisplay(),
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
