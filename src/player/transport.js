import { S, current } from '../state.js';
import { $ } from '../util/dom.js';
import { clamp } from '../util/math.js';
import { albumKey } from '../record-art/tiers.js';
import { albumTracks } from '../library/model.js';
import { splitSides } from '../shell/ceremony-timing.js';
import { routeSource } from '../audio/engine.js';
import { updateSleepUI } from './sleep-timer.js';
import { drawTime, settleTrackEnd } from './clock.js';
import { setPathNote } from '../ui/path-note.js';
import { advance, preloadNextTrack } from './queue.js';
import { ensureBuffer } from './buffers.js';
import { sessionOnLoad, touchActiveSession } from '../history/sessions.js';
import { updateCreditsButtonForCurrent } from '../library/credits.js';
import { updateFavoriteButtons } from '../library/favorites.js';
import { applyDiscVariant } from '../record-art/looks.js';
import { breakSeal } from '../library/sealed.js';
import { bgPrime, bgRouteActive, bgIdleNow, bgPosition } from './background.js';
import { updateShellAlbum, renderMiniPlayer } from '../shell/mini-player.js';
import { showRoute } from '../shell/routes.js';
import { clearSpinDown } from '../shell/put-away.js';
import { renderTracks, updateTrackRow } from '../library/view.js';
import { updateGatefoldNowPlaying } from '../gatefold/view.js';
import { renderPlayerSidePanel } from '../shell/player-side-panel.js';
import { realDayPosition } from '../sundown/solar.js';
import { trackTier } from '../record-art/tiers.js';
import { applyDeadWaxEtching } from '../record-art/etchings.js';
import {
  releaseSeed, noiseFloorScale, surfaceNoiseActive,
  playNeedleDrop, startLeadIn, startUnderMusicBed, LEAD_IN_SEC,
  fadeMusicTo
} from '../audio/surface-noise.js';
import { performPendingFlip } from '../shell/runout.js';
import { saveResumeNow } from './resume.js';

// AU2 (docs/16_AUDIO.md §2.2): every ordinary edge -- pause, stop, seek --
// fades S.nodes.trackGain by this many ms before the source actually
// stops, and every ordinary source start fades the same node back in by
// this many ms, so neither side of the edit lands mid-waveform as an
// audible click. 15/10, not one shared number -- the doc's own two rules
// each name their own figure.
const EDGE_FADE_MS = 15;
const START_FADE_MS = 10;

// docs/15_SURFACE_NOISE.md §1: "the lead-in plays only at the start of a
// side: playing from stopped, or after a flip" — true when i is the first
// track of its side (sides on) or of its album (sides off/not enough
// tracks to split); a track with no album tag at all (a bare file) counts
// as its own side every time, the same "nothing to compare against" call
// splitSides()/sideTurn() already make elsewhere.
function isSideStart(t, i){
  if(!t || !t.tags || !t.tags.album) return true;
  const idx = albumTracks(t.tags.album);
  if(!idx.length) return true;
  const splits = splitSides(idx, S.tracks, S.albumSides);
  if(!splits) return idx[0] === i;
  const side = splits.find(s => s.idx.includes(i));
  return !!side && side.idx[0] === i;
}

// The side letter the given index falls on, for seeding the lead-in/
// run-out noise the same way regardless of where it's started from — ''
// when sides are off (one seed per album rather than per side). Exported
// since docs/15_SURFACE_NOISE.md §3's needle-lift skip (src/player/queue.js)
// seeds its own drop hiss the same way, for the same release+side.
export function sideLetterFor(t, i){
  if(!S.albumSides || !t || !t.tags || !t.tags.album) return '';
  const splits = splitSides(albumTracks(t.tags.album), S.tracks, S.albumSides);
  const found = splits && splits.find(s => s.idx.includes(i));
  return found ? found.label.replace('SIDE ', '') : '';
}

