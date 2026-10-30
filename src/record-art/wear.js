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

// "Worn · N plays since Month YYYY" / "Well loved · …" — nothing for
// new/light, per the README table ("the first word follows the stage: no
// word for New and Light, 'Worn' or 'Well loved' after").
export function wearCopy(stage, albumSessions, firstPlayedAt){
  if(stage !== 'worn' && stage !== 'loved') return null;
  const label = stage === 'loved' ? 'Well loved' : 'Worn';
  const plays = albumSessions || 0;
  const playWord = plays === 1 ? 'play' : 'plays';
  if(!firstPlayedAt) return `${label} · ${plays} ${playWord}`;
  const d = new Date(firstPlayedAt);
  const since = `${MONTH_NAMES[d.getMonth()]} ${d.getFullYear()}`;
  return `${label} · ${plays} ${playWord} since ${since}`;
}
