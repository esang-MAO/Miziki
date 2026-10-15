/* ================= theme: Auto/Light/Dark/Nychthemeron appearance (D2, DA4) =
   S.theme is one of 'auto'/'light'/'dark'/'nychthemeron', saved alongside
   the other prefs (serializePrefs/parsePrefs, storage/prefs.js) — but
   deliberately excluded from what gets backed up to the account:
   src/sync/backup.js's buildLocalState() strips it out of the prefs
   object before upload, per docs/DESKTOP_LAYOUT.md's own default
   ("device-only, listed as such in the CLAUDE.md key-inventory table")
   — an appearance choice is a per-device preference, not something that
   should follow the account to a different device the way the rest of
   `prefs` does.

   applyTheme() is the one function every control that changes the theme
   calls through setTheme() — the Profile › Settings screen's own row
   (since DA3 moved it off the old Character tab) and the desktop
   sidebar's segmented control (D7), both targeting the same
   [data-theme-choice] button convention so this file never needs to know
   which markup is on screen. applyTheme() itself:
     - sets document.documentElement.dataset.theme to 'light' or 'dark'
       for a pinned Light/Dark choice, removes it for Auto, and — since
       DA4 — sets it to effectiveTheme()'s own resolved 'light'/'dark'
       for Nychthemeron, which reuses the existing Light/Dark token sets
       verbatim rather than needing a third palette of its own (the
       design README's own framing: "light from sunrise to sunset, dark
       from sunset to sunrise," not a distinct look)
     - mirrors the choice to localStorage (THEME_STORAGE_KEY) for a
       pinned Light/Dark/Nychthemeron choice, read back by the tiny
       external <head> script (src/theme-boot.js) that runs before first
       paint — Auto needs no such mirror, since `@media
       (prefers-color-scheme)` alone handles it with zero JS at first
       paint, and Nychthemeron's own first-paint resolution additionally
       needs theme-boot.js's own device-only sun-times cache (see that
       file's own comment, and solar.js's persistSunTimesCache())
     - updates <meta name="theme-color">, since a meta attribute can't
       read a CSS custom property — resolved against the *effective*
       theme (the device's own scheme while Auto; the sun's own position
       while Nychthemeron)

   PR 7 (DAY_ARC_BRIEF.md §8 item 7): Nychthemeron's own light/dark
   resolution now reads arc.js's phaseAt() — "the app light/dark theme
   follows the sun using the same phase function [as the rest of Day
   Arc v2]. Do not add a second clock" — in place of the old DA1-DA6
   7-phase dayPosition()/currentDayPosition() model
   (sundown/solar.js/day.js, both left in place for the still-shipping
   old Sundown UI behind .sdv1, untouched by this PR). phaseAt()'s own
   four labels (dawn/day/dusk/night) split cleanly into light (day) and
   dark (dawn/dusk/night) — see isDaylightPhase() below.
     - while Auto is active, listens for the device's own scheme changing
       live (e.g. at sunset) and re-applies; the listener is torn down
       the moment a pinned choice (Light/Dark/Nychthemeron) takes over,
       so there's never more than one at a time. Nychthemeron's own live
       updates come from a different mechanism — syncNychthemeronTheme(),
       called every render-loop tick from player/clock.js's drawSun(),
       the one place in the app that already recomputes the day position
       that often — not a second matchMedia-style listener, since there's
       no DOM/OS event that fires when the sun crosses the horizon
     - syncs aria-pressed on every [data-theme-choice] button currently
       in the DOM, so it stays correct whether called at boot (the
       default), after restoreMeta() restores a saved choice, or after
       the user taps a control directly

   Every browser-only call (localStorage, matchMedia) is wrapped in
   try/catch, the same defensive posture src/theme-boot.js's own copy
   takes — storage or matchMedia can be blocked (private browsing, some
   embedded contexts), and losing the optimization there is a far smaller
   problem than throwing.

   effectiveTheme() gained `export` after D7 shipped, for one external
   caller: src/player/clock.js's drawSun() (fix, not part of D1-D7 —
   see that file's own comment at its sky-color block). It resolves
   'light'/'dark'/'auto'/'nychthemeron' down to the one the device is
   actually showing right now, the same question drawSun() needs
   answered to know whether its own animated sky palette is still
   in-theme. */
