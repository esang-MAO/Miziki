import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

// src/profile/rhythm-card.js builds small DOM trees (el()/
// document.createElement) around the pure src/sundown/rhythm.js helpers,
// read against S.phasePlayCountsByDay (windowed to a rolling season,
// RF22)/S.albumPhaseCounts (still lifetime)/S.albumDisplay — the same
// "tiny stub element, no real document" shape tests/unit/profile.test.js
// already uses for metalBadge/collectionBadge.
function fakeEl(){
  const children = [];
  return {
    className: '', textContent: '', style: {}, src: '', alt: '',
    appendChild(child){ children.push(child); return child; },
    get childNodes(){ return children; },
  };
}
mock.module(new URL('../../src/util/dom.js', import.meta.url).href, {
  namedExports: {
    el(tag, cls, text){ const e = fakeEl(); if(cls) e.className = cls; if(text !== undefined) e.textContent = text; return e; },
    $(){ return fakeEl(); },
  },
});
globalThis.document = { createElement(){ return fakeEl(); } };

const { S } = await import('../../src/state.js');
const { renderRhythmCard, renderSharedRhythmCard, renderBestPerPhaseList } = await import('../../src/profile/rhythm-card.js');
const { dayKeyFor, seasonAtOffset } = await import('../../src/sundown/rhythm.js');

// RF22 (docs/12_REFINE.md, "words that invite", point 3): renderRhythmCard
// now reads a rolling window over S.phasePlayCountsByDay rather than the
// lifetime S.phasePlayCounts — every test below seeds "today's" bucket
// instead, so the windowing itself (already covered on its own in
// tests/unit/rhythm.test.js) isn't what's under test here.
const TODAY = dayKeyFor(Date.now());
function seedToday(counts){ S.phasePlayCountsByDay = { [TODAY]: counts }; }

// find every descendant (DFS) whose className contains `cls`
function findAll(root, cls){
  const out = [];
  (function walk(node){
    if(!node || !node.childNodes) return;
    node.childNodes.forEach(c => {
      if(c.className && c.className.split(' ').includes(cls)) out.push(c);
      walk(c);
    });
  })(root);
  return out;
}

function reset(){
  S.phasePlayCounts = {};
  S.phasePlayCountsByDay = {};
  S.albumPhaseCounts = {};
  S.albumDisplay = {};
  S.seasonSummaries = {};
}

// QC3 (docs/24_QUIET_COUNTS.md): below the gate, nothing is drawn at all
// -- no locked card, no "N of 20 plays" progress line.
test('below the 20-play gate renders nothing at all -- no locked card, no ring', () => {
  reset();
  seedToday({ night: 12 });
  const host = fakeEl();
  renderRhythmCard(host);
  assert.equal(host.childNodes.length, 0);
  assert.equal(findAll(host, 'rhythm-ring').length, 0);
});

test('exactly at the gate (20) renders the full card', () => {
  reset();
  seedToday({ night: 20 });
  const host = fakeEl();
  renderRhythmCard(host);
  assert.equal(findAll(host, 'rhythm-ring').length, 1);
});

test('the legend has one row per phase with a nonzero share, and the ring centre shows the total', () => {
  reset();
  seedToday({ night: 15, morning: 10 });   // total 25, two nonzero phases
  const host = fakeEl();
  renderRhythmCard(host);
  assert.equal(findAll(host, 'rhythm-legend-row').length, 2);
  const pcts = findAll(host, 'rhythm-legend-pct').map(e => e.textContent).sort();
  assert.deepEqual(pcts, ['40%', '60%']);
  const center = findAll(host, 'rhythm-ring-center')[0];
  assert.equal(center.childNodes[0].textContent, '25');
  assert.equal(center.childNodes[1].textContent, 'plays');
});

test('the verdict reflects the dominant phase, in RF22\'s "a season" phrasing', () => {
  reset();
  seedToday({ golden: 30 });
  const host = fakeEl();
  renderRhythmCard(host);
  assert.equal(findAll(host, 'rhythm-verdict')[0].textContent, 'Lately, leaning golden hour');
});

test('a play outside the 90-day window is not counted -- a stale season renders nothing again', () => {
  reset();
  const stale = dayKeyFor(new Date(Date.now() - 200 * 24 * 60 * 60 * 1000));
  S.phasePlayCountsByDay = { [stale]: { night: 30 } };
  const host = fakeEl();
  renderRhythmCard(host);
  assert.equal(host.childNodes.length, 0);
  assert.equal(findAll(host, 'rhythm-ring').length, 0);
});

