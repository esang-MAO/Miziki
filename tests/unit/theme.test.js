import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

// src/ui/theme.js touches document.documentElement/document.querySelector/
// querySelectorAll/localStorage/window.matchMedia — none of which exist in
// Node, so each is stubbed here, the same "stub only what a browser would
// otherwise provide" approach shell.test.js/launch.test.js already use.
// documentElement.dataset is a plain object: `root.dataset.theme = x` and
// `delete root.dataset.theme` both work on it exactly like the real thing.
const rootDataset = {};
// DA4: syncNychthemeronTheme()'s own beginThemeTransition() toggles a
// class on documentElement — a tiny Set-backed stub, the same shape
// routes.test.js's fakeEl() already uses for classList, is enough to
// assert on without a real document.
const rootClasses = new Set();
const rootClassList = { add(c){ rootClasses.add(c); }, remove(c){ rootClasses.delete(c); }, contains(c){ return rootClasses.has(c); } };
const metaEl = { attrs: {}, setAttribute(name, val){ this.attrs[name] = val; } };
function fakeThemeButton(choice){
  return { dataset: { themeChoice: choice }, attrs: {}, setAttribute(name, val){ this.attrs[name] = val; } };
}
const themeButtons = [fakeThemeButton('auto'), fakeThemeButton('light'), fakeThemeButton('dark'), fakeThemeButton('nychthemeron')];
globalThis.document = {
  documentElement: { dataset: rootDataset, classList: rootClassList },
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

const { applyTheme, setTheme, THEME_STORAGE_KEY, effectiveTheme, syncNychthemeronTheme, resolveBootThemeFromSunCache } = await import('../../src/ui/theme.js');
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
  assert.deepEqual(byChoice, { auto: 'false', light: 'false', dark: 'true', nychthemeron: 'false' });
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

test('setTheme: "nychthemeron" is a real, accepted choice', () => {
  queueSaveSpy.mock.resetCalls();
  setTheme('nychthemeron');
  assert.equal(S.theme, 'nychthemeron');
  assert.equal(queueSaveSpy.mock.calls.length, 1);
});

// DA4 (docs/DAY_ARC.md): effectiveTheme()'s own Nychthemeron resolution —
// "light from sunrise to sunset, dark from sunset to sunrise," read from
// dayPosition() via currentDayPosition() (sundown/solar.js, real here —
// it's DOM-free, so no mock needed). Fixtures use the full DA1 event
// shape (dawn/rise/noon/set/dusk/altitudeAtNoon), relative to the real
// Date.now() the same way tests/unit/solar.test.js's own fixtures are,
// so these don't depend on which real-world date/time the suite happens
// to run at.
const dayArcNow = Date.now();
// a small, consistently-ordered (dawn < rise < noon < set < dusk) day
// fixture builder, hour offsets from dayArcNow — every test below builds
// its S.sun from this rather than hand-rolling Date math per field, so
// none of them can accidentally end up with an out-of-order (e.g. "set"
// before "noon") day that dayPosition()'s own clamping would silently
// paper over.
function sunAt(dawnH, riseH, noonH, setH, duskH){
  const h = n => new Date(dayArcNow + n * 3600000);
  return { dawn: h(dawnH), rise: h(riseH), noon: h(noonH), set: h(setH), dusk: h(duskH), altitudeAtNoon: 45, ok: true };
}
const sunAtMidday = sunAt(-3, -2, 0, 2, 2.5);      // "now" is exactly solar noon -> light
const sunJustBeforeSunrise = sunAt(-0.1, 0.05, 1, 2, 2.5); // "now" is in the dawn window -> dark
const sunJustAfterSunset = sunAt(-10, -9, -5, -1 / 60, 0.4); // "now" is in the twilight window -> dark

test('effectiveTheme: Nychthemeron is light between sunrise and sunset', () => {
  S.theme = 'nychthemeron'; S.previewMin = 0;
  S.sun = sunAtMidday;
  assert.equal(effectiveTheme(), 'light');
});

test('effectiveTheme: Nychthemeron is dark just before sunrise (dawn) and just after sunset (twilight)', () => {
  S.theme = 'nychthemeron'; S.previewMin = 0;
  S.sun = sunJustBeforeSunrise;
  assert.equal(effectiveTheme(), 'dark', 'before sunrise (dawn) should be dark');

  S.sun = sunJustAfterSunset;
  assert.equal(effectiveTheme(), 'dark', 'just after sunset (twilight) should be dark');
});

test('effectiveTheme: Nychthemeron follows the previewed time, not the real clock', () => {
  S.theme = 'nychthemeron';
  // a full, ordered day (dawn < rise < noon < set < dusk) with real "now"
  // sitting one minute into twilight (dark) — easedProgress()/
  // currentDayPosition() already honor S.previewMin transparently (DA1),
  // so effectiveTheme() should too: previewing 9h earlier lands solidly
  // inside today's own midday window instead (light), with a wide margin
  // on both sides so this isn't sensitive to the handful of ms between
  // capturing dayArcNow and this test actually running.
  S.sun = sunAt(-11, -10, -5, -1 / 60, 25 / 60);
  S.previewMin = 0;
  assert.equal(effectiveTheme(), 'dark', 'real now is one minute past sunset');
  S.previewMin = -540; // preview 9h earlier -> solidly inside midday
  assert.equal(effectiveTheme(), 'light');
  S.previewMin = 0;
});

test('effectiveTheme: Nychthemeron reads light for a polar day, dark for a polar night', () => {
  S.theme = 'nychthemeron'; S.previewMin = 0;
  // no dawn/rise/set/dusk at all (solarEvent() returns null for every one
  // of them) is day.js's own "no usable data" branch, classified by
  // altitudeAtNoon alone — the exact fixture shape tests/unit/day.test.js
  // already uses for its own polar-day/polar-night cases.
  S.sun = { dawn: null, rise: null, noon: new Date(dayArcNow), set: null, dusk: null, altitudeAtNoon: 20, ok: true };
  assert.equal(effectiveTheme(), 'light', 'polar day (sun never sets)');

  S.sun = { dawn: null, rise: null, noon: new Date(dayArcNow), set: null, dusk: null, altitudeAtNoon: -20, ok: true };
  assert.equal(effectiveTheme(), 'dark', 'polar night (sun never rises)');
});

test('applyTheme: Nychthemeron sets data-theme to the resolved light/dark, not the literal choice, and mirrors "nychthemeron" to localStorage', () => {
  S.theme = 'nychthemeron';
  S.sun = sunAtMidday;
  applyTheme();
  assert.equal(rootDataset.theme, 'light');
  assert.equal(localStorage.getItem(THEME_STORAGE_KEY), 'nychthemeron');
  assert.equal(metaEl.attrs.content, '#ECE5D8');
});

// DA4: syncNychthemeronTheme() — the live-crossing watcher drawSun()
// calls every render-loop tick. REDUCED is false in this test file's own
// stubbed window (mq.matches starts false, read once at util/motion.js's
// own module load), so a genuine flip is expected to animate here.
test('syncNychthemeronTheme: a genuine light<->dark flip adds the transition class and re-applies; staying the same is a no-op', () => {
  S.theme = 'nychthemeron';
  rootClasses.delete('theme-transition');
  S.sun = sunJustAfterSunset;
  syncNychthemeronTheme();
  assert.equal(rootClasses.has('theme-transition'), false, 'the first read after switching on is never animated');
  assert.equal(rootDataset.theme, 'dark');

  // calling again with nothing changed should not re-trigger anything
  syncNychthemeronTheme();
  assert.equal(rootClasses.has('theme-transition'), false);

  // now the sun "rises" — light phases span today, flip to light
  S.sun = sunAtMidday;
  syncNychthemeronTheme();
  assert.equal(rootDataset.theme, 'light', 'a real crossing updates the applied theme');
  assert.equal(rootClasses.has('theme-transition'), true, 'a real crossing animates');
});

test('syncNychthemeronTheme: switching off Nychthemeron resets the baseline so a later switch-back never animates a stale flip', () => {
  S.theme = 'nychthemeron';
  S.sun = sunAtMidday;
  syncNychthemeronTheme(); // establishes "light" as the baseline

  S.theme = 'dark'; // user picks Dark directly
  syncNychthemeronTheme(); // no-op: not on nychthemeron, but clears the baseline

  S.theme = 'nychthemeron';
  rootClasses.delete('theme-transition');
  // the sun is now down -- a real difference from the "light" baseline
  // that was active before switching away, but since the baseline was
  // reset, this must read as the first call again, not a flip to animate
  S.sun = sunJustAfterSunset;
  syncNychthemeronTheme();
  assert.equal(rootClasses.has('theme-transition'), false);
  assert.equal(rootDataset.theme, 'dark');
});

// DA4: resolveBootThemeFromSunCache() — the pure decision theme-boot.js's
// own inline <head> script reimplements by hand (see that file's own
// comment for why it can't just import this). now is fixed so "today" is
// deterministic regardless of when the suite runs.
const bootNow = new Date('2026-06-15T12:00:00');
const bootToday = bootNow.toDateString();
const bootRise = new Date('2026-06-15T06:50:00').toISOString();
const bootSet = new Date('2026-06-15T20:10:00').toISOString();

test('resolveBootThemeFromSunCache: a fresh, today-dated cache resolves light between rise and set, dark otherwise', () => {
  const cache = { date: bootToday, rise: bootRise, set: bootSet };
  assert.equal(resolveBootThemeFromSunCache(cache, new Date('2026-06-15T05:00:00')), 'dark', 'before rise');
  assert.equal(resolveBootThemeFromSunCache(cache, new Date('2026-06-15T12:00:00')), 'light', 'midday');
  assert.equal(resolveBootThemeFromSunCache(cache, new Date('2026-06-15T21:00:00')), 'dark', 'after set');
});

test('resolveBootThemeFromSunCache: a missing cache falls back to the 6:50am/8:10pm stand-in times', () => {
  assert.equal(resolveBootThemeFromSunCache(null, new Date('2026-06-15T05:00:00')), 'dark');
  assert.equal(resolveBootThemeFromSunCache(null, new Date('2026-06-15T12:00:00')), 'light');
  assert.equal(resolveBootThemeFromSunCache(undefined, new Date('2026-06-15T21:00:00')), 'dark');
});

test('resolveBootThemeFromSunCache: a cache from a previous day is treated the same as missing', () => {
  // a deliberately wide, clearly-wrong-if-trusted window (4am-11pm, dated
  // the 14th) -- querying 5am on the 15th would read "light" if this
  // stale cache were mistakenly trusted, but must read "dark" (the
  // fallback's own fixed 6:50am rise hasn't happened yet) once the date
  // mismatch correctly forces the fallback path instead.
  const staleCache = { date: new Date('2026-06-14T12:00:00').toDateString(), rise: new Date('2026-06-14T04:00:00').toISOString(), set: new Date('2026-06-14T23:00:00').toISOString() };
  assert.equal(resolveBootThemeFromSunCache(staleCache, new Date('2026-06-15T05:00:00')), 'dark');
});

test('resolveBootThemeFromSunCache: a malformed cache (missing rise/set) falls back the same way', () => {
  assert.equal(resolveBootThemeFromSunCache({ date: bootToday }, new Date('2026-06-15T12:00:00')), 'light');
  assert.equal(resolveBootThemeFromSunCache({ date: bootToday, rise: bootRise }, new Date('2026-06-15T21:00:00')), 'dark');
});
