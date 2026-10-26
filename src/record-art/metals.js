import { S } from '../state.js';
import { $ } from '../util/dom.js';

/* ================= metal tiers =================
   Play-count-driven record colors for Tier 1 (lossy) only — the one tier
   with no visual variance of its own. Two disjoint ladders: album metals
   keyed to qualifying sessions (the same counter/definition session
   tracking already uses), track metals keyed to the track's own lifetime
   play count. Metal level is always a pure function of these counters —
   nothing about "current metal" is ever stored. Thresholds live in one
   config object so they can be retuned without touching render logic. */
export const ALBUM_METAL_THRESHOLDS = [
  {name:'platinum', sessions:40},
  {name:'gold',     sessions:25},
  {name:'silver',   sessions:15},
  {name:'bronze',   sessions:8}
];
export const TRACK_METAL_THRESHOLDS = [
  {name:'platinum', plays:250},
  {name:'gold',     plays:125}
];
// PRESSINGS_110 PR4 (docs/PRESSINGS_110.md §6): a metal's own three colours
// (shadow/mid/highlight, `data/pressings.json`'s own field names and
// values — these superseded CR7's base/highlight/shadow/underglow set,
// which no longer needed an underglow of its own now that the rim/
// underglow comes from the underlying pressing instead, see below). The
// label still inverts for gold/platinum (amber on either is near-
// unreadable) and silver still gets its own aubergine ring — see
// metalLabelKind() below, read by record-art/looks.js when painting the
// platter label.
export const METAL_COLORS = {
  bronze:   {shadow:'#5A3516', mid:'#B27A3C', highlight:'#E3B77A'},
  silver:   {shadow:'#4D5259', mid:'#A9A9B4', highlight:'#E8EFF2'},
  gold:     {shadow:'#7A4E12', mid:'#D6A83F', highlight:'#F7E7A8'},
  platinum: {shadow:'#8A9199', mid:'#D3D7DC', highlight:'#F8F9FA'},
};
// 'invert': the label flips to an aubergine disc with an amber mark, ringed
// in the metal's own shadow tone. 'silver-ring': the ordinary amber label,
// plus a 3px aubergine ring. 'amber': the plain amber label, unchanged.
export function metalLabelKind(name){
  if(name === 'gold' || name === 'platinum') return 'invert';
  if(name === 'silver') return 'silver-ring';
  return 'amber';
}
const METAL_FADE_MS = 400;

// reads the tier-1-only shadow counter, not the true lifetime total, so a
// tier-upgraded album's metal is grandfathered (frozen) rather than
// continuing to climb thresholds it can no longer earn — see METAL spec §2.
// RF4 (docs/12_REFINE.md): reads the merged cross-device shadow counter
// (S.mergedStats) in place of this device's own, when one exists, so the
// same metal shows on every device and in a friend's view — see state.js's
// own S.mergedStats comment.
export function albumMetalFor(albumId){
  const counts = S.mergedStats ? S.mergedStats.metalEligibleSessions : S.metalEligibleSessions;
  const n = counts[albumId] || 0;
  for(const lvl of ALBUM_METAL_THRESHOLDS) if(n >= lvl.sessions) return lvl.name;
  return null;
}
// takes a trackIdentityKey(), not a file id — see that function
export function trackMetalFor(trackKey){
  const counts = S.mergedStats ? S.mergedStats.trackMetalEligiblePlays : S.trackMetalEligiblePlays;
  const n = counts[trackKey] || 0;
  for(const lvl of TRACK_METAL_THRESHOLDS) if(n >= lvl.plays) return lvl.name;
  return null;
}

// incrementTrackPlay moved to src/history/played.js (step 5c), alongside
// checkTrackCompletion, its only caller.

// PRESSINGS_110 PR4 (docs/PRESSINGS_110.md §6): a shared color-mix helper
// for the three derived blends the light overlay's own stop list needs.
function mix(colorA, pctA, colorB){
  return 'color-mix(in srgb,' + colorA + ' ' + pctA + '%,' + colorB + ' ' + (100 - pctA) + '%)';
}

