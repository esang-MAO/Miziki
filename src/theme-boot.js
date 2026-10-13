/* theme-boot.js — avoids a flash of the wrong theme for a pinned Light,
   Dark or Nychthemeron choice (D2, docs/DESKTOP_LAYOUT.md; Nychthemeron
   since DA4, docs/DAY_ARC.md). IndexedDB, where S.theme is actually
   persisted (src/storage/meta.js), is only readable after first paint,
   so this is a separate, tiny external classic script (the CSP allows
   only same-origin scripts, no inline) loaded early in <head> — it runs
   and blocks parsing before the stylesheet <link> tags after it, so
   document.documentElement.dataset.theme is already set by the time
   those rules are applied. Reads the localStorage mirror src/ui/theme.js
   keeps in sync with the real saved value, under the same key
   (THEME_STORAGE_KEY there — duplicated here as a literal rather than
   imported, since this file has to stay import-free to run as a plain
   classic script). Auto needs none of this: with no data-theme attribute
   set, @media (prefers-color-scheme) in src/styles/22-theme.css handles
   it with zero JavaScript at first paint.

   Nychthemeron needs one more fact this script otherwise has no way to
   know: whether the sun is up right now. Location is never stored
   (CLAUDE.md, the privacy policy), so this can't call the real location
   API or wait on it before first paint — instead it reads the same
   device-only, no-coordinates cache src/sundown/solar.js's
   persistSunTimesCache() keeps fresh (SUN_TIMES_STORAGE_KEY there,
   duplicated here as a literal for the same "stay import-free" reason):
   just today's own rise/set clock times, nothing that could identify
   where the device is. A missing cache, a malformed one, or one from a
   day other than today (its own `date` no longer matches) falls back to
   the same fixed stand-in times sundown/location.js's own fallbackSun()
   uses (6:50 am / 8:10 pm) — exactly mirrored by
   src/ui/theme.js's own resolveBootThemeFromSunCache(), kept here as a
   plain inline literal rather than imported for the same reason as
   everything else in this file; that exported copy exists only so this
   exact decision has something a unit test can call without a browser,
   per CLAUDE.md's own "two sources reviewed together" discipline. The
   real app corrects this guess within moments either way, the instant
   S.sun is actually populated (computeSun()/fallbackSun(), both already
   called at boot) and src/ui/theme.js's own applyTheme() runs for real —
   this is only ever a best-guess for the few hundred milliseconds before
   that.

   Wrapped in try/catch throughout — localStorage can be blocked (private
   browsing, some embedded contexts), and losing this optimization is far
   cheaper than throwing before the rest of the page has even started
   loading. */
(function(){
  try {
    var t = localStorage.getItem('miziki-theme');
    if(t === 'light' || t === 'dark'){
      document.documentElement.dataset.theme = t;
    } else if(t === 'nychthemeron'){
      var now = new Date();
      var todayKey = now.toDateString();
      var riseMs, setMs;
      var cache = null;
      try {
        var raw = localStorage.getItem('miziki-sun-times');
        cache = raw ? JSON.parse(raw) : null;
      } catch(_e2) { cache = null; }
      if(cache && cache.date === todayKey && cache.rise && cache.set){
        riseMs = new Date(cache.rise).getTime();
        setMs = new Date(cache.set).getTime();
      } else {
        var rise = new Date(now); rise.setHours(6, 50, 0, 0); riseMs = rise.getTime();
        var set = new Date(now); set.setHours(20, 10, 0, 0); setMs = set.getTime();
      }
      var nowMs = now.getTime();
      document.documentElement.dataset.theme = (nowMs >= riseMs && nowMs < setMs) ? 'light' : 'dark';
    }
  } catch(_e) {}
})();
