import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

// src/profile/rhythm-card.js builds small DOM trees (el()/
// document.createElement) around the pure src/sundown/rhythm.js helpers,
// read against S.phasePlayCounts/S.albumPhaseCounts/S.albumDisplay — the
// same "tiny stub element, no real document" shape tests/unit/profile.test.js
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
const { renderRhythmCard, renderSharedRhythmCard } = await import('../../src/profile/rhythm-card.js');

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
  S.albumPhaseCounts = {};
  S.albumDisplay = {};
}

test('below the 20-play gate renders the locked card, not the ring', () => {
  reset();
  S.phasePlayCounts = { night: 12 };
  const host = fakeEl();
  renderRhythmCard(host);
  const locked = findAll(host, 'rhythm-locked');
  assert.equal(locked.length, 1);
  assert.equal(findAll(host, 'rhythm-ring').length, 0);
  const note = findAll(host, 'note')[0];
  assert.ok(note.textContent.includes('12 of 20 plays'), note.textContent);
});

test('exactly at the gate (20) unlocks the full card', () => {
  reset();
  S.phasePlayCounts = { night: 20 };
  const host = fakeEl();
  renderRhythmCard(host);
  assert.equal(findAll(host, 'rhythm-locked').length, 0);
  assert.equal(findAll(host, 'rhythm-ring').length, 1);
});

test('the legend has one row per phase with a nonzero share, and the ring centre shows the total', () => {
  reset();
  S.phasePlayCounts = { night: 15, morning: 10 };   // total 25, two nonzero phases
  const host = fakeEl();
  renderRhythmCard(host);
  assert.equal(findAll(host, 'rhythm-legend-row').length, 2);
  const pcts = findAll(host, 'rhythm-legend-pct').map(e => e.textContent).sort();
  assert.deepEqual(pcts, ['40%', '60%']);
  const center = findAll(host, 'rhythm-ring-center')[0];
  assert.equal(center.childNodes[0].textContent, '25');
  assert.equal(center.childNodes[1].textContent, 'plays');
});

test('the verdict reflects the dominant phase', () => {
  reset();
  S.phasePlayCounts = { golden: 30 };
  const host = fakeEl();
  renderRhythmCard(host);
  assert.equal(findAll(host, 'rhythm-verdict')[0].textContent, 'Golden-hour leaning');
});

test('a record row renders only for phases with a resolvable best album, using S.albumDisplay', () => {
  reset();
  S.phasePlayCounts = { night: 15, dawn: 10 };   // 25 total -- past the gate
  S.albumPhaseCounts = { alb1: { night: 5 }, alb2: { dawn: 3 } };
  S.albumDisplay = { alb1: { name: 'Night Album', artist: 'Band A', art: null }, alb2: { name: 'Dawn Album', artist: '', art: null } };
  const host = fakeEl();
  renderRhythmCard(host);
  const rows = findAll(host, 'rhythm-record-row');
  assert.equal(rows.length, 2);   // one per phase that actually has a best album
  const texts = rows.map(r => r.childNodes[1].childNodes[1].textContent).sort();
  assert.deepEqual(texts, ['Dawn Album', 'Night Album — Band A']);
});

test('no plays at all for any album is simply no record rows -- not a crash', () => {
  reset();
  S.phasePlayCounts = { night: 25 };
  // S.albumPhaseCounts left empty
  const host = fakeEl();
  renderRhythmCard(host);
  assert.equal(findAll(host, 'rhythm-record-row').length, 0);
  assert.equal(findAll(host, 'rhythm-records').length, 0);
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

test('never reads S.phasePlayCounts/S.albumPhaseCounts -- it only uses what it was handed', () => {
  reset();
  S.phasePlayCounts = { night: 999 };   // this device's own data, irrelevant here
  const host = fakeEl();
  renderSharedRhythmCard(host, { verdict: 'Golden-hour leaning', shares: { golden: 1 } });
  assert.equal(findAll(host, 'rhythm-verdict')[0].textContent, 'Golden-hour leaning');
  assert.equal(findAll(host, 'rhythm-legend-row').length, 1);
});
