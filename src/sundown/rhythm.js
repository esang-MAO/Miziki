/* ================= listening rhythm (DA5, docs/DAY_ARC.md; windowed RF22) =================
   Pure functions over a {phase: count} / {albumId: {phase: count}} map —
   no DOM, no network, no S import, the same "testable without a browser"
   shape as sundown/day.js and sundown/drift.js. S.phasePlayCountsByDay
   (src/history/played.js, counted from the real clock only — see
   sundown/solar.js's realDayPosition()), summed over the last
   RHYTHM_WINDOW_DAYS by windowedPhaseCounts() below, is what every real
   caller now feeds computeRhythmShares() (RF22, "a season" — was
   S.phasePlayCounts, a lifetime total, before this step). bestAlbumPerPhase
   still reads lifetime S.albumPhaseCounts — RF22 only asks for the
   verdict/share ring itself to be windowed, not the per-phase "best
   record" list, which isn't part of the shared {verdict, shares} payload
   in the first place. src/sync/backup.js's merged.totals.counters.* (the
   cross-device grand totals) are shaped identically to the lifetime maps
   and could still be fed into computeRhythmShares() directly, though
   nothing does — the profile card and the shared snapshot both read this
   device's own local, windowed counts, the same "never written back from
   a merge" posture every other per-device counter in this app already
   has (see src/sync/merge.js's own header comment). */

// The seven phases named throughout docs/DAY_ARC.md's own day model —
// the fixed iteration order every function below uses, so a caller never
// has to guess which phases exist or in what order to read them.
export const PHASES = ['night', 'dawn', 'morning', 'midday', 'afternoon', 'golden', 'twilight'];

// "Show it only after at least 20 counted plays" (DA5 point 2) — gates
// both the profile card itself and what the sharing toggle is allowed to
// publish (src/sync/backup.js's own push cycle checks this too, so an
// account can never end up sharing a near-empty rhythm just because the
// toggle happened to be flipped on early).
export const RHYTHM_MIN_PLAYS = 20;

// "no phase is above about 30%" (DA5 point 2) — below this, the verdict
// falls through to "Around the clock" regardless of which phase happens
// to be nominally largest.
export const RHYTHM_VERDICT_THRESHOLD = 0.30;

// {total, shares: {phase: 0..1}} — every one of the seven phases is
// always present in `shares` (0 for a phase with no plays at all), so a
// caller (the ring, the legend) never has to guard a missing key.
export function computeRhythmShares(counts){
  const c = counts || {};
  let total = 0;
  PHASES.forEach(p => { total += c[p] || 0; });
  const shares = {};
  PHASES.forEach(p => { shares[p] = total ? (c[p] || 0) / total : 0; });
  return { total, shares };
}

// RF22 (docs/12_REFINE.md, "words that invite", point 3): "listening
// rhythm as a season" — a rolling window over the day-bucketed counts
// (S.phasePlayCountsByDay, kept by history/played.js) rather than a
// lifetime total, so the card/verdict/share reflect lately, not ever.
// 90 days reads as a season (three-ish months); PRUNE_KEEP_DAYS is kept
// well past the window so a write never prunes a bucket the window
// itself still needs to read.
export const RHYTHM_WINDOW_DAYS = 90;
export const RHYTHM_PRUNE_KEEP_DAYS = 120;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

// A local-calendar 'YYYY-MM-DD' string for `ts` (a Date or epoch ms) —
// local time, not UTC, the same calendar day a person would name, and
// consistent with realDayPosition()'s own local-solar-time basis (the
// phase a play is tallied under already depends on the device's local
// clock, so the day it's bucketed under should too).
export function dayKeyFor(ts){
  const d = ts instanceof Date ? ts : new Date(ts);
  const y = d.getFullYear(), m = d.getMonth() + 1, day = d.getDate();
  return y + '-' + String(m).padStart(2, '0') + '-' + String(day).padStart(2, '0');
}

