/* ================= metadata editing: sidecar overlay =================
   Source of truth stays the app's own database. Edits are stored as a
   sparse overlay (only the fields actually
   changed) keyed by the same stable file id used everywhere else — never
   by mutating the original file. Resolve order for any field: user edit >
   embedded file tag > fallback. The overlay is applied once, when a track
   enters S.tracks, so the rest of the app just reads t.tags/t.art as
   always; no caller needs to know an overlay exists. t.embeddedTags/
   t.embeddedArt are kept aside so a track can always revert. */
import { S, current } from '../state.js';
import { $, el } from '../util/dom.js';
import { idxOf, albumTracks } from './model.js';
import { albumKey } from '../record-art/tiers.js';
import { storage, overlays, artwork } from '../storage/repo.js';
import { applyDiscVariant } from '../record-art/looks.js';
import { persistSealedAlbums } from './sealed.js';
import { persistAlbumFormat } from '../history/sessions.js';
import { renderMiniPlayer } from '../shell/mini-player.js';
import { deleteCrateArtTiers, buildCrateTier } from '../crate/tiers.js';
import { renderTracks, updateTrackRow, exitSelectMode } from './view.js';
import { scheduleBackupSync, queueCoverUpload } from '../sync/backup.js';
import { openLayer, closeLayer } from '../shell/nav-stack.js';
import { emptyDetails } from './tags/index.js';
import { albumFormatFor, sideLengthsFor } from '../shell/ceremony-timing.js';
import { applyWobbleRate, applyCharacter } from '../audio/engine.js';
import { formatRecordName, formatSpeedText } from '../record-art/format.js';

// Which of an overlay's sparse `fields` land on t.tags (title/artist/
// album/...) versus t.details (genre/year — CREDITS spec's own liner-
// notes/credits object, read by search.js's genre:/year: field matchers,
// not by anything that reads t.tags). The overlay row itself stays one flat
// `fields` object regardless — splitting only matters at apply time, so the
// cross-device overlay merge (sync/merge.js's mergeOverlays, sync/
// backup-doc.js's convertOverlays) needs no change for this to sync.
const DETAIL_FIELD_KEYS = new Set(['genre', 'year']);
function splitFields(fields){
  const tagFields = {}, detailFields = {};
  Object.keys(fields || {}).forEach(k => {
    if(DETAIL_FIELD_KEYS.has(k)) detailFields[k] = fields[k];
    else tagFields[k] = fields[k];
  });
  return {tagFields, detailFields};
}

function applyOverlay(t, rec, artBlob){
  t.embeddedTags = Object.assign({}, t.tags);
  t.embeddedDetails = Object.assign({}, t.details || emptyDetails());
  t.embeddedArt = t.art;
  if(rec && rec.fields){
    const {tagFields, detailFields} = splitFields(rec.fields);
    Object.assign(t.tags, tagFields);
    if(Object.keys(detailFields).length) t.details = Object.assign({}, t.details || emptyDetails(), detailFields);
  }
  if(artBlob){ t.overlayArtBlob = artBlob; t.art = URL.createObjectURL(artBlob); }
}

export async function loadOverlayFor(t){
  if(!storage.available()) return;
  const rec = await overlays.get(t.id);
  const artRec = await artwork.get(t.id);
  applyOverlay(t, rec, artRec && artRec.blob);
}

