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
import { achievements, collection, sessions } from '../storage/repo.js';
import {
  persistSessionCounts, persistMetalEligibleSessions, persistRareUnlocked,
  persistAlbumLastPlayed, persistAlbumLookPref, persistTrackPlayCounts,
  persistTrackMetalEligiblePlays,
} from './sessions.js';
// Temporary circular imports back to main.js (rule 8 in CLAUDE.md) —
// screen/thumbnail/sealed-records functions not yet extracted. Used only
// inside the functions below, never at module top level.
import {
  persistAlbumDisplay, persistTrackDisplay, persistTrackLastPlayed,
  pruneThumbs, applyDiscVariant, renderProfile,
} from '../main.js';

function currentAlbumIds(){ return new Set(S.tracks.map(albumKey)); }
function currentTrackKeys(){ return new Set(S.tracks.map(trackIdentityKey)); }
function filterKeep(dict, keepSet){
  const out = {};
  Object.keys(dict).forEach(k => { if(keepSet.has(k)) out[k] = dict[k]; });
  return out;
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
    for(const id of droppedAlbums) await achievements.del(id);
    for(const id of droppedCollection) await collection.del(id);
    for(const id of droppedSessions) await sessions.del(id);
  } else {
    S.sessionCounts = {}; S.metalEligibleSessions = {}; S.rareUnlocked = {};
    S.albumLastPlayed = {}; S.albumDisplay = {}; S.albumLookPref = {};
    S.achievements = {}; S.collection = {}; S.sessions = {}; S.sessionActive = null;
    S.trackPlayCounts = {}; S.trackMetalEligiblePlays = {}; S.trackLastPlayed = {}; S.trackDisplay = {};
    await achievements.clear(); await collection.clear(); await sessions.clear();
  }
  await pruneThumbs();
  await Promise.all([
    persistSessionCounts(), persistMetalEligibleSessions(), persistRareUnlocked(),
    persistAlbumLastPlayed(), persistAlbumDisplay(), persistAlbumLookPref(),
    persistTrackPlayCounts(), persistTrackMetalEligiblePlays(), persistTrackLastPlayed(), persistTrackDisplay()
  ]);
  const t = current();
  if(t) applyDiscVariant(t, true);
  const profileRoute = $('#route-profile');
  if(profileRoute && profileRoute.classList.contains('on')) renderProfile();
}