// The lead-in/run-out noise still has to be reachable from outside play()
// (an interruption — pause, a skip, a seek — fades it out early rather
// than letting it clip or run on under audio that's already moved past
// it). Module-private, like scrub.js's own gesture state.
let pendingOpening = null;
function cancelPendingOpening(fadeMs = 150){
  if(pendingOpening){ pendingOpening.stop(fadeMs); pendingOpening = null; }
  S.openUntil = 0;
}

// §1, "Under the music": a faint continuous bed for as long as playback
// runs. Module-private for the same reason pendingOpening is.
let underMusicBed = null;
function stopUnderMusicBed(fadeMs = 150){
  if(underMusicBed){ underMusicBed.stop(fadeMs); underMusicBed = null; }
}

// AU2 (docs/16_AUDIO.md §2.2): pause/stop/seek's own clean edge -- fades
// S.nodes.trackGain to 0 over EDGE_FADE_MS and schedules the source's own
// stop right at the end of that ramp, entirely on the Web Audio clock
// (ctx.currentTime + EDGE_FADE_MS/1000) rather than a setTimeout, so there
// is nothing here for refactor rule 9 to catch -- no timer, no await,
// nothing reordered. A null/already-cleared S.source is a quiet no-op.
// This never touches the needle-lift skip's own fade (SKIP_FADE_MS,
// player/queue.js's skipWithLift()) -- that path never goes through
// transport.js's stop()/pause()/seek() at all, and docs/16_AUDIO.md §2.2
// says explicitly to leave it alone.
//
// A source whose own `_mzEnded` flag is already set (startSource()'s
// onended, below) has already finished playing on its own -- advance()'s
// natural, gapless track-end path calls load(), which calls stop(), on
// exactly this source, and it must stay untouched here: AU4 (docs/16_AUDIO.md
// §2.4) owns that seamless-track-change path, and fading a node that's
// already silent would only inject an audible dip where none exists --
// it's nothing left to click on, so there's nothing to fade.
function stopSourceCleanly(){
  const src = S.source;
  if(!src) return;
  src.onended = null;
  if(!src._mzEnded){
    fadeMusicTo(0, EDGE_FADE_MS);
    const when = S.ctx ? S.ctx.currentTime + EDGE_FADE_MS / 1000 : 0;
    try{ src.stop(when); }catch(_e){}
  }
  S.source = null;
}