// Batched twin of loadOverlayFor(), for main.js's restoreLibrary() boot
// path only. Calling loadOverlayFor(t) once per track there meant two
// sequential IndexedDB transactions per track (overlays.get + artwork.get),
// each its own open-transaction/read/commit round trip -- at a few thousand
// tracks that per-track overhead dominates launch time (measured ~3ms/track
// just for this step alone). overlays.all()/artwork.all() already exist
// (the former for sync/backup.js's own cross-device snapshot) and are each
// one IndexedDB.getAll() -- a single transaction regardless of track count.
// Fetching both once and applying them synchronously from in-memory Maps
// turns this into a small constant number of transactions instead of 2*N.
// loadOverlayFor() itself is untouched and still used by library/import.js's
// own per-file import loop, where there's no list of tracks to batch across
// yet and the per-file cost is already dwarfed by decoding/tagging a
// freshly-added file.
export async function loadOverlaysBatch(trackList){
  if(!storage.available()) return;
  const [overlayRows, artRows] = await Promise.all([overlays.all(), artwork.all()]);
  const overlayById = new Map(overlayRows.map(r => [r.id, r]));
  const artById = new Map(artRows.map(r => [r.id, r]));
  for(const t of trackList){
    applyOverlay(t, overlayById.get(t.id), (artById.get(t.id) || {}).blob);
  }
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
    // RF15 (docs/12_REFINE.md): the label's own title (visible only
    // without art) has to follow a retag the same way #trackName/#trackBy
    // just above already do.
    $('#labelTitle').textContent = t.tags.album || t.tags.title;
  }
  // NV3: a single-track edit only ever changes that one row's own content
  // (title/artist/art) — patch it in place instead of rebuilding the whole
  // library list, falling back to a full render when the row isn't
  // currently on screen (a batch edit can easily span tracks across more
  // than one visible group, and a grouped/drilled-into view, an active
  // search, or the crate has no flat row for updateTrackRow to find at all).
  if(!updateTrackRow(t.id)) renderTracks();
  renderMiniPlayer();
}

