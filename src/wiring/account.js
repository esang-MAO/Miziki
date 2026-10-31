/* ================= wiring: profile and social =================
   The profile picture picker, the social sign-in sheet's close button,
   the social nav stack's back button, and the record sheet's close
   button. */
import { S } from '../state.js';
import { $ } from '../util/dom.js';
import { persistProfile, renderProfile } from '../profile/screens.js';
import { cropSquareImage } from '../library/edit.js';
import { closeLayer } from '../shell/nav-stack.js';
import { triggerProfileRefresh } from '../shell/pull-refresh.js';

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

  // FS7 (docs/25_FROM_SCRATCH.md point 1): "the wordmark top-left, Settings
  // top-right" -- replaces the gear-icon dropdown renderStorefrontSection()
  // used to build fresh on every render (its Refresh item folded in only
  // to avoid colliding with the pull-to-refresh indicator's own top-right
  // spot, src/shell/pull-refresh.js). These two buttons are static markup
  // in the shared #appHeader (same home as #hdrWordmark), so they're wired
  // once here rather than rebuilt per render; the handlers themselves don't
  // vary by render state.
  $('#hdrProfileRefreshBtn').addEventListener('click', () => triggerProfileRefresh());
  $('#hdrProfileSettingsBtn').addEventListener('click', () => { S.profileView.screen = 'settings'; renderProfile(); });
}
