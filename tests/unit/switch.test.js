// FS3 (docs/25_FROM_SCRATCH.md): makeSwitch() is the one switch component
// for the whole app. It's a real <button type="button">, so Space/Enter
// toggling is the browser's own native button semantics -- nothing in
// makeSwitch wires or could break that, so there's no fake-DOM test for
// it; what these tests cover is the behavior makeSwitch actually adds:
// aria-checked tracking state, and the row-wide tap target.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeSwitch } from '../../src/ui/switch.js';

// A tiny DOM stub, just capable enough for makeSwitch: attributes,
// classList, appendChild/contains, and real addEventListener/click
// dispatch so a test can fire them -- same shape as the fakeButton()
// helper tests/unit/letter-rail.test.js already uses for this kind of
// hand-built-DOM test.
function fakeEl(){
  const attrs = {};
  const listeners = {};
  const classes = new Set();
  const kids = [];
  return {
    tagName: 'BUTTON', type: '', className: '',
    children: kids,
    setAttribute(k, v){ attrs[k] = String(v); },
    getAttribute(k){ return attrs[k]; },
    appendChild(c){ kids.push(c); return c; },
    contains(el){ return kids.includes(el); },
    classList: {
      add(...cs){ cs.forEach(c => classes.add(c)); },
      contains(c){ return classes.has(c); },
    },
    addEventListener(type, fn){ (listeners[type] = listeners[type] || []).push(fn); },
    fire(type, ev){ (listeners[type] || []).forEach(fn => fn(ev || {})); },
  };
}

function withFakeDocument(fn){
  const orig = globalThis.document;
  globalThis.document = { createElement(){ return fakeEl(); } };
  try{ fn(); } finally {
    if(orig) globalThis.document = orig; else delete globalThis.document;
  }
}

test('makeSwitch: aria-checked starts at the given state and flips on click, calling onChange with the new value', () => {
  withFakeDocument(() => {
    let last = null;
    const sw = makeSwitch({checked: false, label: 'Scratch', onChange: on => { last = on; }});
    assert.equal(sw.getAttribute('aria-checked'), 'false');
    assert.equal(sw.getAttribute('role'), 'switch');
    assert.equal(sw.getAttribute('aria-label'), 'Scratch');
    sw.fire('click');
    assert.equal(sw.getAttribute('aria-checked'), 'true');
    assert.equal(last, true);
    sw.fire('click');
    assert.equal(sw.getAttribute('aria-checked'), 'false');
    assert.equal(last, false);
  });
});

test('makeSwitch: with a row passed, tapping the row (not the switch itself) also toggles it', () => {
  withFakeDocument(() => {
    let calls = 0;
    const row = fakeEl();
    const sw = makeSwitch({checked: false, label: 'Larger text', onChange: () => { calls++; }, row});
    assert.equal(row.classList.contains('switch-row'), true);
    row.fire('click', {target: row});
    assert.equal(sw.getAttribute('aria-checked'), 'true');
    assert.equal(calls, 1);
  });
});

test('makeSwitch: with a row passed, a click that lands on the switch itself does not double-toggle', () => {
  withFakeDocument(() => {
    let calls = 0;
    const row = fakeEl();
    const sw = makeSwitch({checked: false, label: 'Show wear', onChange: () => { calls++; }, row});
    sw.fire('click'); // the switch's own listener fires first, same as a real click bubbling
    row.fire('click', {target: sw});
    assert.equal(calls, 1);
  });
});

test('makeSwitch: with no row, the switch button alone still works (most call sites)', () => {
  withFakeDocument(() => {
    const sw = makeSwitch({checked: true, label: 'Mono', onChange: () => {}});
    assert.equal(sw.getAttribute('aria-checked'), 'true');
    assert.equal(sw.className, 'switch');
  });
});
