import { S, current } from '../state.js';
import { $ } from '../util/dom.js';
import { clamp } from '../util/math.js';
import { fmt } from '../util/text.js';
import { sleepCheckDeadline } from './sleep-timer.js';
import { computeRate, sunProgress, easedProgress, currentDayPosition, nowClock, formatRateChange } from '../sundown/solar.js';
import { seasonTint } from '../sundown/season.js';
import { addPlayedRange, checkTrackCompletion } from '../history/played.js';
import { autosaveResumeTick } from './resume.js';
import { bgPosition } from './background.js';
import { applyWobbleRate } from '../audio/engine.js';
import { maybeScheduleGaplessNext, cancelPendingGapless } from './transport.js';
import { easeOutCubic, REDUCED } from '../util/motion.js';
import { effectiveTheme, syncNychthemeronTheme } from '../ui/theme.js';
import { renderDialView } from '../sundown/dial-view.js';
import { RPM_33 } from '../record-art/format.js';
import { zoetropeRingAngleDeg } from '../record-art/zoetrope-motion.js';

// AU10 (docs/16_AUDIO.md §5, "the speed change"): the platter's own base
// RPM, eased over S.rpmEase.ms when one's in flight (player/transport.js's
// load() arms it only with the player open and a real speed change — Pure
// and Reduce Motion both leave it null, so this falls straight through to
// the new record's own speed with no ease). Used by both frame()'s own
// visual rotation and drawSun()'s labelArcText write, so the two numbers
// never disagree mid-ease.
function currentBaseRpm(){
  const target = (S.recordFormat && S.recordFormat.speed) || RPM_33;
  const ease = S.rpmEase;
  if(!ease) return target;
  const p = clamp((performance.now() - ease.start) / ease.ms, 0, 1);
  if(p >= 1){ S.rpmEase = null; return target; }
  return ease.from + (ease.to - ease.from) * easeOutCubic(p);
}

// PL2 (docs/19_PLAYER.md, "one clock"): position is always derived from
// S.anchor ({ctxTime, offset, rate}, set by player/transport.js whenever a
// source starts or replaces another, and re-anchored below whenever
// S.rate itself changes), never accumulated from per-tick dt — the old
// `S.pos += dt * S.rate` model drifted from the real audio clock, which
// is what gapless scheduling, the lock-screen scrubber and interruption
// detection all actually need to agree with.
// - Not playing, no anchor yet, or the context isn't 'running' (PL4's
//   frozen-on-interruption case): hold whatever S.pos already is — tick()
//   only ever writes it while actually playing, so it's already the right
//   frozen snapshot.
// - Before anchor.ctxTime (the lead-in/needle-drop window): position reads 0.
// - Otherwise: anchor.offset plus however much real, rate-adjusted time
//   has elapsed on the audio clock since anchor.ctxTime, clamped to
//   [0, duration].
export function currentPos(){
  const t = current();
  if(!t || !S.anchor || !S.playing || !S.ctx || S.ctx.state !== 'running') return S.pos;
  if(S.ctx.currentTime < S.anchor.ctxTime) return 0;
  const pos = S.anchor.offset + (S.ctx.currentTime - S.anchor.ctxTime) * S.anchor.rate;
  return clamp(pos, 0, t.duration);
}

