import { S, current } from '../state.js';
import { $ } from '../util/dom.js';
import { clamp } from '../util/math.js';
import { albumKey } from '../record-art/tiers.js';
import { albumTracks } from '../library/model.js';
import { splitSides, albumFormatFor } from '../shell/ceremony-timing.js';
import { routeSource, applyLoudnessNorm, applyWobbleRate, applyCharacter } from '../audio/engine.js';
import { rotationHz, RPM_33, RPM_45, sideFullness, formatChipText, platterSizeAttr, platterSpeedAttr } from '../record-art/format.js';
import { hapticTick } from '../ui/haptic.js';
import { REDUCED } from '../util/motion.js';
import { updateSleepUI } from './sleep-timer.js';
import { drawTime, settleTrackEnd } from './clock.js';
import { setPathNote } from '../ui/path-note.js';
import { advance, preloadNextTrack, peekNextIndex, updateFocusUI } from './queue.js';
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
  playNeedleDrop, startLeadIn, startUnderMusicBed,
  leadInSecFor, fadeMusicTo, fadeMusicInAt
} from '../audio/surface-noise.js';
import { performPendingFlip, sideFlipTurnAt } from '../shell/runout.js';
import { saveResumeNow } from './resume.js';
import { specRateSuffix, specState, specStateLabel } from './track-spec.js';

// AU2 (docs/16_AUDIO.md §2.2): every ordinary edge -- pause, stop, seek --
// fades S.nodes.trackGain by this many ms before the source actually
// stops, and every ordinary source start fades the same node back in by
// this many ms, so neither side of the edit lands mid-waveform as an
// audible click. 15/10, not one shared number -- the doc's own two rules
// each name their own figure.
const EDGE_FADE_MS = 15;
const START_FADE_MS = 10;

// PL8 item 10: whether the current track's spec line is showing its
// plain-text state (Untouched/Converted/Shaped) alongside the format —
// module-level since it survives across the renders a tap triggers, but
// reset to collapsed on every new load() (see its own call site below).
let specExpanded = false;

// Writes #trackSpec's full text -- the plain format + resample arrow
// always, plus the tapped state when specExpanded. Called from load()
// (collapsed) and from toggleTrackSpecState() (the tap itself).
function renderTrackSpecLine(t){
  const el = $('#trackSpec');
  if(!el || !t) return;
  const m = t.meta;
  const engineRate = S.ctx ? S.ctx.sampleRate : null;
  const base = [m.codec, (m.rate/1000).toFixed(1)+' kHz', m.bits? m.bits+'-bit':null,
    m.ch===1?'mono':'stereo', m.lossless? null : 'lossy'].filter(Boolean).join(' · ')
    + specRateSuffix(m.rate, engineRate);
  if(!specExpanded){ el.textContent = base; return; }
  const eq = S.eq || {};
  const state = specState({
    lossless: m.lossless, mode: S.mode, eqEnabled: !!eq.enabled,
    loudnessMode: S.loudnessMode, sourceRateHz: m.rate, engineRateHz: engineRate,
  });
  el.textContent = base + ' — ' + specStateLabel(state);
}

// Tapping the spec line (wired from src/wiring/transport.js) toggles the
// state word on or off, recomputed fresh at tap time — not kept live
// against a setting changed elsewhere while it's showing (see the doc's
// own "tapping it adds one plain-text state," a discrete action, not a
// subscription).
export function toggleTrackSpecState(){
  const t = current();
  if(!t) return;
  specExpanded = !specExpanded;
  renderTrackSpecLine(t);
}

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

// AU10 (docs/16_AUDIO.md §5): the dead-wax etching's own radius needs this
// side's real length in seconds, independent of whether S.albumSides is on
// (the format table already reads sideLengthsFor() the same "whether or
// not Sides itself is on" way — see albumFormatFor()'s own header above).
// Forces splitSides()'s own enabled flag to true so a single-track album
// still resolves to its one side rather than null.
function sideLengthOf(albumTrackIdx, i){
  const splits = splitSides(albumTrackIdx, S.tracks, true);
  const group = splits ? splits.find(s => s.idx.includes(i)) : {idx: albumTrackIdx};
  if(!group) return 0;
  return group.idx.reduce((sum, idx) => sum + ((S.tracks[idx] && S.tracks[idx].duration) || 0), 0);
}

