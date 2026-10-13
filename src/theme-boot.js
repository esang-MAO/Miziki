/* theme-boot.js — avoids a flash of the wrong theme for a pinned Light or
   Dark choice (D2, docs/DESKTOP_LAYOUT.md). IndexedDB, where S.theme is
   actually persisted (src/storage/meta.js), is only readable after first
   paint, so this is a separate, tiny external classic script (the CSP
   allows only same-origin scripts, no inline) loaded early in <head> —
   it runs and blocks parsing before the stylesheet <link> tags after it,
   so document.documentElement.dataset.theme is already set by the time
   those rules are applied. Reads the localStorage mirror src/ui/theme.js
   keeps in sync with the real saved value, under the same key
   (THEME_STORAGE_KEY there — duplicated here as a literal rather than
   imported, since this file has to stay import-free to run as a plain
   classic script). Auto needs none of this: with no data-theme attribute
   set, @media (prefers-color-scheme) in src/styles/22-theme.css handles
   it with zero JavaScript at first paint. Wrapped in try/catch —
   localStorage can be blocked (private browsing, some embedded
   contexts), and losing this optimization is far cheaper than throwing
   before the rest of the page has even started loading. */
(function(){
  try {
    var t = localStorage.getItem('miziki-theme');
    if(t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
  } catch(_e) {}
})();