import { S } from '../state.js';
import { queueSave } from '../storage/meta.js';
import { nowClock } from '../sundown/solar.js';
import { phaseAt } from '../sundown/arc.js';
import { REDUCED } from '../util/motion.js';

export const THEME_STORAGE_KEY = 'miziki-theme';
// the literal meta content each effective theme resolves to — the exact
// hex --sky2 already holds for each theme (00-base.css's dark block,
// 22-theme.css's light block), not a separately-chosen approximation
const THEME_COLOR = { dark: '#101A20', light: '#ECE5D8' };

// PR7 (DAY_ARC_BRIEF.md): arc.js's phaseAt() only ever names one light
// phase ('day' — sunrise up to ~32 min before sunset, §3.2's own fixed
// offsets); 'dawn'/'dusk'/'night' are all dark, the same "is the sun up"
// cut the old 7-phase LIGHT_PHASES set made, just against the new
// 4-phase model instead of day.js's dayPosition().
//
// exported so the Settings/sidebar caption ("Turns dark at 6:33pm today")
// can ask "is the sun up right now" the same way effectiveTheme() itself
// does — src/profile/screens.js's own nychthemeronSwitchCaption() is the
// one caller, and it needs this independent of whatever S.theme is
// actually set to right now (the caption describes what Nychthemeron
// would do, not what the currently selected choice is doing).
export function isDaylightPhase(phase){
  return phase === 'day';
}

let mq = null;
let mqHandler = null;
// DA4: the Nychthemeron-resolved theme ('light'/'dark') as of the last
// syncNychthemeronTheme() call — null means "not established yet" (just
// switched to Nychthemeron, or not on it at all), the signal that tells
// a genuine flip (worth animating) apart from the very first read after
// switching on (never animated — nothing was visibly different a moment
// ago to transition away from).
let lastNychthemeronEffective = null;

export function effectiveTheme(){
  if(S.theme === 'light' || S.theme === 'dark') return S.theme;
  // nowClock() (not a bare `new Date()`) is what makes "Preview the day"
  // move Nychthemeron's own resolution too, the same as every other
  // Day Arc v2 readout — see sundown/solar.js's own comment on nowClock().
  if(S.theme === 'nychthemeron') return isDaylightPhase(phaseAt(nowClock(), S.sun)) ? 'light' : 'dark';
  try {
    return (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) ? 'light' : 'dark';
  } catch(_e) { return 'dark'; }
}

function setMetaThemeColor(theme){
  const meta = document.querySelector('meta[name="theme-color"]');
  if(meta) meta.setAttribute('content', THEME_COLOR[theme]);
}

function syncThemeButtons(){
  document.querySelectorAll('[data-theme-choice]').forEach(b => {
    b.setAttribute('aria-pressed', String(b.dataset.themeChoice === S.theme));
  });
}

function teardownAutoListener(){
  if(mq && mqHandler){
    if(mq.removeEventListener) mq.removeEventListener('change', mqHandler);
    else if(mq.removeListener) mq.removeListener(mqHandler);
  }
  mq = null; mqHandler = null;
}

function setupAutoListener(){
  teardownAutoListener();
  try {
    mq = window.matchMedia('(prefers-color-scheme: light)');
    mqHandler = () => { setMetaThemeColor(effectiveTheme()); };
    if(mq.addEventListener) mq.addEventListener('change', mqHandler);
    else if(mq.addListener) mq.addListener(mqHandler);
  } catch(_e) { /* matchMedia unavailable — Auto just never gets a live update */ }
}

export function applyTheme(){
  const root = document.documentElement;
  if(S.theme === 'light' || S.theme === 'dark'){
    root.dataset.theme = S.theme;
    teardownAutoListener();
    try { localStorage.setItem(THEME_STORAGE_KEY, S.theme); } catch(_e) {}
  } else if(S.theme === 'nychthemeron'){
    // resolves to the *existing* light/dark token sets — Nychthemeron
    // isn't a third palette, just a different rule for picking between
    // the two that already exist (see this file's own header comment).
    root.dataset.theme = effectiveTheme();
    teardownAutoListener();
    try { localStorage.setItem(THEME_STORAGE_KEY, 'nychthemeron'); } catch(_e) {}
  } else {
    delete root.dataset.theme;
    setupAutoListener();
    try { localStorage.removeItem(THEME_STORAGE_KEY); } catch(_e) {}
  }
  setMetaThemeColor(effectiveTheme());
  syncThemeButtons();
}

