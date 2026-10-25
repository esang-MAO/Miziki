/* ================= ceremony timing (docs/CEREMONY.md §2-§4) =================
   The numbers and small decisions behind the run-out groove, the side flip
   and the overlapped record change, kept pure (no DOM, no S) so they can
   be unit-tested without a browser. The orchestration that uses them lives
   in shell/runout.js and shell/start-sequence.js.

   AU9 (docs/16_AUDIO.md §5) replaced splitSides()'s old track-count
   midpoint split with the time-balanced one record-art/format.js's
   bestSideCut() computes, and added sideLengthsFor()/albumFormatFor() --
   the record's own side lengths and format are computed independent of
   whether Album sides itself is on ("the format... is computed whether or
   not the Sides setting is on. With Sides off, there are simply no
   flips."), so this file keeps its one real import from that still-pure
   leaf module rather than duplicating the split math a second time. */
import { bestSideCut, sideLengthsFromDurations, albumRecordFormat } from '../record-art/format.js';

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

// docs/15_SURFACE_NOISE.md §4, Auto-flip Off: how long the record waits in
// the run-out, needle still down, before it lifts on its own. "Until I lift
// it" has no timeout at all (null) -- the record waits forever, same as the
// doc's own third bullet ("run-out continues until flip, lift, or pull").
export const WAIT_TIMEOUT_MS = { short: 8000, normal: 20000, 'until-lift': null };

export function runoutWaitMs(runoutLength){
  return Object.prototype.hasOwnProperty.call(WAIT_TIMEOUT_MS, runoutLength)
    ? WAIT_TIMEOUT_MS[runoutLength] : WAIT_TIMEOUT_MS.normal;
}

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

// The album's sides, as the gatefold shows them: one per disc when the
// album has several (today's own kept-as-is behavior), otherwise the two
// sides bestSideCut() balances by time -- "one track: a single side, no
// flip. Two tracks: A and B. Three or more: balanced by time." Null when
// sides are turned off or there's only one track to show.
// trackIdx: the album's track indices in play order; tracks: S.tracks.
export function splitSides(trackIdx, tracks, enabled){
  if(!enabled || !trackIdx || trackIdx.length < 2) return null;
  const discOf = i => (tracks[i] && tracks[i].tags && tracks[i].tags.disc) || 0;
  const discs = [...new Set(trackIdx.map(discOf))];
  if(discs.length > 1){
    return discs.map((d, k) => ({label:'SIDE ' + String.fromCharCode(65 + k),
      idx: trackIdx.filter(i => discOf(i) === d)}));
  }
  const durOf = i => (tracks[i] && tracks[i].duration) || 0;
  const cut = bestSideCut(trackIdx.map(durOf));
  return [{label:'SIDE A', idx: trackIdx.slice(0, cut)}, {label:'SIDE B', idx: trackIdx.slice(cut)}];
}

// The record's own side lengths (seconds), independent of S.albumSides --
// one per disc for a multi-disc album (today's kept-as-is rule), otherwise
// sideLengthsFromDurations()'s time-balanced split. The one input
// albumFormatFor() needs to find "the longest side" from.
export function sideLengthsFor(trackIdx, tracks){
  if(!trackIdx || !trackIdx.length) return [0];
  const discOf = i => (tracks[i] && tracks[i].tags && tracks[i].tags.disc) || 0;
  const discs = [...new Set(trackIdx.map(discOf))];
  const durOf = i => (tracks[i] && tracks[i].duration) || 0;
  if(discs.length > 1){
    return discs.map(d => trackIdx.filter(i => discOf(i) === d).reduce((s, i) => s + durOf(i), 0));
  }
  return sideLengthsFromDurations(trackIdx.map(durOf));
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
