import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

// FS11 (docs/25_FROM_SCRATCH.md): openLibraryToolsMenuPanel()/
// closeLibraryToolsMenuPanel() (src/shell/header.js) reparent the real,
// shared #libTools element (never copy it) between its stash and this
// panel's own body -- the same "stop the chain at the door" mocking this
// codebase uses throughout for header.js's own wider real imports
// (library/delete.js reaches player/queue.js's/clock.js's whole chain;
// shell/routes.js reaches profile/screens.js/social/home.js/gatefold).
globalThis.window = { scrollY: 0, innerWidth: 390 };

mock.module(new URL('../../src/library/delete.js', import.meta.url).href, {
  namedExports: { formatBytes(){ return '0 B'; }, totalLibraryBytes(){ return 0; } },
});
mock.module(new URL('../../src/library/search.js', import.meta.url).href, {
  namedExports: { updateSearchChipsVisibility(){} },
});
mock.module(new URL('../../src/shell/routes.js', import.meta.url).href, {
  namedExports: { isLibraryRouteVisible(){ return true; } },
});
const openLayerMock = mock.fn();
mock.module(new URL('../../src/shell/nav-stack.js', import.meta.url).href, {
  namedExports: { openLayer: openLayerMock },
});

const elCache = new Map();
function fakeEl(){
  const classes = new Set();
  return {
    style: {}, textContent: '', parentNode: null,
    classList: {
      add(...cs){ cs.forEach(c => classes.add(c)); },
      remove(...cs){ cs.forEach(c => classes.delete(c)); },
      contains(c){ return classes.has(c); },
      toggle(c, on){ if(on === undefined) on = !classes.has(c); if(on) classes.add(c); else classes.delete(c); return on; },
    },
    setAttribute(){}, getAttribute(){ return null; },
    appendChild(child){ child.parentNode = this; return child; },
    getBoundingClientRect(){ return { top: 44, bottom: 88, left: 0, right: 390, width: 390, height: 44 }; },
  };
}
mock.module(new URL('../../src/util/dom.js', import.meta.url).href, {
  namedExports: {
    $(sel){ if(!elCache.has(sel)) elCache.set(sel, fakeEl()); return elCache.get(sel); },
    el(tag, cls, text){ const e = fakeEl(); if(cls) e.className = cls; if(text !== undefined) e.textContent = text; return e; },
  },
});

const {
  openLibOverflowMenu, closeLibOverflowMenu,
  openLibraryToolsMenuPanel, closeLibraryToolsMenuPanel,
} = await import('../../src/shell/header.js');
const { $ } = await import('../../src/util/dom.js');

function resetEls(){
  elCache.clear();
  // #libTools starts parked in its stash, same as the real app's boot state
  $('#libTools').parentNode = $('#libToolsStash');
}

test('openLibraryToolsMenuPanel reparents #libTools out of the stash into the panel body', () => {
  resetEls();
  openLibraryToolsMenuPanel();
  assert.equal($('#libTools').parentNode, $('#libToolsMenuBody'));
  assert.ok($('#libOverflowMenu').classList.contains('lib-tools-open'));
  assert.ok($('#libToolsPanel').classList.contains('open'));
});

test('closeLibraryToolsMenuPanel hands #libTools back to the stash and collapses the panel', () => {
  resetEls();
  openLibraryToolsMenuPanel();
  closeLibraryToolsMenuPanel();
  assert.equal($('#libTools').parentNode, $('#libToolsStash'));
  assert.ok(!$('#libOverflowMenu').classList.contains('lib-tools-open'));
  assert.ok(!$('#libToolsPanel').classList.contains('open'));
});

test('closeLibraryToolsMenuPanel is a quiet no-op when the panel was never opened', () => {
  resetEls();
  closeLibraryToolsMenuPanel();   // must not throw, must not move #libTools
  assert.equal($('#libTools').parentNode, $('#libToolsStash'));
});

// Point 3: "whichever opens last owns the element" -- if Settings already
// re-grabbed #libTools (its own renderAppSettingsScreen() reparenting it
// elsewhere), this panel's close must not snatch it back out from under it.
test('closeLibraryToolsMenuPanel leaves #libTools alone if something else already re-grabbed it', () => {
  resetEls();
  openLibraryToolsMenuPanel();
  const somewhereElse = fakeEl();
  somewhereElse.appendChild($('#libTools'));
  closeLibraryToolsMenuPanel();
  assert.equal($('#libTools').parentNode, somewhereElse);
});

// closeLibOverflowMenu() is the real close path every dismissal (×, scrim,
// Escape, back gesture) runs through via nav-stack's closeLayer() -- it
// must tear down the expanded panel state too, not just the menu itself,
// and do nothing destructive when the panel was never expanded.
test('closeLibOverflowMenu also closes an expanded Library tools panel', () => {
  resetEls();
  openLibOverflowMenu();
  openLibraryToolsMenuPanel();
  closeLibOverflowMenu();
  assert.ok(!$('#libOverflowMenu').classList.contains('open'));
  assert.ok(!$('#libOverflowMenu').classList.contains('lib-tools-open'));
  assert.equal($('#libTools').parentNode, $('#libToolsStash'));
});

test('closeLibOverflowMenu with the panel never opened just closes the plain menu', () => {
  resetEls();
  openLibOverflowMenu();
  closeLibOverflowMenu();
  assert.ok(!$('#libOverflowMenu').classList.contains('open'));
  assert.equal($('#libTools').parentNode, $('#libToolsStash'));   // untouched
});