/* ================= render loop ================= */
let last = performance.now();
// NV1: the last --sky1/--sky2 strings actually written, so drawSun() can
// skip the setProperty call (and the repaint it forces) when nothing's
// changed since the previous tick.
let lastSky1 = null, lastSky2 = null;
// RF14: the same "only write when changed" guard, for --muted/--muted-2.
let lastMuted = null, lastMuted2 = null;
// CR1/CR6: the same guard, for --phase-color/--crate-light.
let lastPhaseColor = null, lastCrateLight = null;
// The playback clock: position, played-range tracking (which feeds the 95% rule,
// sessions and metals) and Sundown's rate. Split out of frame() so it can also run
// while the page is hidden — the browser stops calling frame() then, but audio can
// keep playing (Background playback, or a background desktop tab).
export function tick(now, maxDt){
  const dt = Math.min(maxDt, (now - last)/1000); last = now;
  sleepCheckDeadline();   // fallback check — the setTimeout chain is primary

  const r = computeRate();
  if(Math.abs(r - S.rate) > 0.0001){
    // PL2: re-anchor at the new rate — capture the exact position the old
    // anchor/rate would report right now, before either changes, so the
    // switch itself introduces no jump. Sundown's own changes are gradual
    // (computeRate() ramps toward its target), so re-anchoring on every
    // tick it moves is cheap and keeps the anchor exact throughout.
    const pos = currentPos();
    S.rate = r;
    if(S.source) S.source.playbackRate.setTargetAtTime(r, S.ctx.currentTime, 0.08);
    // AU3 (docs/16_AUDIO.md §2.3): "updated wherever S.rate changes" —
    // this is the one place it ever is.
    applyWobbleRate(r);
    if(S.anchor && S.ctx) S.anchor = { ctxTime: S.ctx.currentTime, offset: pos, rate: r };
    // PL3 (docs/19_PLAYER.md, item 3): a rate change moves the boundary
    // any already-armed gapless source was scheduled against — cancel and
    // let maybeScheduleGaplessNext() re-arm it from the fresh anchor below.
    cancelPendingGapless();
    // PL7 item 2: "rate re-anchor" is one of the five moments the lock
    // screen's setPositionState should fire on — this is the one place
    // S.rate/S.anchor ever change, so it's the one place to call it from.
    // During an active Sundown ramp this fires once per tick the rate
    // actually moves, which is exactly what keeps the lock-screen scrubber
    // in step through the slowdown (PL7 item 3); outside a ramp S.rate
    // never changes, so this never runs at a plain per-tick rate.
    bgPosition();
  }

  const t = current();
  if(S.playing && t){
    const prevPos = S.pos;
    S.pos = currentPos();
    addPlayedRange(prevPos, S.pos);
    checkTrackCompletion(t);
    // AU4 (docs/16_AUDIO.md §2.4): arms the next track's own source to
    // start() at the exact moment this one is computed to end, once
    // that's close enough and the buffer's ready — the one place this
    // needs checking every tick while something's actually playing.
    maybeScheduleGaplessNext();
  }
  // AU1 (docs/16_AUDIO.md §2.1): "save the position about every 5s while
  // playing" — a plain throttle inside the already-ticking render loop,
  // not a separate timer of its own.
  autosaveResumeTick(now);
  return dt;
}

// a track that ended on its own while hidden: bring the clock up to date, then credit
// whatever remained, since the source really did play to its end
export function settleTrackEnd(){
  const t = current(); if(!t) return;
  tick(performance.now(), 120);
  if(S.pos < t.duration){ addPlayedRange(S.pos, t.duration); S.pos = t.duration; }
  checkTrackCompletion(t);
}

export function frame(now){
  const dt = tick(now, 0.1);

  if(!REDUCED){
    let spin;
    // the run-out groove keeps the platter turning with no track playing (CEREMONY §2/§3)
    if(S.playing || (S.runout && S.runout.turning)) spin = S.rate;
    else if(S.spinDown){
      const p = clamp((now - S.spinDown.start) / S.spinDown.ms, 0, 1);
      spin = S.spinDown.from * (1 - easeOutCubic(p));
      if(p >= 1) S.spinDown = null;
    } else spin = 0;
    // AU10 (docs/16_AUDIO.md §5): rpm × 6°/s -- 200°/s at 33⅓, 270°/s at 45.
    S.angle = (S.angle + dt * spin * currentBaseRpm() * 6) % 360;
    $('#disc').style.transform = 'rotate(' + S.angle + 'deg)';
    // The zoetrope frame ring tracks the same real angle as
    // #disc, quantized to the nearest frame-slot boundary
    // (record-art/zoetrope-motion.js) so each figure appears to animate in
    // place rather than merely spin. `spin` above is already the fraction
    // of full speed in effect right now (0 while stopped/spun-down, up to
    // S.rate while playing) — the same number frame()'s own S.angle advance
    // already multiplies by — so actualRps is just nominalRps*spin, with
    // no separate Sundown lookup needed here. reducedMotion is always
    // false at this call site: REDUCED is already checked by the
    // surrounding `if`, which is what makes "no stepping" true for this
    // ring the same way it's already true for #disc itself (no transform
    // is ever written while reduced motion is on).
    if(S.zoetropeFrameCount){
      const nominalRps = currentBaseRpm() / 60;
      const ringAngle = zoetropeRingAngleDeg({
        realAngleDeg: S.angle, frameCount: S.zoetropeFrameCount,
        actualRps: nominalRps * spin, nominalRps,
        mode: S.mode, reducedMotion: false,
      });
      $('#discZoetropeRing').style.transform = 'rotate(' + ringAngle + 'deg)';
    }
  }

  if(now - lastUI > 90){ lastUI = now; drawTime(); }
  if(now - lastSky > 220){ lastSky = now; drawSun(); }
  requestAnimationFrame(frame);
}
let lastUI = 0, lastSky = 0;

// hidden pages get no frames; keep the clock honest from a timer. A long gap here is
// real elapsed time (audio kept playing), not a stall, so the cap is much larger.
// PL7 item 2: must NOT call bgPosition() unconditionally every second here
// — that's exactly the "every tick" setPositionState calls the doc asks
// to avoid. tick() above already calls it on an actual rate re-anchor,
// and seek()/play()/pause()/load() each already trigger it their own way
// (directly, or via renderMiniPlayer() -> bgSync()) — nothing else here
// needs its own poll.
setInterval(() => {
  if(!document.hidden || !S.playing) return;
  tick(performance.now(), 120);
}, 1000);