export function setTheme(choice){
  if(choice !== 'auto' && choice !== 'light' && choice !== 'dark' && choice !== 'nychthemeron') return;
  S.theme = choice;
  queueSave();
  applyTheme();
}

// DA4: briefly makes background/text/border colors transition instead of
// snapping, for the one Nychthemeron flip itself — "switch with a ~1.5s
// colour transition" (the doc's own wording). A class on :root, not an
// inline style, since src/styles/22-theme.css's own selector blocks are
// what actually changes (--panel, --chrome, --paper, etc.) and a
// transition has to be declared on the elements reading those tokens,
// not on :root itself. Scoped to this one brief window rather than left
// on permanently — every other theme change in this app (a manual Auto/
// Light/Dark tap, Auto following a live OS scheme change) stays an
// instant snap, unchanged; only a live Nychthemeron crossing gets this.
function beginThemeTransition(){
  const root = document.documentElement;
  root.classList.add('theme-transition');
  const timer = setTimeout(() => { root.classList.remove('theme-transition'); }, 1600);
  // Node's test runner doesn't exit while a ref'd timer is pending; a
  // browser's setTimeout return value has no .unref to call, so this is
  // a no-op there — same "doesn't hurt either runtime" shape several
  // other setTimeout calls in this codebase don't need, since none of
  // them are reached from a test file that doesn't also fake timers.
  if(timer && typeof timer.unref === 'function') timer.unref();
}

// DA4: called every render-loop tick from player/clock.js's drawSun() —
// the one place in the app that already recomputes the day position that
// often — so a live Nychthemeron crossing (the sun actually rising or
// setting while the app is open) is caught and animated without a
// second timer of its own. A no-op whenever S.theme isn't 'nychthemeron'
// (and resets lastNychthemeronEffective, so switching away and back
// later doesn't animate a flip that was never actually live) and a
// no-op when the resolved side hasn't actually changed since the last
// call, so this never re-triggers the transition class on every tick
// while nothing is actually different. The very first call after
// switching to Nychthemeron (lastNychthemeronEffective still null) never
// animates either — there's nothing visibly different a moment ago to
// transition away from, the same reasoning setTheme()'s own direct
// applyTheme() call for every other choice has never animated.
export function syncNychthemeronTheme(){
  if(S.theme !== 'nychthemeron'){ lastNychthemeronEffective = null; return; }
  const next = effectiveTheme();
  if(next === lastNychthemeronEffective) return;
  const isFirst = lastNychthemeronEffective === null;
  lastNychthemeronEffective = next;
  if(!isFirst && !REDUCED) beginThemeTransition();
  applyTheme();
}

// DA4: the pure decision theme-boot.js's own inline <head> script needs
// to resolve the first-paint theme for a pinned Nychthemeron choice,
// before S.sun or any module here even exists — exported here, for its
// own unit test, same as every other "duplicated as a literal in
// theme-boot.js, kept here importable for testing" precedent this file
// already has for THEME_STORAGE_KEY. theme-boot.js reimplements this
// exact logic inline rather than importing it, since that file has to
// stay a plain, import-free classic script (see its own comment) — the
// two are kept in sync by hand, the same discipline CLAUDE.md's own
// "two sources reviewed together" note already applies elsewhere
// (docs/PRIVACY_POLICY.md vs. src/profile/legal.js).
//
// `cache` is whatever solar.js's SUN_TIMES_STORAGE_KEY holds, parsed
// (or null/malformed — never thrown on): { date, rise, set }. A cache
// missing, malformed, or not from today (its own `date` string doesn't
// match `now`'s) falls back to the exact same fixed stand-in times
// sundown/location.js's fallbackSun() uses (6:50 am rise, 8:10 pm set)
// — "with no cache, it falls back to 6:50 am / 8:10 pm," per the doc.
export function resolveBootThemeFromSunCache(cache, now){
  let riseMs, setMs;
  const todayKey = now.toDateString();
  if(cache && cache.date === todayKey && cache.rise && cache.set){
    riseMs = new Date(cache.rise).getTime();
    setMs = new Date(cache.set).getTime();
  } else {
    const at = (h, m) => { const x = new Date(now); x.setHours(h, m, 0, 0); return x.getTime(); };
    riseMs = at(6, 50); setMs = at(20, 10);
  }
  const t = now.getTime();
  return (t >= riseMs && t < setMs) ? 'light' : 'dark';
}
