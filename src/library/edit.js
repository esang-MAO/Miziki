/* ================= metadata editing: sidecar overlay =================
   Moved out of main.js (step 5d). Source of truth stays the app's own
   database. Edits are stored as a sparse overlay (only the fields actually
   changed) keyed by the same stable file id used everywhere else — never
   by mutating the original file. Resolve order for any field: user edit >
   embedded file tag > fallback. The overlay is applied once, when a track
   enters S.tracks, so the rest of the app just reads t.tags/t.art as
   always; no caller needs to know an overlay exists. t.embeddedTags/
   t.embeddedArt are kept aside so a track can always revert. */
import { S } from '../state.js';
import { $, el } from '../util/dom.js';
import { idxOf } from './model.js';
import { albumKey } from '../record-art/tiers.js';
import { storage, overlays, artwork } from '../storage/repo.js';
import { applyDiscVariant } from '../record-art/looks.js';
import { persistSealedAlbums } from './sealed.js';
import { renderMiniPlayer } from '../shell/mini-player.js';
import { deleteCrateArtTiers, buildCrateTier } from '../crate/tiers.js';
import { renderTracks, exitSelectMode } from './view.js';
import { scheduleBackupSync } from '../sync/backup.js';

function applyOverlay(t, rec, artBlob){
  t.embeddedTags = Object.assign({}, t.tags);
  t.embeddedArt = t.art;
  if(rec && rec.fields) Object.keys(rec.fields).forEach(k => { t.tags[k] = rec.fields[k]; });
  if(artBlob){ t.overlayArtBlob = artBlob; t.art = URL.createObjectURL(artBlob); }
}

export async function loadOverlayFor(t){
  if(!storage.available()) return;
  const rec = await overlays.get(t.id);
  const artRec = await artwork.get(t.id);
  applyOverlay(t, rec, artRec && artRec.blob);
}

// downscale + center-crop any image Blob/File to a square JPEG, capped at maxDim —
// the full player crops square art to a circle for the label and the sleeve
// renders it square, so a centered square source is what every render target wants
export function cropSquareImage(file, maxDim){
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const side = Math.min(img.width, img.height);
      const sx = (img.width - side) / 2, sy = (img.height - side) / 2;
      const out = Math.min(maxDim || 800, side);
      const canvas = document.createElement('canvas');
      canvas.width = out; canvas.height = out;
      canvas.getContext('2d').drawImage(img, sx, sy, side, side, 0, 0, out, out);
      URL.revokeObjectURL(img.src);
      canvas.toBlob(b => b ? resolve(b) : reject(new Error('encode failed')), 'image/jpeg', 0.9);
    };
    img.onerror = () => reject(new Error('could not read image'));
    img.src = URL.createObjectURL(file);
  });
}

// refreshes everything that depends on a track's tags/art after an edit —
// the disc (if it's the one currently on the platter), the library list,
// and the mini-player
function recomputeTrack(i){
  const t = S.tracks[i];
  if(!t) return;
  if(S.index === i){
    applyDiscVariant(t, true);
    $('#trackName').textContent = t.tags.title;
    $('#trackBy').textContent = t.tags.artist + ' — ' + t.tags.album;
    const lab = $('#label'), img = $('#labelArt');
    if(t.art){ img.src = t.art; lab.classList.add('has-art'); }
    else { img.removeAttribute('src'); lab.classList.remove('has-art'); }
  }
  renderTracks();
  renderMiniPlayer();
}

