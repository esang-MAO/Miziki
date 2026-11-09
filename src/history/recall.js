/* ================= LI4 (docs/35_LEAD_IN.md) — a record remembers =================
   Pure, read-only over stats src/history/ already keeps -- this file never
   writes a listening counter (CLAUDE.md's "src/history/ is the only place
   that writes listening counters" still holds; recall.js only reads two of
   those maps back, the same posture sundown/rhythm.js and record-art/
   wear.js already have). Reminiscence -- memories of specific times as a
   reason people reach for a record -- is one of the most common things
   people say about why they chose a piece of music (Oxford Handbook of
   Music Psychology, ch. 13, 43). The data already exists
   (S.albumPlayCountsByDay, kept ~400 days; S.albumPhaseCounts, lifetime)
   but nothing on the record itself read it back before this.

   Season/phase words only -- never a date, never "this time last year":
   CLAUDE.md's "Miziki never announces a time of day" rule applies here
   the same as everywhere else. */

import { seasonKeyFor, RHYTHM_PRUNE_KEEP_DAYS } from '../sundown/rhythm.js';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

// "Only when the album has at least 5 plays in the window" (LI4 point 1) --
// the same shape of gate wear.js's wearPhaseWord() already uses for its
// own phase line, just over the windowed per-album total instead of a
// lifetime one.
const RECALL_MIN_PLAYS = 5;
const SEASON_SHARE_MIN = 0.40;
const PHASE_SHARE_MIN = 0.50;

const SEASON_WORDS = { winter: 'winter', spring: 'spring', summer: 'summer', autumn: 'autumn' };

// Plain phase words for "Mostly at [phase]" -- a different phrasing from
// wear.js's own PHASE_WEAR_WORDS ("mostly spun at dusk", read as part of a
// longer wear sentence), since this line stands alone.
const RECALL_PHASE_WORDS = {
  night: 'night', dawn: 'dawn', morning: 'morning', midday: 'midday',
  afternoon: 'afternoon', golden: 'golden hour', twilight: 'dusk',
};

// Sums `albumPlayCountsByDay` (GS1, src/state.js -- {dayKey: {albumId:
// count}}) for one album, grouped by the meteorological season each day
// falls in (sundown/rhythm.js's seasonKeyFor()), over the last
// `windowDays` of `now`. Pure. {bySeasonKey: {seasonKey: count}, total}.
export function seasonTotalsForAlbum(albumPlayCountsByDay, albumId, now, windowDays){
  const map = albumPlayCountsByDay || {};
  const cutoff = (now instanceof Date ? now.getTime() : now) - windowDays * MS_PER_DAY;
  const bySeasonKey = {};
  let total = 0;
  Object.keys(map).forEach(key => {
    const parts = key.split('-');
    const keyMs = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2])).getTime();
    if(keyMs < cutoff) return;
    const c = (map[key] || {})[albumId] || 0;
    if(!c) return;
    const season = seasonKeyFor(keyMs);
    bySeasonKey[season] = (bySeasonKey[season] || 0) + c;
    total += c;
  });
  return { bySeasonKey, total };
}

// The gatefold's one quiet "remembers" line for this album, or null:
//   - "Spun a lot last [season]" when one past season (never the current
//     one) holds at least 40% of this album's plays in the kept window;
//   - else "Mostly at [phase]" when one phase holds at least 50% of
//     `albumPhaseCounts`, unless `skipPhase` (the wear line already said
//     the same phase -- LI4 point 2, checked by the caller);
//   - else null.
// `albumPlayCountsByDay`/`albumPhaseCounts` are whichever of S's own maps
// or S.mergedStats' merged twins the caller already picked (LI4: "uses
// merged stats when signed in", same posture as every other per-device
// counter reader in this app).
export function recallLineFor(albumPlayCountsByDay, albumPhaseCounts, albumId, now, skipPhase){
  const { bySeasonKey, total } = seasonTotalsForAlbum(albumPlayCountsByDay, albumId, now, RHYTHM_PRUNE_KEEP_DAYS);
  if(total < RECALL_MIN_PLAYS) return null;

  const currentSeason = seasonKeyFor(now);
  let bestSeason = null, bestSeasonCount = 0;
  Object.keys(bySeasonKey).forEach(key => {
    if(key === currentSeason) return;
    const c = bySeasonKey[key];
    if(c > bestSeasonCount){ bestSeasonCount = c; bestSeason = key; }
  });
  if(bestSeason && bestSeasonCount / total >= SEASON_SHARE_MIN){
    const name = bestSeason.slice(bestSeason.indexOf('-') + 1);
    return 'Spun a lot last ' + (SEASON_WORDS[name] || name);
  }

  if(skipPhase) return null;
  const phaseCounts = albumPhaseCounts || {};
  let phaseTotal = 0, bestPhase = null, bestPhaseCount = 0;
  Object.keys(phaseCounts).forEach(p => {
    const c = phaseCounts[p] || 0;
    phaseTotal += c;
    if(c > bestPhaseCount){ bestPhaseCount = c; bestPhase = p; }
  });
  if(bestPhase && phaseTotal > 0 && bestPhaseCount / phaseTotal >= PHASE_SHARE_MIN){
    return 'Mostly at ' + (RECALL_PHASE_WORDS[bestPhase] || bestPhase);
  }
  return null;
}