export function drawTime(){
  const t = current();
  const dur = t ? (t.duration || 0) : 0;
  $('#tElapsed').textContent = fmt(S.pos);
  $('#tTotal').textContent = fmt(dur);
  const p = dur ? S.pos/dur : 0;
  if(!S.scrubbing) $('#scrub').value = Math.round(p*1000);

  // D4 (docs/DESKTOP_LAYOUT.md): the desktop player bar's own seek
  // readout mirrors this exact value, the same "reuse the readout
  // rather than compute it twice" approach drawSun() already uses for
  // the sidebar's Sundown card below — null-guarded since these ids
  // exist only in the player bar's own markup (miziki.html), hidden
  // below 1024px by CSS, never a breakpoint check.
  const barElapsed = $('#barElapsed'), barTotal = $('#barTotal');
  if(barElapsed) barElapsed.textContent = fmt(S.pos);
  if(barTotal) barTotal.textContent = fmt(dur);
  if(!S.scrubbing){ const barScrub = $('#barScrub'); if(barScrub) barScrub.value = Math.round(p*1000); }
}

export function drawSun(){
  const p = sunProgress(), e = easedProgress();

  // DA3's own header eyebrow ("Now · 6:49 PM") — only while live;
  // src/sundown/dial-gesture.js's setPreviewMinutes() owns the
  // "Previewing · <time>" text the instant the dial moves, since that
  // has to feel immediate, not wait for this ~220ms-throttled tick.
  if(S.previewMin === 0){
    const eyebrow = $('#sundownEyebrow');
    if(eyebrow){
      eyebrow.textContent = 'Now · ' + nowClock().toLocaleTimeString([], {hour:'numeric', minute:'2-digit'});
      eyebrow.classList.remove('sd-previewing');
    }
  }
  // RF15 (docs/12_REFINE.md): the platter label's own mono arc — real RPM
  // (tracks Sundown's drift, same number the plain readout this replaced
  // always showed) plus the side/format half transport.js's load() cached
  // on S.labelSideFormat, since that part doesn't change between loads.
  // AU10 (docs/16_AUDIO.md §5): the base RPM itself now follows the loaded
  // record's own format (S.recordFormat.speed), not a fixed 33.333, so a
  // 45 reads "45.0 RPM..." the same way a 33⅓ record already did.
  const arcText = $('#labelArcText');
  if(arcText) arcText.textContent = (currentBaseRpm() * S.rate).toFixed(1) + ' RPM · ' + S.labelSideFormat;

  // Pure means untouched — Sundown only ever reaches the recording in Vinyl.
  // The settings below stay live and usable in Pure anyway, since they
  // describe what Vinyl will do the moment you switch back.
  //
  // DA1 (docs/DAY_ARC.md): Dawn and Morning are the two new cases — every
  // other phase (midday/afternoon/golden, all still "full daylight" as
  // far as the rate is concerned) keeps the existing "Daylight — full
  // speed" wording, since DA1 only asks for Dawn's and Morning's own text,
  // not a distinct line for each of the seven phases (that's DA3's own
  // richer phase line).
  const dayPos = currentDayPosition();
  let rateWhyText;
  if(S.mode === 'pure') rateWhyText = 'Pure — always full speed (Sundown applies in Vinyl)';
  else if(!S.auto) rateWhyText = 'Set by hand';
  else if(dayPos.phase === 'dawn') rateWhyText = 'Dawn — rising, ' + Math.round(dayPos.phaseProgress*100) + '% of the way up';
  else if(dayPos.phase === 'morning') rateWhyText = 'Morning — full speed';
  else if(p <= 0) rateWhyText = 'Daylight — full speed';
  else if(p >= 1) rateWhyText = 'Night — settled at ' + S.target.toFixed(2) + '×';
  else rateWhyText = 'Twilight — ' + Math.round(e*100) + '% of the way down';

  // D3 (docs/DESKTOP_LAYOUT.md): the desktop sidebar's own Sundown summary
  // card gets this same computed string directly, written once here
  // rather than having a second module call sunProgress()/computeRate()
  // on its own. This id exists only in the sidebar's own DOM
  // (src/shell/sidebar.js has no render function of its own for it),
  // hidden below the 1024px breakpoint by CSS, so the null guard here is
  // just "does the sidebar card exist in the DOM," never a breakpoint
  // check.
  const sideWhy = $('#sideRateWhy');
  if(sideWhy) sideWhy.textContent = rateWhyText;
  if(S.sun.ok){
    const sideStart = $('#sideLegStart'), sideEnd = $('#sideLegEnd');
    const f = d => d.toLocaleTimeString([], {hour:'numeric', minute:'2-digit'});
    if(sideStart) sideStart.textContent = 'Sunset ' + f(S.sun.set);
    if(sideEnd) sideEnd.textContent = 'Dusk ' + f(S.sun.dusk);
  }

  // DA3 (docs/DAY_ARC.md): the sky follows the whole day in both themes,
  // not just the dusk window in dark — see skyGradientStops()'s own
  // header comment for the 8-anchor design. This is deliberate, not a
  // regression of "Light keeps its static tokens, no inline override"
  // (CLAUDE.md's own D2 changelog entry): that was a stand-in for not
  // having designed a light sky arc yet, not a permanent rule. The design
  // README (docs/design/day-arc/README.md) gives Light its own full,
  // contrast-checked anchor table, so there's no reason to skip animating
  // it. document.documentElement.style.setProperty() still writes an
  // inline style (always wins over the stylesheet's own 22-theme.css
  // tokens), which is the point in both themes now.
  // DA4 (docs/DAY_ARC.md): this is the one place in the app that already
  // recomputes the day position on a steady ~220ms cadence while
  // visible, so it's also where a live Nychthemeron crossing (the sun
  // actually rising or setting while the app is open) gets caught and
  // applied — a no-op the rest of the time (not on Nychthemeron, or
  // nothing's actually changed since the last tick). See
  // src/ui/theme.js's own comment for why this isn't a second matchMedia-
  // style listener.
  syncNychthemeronTheme();

  // NV1: drawSun() runs every ~220ms while visible, but the sky's two
  // stops rarely actually change that often (skyGradientStops() only
  // moves between its anchors as the day itself progresses). Writing an
  // identical custom-property value still forces a full repaint of the
  // fixed-position gradient layer behind everything (.sky-bg,
  // 00-base.css) — skip the writes entirely once the strings match what
  // was last written, the same "don't touch the DOM for a no-op" shape
  // every other guarded id in this function already uses.
  const theme = effectiveTheme();
  const seasonWeights = S.seasonalSky !== false ? seasonTint(Date.now(), S.sun.lat) : null;
  const [sky1, sky2] = skyGradientStops(dayPos, theme, seasonWeights);
  if(sky1 !== lastSky1 || sky2 !== lastSky2){
    lastSky1 = sky1; lastSky2 = sky2;
    document.documentElement.style.setProperty('--sky1', sky1);
    document.documentElement.style.setProperty('--sky2', sky2);
  }

  // RF14 (docs/12_REFINE.md, point 1): --muted/--muted-2 follow the sky the
  // same "write an inline style, skip when nothing's changed" way --sky1/
  // --sky2 just did above -- see mutedGradientStops()'s own header comment
  // for the warm/cool rule.
  const [muted, muted2] = mutedGradientStops(dayPos, theme);
  if(muted !== lastMuted || muted2 !== lastMuted2){
    lastMuted = muted; lastMuted2 = muted2;
    document.documentElement.style.setProperty('--muted', muted);
    document.documentElement.style.setProperty('--muted-2', muted2);
  }

  // CR1/CR6 (docs/13_CRATE.md): a single global --phase-color, the same
  // "write it once here, read it from CSS wherever it's needed" shape
  // --sky1/--sky2/--muted/--muted-2 just above already use, so the crate's
  // own now-playing header text (CR1) and the sealed-record film's tint
  // (CR6) read one value instead of each keying off [data-phase] the way
  // the Sundown sheet's entry points (26-sundown-sheet.css) do. The seven
  // hex values are profile/rhythm-card.js's own PHASE_COLOR table,
  // duplicated rather than imported — the same "a few color strings
  // aren't worth a new edge into this already widely-imported render
  // loop" call this file already makes for the Sundown sheet's own
  // phase-tinted elements.
  const phaseColor = PHASE_COLOR[dayPos.phase] || PHASE_COLOR.midday;
  if(phaseColor !== lastPhaseColor){
    lastPhaseColor = phaseColor;
    document.documentElement.style.setProperty('--phase-color', phaseColor);
  }

  // CR1 (docs/13_CRATE.md): the sleeve's own sky-lit top edge — warm white
  // at Golden hour, cool at Night, smoothstep-blended across the same
  // phase boundaries as --sky1/--sky2/--muted above. Only the crate card
  // reads it (src/styles/10-crate.css's .crate-card lit-edge box-shadow),
  // so it's written with the same change-guard every other per-tick
  // custom property here already uses.
  const crateLight = crateLightColor(dayPos);
  if(crateLight !== lastCrateLight){
    lastCrateLight = crateLight;
    document.documentElement.style.setProperty('--crate-light', crateLight);
  }

  // DA3's own phase block: a big phase name ("Twilight") plus a muted
  // sub-line ("60% of the way down"), kept separate from rateWhyText just
  // above (the existing, shorter "Now playing at" sub-copy — the doc's own
  // "keep the existing readout and add a new phase line" instruction, not
  // a replacement for it). phaseText() is a small, pure DOM-free helper so
  // the actual phase-name/phase-sub strings are directly unit-testable
  // without a document.
  const { name, sub } = phaseText(dayPos, p, e);
  const sidePhaseName = $('#sidePhaseName'), sidePhaseSub = $('#sidePhaseSub');
  if(sidePhaseName) sidePhaseName.textContent = name;
  if(sidePhaseSub) sidePhaseSub.textContent = sub;

  // RF26 (docs/12_REFINE.md): the sheet's two ways-in on the player — the
  // sun knob and the mini-player's sun button — are tinted by the current
  // phase via a plain data attribute; CSS (src/styles/26-sundown-sheet.css)
  // owns the actual colours, the same "write the phase, let CSS decide
  // the colour" split src/profile/rhythm-card.js's own PHASE_COLOR table
  // already uses elsewhere (duplicated there rather than imported, to
  // avoid a new import edge into this already widely-imported render
  // loop). The knob's own time readout and the player's format line's
  // phase suffix (#trackSpecPhase) are two more small mirrors of this
  // same already-computed `name`/`S.rate`, the same shape #sideRateWhy
  // just above already uses.
  const knob = $('#sunKnob'), miniSun = $('#miniSunBtn');
  if(knob) knob.dataset.phase = dayPos.phase;
  if(miniSun) miniSun.dataset.phase = dayPos.phase;
  const knobTime = $('#sunKnobTime');
  if(knobTime) knobTime.textContent = nowClock().toLocaleTimeString([], {hour:'numeric', minute:'2-digit'});
  const specPhase = $('#trackSpecPhase');
  if(specPhase){
    // RF27 (docs/12_REFINE.md): same percentage+semitone format as
    // rateWhyText above and the depth caption (solar.js's
    // formatRateChange()), not a bare "X ST SLOWER" — upper-cased to
    // match this line's own all-caps style.
    specPhase.textContent = current()
      ? name.toUpperCase() + ' · ' + (S.mode === 'pure' || S.rate >= 0.999 ? 'FULL SPEED' : formatRateChange(S.rate).toUpperCase())
      : '';
  }

  // Day Arc v2 (DAY_ARC_BRIEF.md, PR 4): the dial + reading cards paint
  // off the exact same tick this whole function already runs on — see
  // sundown/dial-view.js's own header comment for why this rides along
  // here rather than a second timer.
  renderDialView();
}

