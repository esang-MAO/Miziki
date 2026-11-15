// CC4 (docs/34_CARE_AND_CONTROL.md): guards Miziki's "every turntable
// stays earnable without Deluxe" rule in code, with no UI to click
// through. Two checks:
//   1. every non-Standard model in TURNTABLE_LINEUP has a real
//      `markTurntableFound('id', ...)` call somewhere in src/history --
//      scanned from source text, not a hand-maintained duplicate list,
//      so a newly-added model with no earning path fails this test
//      automatically instead of silently shipping purchase-only.
//   2. every earning threshold constant matches a frozen snapshot
//      (earning-thresholds.snap.json) -- changing one fails CI until the
//      snapshot is updated on purpose, so tightening a threshold after
//      release is a deliberate, reviewable act, not a quiet edit.
//
// Known gap, not this test's job to fix: Upright and Horn have no
// earning rule yet (ST4, docs/32_SHELF_AND_TURNTABLES.md -- Upright
// needs a local pin-start timestamp, not verified in a reusable shape;
// Horn waits on the 78rpm format). Suitcase itself was removed outright
// by BD8 (docs/38_BEFORE_THE_DOMAIN.md) -- its earning rule leaned on
// the held-for-you social feature that step also removes, so there's no
// gap left to close for it. They're excluded here by name, not papered
// over -- closing either remaining gap means deleting it from
// KNOWN_UNEARNABLE, which makes this test start enforcing it too.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { TURNTABLE_LINEUP } from '../../src/profile/turntable.js';

// sessions.js can't be imported directly under the Node test runner --
// its own import chain (library/model.js / record-art/looks.js /
// library/thumbs.js) eventually reaches ui/wordmark.js's Vite-only
// `?raw` SVG import, same reason every other test touching sessions.js
// mocks it rather than importing it for real (booklet/controls/edit/
// looks/platter-size/transport-interruption .test.js). Reading the
// source as text and scanning it is this file's own way around that,
// not a style choice -- it also means these checks reflect the code as
// actually written, not a hand-maintained list that can drift from it.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SESSIONS_SRC = readFileSync(path.join(__dirname, '..', '..', 'src', 'history', 'sessions.js'), 'utf8');

const KNOWN_UNEARNABLE = new Set(['upright', 'horn']);

function idsWithAnEarningRule(){
  const ids = new Set();
  for(const m of SESSIONS_SRC.matchAll(/markTurntableFound\(\s*'([a-z]+)'/g)) ids.add(m[1]);
  return ids;
}

function exportedNumberConstants(){
  const out = {};
  for(const m of SESSIONS_SRC.matchAll(/export const ([A-Z_]+)\s*=\s*(-?\d+(?:\.\d+)?)\s*;/g)) out[m[1]] = Number(m[2]);
  return out;
}

test('every non-Standard, non-deferred turntable has a markTurntableFound() call', () => {
  const earned = idsWithAnEarningRule();
  const missing = TURNTABLE_LINEUP
    .map(m => m.id)
    .filter(id => id !== 'standard' && !KNOWN_UNEARNABLE.has(id) && !earned.has(id));
  assert.deepEqual(missing, [], 'turntable(s) with no earning rule and not flagged as a known gap: ' + missing.join(', '));
});

test('KNOWN_UNEARNABLE only names ids that are real, non-Deluxe lineup entries', () => {
  const byId = Object.fromEntries(TURNTABLE_LINEUP.map(m => [m.id, m]));
  for(const id of KNOWN_UNEARNABLE){
    assert.ok(byId[id], id + ' is not in TURNTABLE_LINEUP');
    assert.equal(byId[id].deluxe, false, id + ' is Deluxe-gated, so it is not actually unearnable -- remove it from KNOWN_UNEARNABLE');
  }
});

test('earning thresholds match the frozen snapshot', () => {
  const snapshot = JSON.parse(readFileSync(path.join(__dirname, 'earning-thresholds.snap.json'), 'utf8'));
  const exported = exportedNumberConstants();
  const actual = {};
  for(const key of Object.keys(snapshot)) actual[key] = exported[key];
  assert.deepEqual(actual, snapshot, 'an earning threshold changed -- update earning-thresholds.snap.json only if the change is deliberate');
});
