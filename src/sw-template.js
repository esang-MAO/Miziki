// BD14 (docs/38_BEFORE_THE_DOMAIN.md): generated into dist/sw.js at build
// time by vite.config.js's serviceWorkerPlugin, which replaces the two
// quoted placeholders below with the real precache list (every file in
// that build's own dist/, as root-relative paths under the build's base)
// and a
// short build id -- everything else in this file ships byte-for-byte as
// the real worker. Registered with `{ type: 'module' }` (src/main.js), so
// `export`/`import` are valid here the same as any other module.
//
// This file is also imported directly under Node (tests/unit/
// sw-template.test.js) to unit-test shouldServeFromCache() -- harmless,
// since that function only ever reads what its caller passes it, never
// the two placeholder constants below, which stay their literal
// placeholder strings when this file is loaded unsubstituted.
const PRECACHE_LIST = "__MIZIKI_PRECACHE_LIST__";
const BUILD_ID = "__MIZIKI_BUILD_ID__";
const CACHE_NAME = 'miziki-' + BUILD_ID;

// Pure fetch decision (BD14 item 8's own unit test target): a same-origin
// GET for a listed file goes to the cache; everything else -- a
// cross-origin request (Supabase), a non-GET, or a Range request (audio
// seeking needs partial-content support the cached Response doesn't have)
// -- is left for the browser to handle untouched. `precacheList` is a
// list of root-relative paths (e.g. '/Miziki/miziki.html'), not full
// URLs -- the build's own origin isn't known until it's actually
// deployed (GitHub Pages vs. a Netlify preview), so only the path is
// compared.
export function shouldServeFromCache({ url, method, origin, hasRange, precacheList }){
  if(method !== 'GET' || hasRange) return false;
  let parsed;
  try{ parsed = new URL(url); }catch(_e){ return false; }
  if(parsed.origin !== origin) return false;
  return precacheList.includes(parsed.pathname);
}

// `self`/`caches` don't exist under plain Node -- this whole block only
// ever runs inside the real service worker itself.
if(typeof self !== 'undefined' && typeof self.addEventListener === 'function'){
  self.addEventListener('install', (event) => {
    event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(PRECACHE_LIST)));
  });

  // BD14 item 4: never clients.claim() here and never skipWaiting() in
  // install above -- a new worker waits until every tab the old one
  // controls is gone, so an update only takes over at the next cold
  // start, never interrupting a running app or its playback.
  self.addEventListener('activate', (event) => {
    event.waitUntil(
      caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))),
    );
  });

  self.addEventListener('fetch', (event) => {
    const req = event.request;
    const serve = shouldServeFromCache({
      url: req.url, method: req.method, origin: self.location.origin,
      hasRange: req.headers.has('Range'), precacheList: PRECACHE_LIST,
    });
    if(!serve) return; // let it through untouched -- the browser's own network fetch
    event.respondWith(
      caches.open(CACHE_NAME).then(cache => cache.match(req).then(cached => cached || fetch(req))),
    );
  });
}
