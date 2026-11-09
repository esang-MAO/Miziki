/* ================= ceremony timing (docs/CEREMONY.md §2-§4) =================
   The numbers and small decisions behind the run-out groove, the side flip
   and the overlapped record change, kept pure (no DOM, no S) so they can
   be unit-tested without a browser. The orchestration that uses them lives
   in shell/runout.js and shell/start-sequence.js.

   splitSides() uses record-art/format.js's bestSideCut() (AU9, §5) for a
   time-balanced split rather than a track-count midpoint; sideLengthsFor()/
   albumFormatFor() compute the record's own side lengths and format
   independent of whether Album sides itself is on -- the format is always
   computed, so turning Sides off just means there are no flips. A
   multi-disc album applies that same per-disc time-balance to each disc,
   so a two-disc album with at least two tracks per disc reads as four
   sides, A-D, not two. */
import { bestSideCut, bestSideCuts, sideLengthsFromDurations, albumRecordFormat, DOUBLE_LP_SIDE_CAP_SEC } from '../record-art/format.js';

// CC5 (docs/34_CARE_AND_CONTROL.md): a single real disc's own track
// list, split into either its normal 2 time-balanced sides, or, when
// that 2-way split would put either side over DOUBLE_LP_SIDE_CAP_SEC, 4
// sides via bestSideCuts() -- "a single-disc album whose two-side split
// puts either side over 22 min becomes a double LP." Needs at least 4
// tracks to actually produce 4 groups (can't split further than one
// track per side); with fewer, the over-length 2-way split stands --
// "with no side over 22 min where avoidable," and a handful of very long
// tracks isn't avoidable this way. Returns an array of 1, 2 or 4 index
// groups, never empty for a non-empty discIdx.
function splitSingleDiscGroups(discIdx, durOf){
  if(discIdx.length < 2) return [discIdx];
  const cut = bestSideCut(discIdx.map(durOf));
  const a = discIdx.slice(0, cut).reduce((s, i) => s + durOf(i), 0);
  const b = discIdx.slice(cut).reduce((s, i) => s + durOf(i), 0);
  if(discIdx.length < 4 || Math.max(a, b) <= DOUBLE_LP_SIDE_CAP_SEC) return [discIdx.slice(0, cut), discIdx.slice(cut)];
  const cuts = bestSideCuts(discIdx.map(durOf), 4);
  const groups = [];
  let prev = 0;
  for(const c of cuts){ groups.push(discIdx.slice(prev, c)); prev = c; }
  groups.push(discIdx.slice(prev));
  return groups;
}

// §4, change records. Milliseconds from the moment the next record is asked
// for. The outgoing sleeve's own exit and the incoming sleeve's arrival
// overlap by 300 ms (1200 to 1500).
export const CHANGE_TIMELINE = {
  spinDown: [0, 400],
  lift: [250, 450],
  slideIn: [450, 1050],
  sleeveExit: [1050, 1500],
  arriveStart: 1200,
  arriveMs: 700
};

// §2, end of queue: the run-out groove before the put-away.
// One thump per revolution at 33⅓ rpm is 60 / 33.333 = 1.8 s.
export const GROOVE = { ms: 2500, fadeInMs: 150, thumpEverySec: 1.8, spinDownMs: 400 };

// §3, side flip: a shorter groove, then about 700 ms of lift and turn.
export const FLIP = { grooveMs: 2000, liftMs: 350, turnMs: 350 };

// When the new sleeve lands, measured from the start of the change.
export function changeLandsAt(t = CHANGE_TIMELINE){ return t.arriveStart + t.arriveMs; }

// Thump times (seconds) inside a groove of durSec: one per revolution,
// starting half a revolution in so the first one isn't masked by the fade-in.
export function grooveThumpTimes(durSec, period = GROOVE.thumpEverySec){
  if(!(durSec > 0) || !(period > 0)) return [];
  const out = [];
  for(let t = period / 2; t < durSec; t += period) out.push(Math.round(t * 1000) / 1000);
  return out;
}

// The album's sides, as the gatefold shows them. Each disc of a multi-disc
// album gets the same time-balanced two-side split a single disc gets: one
// track is a single side, two tracks are A and B, three or more are
// balanced by time. A disc with fewer than two tracks of its own can't be
// split (there's nothing to balance) and stays one whole side -- guarded
// explicitly here because bestSideCut() on fewer than 2 durations returns
// the array's own length ("no cut"), which would otherwise produce a
// spurious empty second group alongside the correct whole-disc one. Null
// when sides are turned off or there's only one track to show.
// trackIdx: the album's track indices in play order; tracks: S.tracks.
export function splitSides(trackIdx, tracks, enabled){
  if(!enabled || !trackIdx || trackIdx.length < 2) return null;
  const discOf = i => (tracks[i] && tracks[i].tags && tracks[i].tags.disc) || 0;
  const durOf = i => (tracks[i] && tracks[i].duration) || 0;
  const discs = [...new Set(trackIdx.map(discOf))];
  let groups;
  if(discs.length > 1){
    groups = [];
    for(const d of discs){
      const discIdx = trackIdx.filter(i => discOf(i) === d);
      if(discIdx.length < 2){ groups.push(discIdx); continue; }
      const cut = bestSideCut(discIdx.map(durOf));
      groups.push(discIdx.slice(0, cut), discIdx.slice(cut));
    }
  } else {
    groups = splitSingleDiscGroups(trackIdx, durOf);
  }
  return groups.map((idx, k) => ({label: 'SIDE ' + String.fromCharCode(65 + k), idx}));
}

