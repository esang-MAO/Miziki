/* ================= grooves drawn from the audio (GS3, docs/
   30_GROOVES_AND_SHELF.md) =================
   Pure, zero-import leaf (besides util/math.js's clamp, itself pure/
   zero-import) -- same "directly unit-testable in Node" shape as
   record-art/format.js right beside it. Three independent pieces:
   - bandRadiiFromDurations()/grooveBandsForSide(): one band per track on
     a side, outer (track 0) to inner (the last track), width proportional
     to the track's duration on that side -- the needle moves inward as a
     side plays, same direction a real record's groove does.
   - groovePitchForLoudness(): louder -> a tighter (smaller) ring pitch;
     an unmeasured track (t.details.loudness missing) takes the middle
     pitch, same "always a de­fined, textable fallback" shape splitSides()'s
     own tie-break gives every fully-tied cut.
   - sideMapSegments(): the side map replacing the player's plain elapsed/
     total time readout (point 4) -- one segment per track, the current
     one filling, no numbers.
   grooveBackgroundImage()/needleRadiusPct() turn the two geometry pieces
   above into what the platter actually draws -- the CSS radial-gradient
   string for #disc's own groove layer, and the needle ring's current
   radius (a percent of the record's own radius, moving inward with
   playback, same clamp-to-the-band shape as sideFullness() elsewhere in
   record-art/format.js). */
import { clamp } from '../util/math.js';

// The groove area's own inner/outer radius, as a percent of the record's
// radius -- matches .disc's existing static background stops
// (src/styles/02-stage-platter.css): the label sits inside 27%, the rim
// starts at 90%. Independent of record size/speed -- a future per-size
// refinement is left for later, same as the rest of this step.
export const GROOVE_INNER_PCT = 27;
export const GROOVE_OUTER_PCT = 90;

// Ring pitch (the gap between adjacent texture rings), as a percent of the
// record's own radius -- middle is today's flat pitch (1px line + 4px gap
// at a ~171px platter radius, --platter-size's own 342px cap halved,
// ~2.9% of that). Loud tracks read tighter (closer to vinyl's own real
// "louder masters cut a narrower groove" behavior), quiet ones looser.
export const GROOVE_PITCH_MIN_PCT = 1.8;
export const GROOVE_PITCH_MAX_PCT = 4.0;
export const GROOVE_PITCH_MIDDLE_PCT = 2.9;

// The loudness range (BS.1770 LUFS, audio/loudness.js) this mapping spans
// -- a typical loud/quiet master, not a hard technical limit; anything
// outside it just clamps to the nearest end rather than reading as more
// extreme than the range we've actually calibrated against.
export const LOUDNESS_FLOOR_LUFS = -24;
export const LOUDNESS_CEIL_LUFS = -6;

// "Groove pitch per band from the track's measured loudness: louder ->
// tighter. Unmeasured tracks use the middle pitch."
export function groovePitchForLoudness(loudness){
  if(loudness == null || !Number.isFinite(loudness)) return GROOVE_PITCH_MIDDLE_PCT;
  const t = clamp((loudness - LOUDNESS_FLOOR_LUFS) / (LOUDNESS_CEIL_LUFS - LOUDNESS_FLOOR_LUFS), 0, 1);
  return GROOVE_PITCH_MAX_PCT - t * (GROOVE_PITCH_MAX_PCT - GROOVE_PITCH_MIN_PCT);
}

// One band per track, decreasing radius in track order: band 0 starts at
// outerPct (the needle drops there first) and ends wherever its own share
// of the side's total duration runs out; the last band ends exactly at
// innerPct. An empty/all-silent duration list splits evenly rather than
// dividing by zero -- the same "never divide by a possibly-zero total"
// guard sideLengthsFromDurations() (record-art/format.js) already needs.
export function bandRadiiFromDurations(durations, innerPct = GROOVE_INNER_PCT, outerPct = GROOVE_OUTER_PCT){
  const list = (durations && durations.length) ? durations : [0];
  const total = list.reduce((a, b) => a + (b || 0), 0);
  const span = outerPct - innerPct;
  const weights = total > 0 ? list.map(d => (d || 0) / total) : list.map(() => 1 / list.length);
  const bands = [];
  let cursor = outerPct;
  weights.forEach(w => {
    const end = cursor - w * span;
    bands.push({ startPct: cursor, endPct: end });
    cursor = end;
  });
  return bands;
}