// applies fields (and optionally new artwork) to one or more tracks, merging
// onto any existing overlay rather than replacing it, and persists each
export async function applyEdit(trackIds, fields, artBlob){
  const touchedAlbumIds = new Set();
  let sealedChanged = false;
  const {tagFields, detailFields} = splitFields(fields);
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
    Object.assign(t.tags, tagFields);
    if(Object.keys(detailFields).length) t.details = Object.assign({}, t.details || emptyDetails(), detailFields);
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
      // step 07, B4: stamps the overlay's own cover hash (re-encode is
      // fast, local, no network) and leaves the actual upload to the
      // same debounced/backoff sync cycle scheduleBackupSync() below
      // already drives — never awaited here, nowhere near playback
      queueCoverUpload(id, artBlob);
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
  // cover: null clears any custom-cover claim the same way (step 07, B4
  // — "a revert to the file's own art is a tombstone" applies to the
  // cover exactly as it does to the text fields).
  await overlays.put({id, fields: null, reverted: true, revertedAt: Date.now(), cover: null});
  await artwork.del(id);
  t.tags = Object.assign({}, t.embeddedTags);
  t.details = Object.assign({}, t.embeddedDetails);
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
    else await overlays.put({id, fields: null, reverted: true, revertedAt: Date.now(), cover: null});
    if(prevArtRec) await artwork.put(prevArtRec); else await artwork.del(id);
    const {tagFields: prevTagFields, detailFields: prevDetailFields} = splitFields(prevRec ? prevRec.fields : null);
    t.tags = Object.assign({}, t.embeddedTags, prevTagFields);
    t.details = Object.assign({}, t.embeddedDetails, prevDetailFields);
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

// AU9 (docs/16_AUDIO.md §5): the personal per-album speed override, applied
// immediately on tap rather than deferred to Save -- a format override is
// a property of the album, not a sparse per-track overlay field like the
// rest of this sheet, so there's nothing for Save/Revert to collect or
// undo here. Live-recomputes S.recordFormat/the Vinyl chain when the
// edited album is the one currently on the platter, the same "re-apply
// right after the thing it depends on changes" shape applyEdit() above
// already uses for a retagged now-playing track.
export function setAlbumFormatOverride(albumId, override){
  if(override === 'auto') delete S.albumFormat[albumId];
  else S.albumFormat[albumId] = override;
  persistAlbumFormat(albumId);
  const t = current();
  if(t && albumKey(t) === albumId){
    const idx = albumTracks(t.tags.album);
    S.recordFormat = albumFormatFor(idx, S.tracks, override);
    applyWobbleRate(S.rate);
    applyCharacter();
  }
  const first = S.tracks[idxOf(S.editTarget && S.editTarget.trackIds[0])];
  if(first && albumKey(first) === albumId) paintEditFormatResult(first, override);
}

function paintEditFormatSeg(override){
  const seg = $('#editFormatSeg'); if(!seg) return;
  seg.querySelectorAll('button').forEach(b => {
    b.setAttribute('aria-pressed', String(b.dataset.formatOverride === override));
  });
}

function fmtMinSec(sec){
  sec = Math.max(0, Math.round(sec || 0));
  return Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0');
}

// AU10 (docs/16_AUDIO.md §5, png/06-EditSpeed.png): "a small disc, 7″
// SINGLE · 45 RPM, and one line" -- resolves the album's own format
// (auto or the given override) and writes the summary + a plain
// side-count/length description, the same call site as the seg's own
// aria-pressed paint above.
function paintEditFormatResult(track, override){
  const summary = $('#editFormatSummary'); const note = $('#editFormatNote');
  if(!summary || !note) return;
  const idx = albumTracks(track.tags.album);
  const format = albumFormatFor(idx, S.tracks, override);
  summary.textContent = formatRecordName(format) + ' · ' + formatSpeedText(format.speed) + ' RPM';
  const lengths = sideLengthsFor(idx, S.tracks);
  note.textContent = (lengths.length === 1 ? 'One side, no flip' : lengths.length + ' sides')
    + ' — longest ' + fmtMinSec(Math.max(...lengths)) + '.';
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
  const firstDetails = first.details || emptyDetails();
  $('#editGenre').value = batch ? '' : (firstDetails.genre || '');
  $('#editYear').value = batch ? '' : (firstDetails.year || '');
  $('#editRevert').style.display = batch ? 'none' : '';
  $('#editBatchNote').style.display = batch ? 'block' : 'none';
  // AU9 (docs/16_AUDIO.md §5): single-track, album-tagged edits only --
  // a batch selection can span more than one album, so there's no one
  // album id for the override to apply to.
  const showFormat = !batch && !!first.tags.album;
  $('#editFormatRow').style.display = showFormat ? '' : 'none';
  if(showFormat){
    const override = S.albumFormat[albumKey(first)] || 'auto';
    paintEditFormatSeg(override);
    paintEditFormatResult(first, override);
  }
  if(batch) $('#editBatchNote').textContent = 'Artist, album, album artist, genre, year, and cover apply to all '
    + trackIds.length + ' selected tracks. Titles are left as they are.';
  renderEditArtPreview(batch ? null : first.art);
  // single-track fields start pre-filled with the current values (so the
  // user can see them), which means only what actually changed from these
  // should become a new overlay entry — otherwise every save would silently
  // freeze untouched fields (like a fallback title) into the overlay forever
  S.editOriginal = batch ? null : {
    title: first.tags.title || '', artist: first.tags.artist || '', album: first.tags.album || '',
    albumArtist: first.tags.albumArtist || '', track: String(first.tags.track || ''),
    genre: firstDetails.genre || '', year: String(firstDetails.year || '')
  };
  const overlay = $('#editOverlay');
  overlay.classList.add('open');
  overlay.setAttribute('aria-hidden','false');
  openLayer('edit', closeEditSheet, { container: overlay });
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
    const genre = $('#editGenre').value.trim(); if(genre) fields.genre = genre;
    const yearStr = $('#editYear').value; if(yearStr !== '') fields.year = parseInt(yearStr, 10) || 0;
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
    const genre = $('#editGenre').value.trim(); if(genre !== orig.genre) fields.genre = genre;
    const yearStr = $('#editYear').value;
    if(yearStr !== orig.year) fields.year = yearStr === '' ? 0 : (parseInt(yearStr, 10) || 0);
  }

  if(!Object.keys(fields).length && !S.editArtBlob){ closeLayer('edit'); return; }
  await applyEditWithUndo(target.trackIds, fields, S.editArtBlob);
  closeLayer('edit');
  if(target.batch) exitSelectMode();
  if('artist' in fields || 'album' in fields || 'albumArtist' in fields) MizikiSocial.libraryChanged();
}
