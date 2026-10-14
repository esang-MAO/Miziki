/* ================= wiring: metadata editing and credits =================
   Moved out of main.js's "wiring" IIFE (step 7f) — the edit sheet
   (open from the player, close/save/revert, the art picker, undo) and
   the credits sheet (open from the player, close). Every function
   called here was already a real export of its owning module. */
import { S, current } from '../state.js';
import { $ } from '../util/dom.js';
import {
  cropSquareImage, revertTrack, undoLastEdit, openEditSheet,
  saveEditSheet, renderEditArtPreview,
} from '../library/edit.js';
import { openCreditsSheet } from '../library/credits.js';
import { closeLayer } from '../shell/nav-stack.js';

export function wireEdit(){
  $('#editCurrentBtn').addEventListener('click', ()=>{ const t = current(); if(t) openEditSheet([t.id]); });
  $('#trackInfoBtn').addEventListener('click', ()=>{ const t = current(); if(t) openCreditsSheet(t); });
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
}
