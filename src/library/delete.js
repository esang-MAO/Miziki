/* ================= deletion =================
   Removes files from Miziki's library only — never from disk. Listening
   history is not file-scoped:
   sessionCounts/rareUnlocked/albumLastPlayed/albumDisplay/achievements/
   collection are already keyed by the normalized album identity
   (albumKey), and trackPlayCounts/trackLastPlayed/trackDisplay by the
   normalized track identity (trackIdentityKey) — none of that touches the
   file id, so it's untouched by deletion and rematches automatically the
   moment a track with the same identity is added back. See LIBRARY
   spec §1. */
import { S, touchBackupKey, touchBackupMembership } from '../state.js';
import { $ } from '../util/dom.js';
import { albumKey } from '../record-art/tiers.js';
import { idOf, idxOf, allIdx } from './model.js';
import { tracks, overlays, artwork, meta } from '../storage/repo.js';
import { stop } from '../player/transport.js';
import { setQueue, setQueueList, setQpos } from '../player/queue.js';
import { stopSleepState } from '../player/sleep-timer.js';
import { drawTime } from '../player/clock.js';
import { invalidateActiveSessionIfAny, persistAlbumLookPref, persistAlbumFormat, persistAlbumKeptFor } from '../history/sessions.js';
import { rebuildPeopleIndex, clearAlbumLinerNoteOverride } from './credits.js';
import { applyDiscVariant } from '../record-art/looks.js';
import { applyDeadWaxEtching } from '../record-art/etchings.js';
import { persistSealedAlbums } from './sealed.js';
import { clearAlbumBackCoverImage } from '../gatefold/back-cover.js';
import { queueSave } from '../storage/meta.js';
import { clearSpinDown } from '../shell/put-away.js';
import { forceCloseLayer } from '../shell/nav-stack.js';
import { renderMiniPlayer } from '../shell/mini-player.js';
import { deleteCrateArtTiers } from '../crate/tiers.js';
import { invalidateCrateModel } from '../crate/model.js';
import { renderTracks } from './view.js';
import { pruneThumbs } from './thumbs.js';
export { formatBytes } from '../util/text.js';

export function countForAlbum(album){ return S.tracks.filter(t => t.tags.album === album).length; }
export function countForArtist(artist){ return S.tracks.filter(t => t.tags.artist === artist).length; }

export function totalLibraryBytes(){ return S.tracks.reduce((sum,t) => sum + (t.sizeBytes || 0), 0); }

// Shared by deleteTracks()'s own per-emptied-album loop below and
// sweepOrphanedAlbumOverrides() further down -- an album with no tracks
// left (whether just now, or from a deletion before either of those
// existed) really is forgotten, so every per-album override it ever
// carried goes with it: look pick, speed override, "Keep for…" claim,
// liner note, and its own back-cover photo+claim.
async function dropAlbumOverrides(albumId){
  if(albumId in S.albumLookPref){ delete S.albumLookPref[albumId]; await persistAlbumLookPref(albumId); }
  if(albumId in S.albumFormat){ delete S.albumFormat[albumId]; await persistAlbumFormat(albumId); }
  if(albumId in S.albumKeptFor){ delete S.albumKeptFor[albumId]; await persistAlbumKeptFor(albumId); }
  clearAlbumLinerNoteOverride(albumId);
  await clearAlbumBackCoverImage(albumId);
}

