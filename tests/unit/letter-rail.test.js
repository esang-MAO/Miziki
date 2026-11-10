import { test } from 'node:test';
import assert from 'node:assert/strict';
import { letterKeyFor, buildLetterGroups, buildFullAlphabet, buildRailTicks } from '../../src/ui/letter-rail.js';

// Pure, zero-import (letter-rail.js imports only util/dom.js's el(), which
// itself needs no mocking since these tests build real DOM elements via
// a tiny document stub) -- no mock.module chain to stop here.

test('letterKeyFor: first letter, uppercased', () => {
  assert.equal(letterKeyFor('abba'), 'A');
  assert.equal(letterKeyFor('Zeppelin'), 'Z');
});

test('letterKeyFor: anything that isn\'t a plain A-Z letter buckets under #', () => {
  assert.equal(letterKeyFor('3 Doors Down'), '#');
  assert.equal(letterKeyFor('Ünïcode'), '#');
  assert.equal(letterKeyFor(''), '#');
  assert.equal(letterKeyFor(null), '#');
});

test('buildLetterGroups: one entry per run of consecutive same-letter items', () => {
  const items = ['Abba', 'Air', 'Bowie', 'Beck', 'Blur', 'Coldplay'];
  const groups = buildLetterGroups(items, x => x);
  assert.deepEqual(groups.map(g => g.key), ['A', 'B', 'C']);
  groups.forEach(g => assert.equal(g.present, true));
});

test('buildLetterGroups: a repeated letter later in the (unsorted) list gets its own entry, not merged with the earlier run', () => {
  // this module never re-sorts -- it trusts the caller's own order, same
  // as every other "already sorted" assumption in this codebase
  const items = ['Abba', 'Bowie', 'Air'];
  const groups = buildLetterGroups(items, x => x);
  assert.deepEqual(groups.map(g => g.key), ['A', 'B', 'A']);
});

test('buildLetterGroups: empty input gives no groups', () => {
  assert.deepEqual(buildLetterGroups([], x => x), []);
});

