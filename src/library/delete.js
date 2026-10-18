/* ================= deletion =================
   Moved out of main.js (step 5d). Removes files from Miziki's library
   only — never from disk. Listening history is not file-scoped:
   sessionCounts/rareUnlocked/albumLastPlayed/albumDisplay/achievements/
   collection are already keyed by the normalized album identity
   (albumKey), and trackPlayCounts/trackLastPlayed/trackDisplay by the
   normalized track identity (trackIdentityKey) — none of that touches the
   file id, so it's untouched by deletion and rematches automatically the
   moment a track with the same identity is added back. See LIBRARY
   spec §1. */
import { S, touchBackupField } from '../state.js';
import { $ } from '../util/dom.js';
import { albumKey } from '../record-art/tiers.js';
import { idOf, idxOf, allIdx } from './model.js';
import { tracks, overlays, artwork } from '../storage/repo.js';
import { stop } from '../player/transport.js';
import { setQueue } from '../player/queue.js';
import { stopSleepState } from '../player/sleep-timer.js';
import { drawTime } from '../player/clock.js';
import { invalidateActiveSessionIfAny } from '../history/sessions.js';
import { rebuildPeopleIndex } from './credits.js';
import { applyDiscVariant } from '../record-art/looks.js';
import { persistSealedAlbums } from './sealed.js';
import { queueSave } from '../storage/meta.js';
import { clearSpinDown } from '../shell/put-away.js';
import { forceCloseLayer } from '../shell/nav-stack.js';
import { renderMiniPlayer } from '../shell/mini-player.js';
import { deleteCrateArtTiers } from '../crate/tiers.js';
import { invalidateCrateModel } from '../crate/model.js';
import { renderTracks } from './view.js';
import { pruneThumbs } from './thumbs.js';

export function countForAlbum(album){ return S.tracks.filter(t => t.tags.album === album).length; }
export function countForArtist(artist){ return S.tracks.filter(t => t.tags.artist === artist).length; }

