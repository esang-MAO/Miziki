import { S, current } from '../state.js';
import { $, el } from '../util/dom.js';
import {
  trackTier, albumKey, trackIdentityKey, selectVariant, selectRareVariant,
  getVariantDef, variantBackground,
} from './tiers.js';
import { albumMetalFor, trackMetalFor, metalPlatterBackground, metalLightOverlay, metalLabelKind, METAL_COLORS, setDiscBackground } from './metals.js';
import { persistAlbumLookPref } from '../history/sessions.js';
import { openLayer, closeLayer } from '../shell/nav-stack.js';

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
    b.addEventListener('click', () => { setLookPref(albumId, kind); closeLayer('look'); });
    host.appendChild(b);
  });
  // CR7 point 6: a lossy record only ever presses Jet — say so once, every
  // time the picker opens for one, rather than leaving it unexplained.
  if(trackTier(t) === 1){
    host.appendChild(el('p', 'note look-lossy-hint', 'A lossless copy would press in colour.'));
  }
  $('#lookOverlay').classList.add('open');
  $('#lookOverlay').setAttribute('aria-hidden', 'false');
  // Was a plain classList toggle with no Back/Escape/tap-outside support —
  // an accepted NV2 gap (src/wiring/overlays.js's own comment), closed now
  // per Ken's "easily close any menu" request.
  openLayer('look', closeLookPicker, { container: $('#lookOverlay') });
}
export function closeLookPicker(){
  $('#lookOverlay').classList.remove('open');
  $('#lookOverlay').setAttribute('aria-hidden', 'true');
}

// The disc's resolved surface for a track, with no DOM side effects: the
// same look precedence (rare > metal > file variant, unless a saved look
// preference says otherwise) the platter uses. Shared by applyDiscVariant()
// below and record-art/peek.js, so the record that peeks out of a sleeve
// (launch intro, crate pull) is always the same pressing the platter shows.
export function discLook(t){
  const look = resolveLook(t);
  const rare = look === 'rare';
  if(rare){
    // CR7: four rare pressings now, not one — Ultra clear/Picture disc keep
    // the original "continuous material, no paper seam" art-backed render
    // (the same artwork the label shows extends across the whole disc);
    // Glow/Liquid filled are patterns, same as any solid/effect, since
    // neither needs the track's own art to render.
    const rareId = selectRareVariant(t);
    let bg;
    if(rareId === 'ultra-clear' || rareId === 'picture-disc'){
      bg = 'radial-gradient(circle at 50% 50%,rgba(0,0,0,.12),rgba(0,0,0,.55) 88%,rgba(0,0,0,.78) 100%),'
        + 'url("' + t.art + '") center/cover';
    } else {
      bg = variantBackground(getVariantDef(rareId));
    }
    return { look, rare: true, rareId, tier: null, variant: null, metal: null, bg, lightOverlay: null, labelKind: 'amber', paperLabel: false };
  }
  const {tier, variant} = selectVariant(t);
  // track wins over album — see METAL spec §4. Grandfathered metals are
  // no longer gated to tier===1 here: a metal earned pre-upgrade stays
  // selectable regardless of the track's current tier, since it's the
  // resolveLook() call above (via availableLooks()) that decides whether
  // 'metal' is even a candidate in the first place.
  const metal = look === 'metal' ? (trackMetalFor(trackIdentityKey(t)) || albumMetalFor(albumKey(t))) : null;
  if(metal){
    // PRESSINGS_110 PR4 (docs/PRESSINGS_110.md §6): "the pressing still
    // shows" — the metal's rotating layer reads its rim/underglow off the
    // pressing underneath it, not a fixed per-metal swatch. tier/variant
    // are already resolved above regardless of the metal look, so the
    // underlying def's own colours (ring/body/rim, see tiers.js's F())
    // are always in hand with no extra lookup.
    const def = getVariantDef(variant);
    const pressingRim = def.rim || (def.colors && def.colors[2]);
    const pressingBody = def.body || (def.colors && def.colors[1]);
    return { look, rare: false, rareId: null, tier, variant, metal,
      bg: metalPlatterBackground(metal, pressingRim, pressingBody),
      lightOverlay: metalLightOverlay(metal),
      labelKind: metalLabelKind(metal), paperLabel: false };
  }
  // "Decided" (docs/13_CRATE.md, CR7): tier-1 Jet gets the paper label
  // behind a Settings switch, off by default — amber everywhere else.
  return { look, rare: false, rareId: null, tier, variant, metal: null,
    bg: variantBackground(getVariantDef(variant)), lightOverlay: null, labelKind: 'amber', paperLabel: tier === 1 && S.paperLabelOnLossy };
}

// Outside the full player the artwork travels as a plain circular label; the disc's
// tier-derived surface is scoped to this renderer only (see spec §1).
// `crossfade` should be true only for a same-album change with no sleeve
// animation to cover it — see updateShellAlbum()'s sameAlbum flag.
export function applyDiscVariant(t, crossfade){
  const disc = $('#disc'), label = $('#label');
  // PRESSINGS_110 PR4 (docs/PRESSINGS_110.md §6): the screen-fixed light
  // layer — a sibling of #disc inside #platterBox, never a part of #disc
  // itself, so it never inherits the rotation transform player/clock.js's
  // frame loop writes onto #disc every tick. Shown only while a metal
  // look is active; hidden (and its background cleared) otherwise.
  const light = $('#discMetalLight');
  if(!t){
    disc.classList.remove('rare');
    label.classList.remove('rare', 'paper-label', 'metal-invert', 'metal-silver');
    setDiscBackground(disc, '', false);
    if(light){ light.style.background = ''; light.classList.remove('on'); }
    $('#lookBtn').style.display = 'none';
    return;
  }
  $('#lookBtn').style.display = availableLooks(t).length > 1 ? '' : 'none';
  const d = discLook(t);
  disc.classList.toggle('rare', d.rare);
  label.classList.toggle('rare', d.rare);
  if(d.rare){
    disc.dataset.variant = d.rareId;
    delete disc.dataset.tier;
  } else {
    disc.dataset.tier = d.tier;
    disc.dataset.variant = d.metal ? 'metal-' + d.metal : d.variant;
    // gold/platinum each invert to the same aubergine disc/amber mark,
    // but with their own ring colour (the metal's own shadow stop) —
    // one class can't carry two different colours, so it rides inline.
    if(d.metal && d.labelKind === 'invert') label.style.setProperty('--metal-ring', METAL_COLORS[d.metal].shadow);
  }
  const bg = d.bg, paperLabel = d.paperLabel, labelKind = d.labelKind;
  label.classList.toggle('paper-label', paperLabel);
  label.classList.toggle('metal-invert', labelKind === 'invert');
  label.classList.toggle('metal-silver', labelKind === 'silver-ring');
  setDiscBackground(disc, bg, crossfade);
  if(light){
    if(d.lightOverlay){ light.style.background = d.lightOverlay; light.classList.add('on'); }
    else { light.style.background = ''; light.classList.remove('on'); }
  }
}
