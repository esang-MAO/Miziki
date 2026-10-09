import { S, current } from '../state.js';
import { $ } from '../util/dom.js';
import { clamp } from '../util/math.js';
import { albumKey } from '../record-art/tiers.js';
import { routeSource } from '../audio/engine.js';
import { updateSleepUI } from './sleep-timer.js';
import { drawTime, settleTrackEnd } from './clock.js';
import { setPathNote } from '../ui/path-note.js';
import {
  sessionOnLoad, updateShellAlbum, applyDiscVariant, renderTracks, renderMiniPlayer,
  updateGatefoldNowPlaying, updateCreditsButtonForCurrent, updateFavoriteButtons,
  advance, preloadNextTrack, bgPrime, showRoute, ensureBuffer, breakSeal,
  clearSpinDown, touchActiveSession, bgRouteActive, bgIdleNow, bgPosition,
} from '../main.js';

export function load(i){
  if(!S.tracks[i]) return;
  stop();
  S.index = i; S.pos = 0;
  S.curPlayed = []; S.curTrackDone = false;
  const t = S.tracks[i];
  sessionOnLoad(t);
  S.pendingShellInfo = updateShellAlbum(t);
  applyDiscVariant(t, S.pendingShellInfo.sameAlbum);
  $('#trackName').textContent = t.tags ? t.tags.title : t.name;
  $('#trackBy').textContent = t.tags ? t.tags.artist + ' — ' + t.tags.album : '';
  const lab = $('#label'), img = $('#labelArt');
  if(t.art){ img.src = t.art; lab.classList.add('has-art'); }
  else { img.removeAttribute('src'); lab.classList.remove('has-art'); }
  const m = t.meta;
  $('#trackSpec').textContent = [m.codec, (m.rate/1000).toFixed(1)+' kHz', m.bits? m.bits+'-bit':null,
    m.ch===1?'mono':'stereo', m.lossless? null : 'lossy'].filter(Boolean).join(' · ');
  setPathNote('');
  renderTracks();
  renderMiniPlayer();
  updateGatefoldNowPlaying();
  drawTime();
  $('#playerShareBtn').style.display = '';   // hidden until a track is loaded (see LIBRARY spec §2)
  $('#queueBtn').style.display = '';
  $('#sleepTimerBtn').style.display = '';
  updateCreditsButtonForCurrent();
  updateFavoriteButtons();
  updateSleepUI();
}

export function startSource(offset){
  const t = current();
  if(!t || !t.buffer || !S.ctx) return;
  const src = S.ctx.createBufferSource();
  src.buffer = t.buffer;
  src.playbackRate.value = S.rate;
  routeSource(src);
  const gen = ++S.gen;
  src.onended = () => {
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
  src.start(0, playOffset + (t.gaplessDelaySec || 0), t.duration - playOffset);
  S.source = src;
  preloadNextTrack();
}

export async function play(){
  bgPrime();   // before any await, while this is still inside the tap that asked for playback
  const t = current();
  if(!t){ showRoute('library'); return; }
  if(!await ensureBuffer(S.index)) return;
  if(!S.ctx) return;
  await S.ctx.resume();
  if(S.playing) return;
  S.playing = true;
  // the single point every playback path funnels through, ceremony or not —
  // "played" means this, with no minimum duration (SEALED spec §2)
  breakSeal(albumKey(t));
  clearSpinDown();   // real playback resumed — any eased-down spin-rate from a put-away no longer applies
  startSource(S.pos);
  $('#play').textContent = '❚❚'; $('#play').setAttribute('aria-label','Pause');
  renderMiniPlayer();
  MizikiSocial.nowSpinning(albumKey(t), t.tags.title);
}

export function stop(){
  S.gen++;
  if(S.source){ try{ S.source.onended = null; S.source.stop(); }catch(e){} S.source = null; }
  S.playing = false;
  const b = $('#play'); if(b){ b.textContent = '▶'; b.setAttribute('aria-label','Play'); }
  renderMiniPlayer();
}

export function pause(){ S.playing = false; if(S.source){ try{ S.source.onended=null; S.source.stop(); }catch(e){} S.source=null; }
  $('#play').textContent='▶'; $('#play').setAttribute('aria-label','Play'); touchActiveSession(); renderMiniPlayer();
  MizikiSocial.nowSpinningPaused();
  if(bgRouteActive()) bgIdleNow(); }

export function seek(sec){
  const t = current(); if(!t) return;
  S.pos = clamp(sec, 0, t.duration || 0);
  if(S.playing){ if(S.source){ try{S.source.onended=null;S.source.stop();}catch(e){} } startSource(S.pos); }
  drawTime();
  bgPosition();
}

/* (next/prev now live in the queue section above) */