// DA3's phase-name/phase-sub text, pulled out of drawSun() as a small pure
// function (same precedent as skyGradientStops/angleDelta) so its wording
// is testable directly. dayPos is dayPosition()'s own shape; p/e are
// sunProgress()/easedProgress()'s pre-existing 0=day/1=night values, reused
// rather than recomputed a second time (drawSun()'s existing #rateWhy
// cascade already has them in scope).
export function phaseText(dayPos, p, e){
  switch(dayPos.phase){
    case 'dawn': return { name: 'Dawn', sub: Math.round(dayPos.phaseProgress*100) + '% of the way up' };
    case 'morning': return { name: 'Morning', sub: 'Bright, full speed' };
    case 'midday': return { name: 'Midday', sub: 'Full speed' };
    case 'afternoon': return { name: 'Afternoon', sub: 'Full speed' };
    case 'golden': return { name: 'Golden hour', sub: 'Full speed' };
    case 'twilight': return { name: 'Twilight', sub: Math.round(e*100) + '% of the way down' };
    case 'night': return { name: 'Night', sub: 'Settled in for the night' };
    default: return { name: 'Midday', sub: 'Full speed' };
  }
}

// The sky's own color math — 8 named anchors (docs/design/day-arc/
// README.md's own sky-token table), smoothstep-blended between
// neighbours by dayPosition()'s phase/phaseProgress, the same
// architecture DA2's own character drift (src/sundown/drift.js) already
// uses and for the same reason: every phase boundary is continuous by
// construction (the next phase's blend source is always the previous
// phase's blend target), with no separate continuity mechanism to keep
// in sync. Dusk is the one anchor with no dayPosition() phase of its
// own — like Golden's "sunset − 1h"/Midday's "solar noon," the design
// README's "When" column names the representative instant each swatch
// was picked at, not a separate phase (Golden/Midday apply flat across
// their whole phase, the same judgment call drift.js already made) — but
// Dusk is the one true interior waypoint: Twilight ramps Golden -> Dusk
// across its own phaseProgress (reaching the Dusk anchor exactly at the
// dusk instant), and the first 30 minutes of Night (day.js's own
// duskRampProgress, added for exactly this) ramps Dusk -> Night,
// continuous with Twilight's own ending value, before settling flat at
// the Night anchor for the rest of the night. Dawn then ramps Night ->
// Morning the same way DA2's own dawn branch already does. Pure, no
// document — exported for its own unit test, same precedent as
// angleDelta (scrub.js)/gatefoldSideSplits (gatefold/view.js).
const SKY_ANCHORS = {
  dark: {
    night:     [[18,14,25],[8,7,12]],
    dawn:      [[56,40,66],[24,19,31]],
    morning:   [[28,56,67],[15,31,39]],
    midday:    [[29,47,56],[16,26,32]],
    afternoon: [[35,53,60],[17,25,30]],
    // RF14 (docs/12_REFINE.md, point 2): Golden's and Twilight's own sky1
    // (the brighter of each pair) cooled slightly toward neutral, at the
    // same lightness, so amber (--accent) stays the single most saturated
    // thing on screen instead of competing with these two warm anchors —
    // docs/design/refine/README.md's own "Sky anchors that change" table:
    // Golden #3D2A1F -> #352A24 (saturation 0.33 -> 0.19), Twilight
    // #3B2130 -> #33232E (0.28 -> 0.19). sky2 (the darker stop) is
    // unchanged for both, per that same table.
    golden:    [[53,42,36],[26,19,16]],
    twilight:  [[51,35,46],[26,16,24]],
    dusk:      [[30,24,40],[13,11,19]],
  },
  light: {
    // CR8 (docs/13_CRATE.md point 2): "the four phase anchors that lean
    // into their hue" -- docs/design/crate/README.md's own light-theme
    // table (Golden #F8E2C2, Dawn #F7E1DE, Night #E4DFEE, Twilight
    // #F2E2E5). Each is one flat anchor (both "stops" of the pair
    // identical), replacing the previous near-neutral two-stop pairs for
    // these four phases only -- morning/midday/afternoon/dusk are
    // untouched, since the README names only these four.
    night:     [[228,223,238],[228,223,238]],
    dawn:      [[247,225,222],[247,225,222]],
    morning:   [[239,244,242],[227,236,234]],
    midday:    [[246,241,231],[236,229,216]],
    afternoon: [[245,239,227],[235,227,211]],
    golden:    [[248,226,194],[248,226,194]],
    twilight:  [[242,226,229],[242,226,229]],
    // dusk itself is untouched by CR8 (the README names only Golden/Dawn/
    // Night/Twilight as leaning into their hue) -- but CR8's own new,
    // warmer light --muted (#6B6258) lost just enough margin against this
    // anchor's darker stop to dip under the 4.5:1 floor at the tail end of
    // twilight (where the sky blends into it) -- found by the project's
    // own full-day contrast sweep (tests/unit/clock.test.js), not asserted.
    // A 3-point lift on each channel (imperceptible; the hue is unchanged)
    // restores the margin without otherwise moving this anchor.
    dusk:      [[236,230,238],[230,224,235]],
  },
};

