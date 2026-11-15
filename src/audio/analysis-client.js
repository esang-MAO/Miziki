/* PL6 item 1 (docs/19_PLAYER.md): the request/response wrapper every real
   caller (library/import.js's import loop, library/thumbs.js's
   healLoudness()/healHooks()) actually calls — analysis-worker.js itself
   only speaks postMessage. One round trip per track returns both the
   loudness measurement and the hook detection together, since every
   caller already wants both from the same decode (the same two call
   sites AU5's measureTrack()/AU12's detectHook() always shared).

   Falls back to running the same two pure functions directly on the
   main thread when Workers aren't available at all (an older WebView,
   or a test environment with no Worker global) — the exact same result,
   just not off the main thread; nothing downstream needs to know which
   path ran. */
import { measureTrack } from './loudness.js';
import { detectHook } from './hook.js';

let worker = null;
let nextId = 1;
const pending = new Map();

function ensureWorker(){
  if(worker || typeof Worker === 'undefined') return worker;
  try{
    worker = new Worker(new URL('./analysis-worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = (e) => {
      const { id, loudness, hook, error } = e.data;
      const p = pending.get(id);
      if(!p) return;
      pending.delete(id);
      if(error) p.reject(new Error(error)); else p.resolve({ loudness, hook });
    };
    worker.onerror = (err) => {
      // The whole worker thread died -- fail every in-flight request so
      // each caller's own existing catch block treats it like any other
      // measurement failure (thumbs.js's heal passes already just retry
      // an unmeasured track on the next pass). A fresh worker is created
      // lazily on the next analyzeTrack() call.
      for(const [, p] of pending) p.reject(err instanceof Error ? err : new Error('analysis worker error'));
      pending.clear();
      worker = null;
    };
  }catch(_e){ worker = null; }
  return worker;
}

// `channels` is an array of Float32Arrays, almost always views straight
// out of an AudioBuffer (getChannelData()) -- those can't be transferred
// (it would detach memory the AudioBuffer itself still owns), so each one
// is copied once here before handing its own, now-transferable, buffer
// to the worker.
export function analyzeTrack(channels, sampleRate){
  const w = ensureWorker();
  if(!w){
    return Promise.resolve({ loudness: measureTrack(channels, sampleRate), hook: detectHook(channels, sampleRate) });
  }
  const copies = channels.map(c => c.slice());
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    try{
      w.postMessage({ id, channels: copies, sampleRate }, copies.map(c => c.buffer));
    }catch(err){
      pending.delete(id);
      reject(err);
    }
  });
}
