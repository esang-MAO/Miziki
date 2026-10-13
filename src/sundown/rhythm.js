/* ================= listening rhythm (DA5, docs/DAY_ARC.md) =================
   Pure functions over a {phase: count} / {albumId: {phase: count}} map —
   no DOM, no network, no S import, the same "testable without a browser"
   shape as sundown/day.js and sundown/drift.js. S.phasePlayCounts/
   S.albumPhaseCounts (src/history/played.js, counted from the real clock
   only — see sundown/solar.js's realDayPosition()) are the only real
   callers' inputs; src/sync/backup.js's merged.totals.counters.* (the
   cross-device grand totals) are shaped identically and could be fed in
   just as well, though nothing does today — the profile card reads this
   device's own local counts, the same "never written back from a merge"
   posture every other per-device counter in this app already has (see
   src/sync/merge.js's own header comment). */

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

// One line from the largest share. docs/DAY_ARC.md names three examples
// verbatim ("Mostly a night listener", "A morning listener", "Golden-hour
// leaning") plus the "Around the clock" fallback; the other four phases
// get a plain, consistent phrasing of the same "Mostly a <phase>
// listener" shape the doc's own night/midday/afternoon/twilight wording
// implies without spelling each one out.
const VERDICT_LABEL = {
  night: 'Mostly a night listener',
  dawn: 'Mostly a dawn listener',
  morning: 'A morning listener',
  midday: 'Mostly a midday listener',
  afternoon: 'Mostly an afternoon listener',
  golden: 'Golden-hour leaning',
  twilight: 'Mostly a twilight listener',
};
export const RHYTHM_AROUND_LABEL = 'Around the clock';

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