export function formatBytes(n){
  if(!n) return '0 MB';
  const units = ['B','KB','MB','GB','TB'];
  let i = 0;
  while(n >= 1024 && i < units.length - 1){ n /= 1024; i++; }
  return n.toFixed(i === 0 ? 0 : 1) + ' ' + units[i];
}
export function totalLibraryBytes(){ return S.tracks.reduce((sum,t) => sum + (t.sizeBytes || 0), 0); }

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

  S.tracks.forEach(t => { if(idSet.has(t.id) && t.art) try{ URL.revokeObjectURL(t.art); }catch(_e){} });
  const removedAlbumIds = new Set();
  S.tracks.forEach(t => { if(idSet.has(t.id)) removedAlbumIds.add(albumKey(t)); });
  S.tracks = S.tracks.filter(t => !idSet.has(t.id));
  // an album that just lost its last track has no tracks left to cut crate
  // art from — drop its tiers rather than leaving them stranded (spec §B3)
  const survivingAlbumIds = new Set(S.tracks.map(albumKey));
  let sealedChanged = false;
  for(const albumId of removedAlbumIds){
    if(survivingAlbumIds.has(albumId)) continue;
    await deleteCrateArtTiers(albumId);
    if(S.sealed.delete(albumId)) sealedChanged = true;   // SEALED spec §2
  }
  if(sealedChanged) persistSealedAlbums();

  for(const id of idsToDelete){
    await tracks.del(id);
    await overlays.del(id);
    await artwork.del(id);
  }

  // explicit deletion actually drops membership — unlike forgetLibrary
  // (F3 spec), which never touches these at all so everything reconnects
  S.playlists.forEach(p => { p.items = p.items.filter(id => !idSet.has(id)); });
  touchBackupField('playlists');
  Object.keys(S.albumOrder).forEach(a => {
    S.albumOrder[a] = S.albumOrder[a].filter(id => !idSet.has(id));
    if(!S.albumOrder[a].length) delete S.albumOrder[a];
  });
  touchBackupField('albumOrder');
  S.lru = [];

  if(removingCurrent){
    S.index = -1; S.pendingShellInfo = null; S.shellAlbumId = null; S.platterEmpty = false;
    if(S.tracks.length){
      $('#platterBox').classList.add('disc-hidden');
      setQueue(allIdx(), 0, false);   // silent priming un-hides it again once the next track lands
    } else {
      S.queue = []; S.baseQueue = []; S.qpos = 0;
      MizikiSocial.stopSpinning();
      $('#trackName').textContent = 'Nothing on the platter';
      $('#trackBy').textContent = ''; $('#trackSpec').textContent = 'Load a file to see its signal path';
      $('#label').classList.remove('has-art'); $('#labelArt').removeAttribute('src');
      $('#labelTitle').textContent = '';
      applyDiscVariant(null);
      // closePlayer()'s interrupt unconditionally un-hides the disc (skipping
      // "lands" the record) — order matters here since there's no record to
      // land, the library is empty, so disc-hidden must be (re-)applied after
      if(S.playerOpen) forceCloseLayer('player');
      $('#platterBox').classList.add('disc-hidden');
      $('#playerShareBtn').style.display = 'none';
      $('#queueBtn').style.display = 'none';
      $('#sleepTimerBtn').style.display = 'none';
      $('#trackInfoBtn').style.display = 'none';
      $('#playerFavBtn').style.display = 'none';
      stopSleepState();
    }
  } else {
    S.queue = queueIds.map(idxOf).filter(i => i >= 0);
    S.baseQueue = baseQueueIds.map(idxOf).filter(i => i >= 0);
    S.index = idxOf(currentId);
    S.qpos = Math.max(0, S.queue.indexOf(S.index));
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

/* F3 spec (step 02): "Forget library" removes your songs and keeps your
   listening stats. It used to clear the tracks/meta/sessions/overlays/
   artwork stores wholesale, which erased play counts, sessions, metals,
   sealed state, playlists, edits and settings along with the songs
   themselves — and left some in-memory stats fields un-reset, so a later
   save could write part of that half-cleared state back (the write-back
   bug step 5d already flagged). Now only the tracks store, this album's
   crate-art tiers, and thumbnails nothing else still references are
   removed; meta/sessions/overlays/achievements/collection are untouched,
   so playlists, track edits, custom covers, manual order/sort and sealed
   state all wait and reconnect automatically once the same files (same
   id: name|size|lastModified) are added back. "Clear listening history"
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

  S.tracks.forEach(t => { if(t.art) try{ URL.revokeObjectURL(t.art); }catch(_e){} });
  invalidateActiveSessionIfAny();   // end any in-flight session cleanly first, so a half-played album is never counted
  stop();
  S.tracks = []; S.index = -1;
  S.queue = []; S.baseQueue = []; S.qpos = 0; S.lru = [];
  S.curPlayed = []; S.curTrackDone = false;
  S.shellAlbumId = null; S.outgoingArt = null; S.outgoingHasArt = false; S.pendingShellInfo = null;
  // playlists, albumOrder/albumSort, S.sealed, every listening-stats field
  // on S, settings and the profile are deliberately left exactly as they
  // were — see this function's own header comment
  $('#trackName').textContent = 'Nothing on the platter';
  $('#trackBy').textContent = ''; $('#trackSpec').textContent = 'Load a file to see its signal path';
  $('#label').classList.remove('has-art'); $('#labelArt').removeAttribute('src');
  $('#labelTitle').textContent = '';
  applyDiscVariant(null);
  forceCloseLayer('player');
  // closePlayer()'s interrupt may have just finished putting a record away
  // (S.platterEmpty true) or landed one instantly — either way there's no
  // library left, so the empty-platter look is reasserted unconditionally
  S.platterEmpty = false; clearSpinDown();
  $('#sleeve').style.display = 'none';
  $('#platterBox').classList.add('disc-hidden');
  $('#playerShareBtn').style.display = 'none';
  $('#queueBtn').style.display = 'none';
  $('#sleepTimerBtn').style.display = 'none';
  $('#trackInfoBtn').style.display = 'none';
  $('#playerFavBtn').style.display = 'none';
  stopSleepState();
  renderTracks(); drawTime(); renderMiniPlayer();
}