export function load(i){
  if(!S.tracks[i]) return;
  // captured before S.index moves, so the row that's losing the now-playing
  // marker can be found by its own (still-current) id, below
  const prevTrack = current();
  stop();
  S.index = i; S.pos = 0;
  S.curPlayed = []; S.curTrackDone = false;
  const t = S.tracks[i];
  cancelPendingOpening(0);
  S.pendingSideStart = isSideStart(t, i);
  sessionOnLoad(t);
  S.pendingShellInfo = updateShellAlbum(t);
  applyDiscVariant(t, S.pendingShellInfo.sameAlbum);
  $('#trackName').textContent = t.tags ? t.tags.title : t.name;
  $('#trackBy').textContent = t.tags ? t.tags.artist + ' — ' + t.tags.album : '';
  const lab = $('#label'), img = $('#labelArt');
  if(t.art){ img.src = t.art; lab.classList.add('has-art'); }
  else { img.removeAttribute('src'); lab.classList.remove('has-art'); }
  const m = t.meta;
  // RF15 (docs/12_REFINE.md): the art-less label's album title + mono arc
  // (real RPM/side/format, not a fixed "33⅓" — see Player.dc.html). The
  // side half reuses splitSides()'s own "which side is this track on"
  // math (src/shell/ceremony-timing.js, also runout.js's side-flip), so
  // there's one source of truth for side letters, not a second one here.
  $('#labelTitle').textContent = t.tags ? (t.tags.album || t.tags.title) : t.name;
  let sideLabel = '';
  if(S.albumSides && t.tags && t.tags.album){
    const splits = splitSides(albumTracks(t.tags.album), S.tracks, S.albumSides);
    const found = splits && splits.find(s => s.idx.includes(i));
    if(found) sideLabel = found.label + ' · ';
  }
  S.labelSideFormat = sideLabel + (m.ch === 1 ? 'MONO' : 'STEREO');
  const arcText = $('#labelArcText');
  if(arcText) arcText.textContent = (33.333 * S.rate).toFixed(1) + ' RPM · ' + S.labelSideFormat;
  // SURFACE_NOISE §5: the dead-wax etching, same as every other
  // written-at-load platter readout just above it.
  applyDeadWaxEtching(t, sideLetterFor(t, i));
  $('#trackSpec').textContent = [m.codec, (m.rate/1000).toFixed(1)+' kHz', m.bits? m.bits+'-bit':null,
    m.ch===1?'mono':'stereo', m.lossless? null : 'lossy'].filter(Boolean).join(' · ');
  setPathNote('');
  // NV3: only the now-playing marker moved — patch the old and new rows in
  // place rather than rebuilding the whole library list on every track
  // change. The old row not being found just means it wasn't on screen to
  // begin with (nothing to fix there); only the new row's own row has to
  // exist for this to be enough — if it isn't currently on screen either
  // (grouped/drilled-into views, an active search, the crate), fall back
  // to a full render exactly as before this change.
  if(prevTrack && prevTrack.id !== t.id) updateTrackRow(prevTrack.id);
  if(!updateTrackRow(t.id)) renderTracks();
  renderMiniPlayer();
  updateGatefoldNowPlaying();
  drawTime();
  $('#playerShareBtn').style.display = '';   // hidden until a track is loaded (see LIBRARY spec §2)
  $('#queueBtn').style.display = '';
  $('#sleepTimerBtn').style.display = '';
  updateCreditsButtonForCurrent();
  updateFavoriteButtons();
  updateSleepUI();
  // D6 (docs/DESKTOP_LAYOUT.md): keeps the desktop side panel's active
  // tab (Up next / Liner notes / Credits) in step with whichever track
  // just loaded — the same choke point every other "must track current()"
  // UI update above already uses. S.queue/S.qpos are always updated by
  // this function's own caller before load() runs (setQueue()/advance()),
  // so renderPlayerSidePanel()'s own "Up next" branch never sees stale
  // queue state. Harmless to call even when the panel is hidden (phone,
  // or the overlay not open) — same "paint it anyway, CSS hides it"
  // precedent D3's sidebar and D5's crate detail panel already set.
  renderPlayerSidePanel();
}

