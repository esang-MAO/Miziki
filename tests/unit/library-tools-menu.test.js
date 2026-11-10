import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

// UN3 (docs/36_UNIFORMITY.md point 6, decision 11): openLibraryToolsPanel()/
// closeLibraryToolsPanel() (src/shell/header.js) reparent the real, shared
// #libTools element (never copy it) between its stash and the sheet's own
// body -- the same "stop the chain at the door" mocking this codebase uses
// throughout for header.js's own wider real imports (library/delete.js
// reaches player/queue.js's/clock.js's whole chain; shell/routes.js reaches
// profile/screens.js/social/home.js/gatefold).
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
  namedExports: { openLayer: openLayerMock, closeLayer(){} },
});
// UN3: openLibraryToolsPanel() builds its sheet header via sheetHeader()
// (src/ui/parts.js) on first open -- stopped at the door here too, same
// reasoning as every other mock in this file.
mock.module(new URL('../../src/ui/parts.js', import.meta.url).href, {
  namedExports: {
    sheetHeader(){ const built = fakeEl(); built.closeBtn = fakeEl(); return built; },
  },
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
    setAttribute(){}, getAttribute(){ return null; }, addEventListener(){},
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
  openLibraryToolsPanel, closeLibraryToolsPanel, isLibraryToolsPanelOpen,
} = await import('../../src/shell/header.js');
const { $ } = await import('../../src/util/dom.js');

function resetEls(){
  elCache.clear();
  // #libTools starts parked in its stash, same as the real app's boot state
  $('#libTools').parentNode = $('#libToolsStash');
}

test('openLibraryToolsPanel reparents #libTools out of the stash into the sheet body', () => {
  resetEls();
  openLibraryToolsPanel();
  assert.equal($('#libTools').parentNode, $('#libToolsSheetBody'));
  assert.ok($('#libToolsSheetOverlay').classList.contains('open'));
  assert.ok($('#libToolsPanel').classList.contains('open'));
  assert.ok(isLibraryToolsPanelOpen());
});

test('closeLibraryToolsPanel hands #libTools back to the stash and closes the sheet', () => {
  resetEls();
  openLibraryToolsPanel();
  closeLibraryToolsPanel();
  assert.equal($('#libTools').parentNode, $('#libToolsStash'));
  assert.ok(!$('#libToolsSheetOverlay').classList.contains('open'));
  assert.ok(!$('#libToolsPanel').classList.contains('open'));
  assert.ok(!isLibraryToolsPanelOpen());
});

test('closeLibraryToolsPanel is a quiet no-op when the panel was never opened', () => {
  resetEls();
  closeLibraryToolsPanel();   // must not throw, must not move #libTools
  assert.equal($('#libTools').parentNode, $('#libToolsStash'));
});

// Point 3: "whichever opens last owns the element" -- if Settings already
// re-grabbed #libTools (its own renderAppSettingsScreen() reparenting it
// elsewhere), this sheet's close must not snatch it back out from under it.
test('closeLibraryToolsPanel leaves #libTools alone if something else already re-grabbed it', () => {
  resetEls();
  openLibraryToolsPanel();
  const somewhereElse = fakeEl();
  somewhereElse.appendChild($('#libTools'));
  closeLibraryToolsPanel();
  assert.equal($('#libTools').parentNode, somewhereElse);
});
