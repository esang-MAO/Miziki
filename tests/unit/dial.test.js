import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dayEvents } from '../../src/sundown/day.js';
import { angleDegAt, nextEventText, dialStateAt } from '../../src/sundown/dial.js';

// src/sundown/dial.js has no DOM/`S`-mutating top level — no mocking
// needed, same precedent as arc.test.js/day.test.js/solar.test.js.

const COLUMBIA = { lat: 39.20, lon: -76.86 };
const DATE = new Date('2025-03-20T12:00:00Z');
const SUN = dayEvents(DATE, COLUMBIA.lat, COLUMBIA.lon);
const settings = (over = {}) => ({ mode: 'vinyl', auto: true, target: 0.85, paceMode: 'window', ...over });

test('angleDegAt: 0 at noon (top), 90 at 18:00, 180 at midnight, wraps for the early morning', () => {
  assert.equal(angleDegAt(new Date('2025-01-01T12:00:00')), 0);
  assert.equal(angleDegAt(new Date('2025-01-01T18:00:00')), 90);
  assert.ok(Math.abs(angleDegAt(new Date('2025-01-01T23:59:59')) - 180) < 0.01);
  // 6:00 AM -> minutesOfDay 360 -> 360/1440*360-180 = -90 -> wraps to 270
  assert.equal(angleDegAt(new Date('2025-01-01T06:00:00')), 270);
});

test('nextEventText: counts up to whichever of sunrise/sunset is next, wrapping past midnight when both have already happened today', () => {
  const beforeRise = new Date(SUN.rise.getTime() - 30 * 60000);
  const toRise = nextEventText(beforeRise, SUN);
  assert.equal(toRise.label, 'SUNRISE');
  assert.equal(toRise.text, 'IN 30 MIN');

  const beforeSet = new Date(SUN.set.getTime() - 14 * 60000);
  const toSet = nextEventText(beforeSet, SUN);
  assert.equal(toSet.label, 'SUNSET');
  assert.equal(toSet.text, 'IN 14 MIN');

  // under an hour -> "N MIN"; an hour or more -> "NH NM"
  const hoursBeforeSet = new Date(SUN.set.getTime() - (5 * 3600000 + 42 * 60000));
  const far = nextEventText(hoursBeforeSet, SUN);
  assert.equal(far.label, 'SUNSET');
  assert.equal(far.text, 'IN 5H 42M');

  // well after both today's sunrise and sunset -> wraps to tomorrow's sunrise
  const lateNight = new Date(SUN.set.getTime() + 5 * 3600000);
  const afterBoth = nextEventText(lateNight, SUN);
  assert.equal(afterBoth.label, 'SUNRISE');
});

test('nextEventText: no usable sun returns null rather than a bogus countdown', () => {
  assert.equal(nextEventText(new Date(), {}), null);
  assert.equal(nextEventText(new Date(), null), null);
});

test('nextEventText: "Preview the day" can push `now` more than 24h past a transit (S.previewMin maxes at 1440) — must never read "IN 0 MIN" for an event that is actually hours away', () => {
  // 23h50m past today's sunrise: a single +24h still lands 10 minutes
  // *before* `now`, so nextOccurrence must keep adding a day, not stop
  // after one — regression test for the bug this exact shape produced.
  const farPastRise = new Date(SUN.rise.getTime() + 23 * 3600000 + 50 * 60000);
  const toRise = nextEventText(farPastRise, SUN);
  assert.equal(toRise.label, 'SUNRISE');
  assert.equal(toRise.text, 'IN 10 MIN');
});

test('dialStateAt: assembles the Pre-dawn state from §5\'s own table (platter rising, tone warm, phase still night)', () => {
  const t = new Date(SUN.rise.getTime() - 56 * 60000); // recovery started at rise-2h; sample ~1h04m before rise
  const st = dialStateAt(t, SUN, settings({ recoveryWindowMs: 2 * 3600000 }));
  assert.equal(st.phase, 'night');
  assert.equal(st.phaseLabel, 'NIGHT');
  assert.equal(st.trend, 'Rising');
  assert.ok(st.platterPct > 85 && st.platterPct < 100, `platter ${st.platterPct}% is rising, between floor and full`);
});

test('dialStateAt: midday matches §5\'s own Midday row (100%, Full speed, BRIGHT, AZURE)', () => {
  const st = dialStateAt(SUN.noon, SUN, settings());
  assert.equal(st.phase, 'day');
  assert.equal(st.platterPct, 100);
  assert.equal(st.trend, 'Full speed');
  assert.equal(st.tone, 'BRIGHT');
  assert.equal(st.paletteName, 'AZURE');
});

test('dialStateAt: night matches §5\'s own Night row (floor, Slowest, WARM, INDIGO)', () => {
  const t = new Date(SUN.set.getTime() + 6 * 3600000);
  const st = dialStateAt(t, SUN, settings());
  assert.equal(st.phase, 'night');
  assert.equal(st.platterPct, 85);
  assert.equal(st.trend, 'Slowest');
  assert.equal(st.tone, 'WARM');
  assert.equal(st.paletteName, 'INDIGO');
});

test('dialStateAt: carries sunrise/sunset labels and ring/sky stops straight from arc.js, with no usable sun falling back cleanly', () => {
  const st = dialStateAt(SUN.noon, SUN, settings());
  assert.ok(/^\d{1,2}:\d{2}[AP]$/.test(st.sunriseLabel));
  assert.ok(Array.isArray(st.ringStops) && st.ringStops.length > 0);
  assert.ok(Array.isArray(st.skyStops) && st.skyStops.length > 0);

  const noData = dialStateAt(new Date(), {}, settings());
  assert.equal(noData.sunriseLabel, '—');
  assert.equal(noData.nextEvent, null);
  assert.deepEqual(noData.ringStops, []);
});
