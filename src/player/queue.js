/* ================= queue, shuffle, repeat =================
   Moved out of main.js (step 5a), together with the "visible queue"
   section's advance()/preloadNextTrack() — see CLAUDE.md. The rest of the
   "visible queue" section (queueInsert/playNext/addToQueue, queueRemoveAt,
   queueMove, the queue-sheet UI) moved in here too, in step 5e. */
import { S, current } from '../state.js';
import { $, el } from '../util/dom.js';
import { albumKey } from '../record-art/tiers.js';
import { sleepStopPlayback } from './sleep-timer.js';
import { load, play, pause, seek } from './transport.js';
import { drawTime } from './clock.js';
import { ensureBuffer } from './buffers.js';
import { invalidateActiveSessionIfAny } from '../history/sessions.js';
// Temporary circular imports back to main.js (rule 8 in CLAUDE.md) — these
// are screen functions that haven't been extracted yet. Used only inside
// the functions below, never at module load.
import {
  runStartSequence, openPlayerViaSheet,
  shouldPutAway, putAwayInstant, runPutAwaySequence,
} from '../main.js';

export function buildOrder(first){
  const rest = S.baseQueue.filter(i => i !== first);
  for(let i = rest.length - 1; i > 0; i--){
    const j = Math.floor(Math.random()*(i+1));
    [rest[i], rest[j]] = [rest[j], rest[i]];
  }
  S.queue = (first === undefined || first === null) ? rest : [first].concat(rest);
}

export function setQueue(indices, startPos, autoplay){
  invalidateActiveSessionIfAny();
  S.baseQueue = indices.slice();
  const first = indices[startPos];
  if(S.shuffle) buildOrder(first); else S.queue = S.baseQueue.slice();
  S.qpos = Math.max(0, S.queue.indexOf(first));
  load(S.queue[S.qpos]);
  if(!autoplay){
    // silent queue-priming (restoring a persisted library on boot) is not a
    // ceremony — nothing is "arriving," so the disc just appears as-is
    // instead of sitting hidden forever with no pull ever coming to reveal it
    $('#platterBox').classList.remove('disc-hidden');
    return;
  }
  // an explicit track pick (as opposed to the silent initial queue-priming
  // calls, which pass autoplay:false) is always "starting something" —
  // opens the full player via the sheet, not the mini-player's morph.
  // Audio itself is strictly gated behind whichever ceremony runs, never
  // started up front — see runStartSequence().
  if(S.playerOpen) runStartSequence(current(), S.pendingShellInfo, play);
  else openPlayerViaSheet(current(), S.pendingShellInfo);
}

export function reorderQueue(){
  const cur = S.index;
  if(!S.baseQueue.length) return;
  if(S.shuffle) buildOrder(cur >= 0 ? cur : undefined);
  else S.queue = S.baseQueue.slice();
  S.qpos = Math.max(0, S.queue.indexOf(cur));
}

// Mirrors advance(1, true)'s own index math (natural end-of-track,
// repeat-all wraparound) without mutating any state — used to know what to
// preload before it's actually time to play it (see PLAYBACK spec §1).
function peekNextIndex(){
  if(!S.queue.length) return null;
  if(S.repeat === 'one') return S.queue[S.qpos];
  let n = S.qpos + 1;
  if(n >= S.queue.length){
    if(S.repeat === 'all') n = 0;
    else return null;
  }
  return S.queue[n];
}

// Kicked off whenever a track starts, so whatever plays next has already
// finished decoding by the time this one's onended fires — decode latency,
// not JS scheduling overhead, was the actual cause of the gap between
// tracks. See PLAYBACK spec §1: "no buffer underrun."
export function preloadNextTrack(){
  const nextIdx = peekNextIndex();
  if(nextIdx === null || nextIdx === undefined) return;
  if(nextIdx === S.index) return;
  const nt = S.tracks[nextIdx];
  if(!nt || nt.buffer) return;
  ensureBuffer(nextIdx).catch(()=>{});
}

export function advance(dir, auto){
  if(!S.queue.length) return;
  if(auto && S.repeat === 'one'){ seek(0); if(!S.playing) play(); return; }
  if(auto && S.sleep.mode === 'track'){ sleepStopPlayback(); return; }
  if(auto && S.sleep.mode === 'album'){
    const curT = S.tracks[S.queue[S.qpos]];
    const n2 = S.qpos + dir;
    const nextT = (n2 >= 0 && n2 < S.queue.length) ? S.tracks[S.queue[n2]] : null;
    if(curT && (!nextT || albumKey(nextT) !== albumKey(curT))){ sleepStopPlayback(); return; }
  }
  if(!auto) invalidateActiveSessionIfAny();     // an explicit next/prev press is a skip
  let n = S.qpos + dir;
  if(n >= S.queue.length){
    if(S.repeat === 'all'){ if(S.shuffle) buildOrder(); n = 0; }
    else {
      pause(); S.pos = 0; drawTime();
      // the record goes back in its sleeve — but only for a real finish
      // (auto), never a manual skip past the last track, and only where
      // there's something to see or it would just be wasted motion
      if(shouldPutAway(auto)){
        if(document.hidden || !S.playerOpen) putAwayInstant();
        else runPutAwaySequence(current());
      }
      return;        // end of the record
    }
  }
  if(n < 0) n = S.repeat === 'all' ? S.queue.length - 1 : 0;
  S.qpos = n;
  load(S.queue[n]);
  // next/prev/auto-advance never open the player themselves — but if it's
  // already open (sitting in it, or mid next/prev), there's no sheet or
  // morph to wait for, so the disc ceremony (if any) runs immediately.
  // With the player closed there's nothing to see, so audio just starts.
  if(S.playerOpen) runStartSequence(current(), S.pendingShellInfo, play);
  else play();
}

