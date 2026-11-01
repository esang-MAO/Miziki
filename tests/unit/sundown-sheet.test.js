import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

// src/shell/sundown-sheet.js's own import graph runs through routes.js,
// which reaches profile/screens.js, social/screens/home.js, gatefold/
// view.js and more -- the same "stop the chain at the door" reasoning as
// every other mock-heavy file in this suite (shell.test.js, clock.test.js).
// Only wireSundownSheetEntryPoints() is under test here, so everything it
// doesn't call at wiring time (openLayer/closeLayer, selectSundownView/
// lastSundownView, eqStateLabel, wireSwipeToClose) is stubbed as a no-op.
mock.module(new URL('../../src/shell/nav-stack.js', import.meta.url).href, {
  namedExports: { openLayer(){}, closeLayer(){} },
});
mock.module(new URL('../../src/shell/routes.js', import.meta.url).href, {
  namedExports: { selectSundownView(){}, lastSundownView(){ return 'day'; } },
});
mock.module(new URL('../../src/player/eq-label.js', import.meta.url).href, {
  namedExports: { eqStateLabel(){ return ''; } },
});
mock.module(new URL('../../src/shell/swipe-close.js', import.meta.url).href, {
  namedExports: { wireSwipeToClose(){} },
});

const { wireSundownSheetEntryPoints } = await import('../../src/shell/sundown-sheet.js');

function fakeEl(){
  return { addEventListener(){}, classList: { contains(){ return false; } }, style: {}, closest(){ return null; } };
}

// DEEP2 (docs/28_PLATTER_KNOB.md): #sunKnob was removed from the platter.
// This fake DOM carries no #sunKnob at all -- wireSundownSheetEntryPoints()
// must still wire the remaining ways in without throwing.
test('wireSundownSheetEntryPoints: wires #nowPhasePill and #miniSunBtn with no #sunKnob present', () => {
  const calls = [];
  const els = {
    '#miniSunBtn': fakeEl(),
    '#nowPhasePill': fakeEl(),
  };
  globalThis.document = {
    querySelector(sel){
      calls.push(sel);
      return els[sel] || null;
    },
  };

  assert.doesNotThrow(() => wireSundownSheetEntryPoints());
  assert.ok(!calls.includes('#sunKnob'), 'no lookup of the removed #sunKnob');
  assert.ok(calls.includes('#miniSunBtn'));
  assert.ok(calls.includes('#nowPhasePill'));
});
