/* ================= the pressing peek =================
   The record sliding an inch out of the top of its sleeve, in the album's
   own pressing — the same surface the platter shows (looks.js's
   discLook(), so a saved look preference, an earned metal or a rare
   unlock all carry through). One drawing, used in two places: the launch
   intro's pull to camera (launch/intro.js) and the crate's pull-up on the
   front record (crate/view.js). The caller positions and sizes it; this
   module only builds the disc. Pure DOM, no listeners, no state. */
import { el } from '../util/dom.js';
import { getVariantDef, variantBackground } from './tiers.js';
import { discLook } from './looks.js';

// t is a track from the album being peeked, or null for the Miziki sleeve
// (an empty library), which always presses plain Jet.
export function peekBackgroundFor(t){
  if(!t) return variantBackground(getVariantDef('jet'));
  try{ return discLook(t).bg; }
  catch(_e){ return variantBackground(getVariantDef('jet')); }
}

export function buildPeekDisc(t){
  const disc = el('div', 'peek-disc');
  disc.setAttribute('aria-hidden', 'true');
  disc.style.background = peekBackgroundFor(t);
  disc.appendChild(el('span', 'peek-disc-grooves'));
  disc.appendChild(el('span', 'peek-disc-sheen'));
  return disc;
}
