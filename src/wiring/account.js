/* ================= wiring: profile and social =================
   Moved out of main.js's "wiring" IIFE (step 7f) — the profile
   picture picker, the social sign-in sheet's close button, the social
   nav stack's back button, and the record sheet's close button. Every
   function called here was already a real export of its owning
   module. */
import { S } from '../state.js';
import { $ } from '../util/dom.js';
import { persistProfile, renderProfile } from '../profile/screens.js';
import { cropSquareImage } from '../library/edit.js';
import { closeLayer } from '../shell/nav-stack.js';

export function wireAccount(){
  $('#profilePicFile').addEventListener('change', async e=>{
    const file = e.target.files[0];
    e.target.value = '';
    if(!file) return;
    try{
      const blob = await cropSquareImage(file, 500);
      if(S.profile.art) try{ URL.revokeObjectURL(S.profile.art); }catch(_err){}
      S.profile.artBlob = blob;
      S.profile.art = URL.createObjectURL(blob);
      await persistProfile();
      renderProfile();
    }catch(_err){ /* bad image — leave the existing picture as-is */ }
  });

  $('#socialAuthClose').addEventListener('click', () => closeLayer('social-auth'));
  // TR2 (docs/19_PLAYER.md): the social nav stack (this Back button) can
  // only ever be open after one of friend-store.js's own open* entry
  // points already ran its own import('../social/screens/friend-store.js')
  // -- same reasoning as src/wiring/share.js's own header comment.
  $('#socialNavBack').addEventListener('click', async () => {
    const { popSocialScreen } = await import('../social/screens/friend-store.js');
    popSocialScreen();
  });
  $('#recordSheetClose').addEventListener('click', () => closeLayer('record-sheet'));
}
