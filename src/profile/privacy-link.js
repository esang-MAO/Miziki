/* TR2 (docs/19_PLAYER.md): wirePrivacyLink() is a tiny button built once
   per Profile-tab visit (profile/screens.js's renderProfileHome) -- it
   used to live in profile/privacy.js alongside the full Privacy screen
   (backup status, visibility picker, sharing toggles, follow requests,
   blocked accounts, data download), which only ever needs loading once
   that screen is actually opened. Split out so a common Profile-tab
   visit never drags that screen along. */
import { S } from '../state.js';
import { el } from '../util/dom.js';
import { navRow } from '../ui/parts.js';

// takes the caller's own renderProfile (screens.js, settings.js both
// already import it for their own navigation) rather than importing it
// here — privacy.js importing back from screens.js would make the two a
// real circular pair, and screens.js is already the hub several other
// profile/social modules circle back to; no need to add one more edge
// just for this one button.
//
// UN12 (docs/36_UNIFORMITY.md point 15): "the 'local preview' note and
// Privacy button at the bottom of the signed-out profile become one
// navRow('Privacy') plus a single muted line" -- only for the plain,
// never-configured-social state (storefront.js's renderLocalStorefront()
// branch with no `cta`, same `!soc.enabled` check it uses). Mid-sign-in
// (a cta prompt card already showing) or signed in keeps the plain
// ghost-button link this always built -- the plan only describes the
// signed-out bottom, and those two states already show their own content
// in that spot (the sign-in card, or nothing).
export function wirePrivacyLink(host, renderProfile){
  const soc = (typeof MizikiSocial === 'undefined') ? {enabled:false} : MizikiSocial.status();
  const goToPrivacy = ()=>{ S.profileView.screen = 'privacy'; renderProfile(); };
  if(!soc.enabled){
    host.appendChild(navRow({ label: 'Privacy', onClick: goToPrivacy }));
    host.appendChild(el('p','note','Sign in from Home to add friends and sharing.'));
    return;
  }
  const btn = el('button','cta ghost profile-share','Privacy');
  btn.addEventListener('click', goToPrivacy);
  host.appendChild(btn);
}
