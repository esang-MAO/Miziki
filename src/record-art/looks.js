import { S, current } from '../state.js';
import { $, el } from '../util/dom.js';
import {
  trackTier, albumKey, trackIdentityKey, selectVariant, selectRareVariant,
  getVariantDef, variantBackground,
} from './tiers.js';
import { albumMetalFor, trackMetalFor, metalBackground, metalLabelKind, METAL_COLORS, setDiscBackground } from './metals.js';
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

// CR7 point 6: each row reads like a pressing plant's chart — a family/
// group eyebrow, the pressing's own name, its collector sub-name (if any),
// and the one-sentence note straight from the catalogue. Rare and metal
// each resolve to one specific pressing/tier per album (same deterministic
// hashing as the file-driven tiers), so there's always exactly one def to
// describe, never a list to choose a colour from.
function familyGroupLabel(def){
  if(!def || !def.family || def.family === 'jet') return '';
  if(def.family === 'effects') return 'Effects';
  if(def.family === 'rare') return 'Rare';
  return def.family[0].toUpperCase() + def.family.slice(1);
}

function buildLookOptionContent(kind, t){
  if(kind === 'rare'){
    const def = getVariantDef(selectRareVariant(t));
    return { group: 'Rare', name: def.name, sub: def.sub, note: def.note };
  }
  if(kind === 'metal'){
    const m = trackMetalFor(trackIdentityKey(t)) || albumMetalFor(albumKey(t));
    const name = m ? (m[0].toUpperCase() + m.slice(1) + ' Metal') : 'Metal';
    return { group: 'Metal', name, sub: null, note: 'Earned by a full, in-order play-through.' };
  }
  const { variant } = selectVariant(t);
  const def = getVariantDef(variant);
  return { group: familyGroupLabel(def), name: def.name, sub: def.sub, note: def.note };
}

export function openLookPicker(){
  const t = current(); if(!t) return;
  const albumId = albumKey(t);
  const looks = availableLooks(t);
  const current_ = resolveLook(t);
  const host = $('#lookOptions');
  host.innerHTML = '';
  looks.forEach(kind => {
    const content = buildLookOptionContent(kind, t);
    const b = el('button', 'cta look-option' + (kind === current_ ? '' : ' ghost'));
    b.type = 'button';
    if(content.group) b.appendChild(el('span', 'look-option-group', content.group));
    b.appendChild(el('span', 'look-option-name', content.name));
    if(content.sub) b.appendChild(el('span', 'look-option-sub', content.sub));
    if(content.note) b.appendChild(el('span', 'look-option-note', content.note));
    // silent and immediate — no confirmation, no animation (see METAL spec §5)
    b.addEventListener('click', () => { setLookPref(albumId, kind); closeLookPicker(); });
    host.appendChild(b);
  });
  // CR7 point 6: a lossy record only ever presses Jet — say so once, every
  // time the picker opens for one, rather than leaving it unexplained.
  if(trackTier(t) === 1){
    host.appendChild(el('p', 'note look-lossy-hint', 'A lossless copy would press in colour.'));
  }
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
  if(!t){
    disc.classList.remove('rare');
    label.classList.remove('rare', 'paper-label', 'metal-invert', 'metal-silver');
    setDiscBackground(disc, '', false);
    $('#lookBtn').style.display = 'none';
    return;
  }
  $('#lookBtn').style.display = availableLooks(t).length > 1 ? '' : 'none';
  const look = resolveLook(t);
  const rare = look === 'rare';
  disc.classList.toggle('rare', rare);
  label.classList.toggle('rare', rare);
  let bg;
  let paperLabel = false, labelKind = 'amber';
  if(rare){
    // CR7: four rare pressings now, not one — Ultra clear/Picture disc keep
    // the original "continuous material, no paper seam" art-backed render
    // (the same artwork the label shows extends across the whole disc);
    // Glow/Liquid filled are patterns, same as any solid/effect, since
    // neither needs the track's own art to render.
    const rareId = selectRareVariant(t);
    disc.dataset.variant = rareId;
    delete disc.dataset.tier;
    if(rareId === 'ultra-clear' || rareId === 'picture-disc'){
      bg = 'radial-gradient(circle at 50% 50%,rgba(0,0,0,.12),rgba(0,0,0,.55) 88%,rgba(0,0,0,.78) 100%),'
        + 'url("' + t.art + '") center/cover';
    } else {
      bg = variantBackground(getVariantDef(rareId));
    }
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
    if(metal){
      bg = metalBackground(metal);
      labelKind = metalLabelKind(metal);
      // gold/platinum each invert to the same aubergine disc/amber mark,
      // but with their own ring colour (the metal's own shadow stop) —
      // one class can't carry two different colours, so it rides inline.
      if(labelKind === 'invert') label.style.setProperty('--metal-ring', METAL_COLORS[metal].shadow);
    } else {
      bg = variantBackground(getVariantDef(variant));
      // "Decided" (docs/13_CRATE.md, CR7): tier-1 Jet gets the paper label
      // behind a Settings switch, off by default — amber everywhere else.
      paperLabel = tier === 1 && S.paperLabelOnLossy;
    }
  }
  label.classList.toggle('paper-label', paperLabel);
  label.classList.toggle('metal-invert', labelKind === 'invert');
  label.classList.toggle('metal-silver', labelKind === 'silver-ring');
  setDiscBackground(disc, bg, crossfade);
}
