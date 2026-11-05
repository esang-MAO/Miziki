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
// radius. GROOVE_OUTER_PCT (the rim) is the same for every record size.
// GROOVE_INNER_PCT is the real .label element's own edge on a 12" record
// (src/styles/02-stage-platter.css: "a 100mm label at 33% of the record",
// inset:33.5% -- inset I% is radius (100-2*I)% of the disc's own full
// radius, the same conversion player/clock.js's own needle-ring inset
// comment uses) -- not record-art/tiers.js's static disc-background
// gradient stop (27%), which this used to reuse on the mistaken assumption
// that it matched the real label: it doesn't, so a side's innermost tracks
// drew groove texture that rendered right under the label, "not realistic"
// (Ken, 2026-11-05). LABEL_INNER_PCT_BY_SIZE below covers the two other
// formats' own, larger real labels (10"/7", same CSS section) -- every
// caller that knows the record's own S.recordFormat.size should resolve
// through labelInnerPctForSize() rather than assuming the 12" default.
export const GROOVE_INNER_PCT = 33;
export const GROOVE_OUTER_PCT = 90;

// 10″ is 100mm/40% of the record; 7″ is 90mm/51.5% (same CSS section's own
// comment) -- a smaller record's label takes up proportionally more of it.
export const LABEL_INNER_PCT_BY_SIZE = { '7"': 51.5, '10"': 40, '12"': GROOVE_INNER_PCT };

export function labelInnerPctForSize(size){
  return LABEL_INNER_PCT_BY_SIZE[size] || GROOVE_INNER_PCT;
}

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
// (the shape S.tracks entries already have). t.details.loudness is
// audio/loudness.js's own analyze() result object ({lufs, truePeakDb,
// clipRuns, plr, measured, truePeakVersion}, src/library/import.js's
// storeTrack()), not a bare number -- its .lufs is what groovePitchFor
// Loudness() actually wants; an unmeasured track (no loudness object
// yet, or one whose own .lufs isn't a real number) still lands on
// groovePitchForLoudness()'s own null/NaN branch below, same as before.
export function grooveBandsForSide(tracks, innerPct = GROOVE_INNER_PCT, outerPct = GROOVE_OUTER_PCT){
  const list = tracks || [];
  const radii = bandRadiiFromDurations(list.map(t => (t && t.duration) || 0), innerPct, outerPct);
  return radii.map((r, i) => {
    const loudness = list[i] && list[i].details && list[i].details.loudness;
    return {
      startPct: r.startPct, endPct: r.endPct,
      pitchPct: groovePitchForLoudness(loudness && loudness.lufs),
    };
  });
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

/* ================= GS4: drop the needle (docs/30_GROOVES_AND_SHELF.md)
   =================
   A touch starting on the outer rim -- the record's own edge, outside the
   groove area entirely (GROOVE_OUTER_PCT and up) -- holds the record
   rather than scrubbing/scratching it (player/scrub.js branches on
   isRimRadiusPct() at pointerdown, before either gesture is claimed).
   Sliding while holding moves a visual needle across the grooves; these
   two helpers are the pure geometry behind that: converting a touch
   point into a radius percent, and resolving that radius into the track
   it's over plus whether it's close enough to that track's own start to
   snap. */

// "The outermost ~8% of the radius" -- a touch at or beyond this radius
// (a percent of the record's own radius, the same 0..100 scale every
// other radius in this module uses) starts a hold rather than a scrub.
export const RIM_INNER_PCT = 92;

export function isRimRadiusPct(radiusPct){
  return radiusPct >= RIM_INNER_PCT;
}

// A touch point's distance from the disc's own center, as a percent of
// its radius (0 at the spindle, 100 at the rim, past 100 outside the
// disc entirely -- callers that need an in-bounds value clamp it
// themselves, same as bandIndexForRadius()/dropNeedleTarget() below
// already do). `rect` is any {left, top, width, height} box the disc
// itself occupies -- a real DOMRect, or a plain object in a test.
export function radiusPctFromPoint(clientX, clientY, rect){
  const cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2;
  const dx = clientX - cx, dy = clientY - cy;
  const radius = rect.width / 2;
  return radius > 0 ? (Math.sqrt(dx * dx + dy * dy) / radius) * 100 : 0;
}

// Which band a given radius falls into -- clamps to the groove area's
// own bounds first (so a radius still inside the rim, or past the
// innermost band at the spindle, still resolves to a real, droppable
// track), same "clamp to the nearest real band" shape needleRadiusPct()
// above already uses.
export function bandIndexForRadius(bands, radiusPct){
  if(!bands || !bands.length) return 0;
  for(let i = 0; i < bands.length; i++){
    const b = bands[i];
    if(radiusPct <= b.startPct && radiusPct >= b.endPct) return i;
  }
  return radiusPct > bands[0].startPct ? 0 : bands.length - 1;
}

// "A small threshold" -- close to a typical ring's own pitch (the
// GROOVE_PITCH_* constants above), so snapping feels like finding the
// actual gap between tracks rather than a wide dead zone around it.
export const DROP_NEEDLE_SNAP_PCT = 2.5;

// A slide's current target while dropping the needle: which track it's
// over (index into `bands`, same order as the side's own track list),
// whether it's close enough to that track's own start to snap, and the
// radius to actually show the needle (and its tag) at -- the track's
// own start once snapped, the raw (but in-bounds) touch radius
// otherwise. Returns null for no bands at all, the same "nothing to
// drop onto" shape grooveBackgroundImage() already uses.
export function dropNeedleTarget(bands, radiusPct, snapPct = DROP_NEEDLE_SNAP_PCT){
  if(!bands || !bands.length) return null;
  const clamped = clamp(radiusPct, bands[bands.length - 1].endPct, bands[0].startPct);
  const idx = bandIndexForRadius(bands, clamped);
  let nearest = 0, nearestDist = Infinity;
  bands.forEach((b, i) => {
    const d = Math.abs(clamped - b.startPct);
    if(d < nearestDist){ nearestDist = d; nearest = i; }
  });
  const snapped = nearestDist <= snapPct;
  return {
    index: snapped ? nearest : idx,
    snapped,
    radiusPct: snapped ? bands[nearest].startPct : clamped,
  };
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
