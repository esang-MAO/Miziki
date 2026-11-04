// RW7 (docs/23_RHYTHM_AND_WEAR.md, docs/design/rhythm-wear/README.md "RW7 ·
// wear"): pure stage math and copy formatting. Wear sits alongside metals
// (it doesn't replace them) and never touches sound.
//
// Mostly full plays (S.sessionCounts), with age since first play nudging
// the stage along — a record played steadily for years wears more than
// one played 200 times in a month. Thresholds and the age nudge are
// tunable constants, not load-bearing calibration.

const LIGHT_PLAYS = 20;
const WORN_PLAYS = 100;
const LOVED_PLAYS = 300;
const AGE_NUDGE_PLAYS_PER_YEAR = 10;
const MS_PER_YEAR = 365.25 * 24 * 60 * 60 * 1000;

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

// albumSessions: S.sessionCounts[albumId] (full plays). firstPlayedAt: ms
// epoch or falsy. now: ms epoch.
export function wearStage(albumSessions, firstPlayedAt, now){
  const plays = albumSessions || 0;
  const ageYears = firstPlayedAt ? Math.max(0, (now - firstPlayedAt) / MS_PER_YEAR) : 0;
  const effective = plays + ageYears * AGE_NUDGE_PLAYS_PER_YEAR;
  if(effective >= LOVED_PLAYS) return 'loved';
  if(effective >= WORN_PLAYS) return 'worn';
  if(effective >= LIGHT_PLAYS) return 'light';
  return 'new';
}

// QC4 (docs/24_QUIET_COUNTS.md): "Worn · since Month YYYY" / "Well loved ·
// since Month YYYY" — the stage word and the first-played month, no play
// count. Nothing for new/light, per the README table ("the first word
// follows the stage: no word for New and Light, 'Worn' or 'Well loved'
// after"). phaseWord (GF1, docs/29_GATEFOLD.md) is wearPhaseWord()'s own
// output below -- optional, and still no count, just the phase name.
export function wearCopy(stage, firstPlayedAt, phaseWord){
  if(stage !== 'worn' && stage !== 'loved') return null;
  const label = stage === 'loved' ? 'Well loved' : 'Worn';
  let out = label;
  if(firstPlayedAt){
    const d = new Date(firstPlayedAt);
    out += ` · since ${MONTH_NAMES[d.getMonth()]} ${d.getFullYear()}`;
  }
  if(phaseWord) out += ` · mostly spun ${phaseWord}`;
  return out;
}

// GF1 (docs/29_GATEFOLD.md): "the phase this record has been played in
// most... only once the record has at least five counted plays." Pure
// over S.albumPhaseCounts[albumId] ({phase: count}, src/state.js) -- the
// same per-phase map src/sundown/rhythm.js's bestAlbumPerPhase() reads,
// here read the other direction (one album's own phase spread, not the
// whole library's). Quiet counts (docs/24_QUIET_COUNTS.md): the number
// itself never reaches the screen, only the winning phase's plain word.
const PHASE_WEAR_MIN_PLAYS = 5;
const PHASE_WEAR_WORDS = {
  night: 'overnight', dawn: 'at dawn', morning: 'in the morning', midday: 'at midday',
  afternoon: 'in the afternoon', golden: 'at golden hour', twilight: 'at dusk',
};
export function wearPhaseWord(albumPhaseCounts){
  if(!albumPhaseCounts) return null;
  let best = null, bestCount = 0, total = 0;
  Object.keys(albumPhaseCounts).forEach(phase => {
    const c = albumPhaseCounts[phase] || 0;
    total += c;
    if(c > bestCount){ bestCount = c; best = phase; }
  });
  if(total < PHASE_WEAR_MIN_PLAYS || !best) return null;
  return PHASE_WEAR_WORDS[best] || null;
}