// Combines the band radii above with each track's own measured loudness
// -- tracks: an array of {duration, details:{loudness}} in side order
// (the shape S.tracks entries already have).
export function grooveBandsForSide(tracks, innerPct = GROOVE_INNER_PCT, outerPct = GROOVE_OUTER_PCT){
  const list = tracks || [];
  const radii = bandRadiiFromDurations(list.map(t => (t && t.duration) || 0), innerPct, outerPct);
  return radii.map((r, i) => ({
    startPct: r.startPct, endPct: r.endPct,
    pitchPct: groovePitchForLoudness(list[i] && list[i].details && list[i].details.loudness),
  }));
}

// The needle's current radius (a percent of the record's own radius),
// interpolated across the active band from its outer edge (playedFrac 0)
// to its inner edge (playedFrac 1) -- "it moves inward with playback."
// An out-of-range activeIdx clamps to the nearest real band; no bands at
// all falls back to the groove area's own outer edge.
export function needleRadiusPct(bands, activeIdx, playedFrac){
  if(!bands || !bands.length) return GROOVE_OUTER_PCT;
  const i = clamp(activeIdx == null ? 0 : activeIdx, 0, bands.length - 1);
  const band = bands[i];
  const frac = clamp(playedFrac || 0, 0, 1);
  return band.startPct + (band.endPct - band.startPct) * frac;
}

// The side map: one segment per track on this side, widthPct proportional
// to its own duration (same weighting bandRadiiFromDurations() uses, just
// expressed as a flat 0..100 width rather than a radius range) and
// fillPct telling the UI how much of *that* segment to fill -- 100 for
// every track already finished, 0 for every track still to come, and the
// played fraction for whichever one is active right now. No activeIdx (or
// one outside the side) means nothing is playing on this side -- every
// segment reads unfilled.
export function sideMapSegments(durations, activeIdx, playedFrac){
  const list = (durations && durations.length) ? durations : [0];
  const total = list.reduce((a, b) => a + (b || 0), 0);
  const frac = clamp(playedFrac || 0, 0, 1);
  return list.map((d, i) => {
    const widthPct = total > 0 ? ((d || 0) / total) * 100 : 100 / list.length;
    let fillPct = 0;
    if(activeIdx != null && activeIdx >= 0 && activeIdx < list.length){
      if(i < activeIdx) fillPct = 100;
      else if(i === activeIdx) fillPct = frac * 100;
    }
    return { widthPct, fillPct };
  });
}

// The CSS radial-gradient string for #disc's own groove layer (read via
// the --groove-rings custom property -- see 02-stage-platter.css), built
// from grooveBandsForSide()'s own bands. Stops are emitted from the
// innermost band outward (ascending radius), the order a CSS radial-
// gradient's own stop list requires -- bands themselves run the other way
// (outer track 0 to inner last track), so this walks them in reverse. A
// thin, slightly brighter seam ring marks every boundary between one
// track's band and the next (point 1's "a smooth, slightly lighter ring
// between tracks"), skipped at the outermost edge where there's no
// further-out track to mark a seam against. Returns null for no bands at
// all, so a caller can fall back to the plain static pitch instead of
// writing an empty gradient.
export function grooveBackgroundImage(bands){
  if(!bands || !bands.length) return null;
  const stops = [];
  // floor keeps every pushed stop at or past the last one, even across a
  // seam ring that nudges slightly past a band's own boundary -- a CSS
  // radial-gradient's stop list has to be non-decreasing, or the browser
  // just clamps it itself, silently flattening the ring right after.
  let floor = 0;
  const push = (pct, color) => {
    const p = Math.max(floor, Math.min(100, pct));
    floor = p;
    stops.push(p.toFixed(3) + '% ' + color);
  };
  const ordered = bands.slice().reverse();
  ordered.forEach((band, oi) => {
    const { startPct, endPct, pitchPct } = band;
    const lineWidth = Math.max(0.05, pitchPct * 0.2);
    let r = Math.max(endPct, floor);
    while(r < startPct){
      const lineEnd = Math.min(startPct, r + lineWidth);
      push(r, 'transparent');
      push(r, 'rgba(255,255,255,.05)');
      push(lineEnd, 'rgba(255,255,255,.05)');
      push(lineEnd, 'transparent');
      r += pitchPct;
    }
    if(oi < ordered.length - 1){
      push(startPct, 'transparent');
      push(Math.min(100, startPct + 0.3), 'rgba(255,255,255,.09)');
      push(Math.min(100, startPct + 0.3), 'transparent');
    }
  });
  return 'radial-gradient(circle at 50% 50%, ' + stops.join(', ') + ')';
}
