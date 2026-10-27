// PL1 (docs/19_PLAYER.md): offline-render proof for fadeMusicInAt() --
// the fix for "picking a new album while surface noise is on plays
// silence." Exercises the real, shipped src/audio/surface-noise.js
// exports against a real OfflineAudioContext, in whichever browser
// engine is running this harness (see tests/audio-render/run.js).
//
// Three scenarios from the doc's own test item (PL1, step 3):
//   1. album A playing, pick album B mid-track (surface noise on)
//   2. same, but A was paused (trackGain already at 0)
//   3. sleep timer faded music to 0, then a later ordinary Play
//      (leadInSec === 0, so this exercises the *other* branch --
//      the original immediate fadeMusicTo(1, ...) path -- to prove
//      PL1 didn't regress the no-lead-in case)
//
// Each renders a short OfflineAudioContext with a 440 Hz "music" tone
// permanently playing into trackGain, drives the exact scheduling calls
// startSource() makes, and checks the real sample output: near-silent
// while the lead-in is still running, audible (> -40 dBFS, the doc's own
// threshold) 0.5s after the fade-in should have completed.
import { windowDb } from '../lib/signal.js';
import { S } from '../../../src/state.js';
import { fadeMusicInAt, fadeMusicTo } from '../../../src/audio/surface-noise.js';

const SAMPLE_RATE = 44100;
const DURATION_SEC = 6;
const START_FADE_MS = 10; // AU2's START_FADE_MS (src/audio/surface-noise.js has no export for it; mirrored here)

function freshOfflineGraph(){
  const ctx = new OfflineAudioContext(1, Math.round(SAMPLE_RATE * DURATION_SEC), SAMPLE_RATE);
  const trackGain = ctx.createGain();
  trackGain.connect(ctx.destination);
  const osc = ctx.createOscillator();
  osc.frequency.value = 440;
  osc.connect(trackGain);
  osc.start(0);
  S.ctx = ctx;
  S.nodes = { trackGain };
  return { ctx, trackGain };
}

async function scenario1_newAlbumWhilePlaying(){
  const { ctx, trackGain } = freshOfflineGraph();
  // A was playing: trackGain at 1, then stopSourceCleanly()'s own
  // fade-out to 0 over EDGE_FADE_MS, same as the real app.
  trackGain.gain.setValueAtTime(1, 0);
  fadeMusicTo(0, 15); // EDGE_FADE_MS
  // B's lead-in: 3s of surface noise, then the music should fade in.
  const leadInEndsAt = 3.0;
  fadeMusicInAt(leadInEndsAt, START_FADE_MS);
  const buffer = await ctx.startRendering();
  return {
    duringLeadIn: windowDb(buffer, 1.0, 0.3),           // should still be silent
    afterFadeIn: windowDb(buffer, leadInEndsAt + 0.5, 0.3), // doc's own check
  };
}

async function scenario2_newAlbumWhilePaused(){
  const { ctx, trackGain } = freshOfflineGraph();
  // A was already paused: trackGain already at 0 (no fade-out needed).
  trackGain.gain.setValueAtTime(0, 0);
  const leadInEndsAt = 3.0;
  fadeMusicInAt(leadInEndsAt, START_FADE_MS);
  const buffer = await ctx.startRendering();
  return {
    duringLeadIn: windowDb(buffer, 1.0, 0.3),
    afterFadeIn: windowDb(buffer, leadInEndsAt + 0.5, 0.3),
  };
}

async function scenario3_sleepTimerThenPlay(){
  const { ctx, trackGain } = freshOfflineGraph();
  // Sleep timer faded master/track gain to 0 at t=0 (already at 0 here,
  // mirroring applyVolume()'s own restore-to-1 happening on S.nodes.master,
  // never trackGain -- see CLAUDE.md's sleep-timer entry). A later,
  // ordinary Play with no lead-in uses the original fadeMusicTo(1, ...)
  // branch directly -- this is the branch PL1 left untouched, checked
  // here so the fix didn't regress it.
  trackGain.gain.setValueAtTime(0, 0);
  const playAt = 1.0;
  // startSource() only ever calls fadeMusicTo "now" for the no-lead-in
  // case; OfflineAudioContext has no real wall clock, so we render the
  // call itself as happening at time 0 -- fadeMusicTo always schedules
  // from ctx.currentTime, which for an OfflineAudioContext before
  // startRendering() is 0. That's the real, current-time-anchored
  // behavior startSource() relies on.
  fadeMusicTo(1, START_FADE_MS);
  const buffer = await ctx.startRendering();
  return {
    afterFadeIn: windowDb(buffer, (START_FADE_MS / 1000) + 0.5, 0.3),
  };
}

export async function run(){
  const s1 = await scenario1_newAlbumWhilePlaying();
  const s2 = await scenario2_newAlbumWhilePaused();
  const s3 = await scenario3_sleepTimerThenPlay();

  const checks = [
    { name: 'scenario1.duringLeadIn (should be silent)', value: s1.duringLeadIn, pass: s1.duringLeadIn < -60 },
    { name: 'scenario1.afterFadeIn (doc: > -40 dBFS)', value: s1.afterFadeIn, pass: s1.afterFadeIn > -40 },
    { name: 'scenario2.duringLeadIn (should be silent)', value: s2.duringLeadIn, pass: s2.duringLeadIn < -60 },
    { name: 'scenario2.afterFadeIn (doc: > -40 dBFS)', value: s2.afterFadeIn, pass: s2.afterFadeIn > -40 },
    { name: 'scenario3.afterFadeIn (no-lead-in branch, doc: > -40 dBFS)', value: s3.afterFadeIn, pass: s3.afterFadeIn > -40 },
  ];
  return { checks, pass: checks.every(c => c.pass) };
}
