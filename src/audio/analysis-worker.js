/* PL6 item 1 (docs/19_PLAYER.md): loudness measurement and hook detection,
   run off the main thread. Loaded via `new Worker(new URL(...), {type:
   'module'})` from analysis-client.js — the first genuine DOM Worker in
   this codebase (the AudioWorklet files elsewhere are a different
   mechanism, Web Audio's own render-thread processors).

   Both audio/loudness.js's measureTrack() and audio/hook.js's
   detectHook() are already pure, zero-import leaves — no DOM, no S, no
   AudioContext — exactly the shape a Worker can import and run directly,
   nothing to strip out or stub. One message in, one message out: the
   caller sends the already-decoded channel Float32Arrays (transferred,
   not copied — see analysis-client.js for why it copies before transfer)
   plus the sample rate; this returns plain numbers/objects only, never
   anything that needs structured-clone of a complex class instance. */
import { measureTrack } from './loudness.js';
import { detectHook } from './hook.js';

self.onmessage = (e) => {
  const { id, channels, sampleRate } = e.data;
  try{
    const loudness = measureTrack(channels, sampleRate);
    const hook = detectHook(channels, sampleRate);
    self.postMessage({ id, loudness, hook });
  }catch(err){
    self.postMessage({ id, error: String((err && err.message) || err) });
  }
};