export async function deleteTracks(idsToDelete){
  const idSet = new Set(idsToDelete);
  if(!idSet.size) return;

  const currentId = idOf(S.index);
  const removingCurrent = currentId !== null && idSet.has(currentId);

  // the queue is still index-based, so it gets snapshotted as ids first and
  // rebuilt onto whatever indices the survivors land at after the splice;
  // playlists/albumOrder are already ids (F3 spec), so deleting a track is
  // just dropping its id from them below, no snapshot/rebuild needed
  const queueIds = S.queue.map(idOf).filter(Boolean);
  const baseQueueIds = S.baseQueue.map(idOf).filter(Boolean);

  if(removingCurrent){
    invalidateActiveSessionIfAny();
    stop();
    // cancel any in-flight ceremony without interruptStartSequence()'s
    // auto-resume side effect — the track it would resume is being deleted
    S.sleeveSeq++;
    const stage = $('#platterStage');
    stage.classList.remove('sleeve-arriving','sleeve-exiting','disc-emerging','returning','changing','putaway-in','putaway-slide','putaway-out');
    clearSpinDown();
    $('#sleeve').style.display = 'none';
  }

  S.tracks.forEach(t => { if(idSet.has(t.id) && t.art) try{ URL.revokeObjectURL(t.art); }catch(_e){} }); // already revoked -- expected, not logged
  const removedAlbumIds = new Set();
  S.tracks.forEach(t => { if(idSet.has(t.id)) removedAlbumIds.add(albumKey(t)); });
  S.tracks = S.tracks.filter(t => !idSet.has(t.id));
  // an album that just lost its last track has no tracks left to cut crate
  // art from — drop its tiers rather than leaving them stranded (spec §B3).
  // Same posture for every other per-album override below (look pref,
  // format, back cover, liner note, "Keep for…"): explicit deletion really
  // forgets this album, unlike forgetLibrary (F3 spec), which leaves these
  // alone on purpose so a later re-add reconnects them. Listening
  // stats/history are the one exception (see this file's own header) --
  // deletion never touches those, only "Clear listening history" does.
  const survivingAlbumIds = new Set(S.tracks.map(albumKey));
  let sealedChanged = false;
  for(const albumId of removedAlbumIds){
    if(survivingAlbumIds.has(albumId)) continue;
    await deleteCrateArtTiers(albumId);
    if(S.sealed.delete(albumId)) sealedChanged = true;   // SEALED spec §2
    await dropAlbumOverrides(albumId);
  }
  if(sealedChanged) persistSealedAlbums();

  for(const id of idsToDelete){
    await tracks.del(id);
    await overlays.del(id);
    await artwork.del(id);
  }
  // Catches the one case the per-album loop above can't: a thumbnail for an
  // album/track that was never played (so no stats row claims it) and is
  // now gone from the library too -- pruneThumbs() only drops thumbnails
  // nothing else (a stats row) still references, so this never touches one
  // backing an album/track history is still keeping.
  await pruneThumbs();

  // explicit deletion actually drops membership — unlike forgetLibrary
  // (F3 spec), which never touches these at all so everything reconnects.
  // RF17 (docs/12_REFINE.md): each dropped (playlist, id) pair gets its own
  // removal tombstone (touchBackupMembership), same add-wins shape as
  // view.js's togglePick()/favorites.js's toggleFavorite() — a removal
  // here must win on merge over a device that still has the track.
  S.playlists.forEach(p => {
    const removedIds = p.items.filter(id => idSet.has(id));
    if(!removedIds.length) return;
    p.items = p.items.filter(id => !idSet.has(id));
    removedIds.forEach(id => touchBackupMembership(p.name, id, 'removed'));
    touchBackupKey('playlistOrder', p.name);
  });
  Object.keys(S.albumOrder).forEach(a => {
    const before = S.albumOrder[a];
    const after = before.filter(id => !idSet.has(id));
    if(after.length === before.length) return;
    if(after.length) S.albumOrder[a] = after; else delete S.albumOrder[a];
    touchBackupKey('albumOrder', a);
  });
  S.lru = [];

  if(removingCurrent){
    S.index = -1; S.pendingShellInfo = null; S.shellAlbumId = null; S.platterEmpty = false;
    if(S.tracks.length){
      $('#platterBox').classList.add('disc-hidden');
      setQueue(allIdx(), 0, false);   // silent priming un-hides it again once the next track lands
    } else {
      setQueueList([]); S.baseQueue = []; setQpos(0);
      MizikiSocial.stopSpinning();
      $('#trackName').textContent = 'Nothing on the platter';
      $('#trackBy').textContent = ''; $('#trackSpec').textContent = 'Load a file to see its signal path';
      $('#nowSideKicker').textContent = '';
      $('#label').classList.remove('has-art'); $('#labelArt').removeAttribute('src');
      $('#labelTitle').textContent = '';
      applyDeadWaxEtching(null, '');
      applyDiscVariant(null);
      // closePlayer()'s interrupt unconditionally un-hides the disc (skipping
      // "lands" the record) — order matters here since there's no record to
      // land, the library is empty, so disc-hidden must be (re-)applied after
      if(S.playerOpen) forceCloseLayer('player');
      $('#platterBox').classList.add('disc-hidden');
      $('#playerShareIconBtn').style.display = 'none';
      $('#queueBtn').style.display = 'none';
      $('#playerQueueBtn').style.display = 'none';
      $('#sleepTimerBtn').style.display = 'none';
      $('#trackInfoBtn').style.display = 'none';
      $('#playerFavBtn').style.display = 'none';
      stopSleepState();
    }
  } else {
    setQueueList(queueIds.map(idxOf).filter(i => i >= 0));
    S.baseQueue = baseQueueIds.map(idxOf).filter(i => i >= 0);
    S.index = idxOf(currentId);
    setQpos(Math.max(0, S.queue.indexOf(S.index)));
  }

  rebuildPeopleIndex();
  invalidateCrateModel();
  renderTracks();
  renderMiniPlayer();
  queueSave();
  MizikiSocial.libraryChanged();
}

export function deleteAlbum(album){
  deleteTracks(S.tracks.filter(t => t.tags.album === album).map(t => t.id));
}
export function deleteArtist(artist){
  deleteTracks(S.tracks.filter(t => t.tags.artist === artist).map(t => t.id));
}

