/* ================= 45 RPM records: sides by time, format, rotation =======
   AU9 (docs/16_AUDIO.md §5): pure, zero-import leaf -- same "directly
   unit-testable in Node" shape as audio/loudness.js/level-match.js and
   sundown/rhythm.js. No DOM, no S, no AudioContext.

   Three independent pieces live here:
   - bestSideCut()/sideLengthsFromDurations(): the duration-based side
     split ("keep track order and pick the cut point that best balances
     the two sides") that superseded the old track-count midpoint split.
   - formatForLongestSide()/recordFormat()/albumRecordFormat(): the
     "format from the longest side" table (7" @45 / 12" EP @45 / 12" LP
     @33⅓), plus the personal Auto/33⅓/45 override.
   - rotationHz(): "the platter turns at rpm × 6°/s × S.rate... add one
     helper, rotationHz() = (rpm / 60) × S.rate, and use it for the wobble
     oscillator and for every surface-noise call that passes 0.55 * S.rate
     today" -- one source of truth shared by audio/engine.js's wow
     oscillator and every surface-noise call site that used to hardcode
     0.55 (33.333/60 rounded) in player/transport.js, player/queue.js and
     shell/runout.js. */

export const RPM_33 = 33.333;
export const RPM_45 = 45;

// §5's table boundaries, in seconds.
export const SEVEN_INCH_MAX_SEC = 7 * 60;
export const TWELVE_SINGLE_MAX_SEC = 15 * 60;

// The cut point (an index into durations, 1..n-1) that best balances the
// two sides by total time, keeping track order -- "the cut point that
// best balances the two sides." Fewer than 2 durations has no meaningful
// cut (a single track is a single side, no flip) and returns
// durations.length so a caller can tell "no split" apart from "split at
// 0" by comparing against the array's own length. A tie (two cut points
// giving the same difference) keeps the earlier one, deterministically.
export function bestSideCut(durations){
  const n = durations.length;
  if(n < 2) return n;
  const total = durations.reduce((a, b) => a + (b || 0), 0);
  let bestK = 1, bestDiff = Infinity, running = 0;
  for(let k = 1; k < n; k++){
    running += durations[k - 1] || 0;
    const diff = Math.abs(running - (total - running));
    if(diff < bestDiff){ bestDiff = diff; bestK = k; }
  }
  return bestK;
}

// The side lengths (seconds) a plain, single-disc track list splits into:
// one side for a single track (no flip) or an empty list, otherwise the
// two time-balanced sides bestSideCut() picks (always exactly two sides --
// "two tracks: A and B. Three or more: balanced by time").
export function sideLengthsFromDurations(durations){
  if(!durations || !durations.length) return [0];
  if(durations.length < 2) return [durations[0] || 0];
  const cut = bestSideCut(durations);
  const a = durations.slice(0, cut).reduce((s, d) => s + (d || 0), 0);
  const b = durations.slice(cut).reduce((s, d) => s + (d || 0), 0);
  return [a, b];
}

// The table itself: "up to 7:00: 7″ single, 45. 7:00 to 15:00: 12″
// single/EP, 45. Over 15:00: 12″ LP, 33⅓." The same for every copy of the
// record, since it's computed from the record's own track lengths, never
// chosen by the listener.
export function formatForLongestSide(longestSec){
  if((longestSec || 0) <= SEVEN_INCH_MAX_SEC) return { size: '7"', speed: RPM_45 };
  if(longestSec <= TWELVE_SINGLE_MAX_SEC) return { size: '12"', speed: RPM_45 };
  return { size: '12"', speed: RPM_33 };
}

// override: 'auto' (default/falsy) | '33' | '45' -- a personal choice that
// skips the table's own speed decision: 33⅓ is always a 12", and 45 still
// sizes itself from the table (7″ if the longest side fits, else 12″).
export function recordFormat(longestSec, override){
  if(override === '33') return { size: '12"', speed: RPM_33 };
  if(override === '45') return { size: (longestSec || 0) <= SEVEN_INCH_MAX_SEC ? '7"' : '12"', speed: RPM_45 };
  return formatForLongestSide(longestSec);
}

