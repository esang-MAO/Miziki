import { test } from 'node:test';
import assert from 'node:assert/strict';
import { seasonTotalsForAlbum, recallLineFor } from '../../src/history/recall.js';

// LI4 (docs/35_LEAD_IN.md): the gatefold's one quiet "remembers" line.
// `now` is pinned to a fixed date so season-boundary math is deterministic
// across runs. Nov 9 falls in sundown/rhythm.js's `seasonKeyFor()`
// Northern-Hemisphere autumn (month index 8-10), so NOW's own season key
// is '2026-autumn' throughout these tests.
const NOW = Date.UTC(2026, 10, 9); // 2026-11-09

function dayKey(y, m, d){ return y + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0'); }

test('seasonTotalsForAlbum: sums one album across days, grouped by season, within the window', () => {
  const byDay = {
    [dayKey(2026, 8, 15)]: { albumA: 10, albumB: 99 },  // August -> summer
    [dayKey(2026, 1, 10)]: { albumA: 5 },                 // January -> winter, keyed '2025-winter'
    [dayKey(2026, 11, 1)]: { albumA: 2 },                 // November -> autumn (same season as NOW)
  };
  const { bySeasonKey, total } = seasonTotalsForAlbum(byDay, 'albumA', NOW, 400);
  assert.equal(total, 17);
  assert.deepEqual(bySeasonKey, { '2026-summer': 10, '2025-winter': 5, '2026-autumn': 2 });
});

test('seasonTotalsForAlbum: a day outside the window is dropped', () => {
  const byDay = {
    [dayKey(2024, 1, 1)]: { albumA: 50 },   // well over a year before NOW
    [dayKey(2026, 11, 1)]: { albumA: 3 },
  };
  const { total } = seasonTotalsForAlbum(byDay, 'albumA', NOW, 400);
  assert.equal(total, 3);
});

test('recallLineFor: nothing below the 5-play-in-window gate', () => {
  const byDay = { [dayKey(2026, 8, 1)]: { albumA: 4 } };
  assert.equal(recallLineFor(byDay, {}, 'albumA', NOW, false), null);
});

test('recallLineFor: "Spun a lot last [season]" when a past season holds >=40% of plays', () => {
  const byDay = {
    [dayKey(2026, 8, 15)]: { albumA: 10 },  // summer (past) -- 10/15 = 67%
    [dayKey(2026, 11, 1)]: { albumA: 5 },   // autumn (current season -- excluded as "the past season")
  };
  assert.equal(recallLineFor(byDay, {}, 'albumA', NOW, false), 'Spun a lot last summer');
});

test('recallLineFor: the current season is never picked as the "past" season', () => {
  const byDay = {
    [dayKey(2026, 11, 2)]: { albumA: 8 },   // autumn -- current, 8/10 = 80%, but excluded
    [dayKey(2026, 8, 1)]: { albumA: 2 },    // summer -- only 2/10 = 20%, not enough on its own
  };
  // No qualifying past season (>=40%) and no phase data -- nothing to say.
  assert.equal(recallLineFor(byDay, {}, 'albumA', NOW, false), null);
});

test('recallLineFor: falls through to "Mostly at [phase]" when no past season clears 40%', () => {
  const byDay = {
    [dayKey(2026, 8, 1)]: { albumA: 3 },    // summer
    [dayKey(2026, 1, 1)]: { albumA: 3 },    // winter
    [dayKey(2026, 11, 1)]: { albumA: 2 },   // autumn (current)
  };
  assert.equal(recallLineFor(byDay, { twilight: 6, morning: 1 }, 'albumA', NOW, false), 'Mostly at dusk');
});

test('recallLineFor: null when neither season nor phase clears its threshold', () => {
  const byDay = {
    [dayKey(2026, 8, 1)]: { albumA: 3 },
    [dayKey(2026, 1, 1)]: { albumA: 3 },
    [dayKey(2026, 11, 1)]: { albumA: 2 },
  };
  assert.equal(recallLineFor(byDay, { twilight: 2, morning: 2, midday: 1 }, 'albumA', NOW, false), null);
});

test('recallLineFor: skipPhase suppresses the phase branch, so a qualifying phase still yields null', () => {
  const byDay = { [dayKey(2026, 11, 1)]: { albumA: 6 } };
  assert.equal(recallLineFor(byDay, { twilight: 6 }, 'albumA', NOW, true), null);
});

test('recallLineFor: skipPhase has no effect on an already-qualifying season line', () => {
  const byDay = {
    [dayKey(2026, 8, 15)]: { albumA: 10 },
    [dayKey(2026, 11, 1)]: { albumA: 5 },
  };
  assert.equal(recallLineFor(byDay, { twilight: 100 }, 'albumA', NOW, true), 'Spun a lot last summer');
});