// leadInSec (docs/15_SURFACE_NOISE.md §1): when the needle-drop + lead-in
// noise is playing before this track, the actual audio start is scheduled
// this many seconds into the future on the audio clock rather than "now" —
// sample-accurate regardless of JS timer jitter, and never a stretch or
// delay of the audio file itself (its own internal timing is untouched;
// only the moment it's told to start moves). Every other caller passes 0,
// which is exactly today's "now" behavior.
//
// opts.startAt/opts.skipFadeIn (AU2, docs/16_AUDIO.md §2.2): seek()'s own
// "replace the live source" case needs the outgoing source's 15ms
// fade-out and this source's 10ms fade-in scheduled as one continuous
// trackGain ramp (down, then back up) rather than two separate
// fadeMusicTo() calls on the same node in the same tick, which would each
// cancel whatever the other just scheduled — see seek()'s own comment.
// opts.startAt, when given, is that already-computed ctx.currentTime to
// start at in place of leadInSec's own math; opts.skipFadeIn skips this
// function's ordinary fade-in since the caller already scheduled one.
export function startSource(offset, leadInSec = 0, opts = {}){
  const t = current();
  if(!t || !t.buffer || !S.ctx) return;
  const src = S.ctx.createBufferSource();
  src.buffer = t.buffer;
  src.playbackRate.value = S.rate;
  routeSource(src);
  const gen = ++S.gen;
  src.onended = () => {
    // AU2 (docs/16_AUDIO.md §2.2): marks this node as genuinely finished
    // -- stopSourceCleanly()'s own guard reads it so a natural, gapless
    // track end never gets an artificial fade-out layered on top of it.
    src._mzEnded = true;
    if(gen === S.gen && S.playing){
      if(document.hidden) settleTrackEnd();   // no frames ran, so credit the tail of the track here
      advance(1, true);
    }
  };
  // t.duration is already the trimmed (encoder delay/padding excluded)
  // length; the delay offset shifts where playback actually starts reading
  // from the buffer, and the explicit duration arg stops it before running
  // into the padding region rather than relying on the buffer's own end —
  // see PLAYBACK spec §1, encoder delay/padding.
  const playOffset = clamp(offset, 0, t.duration - 0.02);
  const when = opts.startAt != null ? opts.startAt : (leadInSec > 0 ? S.ctx.currentTime + leadInSec : 0);
  src.start(when, playOffset + (t.gaplessDelaySec || 0), t.duration - playOffset);
  S.source = src;
  // AU2 (docs/16_AUDIO.md §2.2): every ordinary start fades trackGain in
  // over START_FADE_MS, scheduled at the exact same `when` the source
  // itself starts at -- except a lead-in/needle drop (leadInSec > 0),
  // which already has its own envelope (the needle-drop/lead-in noise
  // itself ramps up on a separate path, surface-noise.js's startBuffer(),
  // that never touches trackGain at all -- see that file's §3 comment).
  if(leadInSec <= 0 && !opts.skipFadeIn) fadeMusicTo(1, START_FADE_MS);
  preloadNextTrack();
}

export async function play(){
  // docs/15_SURFACE_NOISE.md §4: a record waiting in the run-out for a
  // flip (Auto-flip Off) has nothing of its own to resume -- any Play (the
  // in-app button, a lock-screen tap, a headphone/car button, all of which
  // call this same function) performs the flip instead. performPendingFlip()
  // loads and plays side B itself; that nested play() call still runs
  // bgPrime() as its own first line, synchronously within this same call
  // stack and still inside the original tap, so rule 9 holds.
  if(S.runout && S.runout.kind === 'wait'){ performPendingFlip(); return; }
  bgPrime();   // before any await, while this is still inside the tap that asked for playback
  const t = current();
  if(!t){ showRoute('library'); return; }
  if(!await ensureBuffer(S.index)) return;
  if(!S.ctx) return;
  await S.ctx.resume();
  if(S.playing) return;
  S.playing = true;
  // AU1 (docs/16_AUDIO.md §2.1): whatever restoreResume() landed paused
  // on the platter is no longer "pending" the moment Play actually runs —
  // from here on the mini player shows the ordinary artist line again
  S.resumePending = false;
  // the single point every playback path funnels through, ceremony or not —
  // "played" means this, with no minimum duration (SEALED spec §2)
  breakSeal(albumKey(t));
  clearSpinDown();   // real playback resumed — any eased-down spin-rate from a put-away no longer applies
  // docs/15_SURFACE_NOISE.md §1: needle drop + lead-in, only at the start
  // of a side (S.pendingSideStart, set by load()) and only playing from
  // stopped/after a flip — resuming from pause never sets S.pendingSideStart
  // again (load() isn't called), and S.pos === 0 rules out a scrub back to
  // 0:00 on an already-loaded track that never went through load() either.
  let leadInSec = 0;
  if(S.pos === 0 && S.pendingSideStart && surfaceNoiseActive()){
    const scale = noiseFloorScale(S.surfaceNoise, trackTier(t));
    if(scale > 0){
      playNeedleDrop();
      pendingOpening = startLeadIn(LEAD_IN_SEC, releaseSeed(albumKey(t), sideLetterFor(t, S.index)), scale, 0.55 * S.rate);
      leadInSec = LEAD_IN_SEC;
      S.openUntil = performance.now() + leadInSec * 1000;
    }
  }
  S.pendingSideStart = false;
  startSource(S.pos, leadInSec);
  stopUnderMusicBed(0);
  if(S.surfaceNoiseUnderMusic && surfaceNoiseActive()){
    const scale = noiseFloorScale(S.surfaceNoise, trackTier(t));
    if(scale > 0) underMusicBed = startUnderMusicBed(releaseSeed(albumKey(t), sideLetterFor(t, S.index)), scale, 0.55 * S.rate);
  }
  $('#play').textContent = '❚❚'; $('#play').setAttribute('aria-label','Pause');
  renderMiniPlayer();
  // DA6 (docs/DAY_ARC.md): the spinner's own real local day-arc phase,
  // never the clock time or location -- realDayPosition(), not
  // currentDayPosition(), since what friends see has to be this
  // listener's own actual phase, never fooled by their own "Preview the
  // day" slider.
  // RF21 (docs/12_REFINE.md, "a quieter broadcast"): "Don't share this
  // session" (S.privateSpin, player "···" menu) skips this call outright
  // -- not a hidden now-spinning row, no row at all, so no feed event is
  // ever written for this session.
  if(!S.privateSpin) MizikiSocial.nowSpinning(albumKey(t), t.tags.title, realDayPosition().phase);
}

