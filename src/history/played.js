/* ---- played-duration tracking: which portions of the current track's timeline
   have actually sounded, not just been scrubbed past. Forward playback extends
   the last interval in O(1); a merge only runs when coverage is asked for. ---- */
import { S, current } from '../state.js';
import { trackIdentityKey, trackTier, albumKey } from '../record-art/tiers.js';
import { sessionTrackComplete, persistTrackPlayCounts, persistTrackMetalEligiblePlays, persistPhasePlayCounts, persistAlbumPhaseCounts, persistPhasePlayCountsByDay } from './sessions.js';
import { snapshotAlbumDisplay, snapshotTrackDisplay } from '../library/thumbs.js';
import { applyDiscVariant } from '../record-art/looks.js';
import { checkAlbumAchievementAndCollection } from './achievements.js';
import { persistTrackLastPlayed } from '../profile/screens.js';
import { scheduleBackupSync } from '../sync/backup.js';
import { realDayPosition } from '../sundown/solar.js';
import { dayKeyFor, pruneDayBuckets, RHYTHM_PRUNE_KEEP_DAYS } from '../sundown/rhythm.js';

export function addPlayedRange(a, b){
  if(b <= a) return;
  const n = S.curPlayed.length;
  if(n && a <= S.curPlayed[n-1][1] + 0.05) S.curPlayed[n-1][1] = Math.max(S.curPlayed[n-1][1], b);
  else S.curPlayed.push([a, b]);
}
export function playedCoverage(){
  if(!S.curPlayed.length) return 0;
  const ivs = S.curPlayed.slice().sort((x,y) => x[0]-y[0]);
  let total = 0, curStart = ivs[0][0], curEnd = ivs[0][1];
  for(let i=1;i<ivs.length;i++){
    const [s,e] = ivs[i];
    if(s <= curEnd + 0.05) curEnd = Math.max(curEnd, e);
    else { total += curEnd - curStart; curStart = s; curEnd = e; }
  }
  total += curEnd - curStart;
  return total;
}

// same audio-actually-played measure as sessions, not playhead position —
// counts regardless of shuffle/order/skips, since track metals are earned
// outside album context (repeat listens, singles, queue, search). Keyed by
// trackIdentityKey(), not the file id, so the count survives a re-import.
export function incrementTrackPlay(t){
  const key = trackIdentityKey(t);
  S.trackPlayCounts[key] = (S.trackPlayCounts[key] || 0) + 1;
  if(trackTier(t) === 1) S.trackMetalEligiblePlays[key] = (S.trackMetalEligiblePlays[key] || 0) + 1;
  S.trackLastPlayed[key] = Date.now();
  // DA5 (docs/DAY_ARC.md): realDayPosition(), not currentDayPosition() —
  // the real clock, never S.previewMin, so Preview the day can never
  // create or change this stat.
  const phase = realDayPosition().phase;
  S.phasePlayCounts[phase] = (S.phasePlayCounts[phase] || 0) + 1;
  const albumId = albumKey(t);
  const perAlbum = S.albumPhaseCounts[albumId] || (S.albumPhaseCounts[albumId] = {});
  perAlbum[phase] = (perAlbum[phase] || 0) + 1;
  // RF22 (docs/12_REFINE.md, "words that invite", point 3): the same
  // count, also bucketed by local calendar day, so the rhythm card can
  // read "a season" (a rolling window, sundown/rhythm.js's
  // windowedPhaseCounts()) rather than a lifetime total. Pruned on every
  // write, not just occasionally, since a write is the one guaranteed
  // chance to keep this bounded -- there's no other scheduled sweep.
  const today = dayKeyFor(Date.now());
  const todayBucket = S.phasePlayCountsByDay[today] || (S.phasePlayCountsByDay[today] = {});
  todayBucket[phase] = (todayBucket[phase] || 0) + 1;
  S.phasePlayCountsByDay = pruneDayBuckets(S.phasePlayCountsByDay, Date.now(), RHYTHM_PRUNE_KEEP_DAYS);
  persistTrackPlayCounts();
  persistTrackMetalEligiblePlays();
  persistTrackLastPlayed();
  persistPhasePlayCounts();
  persistAlbumPhaseCounts();
  persistPhasePlayCountsByDay();
  snapshotAlbumDisplay(t);
  snapshotTrackDisplay(t, key);
  if(current() === t) applyDiscVariant(t, true);
}

export function checkTrackCompletion(t){
  if(S.curTrackDone || !t.duration) return;
  if(playedCoverage() >= 0.95 * t.duration){
    S.curTrackDone = true;
    incrementTrackPlay(t);
    sessionTrackComplete(t);
    checkAlbumAchievementAndCollection(t);
    scheduleBackupSync();
  }
}
