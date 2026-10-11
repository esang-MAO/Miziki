/* ================= wiring: profile and social =================
   Moved out of main.js's "wiring" IIFE (step 7f) — the profile
   picture picker, the social sign-in sheet's close button, the social
   nav stack's back button, and the record sheet's close button. Every
   function called here was already a real export of its owning
   module. */
import { S } from '../state.js';
import { $ } from '../util/dom.js';
import { persistProfile, renderProfile } from '../profile/screens.js';
import { closeSocialAuth } from '../profile/settings.js';
import { popSocialScreen, closeRecordSheet } from '../social/screens/friend-store.js';
import { cropSquareImage } from '../library/edit.js';

export function wireAccount(){
  $('#profilePicFile').addEventListener('change', async e=>{
    const file = e.target.files[0];
    e.target.value = '';
    if(!file) return;
    try{
      const blob = await cropSquareImage(file, 500);
      if(S.profile.art) try{ URL.revokeObjectURL(S.profile.art); }catch(err){}
      S.profile.artBlob = blob;
      S.profile.art = URL.createObjectURL(blob);
      await persistProfile();
      renderProfile();
    }catch(err){ /* bad image — leave the existing picture as-is */ }
  });

  $('#socialAuthClose').addEventListener('click', closeSocialAuth);
  $('#socialNavBack').addEventListener('click', popSocialScreen);
  $('#recordSheetClose').addEventListener('click', closeRecordSheet);
}