// applies fields (and optionally new artwork) to one or more tracks, merging
// onto any existing overlay rather than replacing it, and persists each
export async function applyEdit(trackIds, fields, artBlob){
  const touchedAlbumIds = new Set();
  let sealedChanged = false;
  for(const id of trackIds){
    const i = idxOf(id); if(i < 0) continue;
    const t = S.tracks[i];
    const oldAlbumId = albumKey(t);
    const existing = await overlays.get(id);
    const merged = Object.assign({}, existing && existing.fields, fields);
    // editedAt stamps this exact write for the cross-device overlay merge
    // (B2 table: "last edit wins by timestamp") — step 06, B3. A sparse
    // overlay row carries no other identity than this track's file id, so
    // this is the only place that timestamp can be recorded.
    await overlays.put({id, fields: merged, editedAt: Date.now()});
    Object.assign(t.tags, fields);
    // the album id is recomputed from the (possibly just-edited) album
    // title — carry the seal state over so a retag never seals or unseals
    // an album as a side effect (SEALED spec §2)
    const newAlbumId = albumKey(t);
    if(newAlbumId !== oldAlbumId && S.sealed.has(oldAlbumId)){
      S.sealed.delete(oldAlbumId); S.sealed.add(newAlbumId); sealedChanged = true;
    }
    if(artBlob){
      await artwork.put({id, blob: artBlob});
      if(t.overlayArtBlob) try{ URL.revokeObjectURL(t.art); }catch(_e){}
      t.overlayArtBlob = artBlob;
      t.art = URL.createObjectURL(artBlob);
      touchedAlbumIds.add(albumKey(t));
    }
    recomputeTrack(i);
  }
  // the crate tiers are cut from this same artwork — a new cover makes the
  // old tiers stale, so clear them and rebuild the S tier right away (the
  // spec's "rebuild that album's tiers... from wherever ensureThumb is
  // re-run for edits", §B3)
  for(const albumId of touchedAlbumIds){
    await deleteCrateArtTiers(albumId);
    buildCrateTier(albumId, 'S').catch(() => {});
  }
  if(sealedChanged) persistSealedAlbums();
  scheduleBackupSync();
}

// clears a track's whole overlay (fields + artwork), restoring it to
// whatever its embedded file tags said
export async function revertTrack(id){
  const i = idxOf(id); if(i < 0) return;
  const t = S.tracks[i];
  const hadArtOverlay = !!t.overlayArtBlob;
  // a tombstone, not a plain delete: the cross-device merge (B2 table —
  // "a revert is a tombstone that also wins by timestamp") needs this
  // device's own revert to be able to out-race a stale edit still sitting
  // unsynced on another device. loadOverlayFor()/applyEdit()'s merge both
  // already treat a falsy `fields` as "nothing to apply", so this is no
  // behavior change for local use — only the row's own survival changes.
  await overlays.put({id, fields: null, reverted: true, revertedAt: Date.now()});
  await artwork.del(id);
  t.tags = Object.assign({}, t.embeddedTags);
  if(t.overlayArtBlob) try{ URL.revokeObjectURL(t.art); }catch(_e){}
  t.overlayArtBlob = null;
  t.art = t.embeddedArt;
  if(hadArtOverlay){
    const albumId = albumKey(t);
    await deleteCrateArtTiers(albumId);
    buildCrateTier(albumId, 'S').catch(() => {});
  }
  recomputeTrack(i);
  scheduleBackupSync();
}

// single-level undo for a batch (or single) edit: snapshots exactly what was
// in the overlay/artwork stores before the edit, so undo restores that exact
// prior state rather than always falling back to the embedded tags
export async function applyEditWithUndo(trackIds, fields, artBlob){
  const prevOverlays = {}, prevArt = {};
  for(const id of trackIds){
    prevOverlays[id] = await overlays.get(id);
    prevArt[id] = await artwork.get(id);
  }
  await applyEdit(trackIds, fields, artBlob);
  S.lastUndo = {trackIds: trackIds.slice(), prevOverlays, prevArt};
  showUndoBanner(trackIds.length);
}

export async function undoLastEdit(){
  const u = S.lastUndo; if(!u) return;
  S.lastUndo = null;
  const touchedAlbumIds = new Set();
  for(const id of u.trackIds){
    const i = idxOf(id); if(i < 0) continue;
    const t = S.tracks[i];
    const prevRec = u.prevOverlays[id], prevArtRec = u.prevArt[id];
    // same tombstone shape as revertTrack() above, for the same reason —
    // undoing an edit that had no prior overlay is exactly a revert
    if(prevRec) await overlays.put(prevRec);
    else await overlays.put({id, fields: null, reverted: true, revertedAt: Date.now()});
    if(prevArtRec) await artwork.put(prevArtRec); else await artwork.del(id);
    t.tags = Object.assign({}, t.embeddedTags, prevRec ? prevRec.fields : {});
    if(t.overlayArtBlob) try{ URL.revokeObjectURL(t.art); }catch(_e){}
    if(prevArtRec){ t.overlayArtBlob = prevArtRec.blob; t.art = URL.createObjectURL(prevArtRec.blob); touchedAlbumIds.add(albumKey(t)); }
    else { t.overlayArtBlob = null; t.art = t.embeddedArt; touchedAlbumIds.add(albumKey(t)); }
    recomputeTrack(i);
  }
  for(const albumId of touchedAlbumIds){
    await deleteCrateArtTiers(albumId);
    buildCrateTier(albumId, 'S').catch(() => {});
  }
  hideUndoBanner();
  scheduleBackupSync();
}

