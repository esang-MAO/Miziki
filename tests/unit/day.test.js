import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dayEvents, dayPosition } from '../../src/sundown/day.js';
import { sunProgress, easedProgress, computeRate } from '../../src/sundown/solar.js';
import { S } from '../../src/state.js';

// src/sundown/day.js and the day-model parts of solar.js have no DOM/`S`-
// mutating top level (solar.js's existing solar.test.js already proves
// this for the whole file) — no mocking needed, same precedent as
// library-model.test.js/crate-geometry.test.js.

const COLUMBIA = { lat: 39.20, lon: -76.86 };
const SYDNEY = { lat: -33.8688, lon: 151.2093 };

// Baltimore, MD (effectively the same sunrise/sunset as nearby Columbia,
// MD) June 21, 2025: sunrise 5:38 am, sunset 8:38 pm EDT — the sunset
// figure matches solar.test.js's own cited sunrisesunset.io value for
// Columbia exactly (8:38 pm), confirming the two sources agree.
test('dayEvents: sunrise and sunset for Columbia, MD match published times', () => {
  const date = new Date('2025-06-21T12:00:00Z');
  const ev = dayEvents(date, COLUMBIA.lat, COLUMBIA.lon);
  const publishedRise = new Date('2025-06-21T09:38:00Z');
  const publishedSet = new Date('2025-06-22T00:38:00Z');
  assert.ok(Math.abs(ev.rise - publishedRise) / 60000 < 5, 'sunrise within 5 minutes of published time');
  assert.ok(Math.abs(ev.set - publishedSet) / 60000 < 5, 'sunset within 5 minutes of published time');
});

// Sydney, Australia (southern hemisphere) June 18, 2025: sunrise 6:59 am,
// sunset 4:53 pm AEST (UTC+10, no DST in the southern-hemisphere winter).
test('dayEvents: sunrise and sunset for Sydney (southern hemisphere) match published times', () => {
  const date = new Date('2025-06-18T12:00:00Z');
  const ev = dayEvents(date, SYDNEY.lat, SYDNEY.lon);
  const publishedRise = new Date('2025-06-17T20:59:00Z');
  const publishedSet = new Date('2025-06-18T06:53:00Z');
  assert.ok(Math.abs(ev.rise - publishedRise) / 60000 < 5, 'sunrise within 5 minutes of published time');
  assert.ok(Math.abs(ev.set - publishedSet) / 60000 < 5, 'sunset within 5 minutes of published time');
});

test('dayEvents: dawn precedes sunrise, sunset precedes dusk, and solar noon never returns null', () => {
  const date = new Date('2025-06-21T12:00:00Z');
  const ev = dayEvents(date, COLUMBIA.lat, COLUMBIA.lon);
  assert.ok(ev.dawn < ev.rise);
  assert.ok(ev.set < ev.dusk);
  assert.ok(ev.noon instanceof Date);
});

// Continuity: dayPosition().rateProgress is what computeRate() eases, so a
// jump here is an audible click in the platter's own speed. Recomputes
// dayEvents() fresh for every sampled minute — the day model's underlying
// continuity claim, independent of the app's own "recompute at midnight"
// caching (src/wiring/lifecycle.js, src/sundown/location.js) which is a
// freshness concern, not a correctness one; see day.js's own header
// comment on why a single dayEvents(now, ...) call already represents
// "today" correctly at any hour, with no separate yesterday/tomorrow
// event needed for this to hold across the midnight boundary itself.
test('dayPosition: rateProgress has no jump across 48 hours, including midnight, dawn, sunrise, sunset and dusk', () => {
  const start = new Date('2025-06-21T04:00:00Z'); // well before dawn, Columbia MD
  let prev = null;
  let maxDelta = 0;
  for(let m = 0; m < 48 * 60; m++){
    const now = new Date(start.getTime() + m * 60000);
    const ev = dayEvents(now, COLUMBIA.lat, COLUMBIA.lon);
    const pos = dayPosition(now, ev);
    if(prev !== null) maxDelta = Math.max(maxDelta, Math.abs(pos.rateProgress - prev));
    prev = pos.rateProgress;
  }
  // the steepest unpaced slope is 1/(twilight or dawn window length in
  // minutes) per minute — Columbia's own civil-twilight window is a few
  // tens of minutes long, so ~0.03-0.05/minute is the expected natural
  // rate; 0.1 leaves generous headroom above that while still catching a
  // real discontinuity (which would show up as a jump near 1.0).
  assert.ok(maxDelta < 0.1, `expected no jump above 0.1, got a max per-minute delta of ${maxDelta}`);
});