/* ================= visible queue: reorder, remove, play next / add =================
   Shows the current track plus everything after it. Reordering or removing
   is manual queue manipulation, same as shuffle/skip, so it silently
   invalidates whatever qualifying session is in progress — no warning, no
   prompt (see PLAYBACK spec §5). */
function queueInsert(idx, mode){
  if(idx === S.index) return;   // already playing; nothing to insert
  invalidateActiveSessionIfAny();
  if(!S.baseQueue.includes(idx)) S.baseQueue.push(idx);
  const existing = S.queue.indexOf(idx, S.qpos + 1);
  if(existing !== -1) S.queue.splice(existing, 1);
  const insertAt = mode === 'next' ? S.qpos + 1 : S.queue.length;
  S.queue.splice(Math.min(insertAt, S.queue.length), 0, idx);
  renderQueueSheet();
}
export function playNext(idx){ queueInsert(idx, 'next'); }
export function addToQueue(idx){ queueInsert(idx, 'end'); }

// pos is an offset into the "upcoming" portion (0 = the track right after
// current) — the current track itself is shown but never removable here,
// that's what skip is for
function queueRemoveAt(pos){
  const queueIdx = S.qpos + 1 + pos;
  if(queueIdx <= S.qpos || queueIdx >= S.queue.length) return;
  invalidateActiveSessionIfAny();
  S.queue.splice(queueIdx, 1);
  renderQueueSheet();
}
function queueMove(pos, dir){
  const queueIdx = S.qpos + 1 + pos;
  const n = queueIdx + dir;
  if(queueIdx <= S.qpos || queueIdx >= S.queue.length || n <= S.qpos || n >= S.queue.length) return;
  invalidateActiveSessionIfAny();
  const tmp = S.queue[queueIdx]; S.queue[queueIdx] = S.queue[n]; S.queue[n] = tmp;
  renderQueueSheet();
}

function renderQueueSheet(){
  const host = $('#queueBody'); host.innerHTML = '';
  if(!S.queue.length || S.qpos >= S.queue.length){
    host.appendChild(el('p','note','Nothing queued.'));
    return;
  }
  const ul = el('ul','tracklist');
  const curT = S.tracks[S.queue[S.qpos]];
  if(curT){
    const li = el('li'); li.setAttribute('aria-current','true');
    if(curT.art){ const im = el('img','t-art'); im.src = curT.art; im.alt=''; li.appendChild(im); }
    else li.appendChild(el('span','t-art'));
    const name = el('span','t-name');
    name.appendChild(el('b', null, curT.tags.title));
    name.appendChild(el('em', null, 'Now playing · ' + curT.tags.artist));
    li.appendChild(name);
    ul.appendChild(li);
  }
  const upcoming = S.queue.slice(S.qpos + 1);
  upcoming.forEach((idx, pos) => {
    const t = S.tracks[idx]; if(!t) return;
    const li = el('li');
    if(t.art){ const im = el('img','t-art'); im.src = t.art; im.alt=''; li.appendChild(im); }
    else li.appendChild(el('span','t-art'));
    const name = el('span','t-name');
    name.appendChild(el('b', null, t.tags.title));
    name.appendChild(el('em', null, t.tags.artist));
    li.appendChild(name);
    const movers = el('span','movers');
    [['▲',-1],['▼',1]].forEach(([glyph,dir]) => {
      const b = el('button','mv',glyph);
      b.setAttribute('aria-label', dir < 0 ? 'Move up' : 'Move down');
      b.addEventListener('click', e => { e.stopPropagation(); queueMove(pos, dir); });
      movers.appendChild(b);
    });
    li.appendChild(movers);
    const rm = el('button','mv','✕');
    rm.setAttribute('aria-label','Remove from queue');
    rm.addEventListener('click', e => { e.stopPropagation(); queueRemoveAt(pos); });
    li.appendChild(rm);
    ul.appendChild(li);
  });
  host.appendChild(ul);
}
export function openQueueSheet(){
  renderQueueSheet();
  $('#queueOverlay').classList.add('open');
  $('#queueOverlay').setAttribute('aria-hidden', 'false');
}
export function closeQueueSheet(){
  $('#queueOverlay').classList.remove('open');
  $('#queueOverlay').setAttribute('aria-hidden', 'true');
}