export function stop(){
  S.gen++;
  cancelPendingOpening();
  stopUnderMusicBed(0);
  stopSourceCleanly();   // AU2: 15ms fade-out before the source actually stops
  S.playing = false;
  const b = $('#play'); if(b){ b.textContent = '▶'; b.setAttribute('aria-label','Play'); }
  renderMiniPlayer();
}

export function pause(){ S.playing = false; cancelPendingOpening(); stopUnderMusicBed();
  stopSourceCleanly();   // AU2: 15ms fade-out before the source actually stops
  $('#play').textContent='▶'; $('#play').setAttribute('aria-label','Play'); touchActiveSession(); renderMiniPlayer();
  MizikiSocial.nowSpinningPaused();
  if(bgRouteActive()) bgIdleNow();
  saveResumeNow();   // AU1: "immediately on pause" (docs/16_AUDIO.md §2.1)
}

export function seek(sec){
  const t = current(); if(!t) return;
  cancelPendingOpening();
  S.pos = clamp(sec, 0, t.duration || 0);
  if(S.playing){
    if(S.source){
      // AU2 (docs/16_AUDIO.md §2.2): a seek while playing replaces the
      // live source outright -- the outgoing source's 15ms fade-out and
      // the incoming one's 10ms fade-in share S.nodes.trackGain, so
      // they're scheduled here as one continuous ramp (down to 0, then
      // back up to 1) instead of two separate fadeMusicTo() calls, which
      // would each cancel whatever the other just scheduled on the same
      // node in this same tick. The new source starts exactly when the
      // ramp reaches 0, via startSource()'s opts.startAt/opts.skipFadeIn.
      const old = S.source; old.onended = null;
      const ctx = S.ctx, g = S.nodes && S.nodes.trackGain;
      let dipEnd = ctx ? ctx.currentTime : 0;
      if(g && ctx){
        try{
          const now = ctx.currentTime;
          dipEnd = now + EDGE_FADE_MS / 1000;
          g.gain.cancelScheduledValues(now);
          g.gain.setValueAtTime(g.gain.value, now);
          g.gain.linearRampToValueAtTime(0, dipEnd);
          g.gain.linearRampToValueAtTime(1, dipEnd + START_FADE_MS / 1000);
        }catch(_e){}
      }
      try{ old.stop(dipEnd); }catch(_e){}
      S.source = null;
      startSource(S.pos, 0, { startAt: dipEnd, skipFadeIn: true });
    } else {
      startSource(S.pos);
    }
  }
  drawTime();
  bgPosition();
}

/* (next/prev now live in the queue section above) */