// Sums every day-bucket within the last `windowDays` of `now` (inclusive
// of today) into a flat {phase: count} map — the same shape
// computeRhythmShares() already takes, so a caller just threads this in
// ahead of it rather than computeRhythmShares() itself needing to know
// anything about days at all.
export function windowedPhaseCounts(byDay, now, windowDays){
  const map = byDay || {};
  const cutoff = (now instanceof Date ? now.getTime() : now) - windowDays * MS_PER_DAY;
  const out = {};
  Object.keys(map).forEach(key => {
    // dayKeyFor() always produces a key whose own local midnight is a
    // stable, parseable instant — re-deriving it from the key itself
    // (rather than trusting insertion order) means this works regardless
    // of how `byDay` was built or iterated.
    const parts = key.split('-');
    const keyMs = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2])).getTime();
    if(keyMs < cutoff) return;
    const bucket = map[key] || {};
    PHASES.forEach(p => { if(bucket[p]) out[p] = (out[p] || 0) + bucket[p]; });
  });
  return out;
}

// Generic sibling of windowedPhaseCounts() above, for a day-bucket map
// whose per-day value isn't the fixed PHASES set — QC2 (docs/
// 24_QUIET_COUNTS.md)'s S.albumPlayCountsByDay, one {albumId: count} map
// per day, sums however many distinct keys a bucket actually holds
// instead of iterating a known list.
export function windowedCounts(byDay, now, windowDays){
  const map = byDay || {};
  const cutoff = (now instanceof Date ? now.getTime() : now) - windowDays * MS_PER_DAY;
  const out = {};
  Object.keys(map).forEach(key => {
    const parts = key.split('-');
    const keyMs = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2])).getTime();
    if(keyMs < cutoff) return;
    const bucket = map[key] || {};
    Object.keys(bucket).forEach(k => { out[k] = (out[k] || 0) + bucket[k]; });
  });
  return out;
}

// Pure — returns a new object, never mutates `byDay`. Drops any bucket
// older than `keepDays`, so the map a device persists never grows past a
// bounded size no matter how long the library's been played.
export function pruneDayBuckets(byDay, now, keepDays){
  const map = byDay || {};
  const cutoff = (now instanceof Date ? now.getTime() : now) - keepDays * MS_PER_DAY;
  const out = {};
  Object.keys(map).forEach(key => {
    const parts = key.split('-');
    const keyMs = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2])).getTime();
    if(keyMs >= cutoff) out[key] = map[key];
  });
  return out;
}

// One line from the largest share, phrased as something said about a
// season just passed rather than a label pinned to the person ("NIGHT
// LISTENER") — RF22's own "Lately, mostly after dark" example. docs/
// DAY_ARC.md's original three verbatim examples ("Mostly a night
// listener", "A morning listener", "Golden-hour leaning") are reworded
// the same way; the other four phases keep a plain, consistent "Lately,
// mostly <phase>" shape.
const VERDICT_LABEL = {
  night: 'Lately, mostly after dark',
  dawn: 'Lately, often up with first light',
  morning: 'Lately, mostly a morning listener',
  midday: 'Lately, mostly midday',
  afternoon: 'Lately, mostly afternoon',
  golden: 'Lately, leaning golden hour',
  twilight: 'Lately, mostly at twilight',
};
export const RHYTHM_AROUND_LABEL = 'Lately, around the clock';

export function rhythmVerdictLabel(shares){
  let best = null, bestShare = 0;
  PHASES.forEach(p => {
    const s = (shares && shares[p]) || 0;
    if(s > bestShare){ bestShare = s; best = p; }
  });
  if(!best || bestShare < RHYTHM_VERDICT_THRESHOLD) return RHYTHM_AROUND_LABEL;
  return VERDICT_LABEL[best];
}

// "Optionally, a record per phase: the most-played album in each phase"
// (DA5 point 2) — returns {phase: albumId|null}, every phase present. A
// tie keeps whichever album id sorts first alphabetically, a
// deterministic (if arbitrary) tiebreak — a {phase: count} map carries no
// "most recent" signal to break a tie by instead.
export function bestAlbumPerPhase(albumPhaseCounts){
  const perAlbum = albumPhaseCounts || {};
  const albumIds = Object.keys(perAlbum).sort();
  const out = {};
  PHASES.forEach(phase => {
    let bestAlbum = null, bestCount = 0;
    albumIds.forEach(albumId => {
      const c = (perAlbum[albumId] && perAlbum[albumId][phase]) || 0;
      if(c > bestCount){ bestCount = c; bestAlbum = albumId; }
    });
    out[phase] = bestAlbum;
  });
  return out;
}
