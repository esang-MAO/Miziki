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
// CR7 (docs/13_CRATE.md): a metal is a finish laid over the pressing, not
// a flat fill — four values per metal (base/highlight/shadow/underglow),
// per docs/design/crate/README.md's own table. The label itself inverts
// for gold/platinum (amber on either is near-unreadable, 1.03:1 for
// gold) and silver gets its own aubergine ring — see metalLabelKind()
// below, read by record-art/looks.js when painting the platter label.
export const METAL_COLORS = {
  bronze:   {base:'#B07A3C', highlight:'#E3B77A', shadow:'#5A3516', underglow:'#8A3A1E'},
  silver:   {base:'#A9ADB4', highlight:'#EDEFF2', shadow:'#4D5259', underglow:'#2E3238'},
  gold:     {base:'#D6AD3F', highlight:'#F7E7A8', shadow:'#7A4E12', underglow:'#8A3A1E'},
  platinum: {base:'#D3D7DC', highlight:'#F8F9FA', shadow:'#8A9199', underglow:'#B9C4D0'},
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

// brushed metal, not a flat fill: one narrow feathered specular band (the
// light-catching angle), a broad mid-tone, a deep shadow opposite, fine
// concentric lines, and a rim ring of the metal's own underglow — CR7's
// replacement for the old single-base conic wedge. Still baked into the
// disc's own background (so it rotates with the platter, same limitation
// the old wedge already had — a screen-fixed highlight would need a
// separate overlay element, out of scope here).
export function metalBackground(name){
  const m = METAL_COLORS[name];
  if(!m) return '';
  const { base, highlight, shadow, underglow } = m;
  const concentric = 'repeating-radial-gradient(circle at 50% 50%,rgba(0,0,0,.06) 0 1px,transparent 1px 3px)';
  const conic = 'conic-gradient(from 205deg,' + highlight + ' 0deg 10deg,' + base + ' 10deg 150deg,'
      + shadow + ' 150deg 195deg,' + base + ' 195deg 350deg,' + highlight + ' 350deg 360deg)';
  const radial = 'radial-gradient(circle at 50% 50%,' + highlight + ' 0 27%,' + base + ' 27% 85%,'
      + shadow + ' 85% 97%,' + underglow + ' 97% 100%)';
  return conic + ',' + concentric + ',' + radial;
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