test('dayPosition: 1am is night (rateProgress 1), noon is day (rateProgress 0), for Columbia, MD', () => {
  const date = new Date('2025-06-21T12:00:00Z');
  const ev = dayEvents(date, COLUMBIA.lat, COLUMBIA.lon);
  const oneAmEDT = new Date('2025-06-21T05:00:00Z'); // 1am EDT, before dawn (~5:10am EDT)
  const noonEDT = new Date('2025-06-21T16:00:00Z'); // noon EDT, between sunrise and sunset
  assert.equal(dayPosition(oneAmEDT, ev).phase, 'night');
  assert.equal(dayPosition(oneAmEDT, ev).rateProgress, 1);
  assert.notEqual(dayPosition(noonEDT, ev).phase, 'night');
  assert.notEqual(dayPosition(noonEDT, ev).phase, 'dawn');
  assert.notEqual(dayPosition(noonEDT, ev).phase, 'twilight');
  assert.equal(dayPosition(noonEDT, ev).rateProgress, 0);
});

test('dayPosition: dawn phase is a smooth 1->0 rise, with phaseProgress reading as "percent risen"', () => {
  const date = new Date('2025-06-21T12:00:00Z');
  const ev = dayEvents(date, COLUMBIA.lat, COLUMBIA.lon);
  const mid = new Date((ev.dawn.getTime() + ev.rise.getTime()) / 2);
  const pos = dayPosition(mid, ev);
  assert.equal(pos.phase, 'dawn');
  assert.ok(Math.abs(pos.phaseProgress - 0.5) < 0.01);
  assert.ok(Math.abs(pos.rateProgress - 0.5) < 0.01); // rateProgress = 1 - phaseProgress
  assert.ok(Math.abs(dayPosition(ev.dawn, ev).rateProgress - 1) < 0.01);
  assert.ok(Math.abs(dayPosition(ev.rise, ev).rateProgress - 0) < 0.01);
});

test('dayPosition: twilight phase is unchanged from the pre-DA1 sunset->dusk progress', () => {
  const date = new Date('2025-06-21T12:00:00Z');
  const ev = dayEvents(date, COLUMBIA.lat, COLUMBIA.lon);
  const mid = new Date((ev.set.getTime() + ev.dusk.getTime()) / 2);
  const pos = dayPosition(mid, ev);
  assert.equal(pos.phase, 'twilight');
  assert.ok(Math.abs(pos.rateProgress - 0.5) < 0.01);
});

test('dayPosition: polar day (sun never sets) is full day all the time', () => {
  // Svalbard (78.2, 15.6) in June — the same location/season as
  // solarEvent's own existing polar-day test in solar.test.js.
  const date = new Date('2025-06-21T12:00:00Z');
  const ev = dayEvents(date, 78.2, 15.6);
  assert.equal(ev.dawn, null); assert.equal(ev.rise, null);
  assert.equal(ev.set, null); assert.equal(ev.dusk, null);
  for(const h of [0, 3, 6, 12, 18, 23]){
    const now = new Date(date); now.setUTCHours(h, 0, 0, 0);
    const pos = dayPosition(now, ev);
    assert.equal(pos.rateProgress, 0, `hour ${h} should be full day`);
  }
});

test('dayPosition: polar night (sun never rises) is full night all the time', () => {
  // Svalbard in December — deep winter, the sun never gets close to the
  // horizon.
  const date = new Date('2025-12-21T12:00:00Z');
  const ev = dayEvents(date, 78.2, 15.6);
  assert.equal(ev.dawn, null); assert.equal(ev.rise, null);
  assert.equal(ev.set, null); assert.equal(ev.dusk, null);
  for(const h of [0, 3, 6, 12, 18, 23]){
    const now = new Date(date); now.setUTCHours(h, 0, 0, 0);
    const pos = dayPosition(now, ev);
    assert.equal(pos.rateProgress, 1, `hour ${h} should be full night`);
  }
});

test('dayPosition: no location data at all defaults to day (the same conservative default sunProgress() always used)', () => {
  const pos = dayPosition(new Date(), {});
  assert.equal(pos.rateProgress, 0);
});

