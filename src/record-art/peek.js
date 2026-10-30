/* ================= the pressing peek =================
   The record sliding an inch out of the top of its sleeve, in the album's
   own pressing — the same surface the platter shows (looks.js's
   discLook(), so a saved look preference, an earned metal or a rare
   unlock all carry through). One drawing, used in two places: the launch
   intro's pull to camera (launch/intro.js) and the crate's pull-up on the
   front record (crate/view.js). The caller positions and sizes it; this
   module only builds the disc. Pure DOM, no listeners -- it reads S only
   for RW7's wear stage (docs/23_RHYTHM_AND_WEAR.md), never writes it. */
import { el } from '../util/dom.js';
import { S } from '../state.js';
import { getVariantDef, variantBackground, albumKey } from './tiers.js';
import { discLook } from './looks.js';
import { wearStage } from './wear.js';

// t is a track from the album being peeked, or null for the Miziki sleeve
// (an empty library), which always presses plain Jet.
export function peekBackgroundFor(t){
  if(!t) return variantBackground(getVariantDef('jet'));
  try{ return discLook(t).bg; }
  catch(_e){ return variantBackground(getVariantDef('jet')); }
}

// RW7 (docs/23_RHYTHM_AND_WEAR.md): label fade and vinyl hairlines, the
// disc's own half of the wear table -- sleeve wear is each caller's own
// sleeve element, never this disc. null for the empty-library sleeve
// (never been played) and whenever Show wear is off.
export function peekWearStage(t){
  if(!t || S.showWear === false) return 'new';
  return wearStage(S.sessionCounts[albumKey(t)], S.albumFirstPlayed[albumKey(t)], Date.now());
}

export function buildPeekDisc(t){
  const disc = el('div', 'peek-disc');
  disc.setAttribute('aria-hidden', 'true');
  disc.style.background = peekBackgroundFor(t);
  disc.appendChild(el('span', 'peek-disc-grooves'));
  disc.appendChild(el('span', 'peek-disc-sheen'));
  const stage = peekWearStage(t);
  if(stage !== 'new') disc.classList.add('wear-' + stage);
  return disc;
}