// AU10: the platter's own "33⅓ | 45" speed indicator — a plain
// active-class pair (never tappable), painted whenever a record loads
// (speed-change or not), so it's never left showing the previous record's
// speed.
function paintSpeedToggle(speed){
  const seg = $('#speedToggle'); if(!seg) return;
  seg.querySelectorAll('[data-speed]').forEach(b => {
    b.classList.toggle('active', Number(b.dataset.speed) === speed);
  });
}

// The lead-in/run-out noise still has to be reachable from outside play()
// (an interruption — pause, a skip, a seek — fades it out early rather
// than letting it clip or run on under audio that's already moved past
// it). Module-private, like scrub.js's own gesture state.
let pendingOpening = null;
function cancelPendingOpening(fadeMs = 150){
  if(pendingOpening){ pendingOpening.stop(fadeMs); pendingOpening = null; }
}

// §1, "Under the music": a faint continuous bed for as long as playback
// runs. Module-private for the same reason pendingOpening is.
let underMusicBed = null;
function stopUnderMusicBed(fadeMs = 150){
  if(underMusicBed){ underMusicBed.stop(fadeMs); underMusicBed = null; }
}

// AU4 (docs/16_AUDIO.md §2.4): a next source, already created and
// scheduled to start() at the exact context time the current one is
// computed to end -- armed by maybeScheduleGaplessNext() (called every
// clock tick, src/player/clock.js) and adopted by play() instead of
// starting a fresh source, so a within-side track boundary never waits
// on ensureBuffer()/ctx.resume()/startSource()'s own async dance. Module-
// private, like pendingOpening/underMusicBed above. Never carries its own
// onended until adoption -- see armGaplessNext()'s own comment for why
// that's safe.
let pendingGapless = null;   // { nextIdx, src }

// Tears down a pre-armed-but-not-yet-adopted source outright, so it can
// never reach the speakers unmanaged -- called by every edit the doc
// names (pause, seek, skip, stop, queue edits) plus deliberately *not*
// called by load()'s own ordinary stop() when load() is itself the thing
// about to adopt this exact source (see load()'s own "continuing" branch
// below) -- that's the one case this function must never run for, or
// every gapless hand-off would tear down the very source it just armed.
export function cancelPendingGapless(){
  if(!pendingGapless) return;
  const { src } = pendingGapless;
  src.onended = null;
  try{ src.stop(); }catch(_e){}
  pendingGapless = null;
}

// How close to the current source's own computed end (in real,
// rate-adjusted seconds) maybeScheduleGaplessNext() waits before arming
// the next one. PL3 (docs/19_PLAYER.md, "gapless that always lands"):
// doesn't need to be tiny -- the boundary itself is computed exactly from
// S.anchor (not re-estimated from S.pos/S.rate at arm time), so a wide
// lead window is just as accurate as a narrow one. Wide enough
// to comfortably clear the 1s hidden-tab tick rate (clock.js's tick()
// only runs every ~1s while document.hidden), so a track boundary that
// falls inside that gap still gets armed before it arrives.
const GAPLESS_ARM_LEAD_SEC = 8;

// PL3 (docs/19_PLAYER.md, item 4): "decode away from the boundary" --
// the track change itself does no decode work, so preloadNextTrack()'s
// own decode runs ~2s after the current source actually starts rather
// than synchronously in the same tick as the change. Not gesture-critical
// (preloadNextTrack() only warms the *next* track's buffer; this one's
// is already decoded by the time this runs), so a plain setTimeout here
// never touches rule 9's synchronous play()-call-stack requirement.
// Re-scheduled, never stacked -- schedulePreload() always clears
// whatever timer the previous track change left running first, since
// preloadNextTrack() itself reads live state (peekNextIndex()) at
// whatever moment it actually fires.
const PRELOAD_DELAY_MS = 2000;
let preloadTimer = null;
function schedulePreload(){
  if(preloadTimer) clearTimeout(preloadTimer);
  preloadTimer = setTimeout(() => { preloadTimer = null; preloadNextTrack(); }, PRELOAD_DELAY_MS);
}

