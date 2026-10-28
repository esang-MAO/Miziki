/* TR2 (docs/19_PLAYER.md): legalLinksRow() is a tiny, often-rendered link
   row (every Settings/Account/Privacy screen render, plus the sign-in
   wizard's footer) -- it used to live in profile/legal.js alongside the
   full Privacy Policy/Terms of use text, which only ever needs loading
   once one of those two screens is actually opened. Split out so a
   common render never drags that text along. */
import { S } from '../state.js';
import { el } from '../util/dom.js';

// Reached from the sign-in wizard's first step, the Account screen, and the
// Privacy screen (profile/privacy.js) — each already imports renderProfile
// from screens.js for its own navigation, so this takes it as a parameter
// rather than importing screens.js here, the same shape privacy.js's own
// wirePrivacyLink already uses and for the same reason: screens.js is
// already a real circular-import hub for several sibling profile/social
// modules, and this one small link doesn't need to add another edge to it.
// `before`, if given, runs right before navigating — the sign-in wizard's
// own footer passes closeSocialAuth so the modal overlay doesn't stay open
// on top of the profile screen underneath it; the Account/Privacy call
// sites don't need it, since renderProfile() there just redraws the same
// #profileBody the sheet is already showing.
export function legalLinksRow(renderProfile, before){
  const go = (screen) => { if(before) before(); S.profileView.screen = screen; renderProfile(); };
  const row = el('p','note legal-links');
  const privacyBtn = el('button','link-btn','Privacy Policy');
  privacyBtn.addEventListener('click', ()=> go('privacyPolicy'));
  const termsBtn = el('button','link-btn','Terms of use');
  termsBtn.addEventListener('click', ()=> go('termsOfUse'));
  row.appendChild(privacyBtn);
  row.appendChild(document.createTextNode(' · '));
  row.appendChild(termsBtn);
  return row;
}
