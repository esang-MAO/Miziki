// UN2 (docs/36_UNIFORMITY.md): DOM-shape tests for src/ui/parts.js's
// helpers. Same tiny document stub tests/unit/switch.test.js and
// tests/unit/letter-rail.test.js already use for hand-built-DOM tests --
// attributes, classList, appendChild, dataset, and real
// addEventListener/fire so a test can dispatch them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  backHeader, sheetHeader, segmented, toggleRow, navRow, listMenu, emptyNote,
} from '../../src/ui/parts.js';

function fakeEl(tag){
  const attrs = {};
  const listeners = {};
  const classes = new Set();
  const kids = [];
  const obj = {
    tagName: String(tag || 'DIV').toUpperCase(), type: '', className: '', textContent: '', dataset: {},
    children: kids,
    setAttribute(k, v){ attrs[k] = String(v); },
    getAttribute(k){ return attrs[k]; },
    appendChild(c){ kids.push(c); return c; },
    contains(el){ return kids.includes(el); },
    classList: {
      add(...cs){ cs.forEach(c => classes.add(c)); },
      // el() sets className as a plain string property, never via
      // classList.add() -- check both, same as the real DOM would.
      contains(c){ return classes.has(c) || obj.className.split(' ').includes(c); },
    },
    addEventListener(type, fn){ (listeners[type] = listeners[type] || []).push(fn); },
    fire(type, ev){ (listeners[type] || []).forEach(fn => fn(ev || {})); },
  };
  return obj;
}

function withFakeDocument(fn){
  const orig = globalThis.document;
  globalThis.document = { createElement(tag){ return fakeEl(tag); } };
  try{ fn(); } finally {
    if(orig) globalThis.document = orig; else delete globalThis.document;
  }
}

test('backHeader: the back link reads "‹ {to}", the title is set, and an optional right element lands in its own slot', () => {
  withFakeDocument(() => {
    const right = fakeEl('button');
    const row = backHeader('Library', 'Artist', right);
    assert.equal(row.backBtn.textContent, '‹ Library');
    assert.equal(row.children[1].textContent, 'Artist');
    assert.equal(row.rightSlot.children[0], right);
  });
});

test('backHeader: with no right element, no right slot is created', () => {
  withFakeDocument(() => {
    const row = backHeader('Crate', 'Album');
    assert.equal(row.rightSlot, undefined);
    assert.equal(row.children.length, 2);
  });
});

test('sheetHeader: title set, close button is a 44px × with an accessible label', () => {
  withFakeDocument(() => {
    const row = sheetHeader('Edit track');
    assert.equal(row.children[0].textContent, 'Edit track');
    assert.equal(row.closeBtn.getAttribute('aria-label'), 'Close');
    assert.equal(row.closeBtn.classList.contains('p-sheet-close'), true);
  });
});

test('segmented: aria-pressed marks only the current value, and clicking an option calls onChange with its value', () => {
  withFakeDocument(() => {
    let last = null;
    const seg = segmented(
      [{value:'a', label:'A'}, {value:'b', label:'B'}],
      'b',
      v => { last = v; },
    );
    assert.equal(seg.getAttribute('role'), 'group');
    const [a, b] = seg.children;
    assert.equal(a.getAttribute('aria-pressed'), 'false');
    assert.equal(b.getAttribute('aria-pressed'), 'true');
    a.fire('click');
    assert.equal(last, 'a');
  });
});

test('toggleRow: role="switch" and aria-checked come from the shared switch, and info clicks don\'t also toggle it', () => {
  withFakeDocument(() => {
    let changed = null;
    let infoCalls = 0;
    const row = toggleRow({
      label: 'Scratch', desc: 'Spin the disc to scrub', info: () => { infoCalls++; },
      checked: false, onChange: v => { changed = v; },
    });
    const top = row.children[0];
    const left = top.children[0];
    const infoBtn = left.children[1];
    assert.equal(row.switchEl.getAttribute('role'), 'switch');
    assert.equal(row.switchEl.getAttribute('aria-checked'), 'false');
    infoBtn.fire('click', {stopPropagation(){}});
    assert.equal(infoCalls, 1);
    assert.equal(changed, null, 'the info button must not also toggle the switch');
    row.switchEl.fire('click');
    assert.equal(changed, true);
  });
});

test('toggleRow: with no info, no info button is built', () => {
  withFakeDocument(() => {
    const row = toggleRow({label: 'Background playback', checked: true, onChange(){}});
    const left = row.children[0].children[0];
    assert.equal(left.children.length, 1);
  });
});

test('navRow: plain row has no danger class; danger:true adds it', () => {
  withFakeDocument(() => {
    const plain = navRow({label: 'Theme', value: 'Auto', onClick(){}});
    assert.equal(plain.classList.contains('p-nav-row--danger'), false);
    const danger = navRow({label: 'Forget library', onClick(){}, danger: true});
    assert.equal(danger.classList.contains('p-nav-row--danger'), true);
  });
});

test('navRow: clicking the row fires onClick', () => {
  withFakeDocument(() => {
    let calls = 0;
    const row = navRow({label: 'Account', onClick: () => { calls++; }});
    row.fire('click');
    assert.equal(calls, 1);
  });
});

test('listMenu: a "!"-prefixed label strips the "!" and gets the danger class; a plain label doesn\'t', () => {
  withFakeDocument(() => {
    const menu = listMenu([[{label: 'Edit info', onClick(){}}, {label: '!Remove from library', onClick(){}}]]);
    const [edit, remove] = menu.children;
    assert.equal(edit.classList.contains('p-list-menu-item--danger'), false);
    assert.equal(remove.textContent, 'Remove from library');
    assert.equal(remove.classList.contains('p-list-menu-item--danger'), true);
  });
});

test('listMenu: a divider separates groups, but a single group has none', () => {
  withFakeDocument(() => {
    const oneGroup = listMenu([[{label: 'A', onClick(){}}]]);
    assert.equal(oneGroup.children.length, 1);
    const twoGroups = listMenu([[{label: 'A', onClick(){}}], [{label: 'B', onClick(){}}]]);
    assert.equal(twoGroups.children.length, 3);
    assert.equal(twoGroups.children[1].classList.contains('p-list-menu-divider'), true);
  });
});

// UN5 point 1: `action` now builds its button inside a
// .p-empty-note-actions wrapper (so the library empty state's `actions`
// array can sit next to it without a separate card shape) -- children[3]
// is that wrapper, not the button itself.
test('emptyNote: head/sub text set, and an action builds one primary button that fires onClick', () => {
  withFakeDocument(() => {
    let calls = 0;
    const card = emptyNote({head: 'No playlists yet', sub: 'Make one from any album.', action: {label: 'New playlist', onClick: () => { calls++; }}});
    assert.equal(card.children[1].textContent, 'No playlists yet');
    assert.equal(card.children[2].textContent, 'Make one from any album.');
    const actions = card.children[3];
    const btn = actions.children[0];
    assert.equal(btn.classList.contains('p-btn--primary'), true);
    btn.fire('click');
    assert.equal(calls, 1);
  });
});

test('emptyNote: with no sub/action, only the tape and headline are built', () => {
  withFakeDocument(() => {
    const card = emptyNote({head: 'Nothing here'});
    assert.equal(card.children.length, 2);
  });
});