export function showUndoBanner(count){
  const bar = $('#undoBanner');
  $('#undoText').textContent = count === 1 ? 'Track updated.' : count + ' tracks updated.';
  bar.style.display = 'flex';
  clearTimeout(S.undoTimer);
  S.undoTimer = setTimeout(hideUndoBanner, 8000);
}
export function hideUndoBanner(){
  $('#undoBanner').style.display = 'none';
  S.lastUndo = null;
}

/* ---- edit sheet: same form for a single track or a batch selection ---- */
export function renderEditArtPreview(url){
  const box = $('#editArtPreview'); box.innerHTML = '';
  if(url){ const im = document.createElement('img'); im.src = url; im.alt = ''; box.appendChild(im); }
  else box.appendChild(el('span', null, 'No art'));
}

export function openEditSheet(trackIds){
  if(!trackIds.length) return;
  const batch = trackIds.length > 1;
  S.editTarget = {trackIds, batch};
  S.editArtBlob = null;
  const first = S.tracks[idxOf(trackIds[0])];
  if(!first) return;
  $('#editTitleLabel').textContent = batch ? ('Edit ' + trackIds.length + ' tracks') : 'Edit track';
  $('#editTitleRow').style.display = batch ? 'none' : '';
  $('#editTitle').value = batch ? '' : (first.tags.title || '');
  $('#editArtist').value = batch ? '' : (first.tags.artist || '');
  $('#editAlbum').value = batch ? '' : (first.tags.album || '');
  $('#editAlbumArtist').value = batch ? '' : (first.tags.albumArtist || '');
  $('#editTrackRow').style.display = batch ? 'none' : '';
  $('#editTrackNum').value = batch ? '' : (first.tags.track || '');
  $('#editRevert').style.display = batch ? 'none' : '';
  $('#editBatchNote').style.display = batch ? 'block' : 'none';
  if(batch) $('#editBatchNote').textContent = 'Artist, album, and cover apply to all ' + trackIds.length
    + ' selected tracks. Titles are left as they are.';
  renderEditArtPreview(batch ? null : first.art);
  // single-track fields start pre-filled with the current values (so the
  // user can see them), which means only what actually changed from these
  // should become a new overlay entry — otherwise every save would silently
  // freeze untouched fields (like a fallback title) into the overlay forever
  S.editOriginal = batch ? null : {
    title: first.tags.title || '', artist: first.tags.artist || '', album: first.tags.album || '',
    albumArtist: first.tags.albumArtist || '', track: String(first.tags.track || '')
  };
  $('#editOverlay').classList.add('open');
  $('#editOverlay').setAttribute('aria-hidden','false');
}

export function closeEditSheet(){
  $('#editOverlay').classList.remove('open');
  $('#editOverlay').setAttribute('aria-hidden','true');
  S.editTarget = null; S.editArtBlob = null;
}

export async function saveEditSheet(){
  const target = S.editTarget; if(!target) return;
  const fields = {};
  if(target.batch){
    // blank = leave alone; batch fields never start pre-filled, so any
    // non-blank value here is something the user actually typed
    const artist = $('#editArtist').value.trim(); if(artist) fields.artist = artist;
    const album = $('#editAlbum').value.trim(); if(album) fields.album = album;
    const albumArtist = $('#editAlbumArtist').value.trim(); if(albumArtist) fields.albumArtist = albumArtist;
  } else {
    // single-track fields start pre-filled with current values, so only
    // what differs from that starting point counts as an actual edit
    const orig = S.editOriginal || {};
    const title = $('#editTitle').value.trim(); if(title && title !== orig.title) fields.title = title;
    const artist = $('#editArtist').value.trim(); if(artist && artist !== orig.artist) fields.artist = artist;
    const album = $('#editAlbum').value.trim(); if(album && album !== orig.album) fields.album = album;
    const albumArtist = $('#editAlbumArtist').value.trim();
    if(albumArtist && albumArtist !== orig.albumArtist) fields.albumArtist = albumArtist;
    const trackNum = $('#editTrackNum').value;
    if(trackNum !== '' && trackNum !== orig.track) fields.track = parseInt(trackNum, 10) || 0;
  }

  if(!Object.keys(fields).length && !S.editArtBlob){ closeEditSheet(); return; }
  await applyEditWithUndo(target.trackIds, fields, S.editArtBlob);
  closeEditSheet();
  if(target.batch) exitSelectMode();
  if('artist' in fields || 'album' in fields || 'albumArtist' in fields) MizikiSocial.libraryChanged();
}
