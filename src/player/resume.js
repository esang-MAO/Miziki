/* ================= AU1 (docs/16_AUDIO.md §2.1): resume where you left off =================
   Saves the queue (S.baseQueue/S.queue/S.qpos), the current track and the
   playback position, and restores them paused at boot — "the mini player
   shows the record and Play continues from there," never autoplaying.
   Tracks are saved by id (idOf()/idxOf(), library/model.js), never by
   index: indices shift the moment a file is added or removed, but an id
   survives that.

   Device-only, same posture as S.theme/the Sundown dial view (CLAUDE.md's
   backup table) — this key is written straight to the `meta` store via
   storage/repo.js, never through src/storage/meta.js's serializePrefs()/
   saveMeta(), and src/sync/backup.js's buildLocalState() never reads it,
   so "what I was playing" never leaves this device. Syncing it across
   devices is a later idea (docs/16_AUDIO.md, "Later ideas").

   Imports setQueue() from player/queue.js, which already imports back from
   player/transport.js (load/play/pause/seek) — this file, called from
   transport.js's pause()/play() below, forms a real three-module circular
   pair with both, the same peer-import shape CLAUDE.md's refactor rule 8
   already documents for engine.js/transport.js. Nothing here is called at
   module top level, only from inside function bodies, so the cycle is
   safe. */
import { S } from '../state.js';
import { idOf, idxOf } from '../library/model.js';
import { meta, storage } from '../storage/repo.js';
import { setQueue } from './queue.js';
import { drawTime } from './clock.js';

const RESUME_KEY = 'resume';
const AUTOSAVE_MS = 5000;
// -Infinity, not 0: the very first tick must always save regardless of
// what `now` happens to be (performance.now()-style timestamps start near
// 0 too, so a bare 0 here would wrongly throttle an early real tick).
let lastAutosave = -Infinity;

function snapshot(){
  if(S.index < 0 || !S.tracks[S.index]) return null;
  const currentId = idOf(S.index);
  if(currentId == null) return null;
  return {
    baseQueueIds: S.baseQueue.map(idOf).filter(id => id != null),
    queueIds: S.queue.map(idOf).filter(id => id != null),
    qpos: S.qpos,
    currentId,
    pos: S.pos,
    savedAt: Date.now(),
  };
}

// Immediate, not debounced — §2.1's "immediately on pause,
// visibilitychange (hidden) and pagehide" rule. Called from
// player/transport.js's pause() and src/wiring/lifecycle.js.
export function saveResumeNow(){
  if(!storage.available()) return;
  const snap = snapshot();
  if(snap) meta.put(RESUME_KEY, snap);
}

// A plain throttle, not a debounce — "about every 5s while playing"
// regardless of how often the caller (player/clock.js's tick()) itself
// runs. now is the same performance.now() value tick() already has.
export function autosaveResumeTick(now){
  if(!S.playing) return;
  if(now - lastAutosave < AUTOSAVE_MS) return;
  lastAutosave = now;
  saveResumeNow();
}

// Restores paused at the saved position, dropping any track deleted
// since (§2.1). Returns true if there was something to restore, false if
// there's nothing saved (or nothing left of it) — the caller falls back
// to today's "land on the last-played album" behavior in that case.
export async function restoreResume(){
  if(!storage.available()) return false;
  const snap = await meta.get(RESUME_KEY);
  if(!snap || !Array.isArray(snap.baseQueueIds) || !snap.baseQueueIds.length) return false;

  const baseQueue = snap.baseQueueIds.map(idxOf).filter(i => i >= 0);
  if(!baseQueue.length) return false;

  const queueIds = (Array.isArray(snap.queueIds) && snap.queueIds.length) ? snap.queueIds : snap.baseQueueIds;
  const origQpos = Number.isInteger(snap.qpos) ? snap.qpos : 0;
  // Resolve every id that still has a track, in the same relative order,
  // dropping ones that don't — same as §2.1's "missing tracks are dropped
  // from the restored queue." qpos lands on whichever surviving entry sits
  // at or after the saved position, so a deleted current track lands on
  // whatever was next in line, not back at the start of the whole queue.
  const queue = [];
  let qpos = -1;
  for(let i = 0; i < queueIds.length; i++){
    const idx = idxOf(queueIds[i]);
    if(idx < 0) continue;
    queue.push(idx);
    if(qpos < 0 && i >= origQpos) qpos = queue.length - 1;
  }
  if(!queue.length) return false;
  if(qpos < 0) qpos = queue.length - 1;   // the saved position and everything after it is gone

  const curIdx = queue[qpos];
  // only resume the exact saved position if the track we actually saved it
  // for is still the one we landed on — otherwise it's a substitute for a
  // deleted track, which restores "at 0:00" per §2.1
  const pos = (idOf(curIdx) === snap.currentId) ? (snap.pos || 0) : 0;

  let startPos = baseQueue.indexOf(curIdx);
  if(startPos < 0) startPos = 0;
  setQueue(baseQueue, startPos, false);
  // setQueue() may have reshuffled S.queue off S.baseQueue if shuffle is
  // on (already restored from prefs by the time this runs) — overwrite
  // with the exact order this device actually left off on
  S.queue = queue;
  S.qpos = qpos;
  S.pos = pos;
  S.resumePending = true;
  drawTime();
  // The platter stays put away (main.js's own putAwayInstant() call, right
  // after this resolves, always re-covers it) — the same "Play pulls the
  // record" ceremony (CEREMONY spec §2, §5) every other boot already uses.
  // Nothing here needs to touch #platterBox/disc-hidden itself.
  return true;
}