// LB7 (docs/36A_LIBRARY_AND_LAUNCH.md decision 6): "always render A-Z plus
// #" -- buildFullAlphabet() spreads whatever present-only groups
// buildLetterGroups() returned across all 27 ticks, every absent one
// carrying a jumpKey to the nearest present one.
test('buildFullAlphabet: always 27 entries (A-Z plus #), in order', () => {
  const entries = buildFullAlphabet(buildLetterGroups(['Abba', 'Bowie'], x => x));
  assert.equal(entries.length, 27);
  assert.deepEqual(entries.map(e => e.key), [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ', '#']);
});

test('buildFullAlphabet: present letters keep present:true and jumpKey === own key', () => {
  const entries = buildFullAlphabet(buildLetterGroups(['Abba', 'Bowie'], x => x));
  const a = entries.find(e => e.key === 'A');
  const b = entries.find(e => e.key === 'B');
  assert.equal(a.present, true); assert.equal(a.jumpKey, 'A');
  assert.equal(b.present, true); assert.equal(b.jumpKey, 'B');
});

test('buildFullAlphabet: a dim letter jumps forward to the next present letter', () => {
  // no F/G, matching the real-world "F and G simply aren't there" case
  const entries = buildFullAlphabet(buildLetterGroups(['Ella', 'Harris'], x => x));
  const f = entries.find(e => e.key === 'F');
  const g = entries.find(e => e.key === 'G');
  assert.equal(f.present, false); assert.equal(f.jumpKey, 'H');
  assert.equal(g.present, false); assert.equal(g.jumpKey, 'H');
});

test('buildFullAlphabet: a dim letter after the last present one falls back to the nearest behind it', () => {
  const entries = buildFullAlphabet(buildLetterGroups(['Young'], x => x));
  const z = entries.find(e => e.key === 'Z');
  const hash = entries.find(e => e.key === '#');
  assert.equal(z.jumpKey, 'Y');
  assert.equal(hash.jumpKey, 'Y');
});

test('buildFullAlphabet: a completely empty library has every letter dim with no jump target', () => {
  const entries = buildFullAlphabet([]);
  entries.forEach(e => { assert.equal(e.present, false); assert.equal(e.jumpKey, null); });
});

// A minimal DOM stub, just capable enough for buildRailTicks: appendChild,
// a fixed-height rect, innerHTML reset, and real click/pointerdown
// listeners so a test can fire them.
function fakeRail(height){
  const kids = [];
  const listeners = {};
  return {
    children: kids,
    get innerHTML(){ return kids.length ? '<x>' : ''; },
    set innerHTML(v){ if(v === '') kids.length = 0; },
    appendChild(child){ kids.push(child); return child; },
    getBoundingClientRect(){ return { height }; },
    addEventListener(type, fn){ listeners[type] = fn; },
    fire(type, ev){ if(listeners[type]) listeners[type](ev || {}); },
  };
}
function fakeButton(){
  const classes = new Set();
  const listeners = {};
  return {
    tagName: 'BUTTON', textContent: '', style: {}, disabled: false,
    classList: {
      add(...cs){ cs.forEach(c => classes.add(c)); },
      contains(c){ return classes.has(c); },
    },
    addEventListener(type, fn){ listeners[type] = fn; },
    fire(type, ev){ if(listeners[type]) listeners[type](ev || { stopPropagation(){} }); },
  };
}

test('buildRailTicks: one tick per entry, spread across the rail\'s measured height', () => {
  const origCreateElement = globalThis.document && globalThis.document.createElement;
  globalThis.document = { createElement(){ return fakeButton(); } };
  try{
    const rail = fakeRail(100);
    const entries = [{key:'A', label:'A', present:true}, {key:'B', label:'B', present:false}, {key:'C', label:'C', present:true}];
    buildRailTicks(rail, entries, {});
    assert.equal(rail.children.length, 3);
    assert.equal(rail.children[0].style.top, '0px');
    assert.equal(rail.children[2].style.top, '80px'); // (2/2) * (100-20)
    assert.equal(rail.children[1].disabled, true);
    assert.equal(rail.children[0].disabled, false);
  } finally {
    if(origCreateElement) globalThis.document.createElement = origCreateElement;
    else delete globalThis.document;
  }
});

test('buildRailTicks: tapping a present tick calls onTap with that entry; a plain dim (absent, no jumpKey) tick has no listener at all', () => {
  globalThis.document = { createElement(){ return fakeButton(); } };
  try{
    const rail = fakeRail(60);
    // no jumpKey here -- e.g. crate/model.js's own railEntries, which
    // never opted into LB7's "dim still jumps" behavior.
    const entries = [{key:'A', label:'A', present:true}, {key:'B', label:'B', present:false}];
    let tapped = null;
    buildRailTicks(rail, entries, { onTap: e_ => { tapped = e_; } });
    rail.children[0].fire('click');
    assert.equal(tapped.key, 'A');
    rail.children[1].fire('click'); // no listener was attached for a dim tick -- a no-op, not a throw
    assert.equal(tapped.key, 'A');
    assert.equal(rail.children[1].disabled, true);
  } finally {
    delete globalThis.document;
  }
});

// LB7 (decision 6): "jump to the next letter that has entries" -- a dim
// entry that carries its own jumpKey (buildFullAlphabet() above) is a
// real, enabled, tappable tick instead.
test('buildRailTicks: a dim tick with a jumpKey stays enabled and calls onTap, same as a present one', () => {
  globalThis.document = { createElement(){ return fakeButton(); } };
  try{
    const rail = fakeRail(60);
    const entries = [
      {key:'A', label:'A', present:true, jumpKey:'A'},
      {key:'B', label:'B', present:false, jumpKey:'C'},
      {key:'C', label:'C', present:true, jumpKey:'C'},
    ];
    let tapped = null;
    buildRailTicks(rail, entries, { onTap: e_ => { tapped = e_; } });
    assert.equal(rail.children[1].disabled, false);
    rail.children[1].fire('click');
    assert.equal(tapped.key, 'B');
    assert.equal(tapped.jumpKey, 'C');
  } finally {
    delete globalThis.document;
  }
});

test('buildRailTicks: isCurrent marks the matching tick with the current class', () => {
  globalThis.document = { createElement(){ return fakeButton(); } };
  try{
    const rail = fakeRail(60);
    const entries = [{key:'A', label:'A', present:true}, {key:'B', label:'B', present:true}];
    buildRailTicks(rail, entries, { isCurrent: e_ => e_.key === 'B' });
    assert.equal(rail.children[0].classList.contains('letter-rail-current'), false);
    assert.equal(rail.children[1].classList.contains('letter-rail-current'), true);
  } finally {
    delete globalThis.document;
  }
});

test('buildRailTicks: no entries is a no-op (clears, appends nothing)', () => {
  globalThis.document = { createElement(){ return fakeButton(); } };
  try{
    const rail = fakeRail(60);
    buildRailTicks(rail, [], {});
    assert.equal(rail.children.length, 0);
  } finally {
    delete globalThis.document;
  }
});