// The doc's own fixed stand-in times (src/sundown/location.js's
// fallbackSun()) — dawn 6:20, sunrise 6:50, noon 1:00 pm, sunset 8:10 pm,
// dusk 8:36 pm — exercised here as a plain events object, since
// fallbackSun() itself pulls in player/clock.js's/storage/meta.js's own
// wide import chains (drawSun()/queueSave(), reached transitively through
// solar.js/storage/meta.js) for no benefit to what's actually being
// checked: that dayPosition() handles this exact shape sensibly. The
// literal fallback times themselves are confirmed by direct reading of
// fallbackSun()'s own source, and by Playwright (denying location
// permission) in this PR's own browser verification.
test('dayPosition: the fallback stand-in times (no real location) behave like a normal day', () => {
  const d = new Date('2025-06-21T12:00:00Z');
  const at = (h, m) => { const x = new Date(d); x.setHours(h, m, 0, 0); return x; };
  const ev = { dawn: at(6, 20), rise: at(6, 50), noon: at(13, 0), set: at(20, 10), dusk: at(20, 36) };
  assert.equal(dayPosition(at(3, 0), ev).rateProgress, 1); // before dawn: still night
  assert.equal(dayPosition(at(12, 0), ev).rateProgress, 0); // midday: full speed
  assert.equal(dayPosition(at(23, 0), ev).rateProgress, 1); // after dusk: settled for the night
});

// Pure means untouched (F1) — unchanged by DA1, but worth confirming
// directly against dawn-phase data specifically, since that's new
// behavior F1's own existing solar.test.js coverage never exercised.
test('computeRate: Pure is always 1 during a dawn transition, whatever the pace', () => {
  const date = new Date('2025-06-21T12:00:00Z');
  const ev = dayEvents(date, COLUMBIA.lat, COLUMBIA.lon);
  S.mode = 'pure'; S.auto = true; S.target = 0.80; S.previewMin = 0;
  S.sun = { lat: COLUMBIA.lat, lon: COLUMBIA.lon, ok: true, ...ev };
  const mid = new Date((ev.dawn.getTime() + ev.rise.getTime()) / 2);
  S.previewMin = (mid.getTime() - Date.now()) / 60000;
  for(const pace of ['window', 'moment']){
    S.pace = pace;
    assert.equal(computeRate(), 1);
  }
});

// Window vs. Moment pacing on the dawn (rising) side — mirrors the
// existing dusk-side behavior: Window eases evenly across the whole
// window; Moment holds back near dawn (barely risen yet) and only
// catches up with a felt rise near the very end, close to sunrise.
test('easedProgress/computeRate: Moment holds back longer than Window during dawn, same as it does during twilight', () => {
  const date = new Date('2025-06-21T12:00:00Z');
  const ev = dayEvents(date, COLUMBIA.lat, COLUMBIA.lon);
  S.mode = 'vinyl'; S.auto = true; S.target = 0.80;
  S.sun = { lat: COLUMBIA.lat, lon: COLUMBIA.lon, ok: true, ...ev };
  // 30% of the way through the dawn window (still well before sunrise)
  const t = new Date(ev.dawn.getTime() + 0.3 * (ev.rise.getTime() - ev.dawn.getTime()));
  S.previewMin = (t.getTime() - Date.now()) / 60000;
  S.pace = 'window'; const windowRate = computeRate();
  S.pace = 'moment'; const momentRate = computeRate();
  // Moment hasn't started rising back toward full speed yet this early in
  // the window, so it's still much closer to the night-rate target than
  // Window already is.
  assert.ok(momentRate < windowRate, `expected moment (${momentRate}) still held back below window (${windowRate}) at 30% through dawn`);
  assert.ok(Math.abs(momentRate - S.target) < 0.01, 'moment should still read essentially the night rate this early in dawn');
});

test('easedProgress: twilight (dusk) pacing is unchanged from before DA1', () => {
  const now = Date.now();
  S.mode = 'vinyl'; S.auto = true; S.target = 0.80; S.previewMin = 0;
  S.sun = { lat: COLUMBIA.lat, lon: COLUMBIA.lon, ok: true, set: new Date(now - 10 * 60000), dusk: new Date(now + 10 * 60000) };
  S.pace = 'window';
  const p = sunProgress();
  assert.ok(Math.abs(p - 0.5) < 0.01);
  const e = easedProgress();
  assert.ok(Math.abs(e - 0.5) < 0.01); // smoothstep(0.5) = 0.5
});
