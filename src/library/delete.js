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
import { S } from '../state.js';
import { $ } from '../util/dom.js';
import { albumKey } from '../record-art/tiers.js';
import { idOf, idxOf, allIdx } from './model.js';
import { tracks, overlays, artwork, meta, sessions } from '../storage/repo.js';
import { stop } from '../player/transport.js';
import { setQueue } from '../player/queue.js';
import { stopSleepState } from '../player/sleep-timer.js';
import { drawTime } from '../player/clock.js';
import { invalidateActiveSessionIfAny } from '../history/sessions.js';
// Temporary circular imports back to main.js (rule 8 in CLAUDE.md) —
// screen/crate-art-tier/sealed-records/persistence functions not yet
// extracted. Used only inside the functions below, never at module top level.
import {
  clearSpinDown, deleteCrateArtTiers, persistSealedAlbums, closePlayer,
  rebuildPeopleIndex, invalidateCrateModel, renderTracks, renderMiniPlayer,
  queueSave, applyDiscVariant,
} from '../main.js';

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

  // every index-based structure gets snapshotted as ids first, then rebuilt
  // onto whatever indices the survivors land at after the splice — the same
  // id<->index round trip saveMeta()/restoreMeta() already use for persistence
  const plSnapshot = S.playlists.map(p => ({name:p.name, items:p.items.map(idOf).filter(Boolean), system:p.system}));
  const ordSnapshot = {};
  Object.keys(S.albumOrder).forEach(a => { ordSnapshot[a] = S.albumOrder[a].map(idOf).filter(Boolean); });
  const queueIds = S.queue.map(idOf).filter(Boolean);
  const baseQueueIds = S.baseQueue.map(idOf).filter(Boolean);

  if(removingCurrent){
    invalidateActiveSessionIfAny();
    stop();
    // cancel any in-flight ceremony without interruptStartSequence()'s
    // auto-resume side effect — the track it would resume is being deleted
    S.sleeveSeq++;
    const stage = $('#platterStage');
    stage.classList.remove('sleeve-arriving','sleeve-exiting','disc-emerging','returning','putaway-in','putaway-slide','putaway-out');
    clearSpinDown();
    $('#sleeve').style.display = 'none';
  }

  S.tracks.forEach(t => { if(idSet.has(t.id) && t.art) try{ URL.revokeObjectURL(t.art); }catch(e){} });
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

  S.playlists = plSnapshot.map(p => ({name:p.name, items:p.items.map(idxOf).filter(i => i >= 0), system:p.system}));
  const newOrder = {};
  Object.keys(ordSnapshot).forEach(a => { const arr = ordSnapshot[a].map(idxOf).filter(i => i >= 0); if(arr.length) newOrder[a] = arr; });
  S.albumOrder = newOrder;
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
      applyDiscVariant(null);
      // closePlayer()'s interrupt unconditionally un-hides the disc (skipping
      // "lands" the record) — order matters here since there's no record to
      // land, the library is empty, so disc-hidden must be (re-)applied after
      if(S.playerOpen) closePlayer();
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

export async function forgetLibrary(){
  // achievements and the Collection outlive "forget library", so their thumbnails do too
  const keepThumbs = [];
  for(const id of new Set(Object.keys(S.achievements).concat(Object.keys(S.collection)))){
    const key = 'thumb:album:' + id;
    const blob = await meta.get(key);
    if(blob) keepThumbs.push({key, blob});
  }
  await tracks.clear(); await meta.clear(); await sessions.clear();
  await overlays.clear(); await artwork.clear();
  for(const {key, blob} of keepThumbs) await meta.put(key, blob);
  S.tracks.forEach(t => { if(t.art) try{ URL.revokeObjectURL(t.art); }catch(e){} });
  stop();
  S.tracks = []; S.index = -1; S.playlists = []; S.albumOrder = {}; S.albumSort = {};
  S.queue = []; S.baseQueue = []; S.lru = [];
  S.sealed = new Set();   // the meta row holding it was just cleared above (SEALED spec §2)
  S.sessions = {}; S.sessionCounts = {}; S.rareUnlocked = {}; S.sessionActive = null;
  S.curPlayed = []; S.curTrackDone = false;
  S.shellAlbumId = null; S.outgoingArt = null; S.outgoingHasArt = false; S.pendingShellInfo = null;
  $('#trackName').textContent = 'Nothing on the platter';
  $('#trackBy').textContent = ''; $('#trackSpec').textContent = 'Load a file to see its signal path';
  $('#label').classList.remove('has-art'); $('#labelArt').removeAttribute('src');
  applyDiscVariant(null);
  closePlayer();
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