const smoothstep = p => p*p*(3 - 2*p);
const mixRGB = (a,b,k) => a.map((v,i) => Math.round(v + (b[i]-v)*k));
const mixPair = (a,b,k) => [mixRGB(a[0],b[0],k), mixRGB(a[1],b[1],k)];
const toStops = pair => ['rgb('+pair[0].join(',')+')', 'rgb('+pair[1].join(',')+')'];

// RW6 (docs/23_RHYTHM_AND_WEAR.md): seasonal sky tint, color only --
// speed, depth and sound never read the season. Deltas below are each
// season's dark-theme midday/twilight swatch (docs/design/rhythm-wear/
// README.md's own table, Seasons.dc.html) minus this file's existing
// dark midday/twilight anchors, so a season weight of 0 reproduces
// today's sky exactly. The other six anchors have no swatch of their
// own -- each takes whichever of midday's/twilight's shift it sits
// nearest to in the day's own cycle (dawn/morning/afternoon are day-lit,
// so midday's shift; night/golden/dusk are evening-lit, so twilight's).
const SEASON_DELTAS_DARK = {
  midday: {
    spring: [[-2,3,-2],[-1,2,-2]],
    summer: [[2,4,8],[1,2,4]],
    autumn: [[9,0,-5],[4,0,-4]],
    winter: [[-1,-4,0],[-1,-2,2]],
  },
  twilight: {
    spring: [[0,3,-2],[0,2,-2]],
    summer: [[7,3,-5],[2,2,-4]],
    autumn: [[3,3,-15],[1,3,-8]],
    winter: [[-7,0,5],[-4,0,4]],
  },
};
// Light theme: "the equivalent gentle shift" -- same hue direction, a
// gentler magnitude (half) so a season never pushes a light-theme anchor
// past its own existing contrast floor (tests/unit/contrast.test.js).
const LIGHT_SHIFT_SCALE = 0.5;
// The six anchors with no swatch of their own take a *softer* fraction of
// whichever shift they're nearest to, not the full amount: dark/morning's
// own existing margin against --muted is already its tightest anchor
// (tests/unit/clock.test.js's own per-10-minute contrast sweep), with
// only ~0.12 of headroom above 4.5:1 to begin with -- the full midday
// shift (most sharply, Summer's) would eat past it. 0.3 (found empirically
// against every anchor/theme/season combination, with a margin for
// rounding) keeps every one of them comfortably clear.
const SPILLOVER_SHIFT_SCALE = 0.3;

