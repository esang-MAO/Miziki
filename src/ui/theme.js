/* ================= theme: Auto/Light/Dark appearance (D2) =================
   S.theme is one of 'auto'/'light'/'dark', saved alongside the other
   prefs (serializePrefs/parsePrefs, storage/prefs.js) — but deliberately
   excluded from what gets backed up to the account: src/sync/backup.js's
   buildLocalState() strips it out of the prefs object before upload, per
   docs/DESKTOP_LAYOUT.md's own default ("device-only, listed as such in
   the CLAUDE.md key-inventory table") — an appearance choice is a
   per-device preference, not something that should follow the account to
   a different device the way the rest of `prefs` does.

   applyTheme() is the one function every control that changes the theme
   calls through setTheme() — the phone Character-menu row today, and
   (D7) the desktop sidebar's segmented control, both targeting the same
   [data-theme-choice] button convention so this file never needs to know
   which markup is on screen. applyTheme() itself:
     - sets (or removes, for Auto) document.documentElement.dataset.theme,
       which src/styles/22-theme.css's selectors read
     - mirrors a pinned choice to localStorage (THEME_STORAGE_KEY), read
       back by the tiny external <head> script (src/theme-boot.js) that
       runs before first paint, avoiding a flash for a pinned Light/Dark
       — Auto needs no such script, since `@media (prefers-color-scheme)`
       alone handles it with zero JS at first paint
     - updates <meta name="theme-color">, since a meta attribute can't
       read a CSS custom property — resolved against the *effective*
       theme (the device's own scheme, while Auto)
     - while Auto is active, listens for the device's own scheme changing
       live (e.g. at sunset) and re-applies; the listener is torn down
       the moment a pinned choice takes over, so there's never more than
       one at a time
     - syncs aria-pressed on every [data-theme-choice] button currently
       in the DOM, so it stays correct whether called at boot (the
       default), after restoreMeta() restores a saved choice, or after
       the user taps a control directly

   Every browser-only call (localStorage, matchMedia) is wrapped in
   try/catch, the same defensive posture src/theme-boot.js's own copy
   takes — storage or matchMedia can be blocked (private browsing, some
   embedded contexts), and losing the optimization there is a far smaller
   problem than throwing. */
import { S } from '../state.js';
import { queueSave } from '../storage/meta.js';

export const THEME_STORAGE_KEY = 'miziki-theme';
// the literal meta content each effective theme resolves to — the exact
// hex --sky2 already holds for each theme (00-base.css's dark block,
// 22-theme.css's light block), not a separately-chosen approximation
const THEME_COLOR = { dark: '#101A20', light: '#ECE5D8' };

let mq = null;
let mqHandler = null;

function effectiveTheme(){
  if(S.theme === 'light' || S.theme === 'dark') return S.theme;
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
  } else {
    delete root.dataset.theme;
    setupAutoListener();
    try { localStorage.removeItem(THEME_STORAGE_KEY); } catch(_e) {}
  }
  setMetaThemeColor(effectiveTheme());
  syncThemeButtons();
}

export function setTheme(choice){
  if(choice !== 'auto' && choice !== 'light' && choice !== 'dark') return;
  S.theme = choice;
  queueSave();
  applyTheme();
}