// GS9 (docs/30_GROOVES_AND_SHELF.md point 3): the per-phase "best record"
// list moved out of renderRhythmCard() itself into its own function,
// shown separately ("below a divider, not season-scoped") on the
// Listening screen -- these two tests now target that function directly.
test('renderBestPerPhaseList: a record row renders only for phases with a resolvable best album, using S.albumDisplay', () => {
  reset();
  // bestAlbumPerPhase() still reads lifetime S.albumPhaseCounts, never
  // windowed/season-scoped -- see this file's own header comment for why.
  S.albumPhaseCounts = { alb1: { night: 5 }, alb2: { dawn: 3 } };
  S.albumDisplay = { alb1: { name: 'Night Album', artist: 'Band A', art: null }, alb2: { name: 'Dawn Album', artist: '', art: null } };
  const host = fakeEl();
  const shown = renderBestPerPhaseList(host);
  assert.equal(shown, true);
  const rows = findAll(host, 'rhythm-record-row');
  assert.equal(rows.length, 2);   // one per phase that actually has a best album
  const texts = rows.map(r => r.childNodes[1].childNodes[1].textContent).sort();
  assert.deepEqual(texts, ['Dawn Album', 'Night Album — Band A']);
});

test('renderBestPerPhaseList: no plays at all for any album returns false and renders nothing -- not a crash', () => {
  reset();
  // S.albumPhaseCounts left empty
  const host = fakeEl();
  const shown = renderBestPerPhaseList(host);
  assert.equal(shown, false);
  assert.equal(findAll(host, 'rhythm-record-row').length, 0);
  assert.equal(findAll(host, 'rhythm-records').length, 0);
});

test('renderRhythmCard no longer renders any record row itself -- that moved to renderBestPerPhaseList', () => {
  reset();
  seedToday({ night: 25 });
  S.albumPhaseCounts = { alb1: { night: 5 } };
  S.albumDisplay = { alb1: { name: 'Night Album', artist: '', art: null } };
  const host = fakeEl();
  renderRhythmCard(host);
  assert.equal(findAll(host, 'rhythm-record-row').length, 0);
  assert.equal(findAll(host, 'rhythm-records').length, 0);
});

// ================= renderRhythmCard with a nonzero offset (GS9, docs/30_GROOVES_AND_SHELF.md point 1-2) =================
test('offset reads a past calendar season from day buckets still in range', () => {
  reset();
  const season = seasonAtOffset(Date.now(), 1);   // the one calendar season before this one
  const midSeason = dayKeyFor(season.startMs + 24 * 60 * 60 * 1000);
  S.phasePlayCountsByDay = { [midSeason]: { golden: 25 } };
  const host = fakeEl();
  renderRhythmCard(host, -1);
  assert.equal(findAll(host, 'rhythm-ring').length, 1);
  assert.equal(findAll(host, 'rhythm-verdict')[0].textContent, 'Lately, leaning golden hour');
});

test('offset also reads an already-folded S.seasonSummaries entry, merged with any remaining day buckets', () => {
  reset();
  const season = seasonAtOffset(Date.now(), 1);
  S.seasonSummaries = { [season.key]: { phases: { night: 18 } } };
  const midSeason = dayKeyFor(season.startMs + 24 * 60 * 60 * 1000);
  S.phasePlayCountsByDay = { [midSeason]: { night: 4 } };   // 18 + 4 = 22, past the gate
  const host = fakeEl();
  renderRhythmCard(host, -1);
  assert.equal(findAll(host, 'rhythm-ring').length, 1);
  const center = findAll(host, 'rhythm-ring-center')[0];
  assert.equal(center.childNodes[0].textContent, '22');
});

test('a day bucket outside the requested season is not counted', () => {
  reset();
  const season = seasonAtOffset(Date.now(), 1);
  S.phasePlayCountsByDay = { [dayKeyFor(Date.now())]: { night: 99 } };   // this season, not the one asked for
  const host = fakeEl();
  renderRhythmCard(host, -1);
  assert.equal(host.childNodes.length, 0, 'a different season\'s own plays never leak into this one; ' + season.key + ' stays empty');
});

// ================= renderSharedRhythmCard (a friend's own shared snapshot) =================
test('renders the ring, legend and verdict straight from the given payload -- no gate, no play count, no record rows', () => {
  const host = fakeEl();
  renderSharedRhythmCard(host, { verdict: 'A morning listener', shares: { morning: 0.75, night: 0.25 } });
  assert.equal(findAll(host, 'rhythm-ring').length, 1);
  assert.equal(findAll(host, 'rhythm-legend-row').length, 2);
  assert.equal(findAll(host, 'rhythm-verdict')[0].textContent, 'A morning listener');
  // no raw play count anywhere -- the shared payload never carries one
  assert.equal(findAll(host, 'rhythm-ring-center')[0].childNodes[0].textContent, '♪');
  assert.equal(findAll(host, 'rhythm-locked').length, 0);
  assert.equal(findAll(host, 'rhythm-records').length, 0, 'the shared payload never carries a per-phase record list');
});

test('never reads S.phasePlayCounts/S.phasePlayCountsByDay/S.albumPhaseCounts -- it only uses what it was handed', () => {
  reset();
  seedToday({ night: 999 });   // this device's own data, irrelevant here
  const host = fakeEl();
  renderSharedRhythmCard(host, { verdict: 'Golden-hour leaning', shares: { golden: 1 } });
  assert.equal(findAll(host, 'rhythm-verdict')[0].textContent, 'Golden-hour leaning');
  assert.equal(findAll(host, 'rhythm-legend-row').length, 1);
});