function weightedDelta(deltas, weights){
  const sum = [[0,0,0],[0,0,0]];
  for(const season of Object.keys(weights)){
    const d = deltas[season];
    const w = weights[season];
    for(let stop = 0; stop < 2; stop++){
      for(let ch = 0; ch < 3; ch++) sum[stop][ch] += d[stop][ch] * w;
    }
  }
  return sum;
}

const addPair = (base, delta, scale = 1) => base.map((stop, i) =>
  stop.map((v, ch) => Math.max(0, Math.min(255, Math.round(v + delta[i][ch] * scale)))));

// seasonalAnchors(theme, weights) -- SKY_ANCHORS[theme], shifted by the
// season blend's own weighted deltas. Returns the unmodified table when
// every weight is falsy (S.seasonalSky off), so skyGradientStops() below
// can call this unconditionally.
function seasonalAnchors(theme, weights){
  if(!weights) return SKY_ANCHORS[theme];
  const base = SKY_ANCHORS[theme];
  const lightScale = theme === 'light' ? LIGHT_SHIFT_SCALE : 1;
  const coreScale = lightScale;
  const spillScale = SPILLOVER_SHIFT_SCALE * lightScale;
  const middayDelta = weightedDelta(SEASON_DELTAS_DARK.midday, weights);
  const twilightDelta = weightedDelta(SEASON_DELTAS_DARK.twilight, weights);
  return {
    night: addPair(base.night, twilightDelta, spillScale),
    dawn: addPair(base.dawn, middayDelta, spillScale),
    morning: addPair(base.morning, middayDelta, spillScale),
    midday: addPair(base.midday, middayDelta, coreScale),
    afternoon: addPair(base.afternoon, middayDelta, spillScale),
    golden: addPair(base.golden, twilightDelta, spillScale),
    twilight: addPair(base.twilight, twilightDelta, coreScale),
    dusk: addPair(base.dusk, twilightDelta, spillScale),
  };
}