// The layer that SPINS with the platter: fine concentric brushing plus a
// flat mid-tone fill — no baked-in light/shadow wedge any more, that's
// metalLightOverlay()'s job now, screen-fixed. "The pressing still shows"
// (§6): a soft underglow and a crisp rim, both read off the UNDERLYING
// pressing's own body/rim colours when given (record-art/looks.js's
// discLook() always has tier/variant in hand even for a metal look, so it
// can pass the real pressing's own colours through) — a gold Verdigris
// has a green edge; two gold records differ. With no pressing context
// (the profile pressing-chart chips, which show a metal with no specific
// record attached) both fall back to the metal's own shadow/mid.
export function metalPlatterBackground(name, pressingRim, pressingBody){
  const m = METAL_COLORS[name];
  if(!m) return '';
  const { mid, shadow } = m;
  const rim = pressingRim || shadow;
  const underglow = pressingBody || mid;
  const concentric = 'repeating-radial-gradient(circle at 50% 50%,rgba(0,0,0,.06) 0 1px,transparent 1px 3px)';
  const radial = 'radial-gradient(circle at 50% 50%,' + mid + ' 0 80%,' + underglow + ' 80% 94%,' + rim + ' 94% 100%)';
  return concentric + ',' + radial;
}

// The layer FIXED to the screen — never rotates, so it has to live on its
// own DOM element (a sibling of #disc, never a part of it — see
// record-art/looks.js's applyDiscVariant()). A soft "bow tie" of light:
// the exact stop sequence from §6 — every stop at its own distinct angle,
// so CSS's own smooth interpolation between conic-gradient stops gives
// the feathered edges the spec asks for with no hard quarters, nothing
// extra needed to soften them.
export function metalLightOverlay(name){
  const m = METAL_COLORS[name];
  if(!m) return '';
  const { mid, shadow, highlight } = m;
  const shadowBlend = mix(shadow, 75, mid);
  const weakHighlight = mix(highlight, 45, mid);
  const core = mix('#fff', 35, highlight);
  return 'conic-gradient(from 0deg,' + mid + ' 0deg,' + shadowBlend + ' 45deg,' + mid + ' 95deg,'
      + weakHighlight + ' 135deg,' + mid + ' 175deg,' + shadowBlend + ' 225deg,' + mid + ' 272deg,'
      + highlight + ' 302deg,' + core + ' 313deg,' + highlight + ' 324deg,' + mid + ' 360deg)';
}

// Combined, single-string form for the two call sites with no rotation to
// split across and no specific underlying pressing in hand — the profile
// pressing-chart chips (profile/badges.js's metalBadge(), profile/
// records.js's metalDisc()). Layers the fixed light on top of the
// (fallback-coloured) platter layer; record-art/looks.js's discLook() is
// the one caller that instead calls the two layers separately, since it
// has both a real underlying pressing and a genuinely rotating disc.
export function metalBackground(name){
  if(!METAL_COLORS[name]) return '';
  return metalLightOverlay(name) + ',' + metalPlatterBackground(name);
}

// crossfades when asked to (a same-album background change with no sleeve
// pull to cover it) and the background actually changed; otherwise applies
// immediately — either nothing was visible yet, or a sleeve/pull is already
// covering the change, so an instant swap underneath it is imperceptible
export function setDiscBackground(disc, bg, crossfade){
  const fade = $('#discFade');
  const prev = disc.style.background;
  if(crossfade && prev && prev !== bg){
    fade.style.transition = 'none';
    fade.style.background = prev;
    fade.style.opacity = '1';
    disc.style.background = bg;
    void fade.offsetWidth;
    fade.style.transition = 'opacity ' + METAL_FADE_MS + 'ms ease';
    fade.style.opacity = '0';
  } else {
    disc.style.background = bg || '';
    fade.style.transition = 'none';
    fade.style.opacity = '0';
  }
}