// sideLengths: the record's own side lengths (seconds) -- from
// sideLengthsFromDurations() for a single disc, or one entry per disc for
// a multi-disc album (shell/ceremony-timing.js's sideLengthsFor() builds
// that either shape). The format always comes from whichever side runs
// longest.
export function albumRecordFormat(sideLengths, override){
  const longest = Math.max(0, ...(sideLengths && sideLengths.length ? sideLengths : [0]));
  return recordFormat(longest, override);
}

// rpm/60 × rate -- how many full revolutions per second a record spins at,
// which both the wow/flutter oscillator and the groove's own thump timing
// are driven from.
export function rotationHz(rpm, rate){
  return ((rpm || RPM_33) / 60) * (rate || 1);
}

/* ================= AU10 (docs/16_AUDIO.md §5, "how it looks"/"how it
   sounds"): text and the dead-wax radius, both derived from the same
   format table above -- kept in this leaf so the player chip, the liner
   notes, the crate stickers, the catalog card and the edit sheet's own
   result line all read the one same mapping, never a second copy of it. */

// "7″ single" / "12″ single / EP" / "12″ LP" from the table, shortened to
// one name per cell the way the liner-notes example already shows it
// ("12″ EP · 45 RPM").
export function formatRecordName(format){
  if(!format) return '';
  if(format.size === '7"') return '7″ SINGLE';
  if(format.speed === RPM_45) return '12″ EP';
  return '12″ LP';
}

// The small "7″ · 45"-style chip text used before the spec line, on crate
// stickers and on the catalog card.
export function formatChipText(format){
  if(!format) return '';
  return format.size + ' · ' + formatSpeedText(format.speed);
}

export function formatSpeedText(speed){
  return speed === RPM_45 ? '45' : '33⅓';
}

// Side capacity in seconds, per the doc's own three numbers ("about 7 min
// for a 7″ at 45, 15 min for a 12″ at 45, 22 min for an LP"). Used only to
// scale the dead-wax band's own radius -- never the format decision
// itself, which stays recordFormat()'s job alone.
export function sideCapacitySec(format){
  if(!format) return TWELVE_SINGLE_MAX_SEC;
  if(format.size === '7"') return SEVEN_INCH_MAX_SEC;
  if(format.speed === RPM_45) return TWELVE_SINGLE_MAX_SEC;
  return 22 * 60;
}

// How full a side is, 0..1 -- a short side (little of the groove actually
// used) reads near 0, a side that fills its format's whole capacity reads
// 1. Clamped so an over-long side (already a different format, by the
// table above) never reads past full.
export function sideFullness(sideLengthSec, format){
  const cap = sideCapacitySec(format);
  if(!(cap > 0)) return 1;
  return Math.max(0, Math.min(1, (sideLengthSec || 0) / cap));
}

/* ================= AU11 (docs/16_AUDIO.md §5, "friends see the format"):
   the short text code a record's own *automatic* format is published as
   (never the personal override, which stays local/backed-up only --
   state.js's S.albumFormat) -- one code per table cell, decoded back
   into the same {size, speed} shape everything else in this file reads.
   The server (supabase/migrations/021_friends_see_format.sql) only ever
   stores and compares this string -- it never interprets it. */

export function formatWireCode(format){
  if(!format) return null;
  if(format.size === '7"') return '7-45';
  if(format.speed === RPM_45) return '12-45';
  return '12-33';
}

export function formatFromWireCode(code){
  if(code === '7-45') return { size: '7"', speed: RPM_45 };
  if(code === '12-45') return { size: '12"', speed: RPM_45 };
  if(code === '12-33') return { size: '12"', speed: RPM_33 };
  return null;
}
