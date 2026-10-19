import { test } from 'node:test';
import assert from 'node:assert/strict';
import { letterKeyFor, buildLetterGroups, buildRailTicks } from '../../src/ui/letter-rail.js';

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

test('buildRailTicks: tapping a present tick calls onTap with that entry; a dim (absent) tick has no listener at all', () => {
  globalThis.document = { createElement(){ return fakeButton(); } };
  try{
    const rail = fakeRail(60);
    const entries = [{key:'A', label:'A', present:true}, {key:'B', label:'B', present:false}];
    let tapped = null;
    buildRailTicks(rail, entries, { onTap: e_ => { tapped = e_; } });
    rail.children[0].fire('click');
    assert.equal(tapped.key, 'A');
    rail.children[1].fire('click'); // no listener was attached for a dim tick -- a no-op, not a throw
    assert.equal(tapped.key, 'A');
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