// GS2 (docs/30_GROOVES_AND_SHELF.md): "the played-through log" needs to
// know, after the Nth track of an album's expected play order completes,
// whether that N lands exactly on one of splitSides()'s own side
// boundaries -- sides partition trackIdx contiguously in order, so this
// is just a running total over each group's own length. Returns the
// letter ('A', 'B', ...) of the side that just finished, or null when N
// falls strictly inside a side (nothing finished yet) or past every
// side (N larger than the album itself). `sides` is splitSides()'s own
// return value (null is a valid input -- always returns null for it, the
// caller's own cue to fall back to "one-sided release" instead).
export function sideBoundaryAt(sides, n){
  if(!sides) return null;
  let cum = 0;
  for(const s of sides){
    cum += s.idx.length;
    if(cum === n) return s.label.slice(-1);
    if(cum > n) return null;
  }
  return null;
}

// GF4 (docs/29_GATEFOLD.md point 1/2): the discs a track list actually
// spans, each with its own full set of track indices (every side of that
// disc together, not split) -- the same discOf()/distinct-disc-list shape
// splitSides() and sideLengthsFor() below already derive internally,
// shared here once instead of a third copy in the gatefold, which needs
// the plain per-disc grouping both to draw one sleeve pocket per disc and
// to place the tracklist's own "Disc N" eyebrow above each disc's first
// side. Disc numbers keep whatever order they first appear in trackIdx
// (almost always ascending, since that's how an album's own tracks sort).
// CC5 point 4, box-set follow-up (Ken, 2026-11-09, "2 in the front and 2
// in the back... cap the number of discs to 4"): a computed double LP
// (the single-real-disc case, split into 4 groups by
// splitSingleDiscGroups() above) is reported as four virtual discs here
// -- one per side, A through D -- the same shape a real tagged 4-disc
// box set's own "DISC 1".."DISC 4" eyebrows already use, so the gatefold
// needs no separate code path for "computed" vs. "tagged" once it has
// this list: both feed gatefoldBuildSleevePockets()'s row layout
// identically, and a computed LP can never exceed 4 virtual discs since
// splitSingleDiscGroups() itself never produces more than 4 groups.
export function discGroupsFor(trackIdx, tracks){
  if(!trackIdx || !trackIdx.length) return [];
  const discOf = i => (tracks[i] && tracks[i].tags && tracks[i].tags.disc) || 0;
  const durOf = i => (tracks[i] && tracks[i].duration) || 0;
  const discs = [...new Set(trackIdx.map(discOf))];
  if(discs.length > 1) return discs.map(disc => ({ disc, idx: trackIdx.filter(i => discOf(i) === disc) }));
  const groups = splitSingleDiscGroups(trackIdx, durOf);
  if(groups.length === 4){
    return groups.map((idx, i) => ({ disc: i + 1, idx }));
  }
  return [{ disc: discs[0], idx: trackIdx }];
}

// The record's own side lengths (seconds), independent of S.albumSides --
// the same per-disc time-balanced split splitSides() now uses (one disc
// with fewer than two tracks stays one length of its own; every other
// disc gets sideLengthsFromDurations()'s own two-side balance), flattened
// into one array across every disc. The one input albumFormatFor() needs
// to find "the longest side" from.
export function sideLengthsFor(trackIdx, tracks){
  if(!trackIdx || !trackIdx.length) return [0];
  const discOf = i => (tracks[i] && tracks[i].tags && tracks[i].tags.disc) || 0;
  const durOf = i => (tracks[i] && tracks[i].duration) || 0;
  const discs = [...new Set(trackIdx.map(discOf))];
  if(discs.length > 1){
    const out = [];
    for(const d of discs){
      const discIdx = trackIdx.filter(i => discOf(i) === d);
      for(const len of sideLengthsFromDurations(discIdx.map(durOf))) out.push(len);
    }
    return out;
  }
  return splitSingleDiscGroups(trackIdx, durOf).map(idx => idx.reduce((s, i) => s + durOf(i), 0));
}

// The record's own format (size/speed) -- §5's table applied to the
// longest of sideLengthsFor()'s own side lengths, or the personal
// Auto/33⅓/45 override when one's set for this album.
export function albumFormatFor(trackIdx, tracks, override){
  return albumRecordFormat(sideLengthsFor(trackIdx, tracks), override);
}

// A flip happens only when the record moves from the last track of one side
// straight onto the first track of the next side. Returns the two side
// letters ({from:'A', to:'B'}) or null for any other move.
export function sideTurn(splits, curIdx, nextIdx){
  if(!splits) return null;
  for(let k = 0; k + 1 < splits.length; k++){
    const a = splits[k].idx, b = splits[k + 1].idx;
    if(a[a.length - 1] === curIdx && b[0] === nextIdx){
      return {from: String.fromCharCode(65 + k), to: String.fromCharCode(66 + k)};
    }
  }
  return null;
}

// GS5 (docs/30_GROOVES_AND_SHELF.md): true when curIdx is the very last
// track of the album's own last side (splitSides()'s final group) -- the
// record itself is done, not just one side of it. Unlike sideTurn(),
// this doesn't care what (if anything) the queue holds next: with
// auto-flip off, the last side ending is its own stopping point.
export function isLastSideEnd(splits, curIdx){
  if(!splits || !splits.length) return false;
  const last = splits[splits.length - 1].idx;
  return last[last.length - 1] === curIdx;
}