// Shared onended logic for every AudioBufferSourceNode this file ever
// starts -- startSource()'s own fresh source and, since AU4, a pre-armed
// gapless source once play() adopts it and gives it a real gen. Exactly
// the pre-AU4 inline behavior, pulled out so both call sites share one
// copy: mark the node as genuinely finished (stopSourceCleanly()'s own
// guard reads this) and, unless something stale-guarded or paused this
// generation since, advance to the next track.
function wireSourceOnEnded(src, gen){
  src._mzEnded = true;
  if(gen === S.gen && S.playing){
    if(document.hidden) settleTrackEnd();   // no frames ran, so credit the tail of the track here
    advance(1, true);
  }
}

// AU4 (docs/16_AUDIO.md §2.4): called every clock tick (player/clock.js's
// tick()) while something is playing. Arms the natural next track's own
// source to start() at the exact moment the current one is computed to
// end, once that moment is close enough (GAPLESS_ARM_LEAD_SEC) and the
// next buffer is already decoded (preloadNextTrack() already saw to
// that). "Ceremonies keep their place" (the doc's own words): a side
// flip or a different-album record change still runs exactly as before,
// so neither is ever pre-scheduled here -- advance()'s own existing
// maybeSideFlip()/album-change paths are left completely untouched, and
// this function simply declines to arm anything in either case, falling
// back to today's onended-triggered start.
export function maybeScheduleGaplessNext(){
  if(!S.playing || !S.source || !S.ctx) return;
  const t = current();
  if(!t || !t.buffer) return;
  const nextIdx = peekNextIndex();
  if(nextIdx === null || nextIdx === undefined) return;
  if(nextIdx === S.index) return;   // repeat-one restarts via seek(0), never a new source
  if(pendingGapless && pendingGapless.nextIdx === nextIdx) return;   // already armed for this exact next track
  if(pendingGapless) cancelPendingGapless();   // armed for a now-stale next (a queue edit, say) -- rearm
  const n = S.qpos + 1 >= S.queue.length ? (S.repeat === 'all' ? 0 : null) : S.qpos + 1;
  if(n !== null && sideFlipTurnAt(n)) return;   // the flip ceremony is about to run -- it owns this transition
  const next = S.tracks[nextIdx];
  if(!next || !next.buffer) return;   // not decoded yet -- the plain onended fallback below handles it
  if(albumKey(next) !== albumKey(t)) return;   // a record change between albums keeps its own ceremony
  if(!S.anchor) return;
  // PL3 (docs/19_PLAYER.md, item 1): the exact context time the current
  // source ends, derived from S.anchor rather than re-estimated from
  // S.pos/S.rate -- robust to GAPLESS_ARM_LEAD_SEC's now-wide arm window
  // because it never drifts: a later rate change re-anchors (see clock.js's
  // tick()) and cancels/re-arms this (item 3), rather than leaving a stale
  // boundary computed against the old rate.
  const endCtxTime = S.anchor.ctxTime + (t.duration - S.anchor.offset) / (S.anchor.rate || 1);
  const remainingRealSec = endCtxTime - S.ctx.currentTime;
  if(remainingRealSec > GAPLESS_ARM_LEAD_SEC || remainingRealSec <= 0) return;
  armGaplessNext(nextIdx, next, endCtxTime);
}

