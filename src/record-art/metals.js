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
export const METAL_COLORS = {bronze:'#CE8946', silver:'#797B80', gold:'#FFC30B', platinum:'#BBC2CC'};
const METAL_FADE_MS = 400;

// reads the tier-1-only shadow counter, not the true lifetime total, so a
// tier-upgraded album's metal is grandfathered (frozen) rather than
// continuing to climb thresholds it can no longer earn — see METAL spec §2
export function albumMetalFor(albumId){
  const n = S.metalEligibleSessions[albumId] || 0;
  for(const lvl of ALBUM_METAL_THRESHOLDS) if(n >= lvl.sessions) return lvl.name;
  return null;
}
// takes a trackIdentityKey(), not a file id — see that function
export function trackMetalFor(trackKey){
  const n = S.trackMetalEligiblePlays[trackKey] || 0;
  for(const lvl of TRACK_METAL_THRESHOLDS) if(n >= lvl.plays) return lvl.name;
  return null;
}

// incrementTrackPlay moved to src/history/played.js (step 5c), alongside
// checkTrackCompletion, its only caller.

// plated metal, not a flat fill: a conic sheen band (bright arcs near the
// light-catching angles, a darker arc opposite) over a radial base, so the
// existing groove/light overlay in .disc::before still reads as reflection
// catching the surface rather than being painted on top of a solid color
export function metalBackground(name){
  const base = METAL_COLORS[name];
  // Silver's rung is both darker AND cooler than Bronze on a straight
  // luminance reading, which can misread as a downgrade rather than a step
  // up — lean harder on the highlight ("finish") here to keep it polished
  const hi = name === 'silver' ? 92 : 82, lo = name === 'silver' ? 45 : 35;
  const bright = 'color-mix(in srgb,' + base + ' ' + (100-hi) + '%, white ' + hi + '%)';
  const dark = 'color-mix(in srgb,' + base + ' ' + lo + '%, black ' + (100-lo) + '%)';
  return 'conic-gradient(from 205deg,' + bright + ' 0deg 10deg,' + base + ' 10deg 150deg,'
      + dark + ' 150deg 195deg,' + base + ' 195deg 340deg,' + bright + ' 340deg 360deg),'
    + 'radial-gradient(circle at 50% 50%,' + bright + ' 0 27%,' + base + ' 27% 88%,' + dark + ' 88% 100%)';
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
