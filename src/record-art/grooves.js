/* ================= grooves drawn from the audio (GS3, docs/
   30_GROOVES_AND_SHELF.md) =================
   Pure, zero-import leaf (besides util/math.js's clamp, itself pure/
   zero-import) -- same "directly unit-testable in Node" shape as
   record-art/format.js right beside it.
   GS3 originally also drew this band geometry as the platter's own visible
   groove texture (a per-track ring pattern, tighter pitch for a louder
   track) -- reverted 2026-11-05 (Ken: "it looks like a faux generated
   image whereas before it truly looked like a record spinning on a
   platter"; see 02-stage-platter.css's own comment on .disc::before for
   the full account). The band *radii* are still real, load-bearing
   geometry -- GS4's needle ring and drop-the-needle gesture both need to
   know where a track starts/ends on the radius -- so bandRadiiFromDurations()/
   grooveBandsForSide() remain; only the texture-drawing half
   (grooveBackgroundImage(), groovePitchForLoudness()) is gone.
   - bandRadiiFromDurations()/grooveBandsForSide(): one band per track on
     a side, outer (track 0) to inner (the last track), width proportional
     to the track's duration on that side -- the needle moves inward as a
     side plays, same direction a real record's groove does.
   - needleRadiusPct(): the needle ring's current radius (a percent of the
     record's own radius, moving inward with playback, same clamp-to-the-
     band shape as sideFullness() elsewhere in record-art/format.js).
   sideMapSegments() (the side map replacing the player's plain elapsed/
   total time readout, GS3 point 4) was removed in UN11 (docs/36_UNIFORMITY.md
   decision 21), which put the plain elapsed/caption/remaining readout back
   under the single progress bar. */
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
// Was 90 -- left a visible 10%-of-radius gap of bare disc before the
// first track's own groove band even started, reading as "too far from
// the edge" (Ken, 2026-11-05). 96 leaves only the thin un-grooved edge
// strip a real pressing has. This now sits *past* RIM_INNER_PCT (92,
// below) on purpose: the rim's own outermost ~8% is a touch-gesture zone
// (hold vs. spin, GS4), not a claim about where groove texture stops
// being drawn -- a real record's grooves run almost to the edge you'd
// hold it by.
export const GROOVE_OUTER_PCT = 96;

// 10″ is 100mm/40% of the record; 7″ is 90mm/51.5% (same CSS section's own
// comment) -- a smaller record's label takes up proportionally more of it.
export const LABEL_INNER_PCT_BY_SIZE = { '7"': 51.5, '10"': 40, '12"': GROOVE_INNER_PCT };

export function labelInnerPctForSize(size){
  return LABEL_INNER_PCT_BY_SIZE[size] || GROOVE_INNER_PCT;
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

// A thin wrapper over bandRadiiFromDurations() that takes the side's own
// track list (the shape S.tracks entries already have) rather than a bare
// duration array -- kept as its own function so transport.js's call site
// reads "bands for this side's tracks," not "bands for these numbers."
export function grooveBandsForSide(tracks, innerPct = GROOVE_INNER_PCT, outerPct = GROOVE_OUTER_PCT){
  const list = tracks || [];
  return bandRadiiFromDurations(list.map(t => (t && t.duration) || 0), innerPct, outerPct);
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
   A touch starting on the outer rim -- the record's own outermost ~8%
   (RIM_INNER_PCT and up), a touch-gesture zone, not a claim about where
   groove texture itself stops being drawn (GROOVE_OUTER_PCT now reaches
   past it, see its own comment above) -- holds the record rather than
   scrubbing/scratching it (player/scrub.js branches on isRimRadiusPct()
   at pointerdown, before either gesture is claimed). Sliding while
   holding moves a visual needle across the grooves; these two helpers
   are the pure geometry behind that: converting a touch point into a
   radius percent, and resolving that radius into the track it's over
   plus whether it's close enough to that track's own start to snap. */

// "The outermost ~8% of the radius" -- a touch at or beyond this radius
// (a percent of the record's own radius, the same 0..100 scale every
// other radius in this module uses) starts a hold rather than a scrub.
export const RIM_INNER_PCT = 92;

// 8% of a full 342px disc's radius is already a tight ~14px-wide ring to
// land a finger on; the short-viewport platter (02-stage-platter.css can
// shrink it to ~180px) narrows that to under 8px -- well under a
// comfortable touch target, and the likely cause of "it works every once
// in a while" (Ken, GS4, 2026-11-06). rimThresholdPct() keeps
// RIM_INNER_PCT's own 92% on a full-size disc but widens the band (lowers
// the threshold) on a smaller one so it always covers at least
// RIM_MIN_PX, never widening past RIM_FLOOR_PCT even on the smallest
// platter (so a tiny disc doesn't lose most of its scrub/scratch area to
// the rim zone).
export const RIM_MIN_PX = 28;
export const RIM_FLOOR_PCT = 75;

export function rimThresholdPct(discRadiusPx){
  if(!discRadiusPx || discRadiusPx <= 0) return RIM_INNER_PCT;
  const pct = 100 - (RIM_MIN_PX / discRadiusPx) * 100;
  return clamp(pct, RIM_FLOOR_PCT, RIM_INNER_PCT);
}

export function isRimRadiusPct(radiusPct, threshold = RIM_INNER_PCT){
  return radiusPct >= threshold;
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

// "A small threshold" -- a few percent of the record's own radius, so
// snapping feels like finding the actual gap between tracks rather than
// a wide dead zone around it.
export const DROP_NEEDLE_SNAP_PCT = 2.5;

// A slide's current target while dropping the needle: which track it's
// over (index into `bands`, same order as the side's own track list),
// whether it's close enough to that track's own start to snap, and the
// radius to actually show the needle (and its tag) at -- the track's
// own start once snapped, the raw (but in-bounds) touch radius
// otherwise. Returns null for no bands at all -- nothing to drop onto.
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
