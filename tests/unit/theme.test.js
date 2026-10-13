import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

// src/ui/theme.js touches document.documentElement/document.querySelector/
// querySelectorAll/localStorage/window.matchMedia — none of which exist in
// Node, so each is stubbed here, the same "stub only what a browser would
// otherwise provide" approach shell.test.js/launch.test.js already use.
// documentElement.dataset is a plain object: `root.dataset.theme = x` and
// `delete root.dataset.theme` both work on it exactly like the real thing.
const rootDataset = {};
const metaEl = { attrs: {}, setAttribute(name, val){ this.attrs[name] = val; } };
function fakeThemeButton(choice){
  return { dataset: { themeChoice: choice }, attrs: {}, setAttribute(name, val){ this.attrs[name] = val; } };
}
const themeButtons = [fakeThemeButton('auto'), fakeThemeButton('light'), fakeThemeButton('dark')];
globalThis.document = {
  documentElement: { dataset: rootDataset },
  querySelector(sel){ return sel.indexOf('theme-color') >= 0 ? metaEl : null; },
  querySelectorAll(sel){ return sel.indexOf('data-theme-choice') >= 0 ? themeButtons : []; },
};

// a single shared MediaQueryList-like object, the same one every
// matchMedia('(prefers-color-scheme: light)') call in theme.js returns --
// addEventListener/removeEventListener are spies so "Auto installs a live
// listener, a pinned choice tears it down" (the doc's own required test
// case) can be asserted directly, not inferred from a side effect that
// would look the same either way.
const mq = { matches: false, addEventListener: mock.fn(), removeEventListener: mock.fn() };
globalThis.window = { matchMedia(){ return mq; } };

const fakeStorage = {};
globalThis.localStorage = {
  setItem(k, v){ fakeStorage[k] = v; },
  getItem(k){ return (k in fakeStorage) ? fakeStorage[k] : null; },
  removeItem(k){ delete fakeStorage[k]; },
};

// setTheme() calls queueSave() (storage/meta.js) -- mocked directly so
// loading the real meta.js doesn't pull in its own wide real chain
// (audio/mode.js, player/background.js, ...), the usual "stop the chain
// at the door" reasoning every mock-heavy file in this suite already uses.
// theme.js and meta.js are a real circular pair (meta.js's applyPrefs()
// calls theme.js's applyTheme()) -- this mock only replaces the queueSave
// name theme.js itself needs, not meta.js as a whole.
const queueSaveSpy = mock.fn();
mock.module(new URL('../../src/storage/meta.js', import.meta.url).href, {
  namedExports: { queueSave: queueSaveSpy },
});

const { applyTheme, setTheme, THEME_STORAGE_KEY } = await import('../../src/ui/theme.js');
const { S } = await import('../../src/state.js');

function resetButtons(){ themeButtons.forEach(b => { b.attrs = {}; }); }

test('applyTheme: a pinned Light sets the data-theme attribute and the meta tag', () => {
  S.theme = 'light';
  applyTheme();
  assert.equal(rootDataset.theme, 'light');
  assert.equal(metaEl.attrs.content, '#ECE5D8');
});

test('applyTheme: a pinned Dark sets the data-theme attribute and the meta tag', () => {
  S.theme = 'dark';
  applyTheme();
  assert.equal(rootDataset.theme, 'dark');
  assert.equal(metaEl.attrs.content, '#101A20');
});

test('applyTheme: Auto removes the data-theme attribute', () => {
  rootDataset.theme = 'dark'; // simulate a prior pinned choice still set
  S.theme = 'auto';
  applyTheme();
  assert.equal('theme' in rootDataset, false);
});

test('applyTheme: Auto resolves the meta tag from the device scheme (matchMedia)', () => {
  mq.matches = false; // device prefers dark
  S.theme = 'auto';
  applyTheme();
  assert.equal(metaEl.attrs.content, '#101A20');

  mq.matches = true; // device prefers light
  S.theme = 'auto';
  applyTheme();
  assert.equal(metaEl.attrs.content, '#ECE5D8');
});

test('applyTheme: Auto installs a live matchMedia listener; a pinned choice tears it down', () => {
  // start from a known, listener-free state (applyTheme()'s own module-
  // private mq/mqHandler persist across calls, so the spy counts below
  // would otherwise pick up whatever the previous test left behind)
  S.theme = 'light';
  applyTheme();
  mq.addEventListener.mock.resetCalls();
  mq.removeEventListener.mock.resetCalls();

  S.theme = 'auto';
  applyTheme();
  assert.equal(mq.addEventListener.mock.calls.length, 1);
  assert.equal(mq.addEventListener.mock.calls[0].arguments[0], 'change');
  assert.equal(mq.removeEventListener.mock.calls.length, 0);

  S.theme = 'light';
  applyTheme();
  assert.equal(mq.removeEventListener.mock.calls.length, 1);
});

test('applyTheme: a matchMedia change event updates the meta tag only while Auto is active', () => {
  mq.matches = false;
  S.theme = 'auto';
  applyTheme();
  assert.equal(metaEl.attrs.content, '#101A20');

  // simulate the device's own scheme changing live, e.g. at sunset
  const handler = mq.addEventListener.mock.calls.at(-1).arguments[1];
  mq.matches = true;
  handler();
  assert.equal(metaEl.attrs.content, '#ECE5D8');
});

test('applyTheme: mirrors a pinned choice to localStorage; Auto clears the mirror', () => {
  S.theme = 'dark';
  applyTheme();
  assert.equal(localStorage.getItem(THEME_STORAGE_KEY), 'dark');

  S.theme = 'auto';
  applyTheme();
  assert.equal(localStorage.getItem(THEME_STORAGE_KEY), null);
});

test('applyTheme: syncs aria-pressed on every [data-theme-choice] button', () => {
  resetButtons();
  S.theme = 'dark';
  applyTheme();
  const byChoice = Object.fromEntries(themeButtons.map(b => [b.dataset.themeChoice, b.attrs['aria-pressed']]));
  assert.deepEqual(byChoice, { auto: 'false', light: 'false', dark: 'true' });
});

test('setTheme: sets S.theme, persists via queueSave, and applies', () => {
  queueSaveSpy.mock.resetCalls();
  setTheme('light');
  assert.equal(S.theme, 'light');
  assert.equal(queueSaveSpy.mock.calls.length, 1);
  assert.equal(rootDataset.theme, 'light');
});

test('setTheme: an unlisted choice is ignored -- no state change, no save', () => {
  S.theme = 'dark';
  queueSaveSpy.mock.resetCalls();
  setTheme('sepia');
  assert.equal(S.theme, 'dark');
  assert.equal(queueSaveSpy.mock.calls.length, 0);
});
