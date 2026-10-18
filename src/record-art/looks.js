import { S, current } from '../state.js';
import { $ } from '../util/dom.js';
import {
  trackTier, albumKey, trackIdentityKey, VARIANT_DEFS, selectVariant, variantBackground,
} from './tiers.js';
import { albumMetalFor, trackMetalFor, metalBackground, setDiscBackground } from './metals.js';
import { persistAlbumLookPref } from '../history/sessions.js';

/* ================= look switching =================
   Once an album has more than one available "look" — the rare variant, an
   earned metal, or a genuine format variant (tier 2/3 only; tier 1's plain
   black is not itself a selectable look) — the user can switch between
   them, silently and immediately, and the choice persists per album. Rare
   is the default the moment it unlocks; anything else is the opt-back. See
   METAL spec §5. */
function availableLooks(t){
  const albumId = albumKey(t);
  const tier = trackTier(t);
  const looks = [];
  if(S.rareUnlocked[albumId] && t.art) looks.push('rare');
  const metal = trackMetalFor(trackIdentityKey(t)) || albumMetalFor(albumId);
  if(metal) looks.push('metal');
  // tier 1 with nothing earned has no real alternative to fall back to, so
  // the plain format variant only counts as a genuine "look" once there's
  // either something else to switch away from, or the tier itself carries
  // real variance (2/3)
  if(tier !== 1 || looks.length === 0) looks.push('variant');
  return looks;
}

export function resolveLook(t){
  const looks = availableLooks(t);
  const pref = S.albumLookPref[albumKey(t)];
  if(pref && looks.includes(pref)) return pref;
  if(looks.includes('rare')) return 'rare';
  if(looks.includes('metal')) return 'metal';
  return 'variant';
}

function setLookPref(albumId, look){
  S.albumLookPref[albumId] = look;
  persistAlbumLookPref(albumId);
  const t = current();
  if(t && albumKey(t) === albumId) applyDiscVariant(t, true);
}

function lookLabel(kind, t){
  if(kind === 'rare') return 'Rare — Art Suspended in Vinyl';
  if(kind === 'metal'){
    const m = trackMetalFor(trackIdentityKey(t)) || albumMetalFor(albumKey(t));
    return m ? (m[0].toUpperCase() + m.slice(1) + ' Metal') : 'Metal';
  }
  return 'Format Variant';
}

export function openLookPicker(){
  const t = current(); if(!t) return;
  const albumId = albumKey(t);
  const looks = availableLooks(t);
  const current_ = resolveLook(t);
  const host = $('#lookOptions');
  host.innerHTML = '';
  looks.forEach(kind => {
    const b = document.createElement('button');
    b.className = 'cta' + (kind === current_ ? '' : ' ghost');
    b.textContent = lookLabel(kind, t);
    // silent and immediate — no confirmation, no animation (see METAL spec §5)
    b.addEventListener('click', () => { setLookPref(albumId, kind); closeLookPicker(); });
    host.appendChild(b);
  });
  $('#lookOverlay').classList.add('open');
  $('#lookOverlay').setAttribute('aria-hidden', 'false');
}
export function closeLookPicker(){
  $('#lookOverlay').classList.remove('open');
  $('#lookOverlay').setAttribute('aria-hidden', 'true');
}

// Outside the full player the artwork travels as a plain circular label; the disc's
// tier-derived surface is scoped to this renderer only (see spec §1).
// `crossfade` should be true only for a same-album change with no sleeve
// animation to cover it — see updateShellAlbum()'s sameAlbum flag.
export function applyDiscVariant(t, crossfade){
  const disc = $('#disc'), label = $('#label');
  if(!t){ disc.classList.remove('rare'); label.classList.remove('rare'); setDiscBackground(disc, '', false); $('#lookBtn').style.display = 'none'; return; }
  $('#lookBtn').style.display = availableLooks(t).length > 1 ? '' : 'none';
  const look = resolveLook(t);
  const rare = look === 'rare';
  disc.classList.toggle('rare', rare);
  label.classList.toggle('rare', rare);
  let bg;
  if(rare){
    // "Art Suspended in Vinyl": continuous material, no paper seam — the same
    // artwork the label shows extends across the whole disc, read through the grooves
    bg = 'radial-gradient(circle at 50% 50%,rgba(0,0,0,.12),rgba(0,0,0,.55) 88%,rgba(0,0,0,.78) 100%),'
      + 'url("' + t.art + '") center/cover';
    delete disc.dataset.variant; delete disc.dataset.tier;
  } else {
    const {tier, variant} = selectVariant(t);
    // track wins over album — see METAL spec §4. Grandfathered metals are
    // no longer gated to tier===1 here: a metal earned pre-upgrade stays
    // selectable regardless of the track's current tier, since it's the
    // resolveLook() call above (via availableLooks()) that decides whether
    // 'metal' is even a candidate in the first place.
    const metal = look === 'metal' ? (trackMetalFor(trackIdentityKey(t)) || albumMetalFor(albumKey(t))) : null;
    disc.dataset.tier = tier;
    disc.dataset.variant = metal ? 'metal-' + metal : variant;
    bg = metal ? metalBackground(metal) : variantBackground(VARIANT_DEFS[variant]);
  }
  setDiscBackground(disc, bg, crossfade);
}
