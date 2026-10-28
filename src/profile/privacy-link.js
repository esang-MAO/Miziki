/* TR2 (docs/19_PLAYER.md): wirePrivacyLink() is a tiny button built once
   per Profile-tab visit (profile/screens.js's renderProfileHome) -- it
   used to live in profile/privacy.js alongside the full Privacy screen
   (backup status, visibility picker, sharing toggles, follow requests,
   blocked accounts, data download), which only ever needs loading once
   that screen is actually opened. Split out so a common Profile-tab
   visit never drags that screen along. */
import { S } from '../state.js';
import { el } from '../util/dom.js';

// takes the caller's own renderProfile (screens.js, settings.js both
// already import it for their own navigation) rather than importing it
// here — privacy.js importing back from screens.js would make the two a
// real circular pair, and screens.js is already the hub several other
// profile/social modules circle back to; no need to add one more edge
// just for this one button.
export function wirePrivacyLink(host, renderProfile){
  const btn = el('button','cta ghost profile-share','Privacy');
  btn.addEventListener('click', ()=>{ S.profileView.screen = 'privacy'; renderProfile(); });
  host.appendChild(btn);
}