function armGaplessNext(nextIdx, next, when){
  const src = S.ctx.createBufferSource();
  src.buffer = next.buffer;
  src.playbackRate.value = S.rate;
  routeSource(src);
  src.start(when, next.gaplessDelaySec || 0, next.duration);
  pendingGapless = { nextIdx, src, when };
  // No onended wired yet -- the old, still-finishing source's own onended
  // (wireSourceOnEnded, above) is what actually drives advance()/load()/
  // play() at the real boundary; play()'s adoption branch is what gives
  // *this* source a real onended, once it's confirmed to be the one
  // that's actually continuing. A source that's never adopted (because
  // something cancelled it first) only ever reaches this far torn down
  // by cancelPendingGapless() -- never left to run on its own with
  // nothing listening for its end.
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
  // AU4 (docs/16_AUDIO.md §2.4): when a pre-armed source is already
  // running for exactly this track, this load() is the natural-advance
  // call that's about to have play() adopt it -- an ordinary stop() here
  // would tear that source down (cancelPendingGapless() runs inside it)
  // and defeat the whole point. The old, already-finished source still
  // needs discarding (no fade -- nothing's left to click on), but the
  // pre-armed one must be left completely alone.
  if(pendingGapless && pendingGapless.nextIdx === i){
    cancelPendingOpening(0);
    stopUnderMusicBed(0);
    S.source = null;
    S.playing = false;
  } else {
    stop();
  }
  S.index = i; S.pos = 0;
  S.curPlayed = []; S.curTrackDone = false;
  const t = S.tracks[i];
  cancelPendingOpening(0);
  S.pendingSideStart = isSideStart(t, i);
  sessionOnLoad(t);
  // SZ2 (docs/26_SIZES_AND_ZOETROPES.md): S.recordFormat has to be this
  // track's own format *before* applyDiscVariant() runs below — it's what
  // picks a zoetrope's disc7in/disc45/discLp art (record-art/looks.js's
  // discLook() reads S.recordFormat for the current track). Moved up from
  // its old spot further down (where it's still read by the speed-ease/
  // chip/dead-wax code that follows) so the art picked for the platter
  // always matches the record that's actually loading, not the previous
  // one.
  let albumTrackIdx = t.tags && t.tags.album ? albumTracks(t.tags.album) : null;
  const prevFormat = S.recordFormat;
  S.recordFormat = albumTrackIdx
    ? albumFormatFor(albumTrackIdx, S.tracks, (S.albumFormat && S.albumFormat[albumKey(t)]) || 'auto')
    : { size:'12"', speed: RPM_33 };
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
  if(t.tags && t.tags.album){
    if(S.albumSides){
      const splits = splitSides(albumTrackIdx, S.tracks, S.albumSides);
      const found = splits && splits.find(s => s.idx.includes(i));
      if(found) sideLabel = found.label + ' · ';
    }
  }
  // FS5 (docs/25_FROM_SCRATCH.md point 1): the top row's own "Side A"
  // kicker -- empty (and hidden by CSS :empty) whenever Sides is off or
  // the track isn't on an album, same condition sideLabel above already
  // resolves; just titled differently ("Side A" vs the label arc's
  // "SIDE A ·").
  const kicker = $('#nowSideKicker');
  if(kicker) kicker.textContent = sideLabel ? 'Side ' + sideLabel.replace(' · ', '').replace('SIDE ', '') : '';
  // AU10 (docs/16_AUDIO.md §5, "the speed change"): when the player is open
  // and the new record's own speed differs from the last one, the platter
  // eases to it over 600ms with a tick + one haptic, rather than snapping —
  // Pure and Reduce Motion both cut straight to the new speed (Pure: "no
  // click, spin-up or lead-in"; Reduce Motion: "the click and haptic stay;
  // the platter cuts straight to the new speed" — so no ease either way,
  // just the one-time tick/haptic under Reduce Motion).
  const playerOpen = !!($('#playerOverlay') && $('#playerOverlay').classList.contains('open'));
  const speedChanged = prevFormat && prevFormat.speed !== S.recordFormat.speed;
  paintSpeedToggle(S.recordFormat.speed);
  if(speedChanged && playerOpen && S.mode !== 'pure'){
    hapticTick();
    if(!REDUCED){
      S.rpmEase = { from: prevFormat.speed, to: S.recordFormat.speed, start: performance.now(), ms: 600 };
    }
  } else {
    S.rpmEase = null;
  }
  applyWobbleRate(S.rate);
  applyCharacter();
  S.labelSideFormat = sideLabel + (m.ch === 1 ? 'MONO' : 'STEREO');
  const arcText = $('#labelArcText');
  if(arcText) arcText.textContent = (S.recordFormat.speed * S.rate).toFixed(1) + ' RPM · ' + S.labelSideFormat;
  // SZ1 (docs/26_SIZES_AND_ZOETROPES.md): one size attribute, not a class
  // per size — CSS (02-stage-platter.css) owns the per-size sizing/mat/
  // adapter rules from [data-size] alone. SZ2: data-speed alongside it
  // keys the zoetrope ring's own band.
  const platterStage = $('#platterStage');
  if(platterStage){
    platterStage.setAttribute('data-size', platterSizeAttr(S.recordFormat));
    platterStage.setAttribute('data-speed', platterSpeedAttr(S.recordFormat));
  }
  // AU10: the "7″ · 45" chip before the spec line.
  const fmtChip = $('#trackSpecFormat');
  if(fmtChip) fmtChip.textContent = S.recordFormat.speed === RPM_45 ? formatChipText(S.recordFormat) : '';
  // SURFACE_NOISE §5: the dead-wax etching, same as every other
  // written-at-load platter readout just above it. AU10: the band's own
  // radius now follows this side's fullness (record-art/format.js).
  const sideLen = albumTrackIdx ? sideLengthOf(albumTrackIdx, i) : 0;
  applyDeadWaxEtching(t, sideLetterFor(t, i), sideFullness(sideLen, S.recordFormat));
  // PL8 item 10: a new track's spec line always starts collapsed (plain
  // format + resample arrow, no state word) -- renderTrackSpecLine()
  // reads specExpanded, so it has to be reset before that first render.
  specExpanded = false;
  renderTrackSpecLine(t);
  setPathNote('');
  // NV3: only the now-playing marker moved — patch the old and new rows in
  // place rather than rebuilding the whole library list on every track
  // change. The old row not being found just means it wasn't on screen to
  // begin with (nothing to fix there); only the new row's own row has to
  // exist for this to be enough — if it isn't currently on screen either
  // (grouped/drilled-into views, an active search, the crate), fall back
  // to a full render.
  if(prevTrack && prevTrack.id !== t.id) updateTrackRow(prevTrack.id);
  if(!updateTrackRow(t.id)) renderTracks();
  renderMiniPlayer();
  updateGatefoldNowPlaying();
  drawTime();
  $('#playerShareIconBtn').style.display = '';   // hidden until a track is loaded (see LIBRARY spec §2)
  $('#queueBtn').style.display = '';
  $('#playerQueueBtn').style.display = '';   // FS5 point 6: the bottom row's own queue icon, same rule
  $('#sleepTimerBtn').style.display = '';
  $('#focusPill').style.display = '';   // FS10: hidden until a track is loaded, same as the row above
  updateFocusUI();   // FS10: re-applies the Queue row's own hide-while-on state, and the status line, for the new track
  updateCreditsButtonForCurrent();
  updateFavoriteButtons();
  updateSleepUI();
  // AU5 (docs/16_AUDIO.md §4): recomputed on every track change — a new
  // track can carry a different tagged/measured gain, and Auto mode's own
  // "is this still the same album, in order" check depends on which track
  // is now current.
  applyLoudnessNorm();
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
  src.onended = () => wireSourceOnEnded(src, gen);
  // t.duration is already the trimmed (encoder delay/padding excluded)
  // length; the delay offset shifts where playback actually starts reading
  // from the buffer, and the explicit duration arg stops it before running
  // into the padding region rather than relying on the buffer's own end —
  // see PLAYBACK spec §1, encoder delay/padding.
  const playOffset = clamp(offset, 0, t.duration - 0.02);
  const when = opts.startAt != null ? opts.startAt : (leadInSec > 0 ? S.ctx.currentTime + leadInSec : 0);
  src.start(when, playOffset + (t.gaplessDelaySec || 0), t.duration - playOffset);
  S.source = src;
  // PL2 (docs/19_PLAYER.md, "one clock"): anchor position to this source's
  // real start time on the audio clock -- `when === 0` means "start()
  // treats anything at or before currentTime as now" (Web Audio's own
  // rule), not a literal anchor at context time 0, so that case anchors
  // to S.ctx.currentTime instead. Before this ctxTime, player/clock.js's
  // currentPos() reads 0.
  S.anchor = { ctxTime: when > 0 ? when : S.ctx.currentTime, offset: playOffset, rate: S.rate };
  // AU2 (docs/16_AUDIO.md §2.2): every ordinary start fades trackGain in
  // over START_FADE_MS, scheduled at the exact same `when` the source
  // itself starts at. PL1 (docs/19_PLAYER.md, "the silent new album"):
  // a lead-in/needle drop (leadInSec > 0, or any other future `when`)
  // still needs trackGain brought back to 1 -- the needle-drop/lead-in
  // noise's own envelope (surface-noise.js's startBuffer(), §3) rides a
  // separate bus and never touches trackGain -- it's scheduled with
  // fadeMusicInAt() instead, anchored at `when` itself rather than "now",
  // so the music is silent through the lead-in and only starts fading up
  // once it actually begins. Every other ordinary start (immediate,
  // leadInSec === 0) keeps the original fadeMusicTo(1, ...) from
  // whatever trackGain already holds. opts.skipFadeIn means the caller
  // (seek()'s own replace-source path) already scheduled this ramp
  // itself as part of a combined dip, so neither branch runs.
  if(!opts.skipFadeIn){
    if(leadInSec > 0 || (opts.startAt != null && opts.startAt > S.ctx.currentTime)){
      fadeMusicInAt(when, START_FADE_MS);
    } else {
      fadeMusicTo(1, START_FADE_MS);
    }
  }
  schedulePreload();
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
  // AU4 (docs/16_AUDIO.md §2.4): a source already pre-armed and running
  // for exactly this track -- maybeScheduleGaplessNext() scheduled its
  // own start() at the exact context time the previous source was
  // computed to end, well before this call. Adopting it skips every
  // async step below (ensureBuffer/ctx.resume): the hand-off already
  // happened, sample-accurately, on the Web Audio clock.
  const adopted = (pendingGapless && pendingGapless.nextIdx === S.index) ? pendingGapless.src : null;
  const adoptedWhen = adopted ? pendingGapless.when : 0;
  if(adopted) pendingGapless = null;
  if(!adopted){
    if(!await ensureBuffer(S.index)) return;
    if(!S.ctx) return;
    await S.ctx.resume();
  }
  if(S.playing) return;
  S.playing = true;
  S.pausedBySystem = false;   // PL4: a resume (lock-screen Play, in-app Play, or the user tapping back in) clears the system-pause flag
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
  // A gapless-adopted track is never a side start either way (isSideStart()
  // already says so, since a side flip keeps its own ceremony and is never
  // pre-armed — see maybeScheduleGaplessNext()), so this naturally no-ops
  // on the adopted path with no extra branch needed.
  // AU9 (docs/16_AUDIO.md §5): rotationHz() — the record's own rpm,
  // cached onto S.recordFormat by load() just above — drives every one
  // of these generators, so a 45 gets the shorter lead-in and the
  // quieter noise floor that section's own "cleaner in Vinyl for 45s"
  // rule asks for.
  const rpm45 = !!(S.recordFormat && S.recordFormat.speed === RPM_45);
  const rotHz = rotationHz((S.recordFormat && S.recordFormat.speed) || RPM_33, S.rate);
  const leadInDurSec = leadInSecFor(S.recordFormat && S.recordFormat.size);
  let leadInSec = 0;
  if(S.pos === 0 && S.pendingSideStart && surfaceNoiseActive()){
    const scale = noiseFloorScale(S.surfaceNoise, trackTier(t), undefined, rpm45);
    if(scale > 0){
      playNeedleDrop();
      pendingOpening = startLeadIn(leadInDurSec, releaseSeed(albumKey(t), sideLetterFor(t, S.index)), scale, rotHz);
      leadInSec = leadInDurSec;
    }
  }
  S.pendingSideStart = false;
  if(adopted){
    S.source = adopted;
    // PL2 (docs/19_PLAYER.md, "one clock"): this source was armed by
    // maybeScheduleGaplessNext() to start() at `adoptedWhen` -- always a
    // fresh track at its own position 0, never a side start (isSideStart()
    // already rules that out for an adopted source, so leadInSec is
    // always 0 here).
    S.anchor = { ctxTime: adoptedWhen, offset: 0, rate: S.rate };
    const gen = ++S.gen;
    adopted.onended = () => wireSourceOnEnded(adopted, gen);
    schedulePreload();
  } else {
    startSource(S.pos, leadInSec);
  }
  stopUnderMusicBed(0);
  if(S.surfaceNoiseUnderMusic && surfaceNoiseActive()){
    const scale = noiseFloorScale(S.surfaceNoise, trackTier(t), undefined, rpm45);
    if(scale > 0) underMusicBed = startUnderMusicBed(releaseSeed(albumKey(t), sideLetterFor(t, S.index)), scale, rotHz);
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
  cancelPendingGapless();   // AU4: stop() invalidates whatever was pre-armed (see load()'s own "continuing" branch, which bypasses this call entirely instead)
  cancelPendingOpening();
  stopUnderMusicBed(0);
  stopSourceCleanly();   // AU2: 15ms fade-out before the source actually stops
  S.playing = false;
  const b = $('#play'); if(b){ b.textContent = '▶'; b.setAttribute('aria-label','Play'); }
  renderMiniPlayer();
}

// PL4 (docs/19_PLAYER.md, "interruptions and coming back"): the context
// leaving 'running' while S.playing -- iOS reports 'interrupted' or
// 'suspended' for a call, Siri, or another app taking the audio session --
// is a system pause, not a track end. Freeze exactly where currentPos()
// already reports it (clock.js's own `S.ctx.state !== 'running'` guard
// means S.pos already holds the last good value, nothing more to do there)
// rather than let the old source's onended fire a bogus advance(), and
// rather than stopSourceCleanly()'s own 15ms fade -- scheduling anything
// against ctx.currentTime on a context that just left 'running' can't be
// trusted to land. S.pausedBySystem marks this apart from an ordinary
// pause so the resume paths (play(), wiring/transport.js's Play button,
// background.js's lock-screen handler) know to restart from here rather
// than treating it as "already paused, nothing to resume."
export function handleContextInterruption(){
  if(!S.playing) return;
  cancelPendingGapless();
  cancelPendingOpening(0);
  stopUnderMusicBed(0);
  const src = S.source;
  if(src){ src.onended = null; try{ src.stop(); }catch(_e){} }
  S.source = null;
  S.playing = false;
  S.pausedBySystem = true;
  const b = $('#play'); if(b){ b.textContent = '▶'; b.setAttribute('aria-label','Play'); }
  renderMiniPlayer();
}

export function pause(){ S.playing = false; cancelPendingGapless(); cancelPendingOpening(); stopUnderMusicBed();
  stopSourceCleanly();   // AU2: 15ms fade-out before the source actually stops
  $('#play').textContent='▶'; $('#play').setAttribute('aria-label','Play'); touchActiveSession(); renderMiniPlayer();
  MizikiSocial.nowSpinningPaused();
  if(bgRouteActive()) bgIdleNow();
  saveResumeNow();   // AU1: "immediately on pause" (docs/16_AUDIO.md §2.1)
}

// RW3 (docs/23_RHYTHM_AND_WEAR.md): the sleep timer's own "no fade, no
// put-away -- just stop where advance() would otherwise have moved on"
// shape, extracted so This record only / Stop between records at sunset
// and midnight (src/player/queue.js) can reuse exactly the same stop,
// alongside the sleep timer's own two call sites (sleep-timer.js).
export function pauseAndRest(){
  pause();
  S.pos = 0;
  drawTime();
}

export function seek(sec){
  const t = current(); if(!t) return;
  cancelPendingGapless();   // AU4: a seek invalidates whatever end-of-track time was pre-armed against
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