// blendAnchors(anchors, dayPos) -- the same 8-anchor, phase/phaseProgress-
// driven smoothstep blend skyGradientStops() has always used, pulled out
// so RF14 (docs/12_REFINE.md)'s --muted/--muted-2 blend (mutedGradientStops()
// below) can reuse the exact same phase arithmetic instead of duplicating
// this switch a second time -- both are "two colors per anchor, blended
// the same way the sky already is," just a different anchor table.
function blendAnchors(anchors, dayPos){
  if(!dayPos) return toStops(anchors.midday);
  const p = clamp(dayPos.phaseProgress || 0, 0, 1);
  switch(dayPos.phase){
    case 'dawn': return toStops(mixPair(anchors.night, anchors.morning, smoothstep(p)));
    case 'morning': return toStops(p < 0.5 ? anchors.morning : mixPair(anchors.morning, anchors.midday, smoothstep((p - 0.5) / 0.5)));
    case 'midday': return toStops(anchors.midday);
    case 'afternoon': return toStops(mixPair(anchors.midday, anchors.golden, smoothstep(p)));
    case 'golden': return toStops(anchors.golden);
    case 'twilight': return toStops(mixPair(anchors.golden, anchors.dusk, smoothstep(p)));
    case 'night': {
      const ramp = clamp(dayPos.duskRampProgress != null ? dayPos.duskRampProgress : 1, 0, 1);
      return toStops(mixPair(anchors.dusk, anchors.night, smoothstep(ramp)));
    }
    default: return toStops(anchors.midday);
  }
}

// RW6: seasonWeights is optional (seasonTint()'s own {spring,summer,
// autumn,winter} shape) -- omitted or null, this is byte-identical to
// the function's pre-RW6 behavior (every existing caller/test above),
// which is also exactly what "Sky follows the seasons" off means.
export function skyGradientStops(dayPos, theme, seasonWeights){
  const th = theme === 'light' ? 'light' : 'dark';
  return blendAnchors(seasonalAnchors(th, seasonWeights), dayPos);
}

