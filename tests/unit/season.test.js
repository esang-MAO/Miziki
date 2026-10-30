import { test } from 'node:test';
import assert from 'node:assert/strict';
import { seasonTint } from '../../src/sundown/season.js';

// RW6 (docs/23_RHYTHM_AND_WEAR.md): seasonTint(date, lat) -- weights sum
// to 1, continuous across the year, hemisphere flip, peaks at the named
// date. No location (lat null/undefined) is northern, per the plan.

test('seasonTint: weights always sum to 1', () => {
  for(const m of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]){
    const w = seasonTint(new Date(Date.UTC(2026, m, 15)), null);
    const sum = w.spring + w.summer + w.autumn + w.winter;
    assert.ok(Math.abs(sum - 1) < 1e-9, `month ${m}: sum ${sum}`);
  }
});

test('seasonTint: each season peaks (weight 1, the rest 0) on its own named date, northern', () => {
  const spring = seasonTint(new Date(Date.UTC(2026, 3, 20)), null);
  assert.ok(spring.spring > 0.999, JSON.stringify(spring));
  const summer = seasonTint(new Date(Date.UTC(2026, 6, 20)), null);
  assert.ok(summer.summer > 0.999, JSON.stringify(summer));
  const autumn = seasonTint(new Date(Date.UTC(2026, 9, 20)), null);
  assert.ok(autumn.autumn > 0.999, JSON.stringify(autumn));
  const winter = seasonTint(new Date(Date.UTC(2026, 0, 20)), null);
  assert.ok(winter.winter > 0.999, JSON.stringify(winter));
});

test('seasonTint: no location defaults to northern', () => {
  const withNull = seasonTint(new Date(Date.UTC(2026, 3, 20)), null);
  const withUndefined = seasonTint(new Date(Date.UTC(2026, 3, 20)), undefined);
  const northern = seasonTint(new Date(Date.UTC(2026, 3, 20)), 39);
  assert.deepEqual(withNull, northern);
  assert.deepEqual(withUndefined, northern);
});

test('seasonTint: southern latitude swaps spring/autumn and summer/winter', () => {
  const date = new Date(Date.UTC(2026, 3, 20)); // Apr 20 -- northern spring peak
  const northern = seasonTint(date, 39);   // e.g. Washington DC
  const southern = seasonTint(date, -34);  // e.g. Buenos Aires
  assert.ok(southern.autumn > 0.999, JSON.stringify(southern));
  assert.equal(southern.spring, northern.autumn);
  assert.equal(southern.autumn, northern.spring);
  assert.equal(southern.summer, northern.winter);
  assert.equal(southern.winter, northern.summer);
});

test('seasonTint: continuous day to day, no jump across a season boundary', () => {
  let prev = seasonTint(new Date(Date.UTC(2026, 0, 1)), null);
  for(let d = 2; d <= 365; d++){
    const date = new Date(Date.UTC(2026, 0, d));
    const cur = seasonTint(date, null);
    for(const season of ['spring', 'summer', 'autumn', 'winter']){
      assert.ok(Math.abs(cur[season] - prev[season]) < 0.03, `day ${d} ${season}: jumped from ${prev[season]} to ${cur[season]}`);
    }
    prev = cur;
  }
});

test('seasonTint: wraps continuously from Dec 31 back to Jan 1 (no year-boundary jump)', () => {
  const dec31 = seasonTint(new Date(Date.UTC(2025, 11, 31)), null);
  const jan1 = seasonTint(new Date(Date.UTC(2026, 0, 1)), null);
  for(const season of ['spring', 'summer', 'autumn', 'winter']){
    assert.ok(Math.abs(dec31[season] - jan1[season]) < 0.03, `${season}: dec31 ${dec31[season]} vs jan1 ${jan1[season]}`);
  }
});
