/* ================= wiring: metadata editing and credits =================
   The edit sheet (open from the player, close/save/revert, the art
   picker, undo) and the credits sheet (open from the player, close). */
import { S, current } from '../state.js';
import { $ } from '../util/dom.js';
import {
  cropSquareImage, revertTrack, undoLastEdit, openEditSheet,
  saveEditSheet, renderEditArtPreview, setAlbumFormatOverride,
} from '../library/edit.js';
import { albumKey } from '../record-art/tiers.js';
import { openCreditsSheet } from '../library/credits.js';
import { closeLayer, closeLayerThen } from '../shell/nav-stack.js';
import { getAlbumBackCoverBlob, setAlbumBackCoverImage, clearAlbumBackCoverImage } from '../gatefold/back-cover.js';
import { refreshGatefoldBackCover } from '../gatefold/view.js';

export function wireEdit(){
  // Both rows live inside #playerOverflowMenu and open a different layer
  // in its place -- closeLayerThen() (nav-stack.js) waits for the menu's
  // own close to actually land before opening it, rather than racing that
  // close's history.go() the way an immediate openLayer() call would.
  $('#editCurrentBtn').addEventListener('click', ()=>{
    closeLayerThen('player-overflow-menu', ()=>{
      const t = current(); if(t) openEditSheet([t.id]);
    });
  });
  $('#trackInfoBtn').addEventListener('click', ()=>{
    closeLayerThen('player-overflow-menu', ()=>{
      const t = current(); if(t) openCreditsSheet(t);
    });
  });
  $('#creditsClose').addEventListener('click', () => closeLayer('credits'));

  $('#editClose').addEventListener('click', () => closeLayer('edit'));
  $('#editSave').addEventListener('click', saveEditSheet);
  $('#editRevert').addEventListener('click', async ()=>{
    const target = S.editTarget;
    if(!target || target.batch) return;
    await revertTrack(target.trackIds[0]);
    closeLayer('edit');
  });
  $('#editArtPick').addEventListener('click', ()=> $('#editArtFile').click());
  $('#editArtFile').addEventListener('change', async e=>{
    const file = e.target.files[0];
    e.target.value = '';
    if(!file) return;
    try{
      const blob = await cropSquareImage(file, 800);
      S.editArtBlob = blob;
      renderEditArtPreview(URL.createObjectURL(blob));
    }catch(_err){ /* bad image — leave whatever preview was already showing */ }
  });
  $('#undoBtn').addEventListener('click', undoLastEdit);

  // GF6 (docs/29_GATEFOLD.md): the edit sheet's own "Back cover" row --
  // applied immediately on pick, the same "apply now, not deferred to
  // Save" posture setAlbumFormatOverride() above already uses. The row's
  // target album arrives via a DOM event from library/edit.js's
  // openEditSheet() rather than a direct import, which is what lets this
  // feature's gatefold/back-cover.js import (and the `?raw` SVG wordmark
  // import it drags in) stay out of library/edit.js's own, far more
  // widely-imported, module graph.
  let editBackCoverAlbumId = null;
  async function paintEditBackCoverPreview(albumId){
    const box = $('#editBackCoverPreview'); if(!box) return;
    box.innerHTML = '';
    const blob = await getAlbumBackCoverBlob(albumId).catch(() => null);
    const btn = $('#editBackCoverDefaultBtn');
    if(btn) btn.setAttribute('aria-pressed', String(!blob));
    if(blob){ const im = document.createElement('img'); im.src = URL.createObjectURL(blob); im.alt = ''; box.appendChild(im); }
    else { const span = document.createElement('span'); span.textContent = 'Default back'; box.appendChild(span); }
  }
  document.addEventListener('miziki-edit-backcover-open', e => {
    editBackCoverAlbumId = e.detail.albumId;
    if(editBackCoverAlbumId) paintEditBackCoverPreview(editBackCoverAlbumId);
  });
  $('#editBackCoverPick').addEventListener('click', ()=> $('#editBackCoverFile').click());
  $('#editBackCoverPhoto').addEventListener('click', ()=> $('#editBackCoverCameraFile').click());
  async function handleEditBackCoverFile(e){
    const file = e.target.files[0];
    e.target.value = '';
    if(!file || !editBackCoverAlbumId) return;
    try{
      const blob = await cropSquareImage(file, 800);
      await setAlbumBackCoverImage(editBackCoverAlbumId, blob);
      await paintEditBackCoverPreview(editBackCoverAlbumId);
      refreshGatefoldBackCover();
    }catch(_err){ /* bad image -- leave whatever preview was already showing */ }
  }
  $('#editBackCoverFile').addEventListener('change', handleEditBackCoverFile);
  $('#editBackCoverCameraFile').addEventListener('change', handleEditBackCoverFile);
  $('#editBackCoverDefaultBtn').addEventListener('click', async ()=>{
    if(!editBackCoverAlbumId) return;
    await clearAlbumBackCoverImage(editBackCoverAlbumId);
    await paintEditBackCoverPreview(editBackCoverAlbumId);
    refreshGatefoldBackCover();
  });

  // AU9 (docs/16_AUDIO.md §5): the personal per-album speed override --
  // applied immediately on tap, not deferred to the Save button (see
  // setAlbumFormatOverride()'s own header comment for why).
  $('#editFormatSeg').addEventListener('click', e => {
    const b = e.target.closest('button[data-format-override]'); if(!b) return;
    const target = S.editTarget;
    if(!target || target.batch) return;
    const t = S.tracks.find(tr => tr.id === target.trackIds[0]);
    if(!t || !t.tags.album) return;
    setAlbumFormatOverride(albumKey(t), b.dataset.formatOverride);
    $('#editFormatSeg').querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
  });
}