/* F3 spec: "Forget library" removes your songs and keeps your listening
   stats. Only the tracks store, this album's crate-art tiers, and
   thumbnails nothing else still references are removed; meta/sessions/
   overlays/achievements/collection are untouched, so playlists, track
   edits, custom covers, manual order/sort and sealed state all wait and
   reconnect automatically once the same files (same id:
   name|size|lastModified) are added back. "Clear listening history"
   stays the one place that resets stats. */
export async function forgetLibrary(){
  // every crate-tier image belongs to an album about to lose its last
  // track — drop them all up front, the same per-album cleanup
  // deleteTracks() already does when a single album empties out
  for(const albumId of new Set(S.tracks.map(albumKey))) await deleteCrateArtTiers(albumId);

  await tracks.clear();
  // overlays (track edits, custom covers) and every stats store (meta,
  // sessions, achievements, collection) are deliberately left alone —
  // they're keyed by the file's own id, or by trackIdentityKey/albumKey,
  // never by position, so they're exactly where they were the moment a
  // file with the same id comes back
  await pruneThumbs();   // drops only the thumbnails nothing else still references

  S.tracks.forEach(t => { if(t.art) try{ URL.revokeObjectURL(t.art); }catch(_e){} }); // already revoked -- expected, not logged
  invalidateActiveSessionIfAny();   // end any in-flight session cleanly first, so a half-played album is never counted
  stop();
  S.tracks = []; S.index = -1;
  setQueueList([]); S.baseQueue = []; setQpos(0); S.lru = [];
  S.curPlayed = []; S.curTrackDone = false;
  S.shellAlbumId = null; S.outgoingArt = null; S.outgoingHasArt = false; S.pendingShellInfo = null;
  // playlists, albumOrder/albumSort, S.sealed, every listening-stats field
  // on S, settings and the profile are deliberately left exactly as they
  // were — see this function's own header comment
  $('#trackName').textContent = 'Nothing on the platter';
  $('#trackBy').textContent = ''; $('#trackSpec').textContent = 'Load a file to see its signal path';
  $('#nowSideKicker').textContent = '';
  $('#label').classList.remove('has-art'); $('#labelArt').removeAttribute('src');
  $('#labelTitle').textContent = '';
  applyDeadWaxEtching(null, '');
  applyDiscVariant(null);
  forceCloseLayer('player');
  // closePlayer()'s interrupt may have just finished putting a record away
  // (S.platterEmpty true) or landed one instantly — either way there's no
  // library left, so the empty-platter look is reasserted unconditionally
  S.platterEmpty = false; clearSpinDown();
  $('#sleeve').style.display = 'none';
  $('#platterBox').classList.add('disc-hidden');
  $('#playerShareIconBtn').style.display = 'none';
  $('#queueBtn').style.display = 'none';
  $('#playerQueueBtn').style.display = 'none';
  $('#sleepTimerBtn').style.display = 'none';
  $('#trackInfoBtn').style.display = 'none';
  $('#playerFavBtn').style.display = 'none';
  stopSleepState();
  renderTracks(); drawTime(); renderMiniPlayer();
}

// One-time backlog cleanup (2026-11-16, Ken): deleteTracks()'s own
// dropAlbumOverrides() above only ever prevents a *new* leak -- it can't
// reach back and clean up an override orphaned by a deletion from before
// that fix shipped. This sweeps every album override an album with no
// tracks left in the library is still carrying, once, the first time a
// build with it runs on a device -- gated by the 'albumOverrideSweepDone'
// meta flag so it never runs again. That gate matters: forgetLibrary()
// deliberately leaves every one of these in place so a later re-add
// reconnects them (its own header comment) -- a *recurring* boot-time
// sweep would treat that exact "waiting to reconnect" state as orphaned
// (every album looks gone right after a Forget Library) and silently
// break the reconnect promise the next time anyone used it. Run once
// against today's backlog, never again, and that risk doesn't exist.
export async function sweepOrphanedAlbumOverrides(){
  if(await meta.get('albumOverrideSweepDone')) return;
  const currentAlbumIds = new Set(S.tracks.map(albumKey));
  const orphaned = new Set();
  [S.albumLookPref, S.albumFormat, S.albumKeptFor, S.albumLinerNote].forEach(dict => {
    Object.keys(dict).forEach(id => { if(!currentAlbumIds.has(id)) orphaned.add(id); });
  });
  (await artwork.all()).forEach(row => {
    if(!row || typeof row.id !== 'string' || row.id.indexOf('back:') !== 0) return;
    const albumId = row.id.slice(5);
    if(!currentAlbumIds.has(albumId)) orphaned.add(albumId);
  });
  for(const albumId of orphaned) await dropAlbumOverrides(albumId);
  await meta.put('albumOverrideSweepDone', true);
}