// RF14 (docs/12_REFINE.md, point 1): "muted follows the sky" -- --muted/
// --muted-2 (tertiary text, new) shift warm during Golden and Twilight and
// cool everywhere else, smoothstep-blended across phase boundaries the
// same way --sky1/--sky2 already are. docs/design/refine/README.md's own
// "Colour" section gives the literal cool/warm pairs (measured to clear
// 4.5:1/3:1 against every anchor already) -- dusk has no third, separate
// pair of its own (unlike the sky's 8-anchor table, whose Dusk anchor is a
// real interior waypoint): the rule is a flat warm/cool split by phase, so
// Dusk takes the cool pair like every other non-Golden/Twilight anchor,
// and Night's own dusk-ramp (duskRampProgress) blends from that cool Dusk
// value toward the (also cool) Night value -- effectively flat, since both
// ends of that ramp are the same pair.
// TY1 (docs/22_TYPE.md, audit point 4): --muted-2's floor was raised in
// 00-base.css (#7A868C -> #86939A) because the old value only cleared
// 3.7:1 against --sky1 -- these two anchor pairs are updated to match so
// the live per-minute gradient this function drives never redraws a
// value darker than the new static floor.
const MUTED_COOL = [[148,160,166],[134,147,154]];   // --muted #94A0A6 / --muted-2 #86939A
const MUTED_WARM = [[169,156,143],[141,131,122]];   // --muted #A99C8F / --muted-2 #8D837A
const MUTED_ANCHORS_DARK = {
  night: MUTED_COOL, dawn: MUTED_COOL, morning: MUTED_COOL, midday: MUTED_COOL,
  afternoon: MUTED_COOL, golden: MUTED_WARM, twilight: MUTED_WARM, dusk: MUTED_COOL,
};
// Light "keeps one pair" (the design README's own wording). This is the
// one other place that pair is set, since drawSun() writes
// --muted/--muted-2 inline every tick and would otherwise silently
// override the CSS token with a stale value. Still a flat pair with no
// warm/cool split (tests/unit/contrast.test.js's own CR8 check covers the
// contrast floor).
// TY1: light's --muted-2 floor was raised the same way (#6E7A80 -> #5E6A70).
const MUTED_LIGHT = toStops([[107,98,88],[94,106,112]]); // --muted #6B6258 / --muted-2 #5E6A70

// TY5 (docs/22_TYPE.md): Nychthemeron and this function move tone only --
// neither this function nor drawSun() (its one caller) ever writes
// font-size, font-family, letter-spacing or font-weight; see
// tests/unit/clock.test.js's own assertion of that, kept beside the
// mutedGradientStops/skyGradientStops tests it would catch a regression
// alongside.
export function mutedGradientStops(dayPos, theme){
  if(theme === 'light') return MUTED_LIGHT;
  return blendAnchors(MUTED_ANCHORS_DARK, dayPos);
}

// CR1/CR6 (docs/13_CRATE.md): the same seven phase names/hexes
// profile/rhythm-card.js's own PHASE_COLOR table already uses, duplicated
// here per that file's own comment on why (see --phase-color's write
// site above).
// CR8 (docs/13_CRATE.md point 3): "Golden's phase colour #F2B35C" -- was
// #FFB85E, close enough to --amber/--accent-text (#FF9E2C) to read as
// amber's own twin; the README's own replacement warms toward gold
// instead, so Golden's chip is clearly its own colour, not amber again.
const PHASE_COLOR = {
  night: '#8E7CC3', dawn: '#E7A7B8', morning: '#9FD8E8', midday: '#EFE9DF',
  afternoon: '#D9C7A0', golden: '#F2B35C', twilight: '#FF9E2C',
};

// CR1's "sky-lit highlight": a warm-white top edge at Golden hour, cool at
// Night, blended the same smoothstep way skyGradientStops()/
// mutedGradientStops() already are — reusing blendAnchors() with a
// one-color-per-phase table (both "stops" of each pair identical) rather
// than teaching that helper a single-color shape of its own. Exported for
// its own unit test, same precedent as skyGradientStops/mutedGradientStops.
const CRATE_LIGHT_WARM = [255,235,200];   // warm white, golden hour
const CRATE_LIGHT_COOL = [205,214,230];  // cool white, night
const CRATE_LIGHT_ANCHORS = {
  night: [CRATE_LIGHT_COOL, CRATE_LIGHT_COOL], dawn: [CRATE_LIGHT_COOL, CRATE_LIGHT_COOL],
  morning: [CRATE_LIGHT_COOL, CRATE_LIGHT_COOL], midday: [CRATE_LIGHT_COOL, CRATE_LIGHT_COOL],
  afternoon: [CRATE_LIGHT_COOL, CRATE_LIGHT_COOL], golden: [CRATE_LIGHT_WARM, CRATE_LIGHT_WARM],
  twilight: [CRATE_LIGHT_WARM, CRATE_LIGHT_WARM], dusk: [CRATE_LIGHT_COOL, CRATE_LIGHT_COOL],
};

export function crateLightColor(dayPos){
  const [stop] = blendAnchors(CRATE_LIGHT_ANCHORS, dayPos);
  // stop is 'rgb(r,g,b)' (toStops()'s own format) — reused as the rgb()
  // triple inside a fixed-alpha rgba(), rather than teaching toStops()
  // itself a fourth, alpha argument no other caller needs.
  return 'rgba(' + stop.slice(4, -1) + ',.2)';
}
