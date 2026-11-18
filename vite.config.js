// package.json has no "type": "module" (tests/client.test.js uses require()
// and must keep working unchanged), so this file is loaded as CommonJS —
// plain require()/module.exports, not import/export.
const { defineConfig } = require('vite');
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');

// BD13 (docs/38_BEFORE_THE_DOMAIN.md): the "Copy error log" sheet shows an
// app build id so Ken can match a tester's report to a commit -- a short
// git SHA, read once at config load (same build serves every request in
// `vite dev` too, so this doesn't need to run per-request). Falls back to
// 'dev' wherever git isn't available (a tarball checkout, a shallow clone
// with no HEAD) rather than failing the build over a diagnostic label.
function buildId(){
  try{
    return execSync('git rev-parse --short HEAD', { cwd: __dirname }).toString().trim();
  }catch(_e){
    return 'dev';
  }
}

// src/theme-boot.js (D2, docs/DESKTOP_LAYOUT.md) — the anti-flash head
// script: a plain classic <script src>, not type="module", so Vite leaves
// it completely untouched rather than bundling it. It has to run before
// src/ui/theme.js (a real module, bundled normally) even loads, which is
// the whole point of it being a separate file in the first place.
// (src/miziki-social.js used to need the same treatment via a sibling
// copySocialClient() plugin here, but TR3, docs/19_PLAYER.md turned it
// into a real ES module, statically imported for its side effect from
// src/main.js, so Vite now bundles and minifies it normally like any
// other module — no plugin needed.)
function copyThemeBoot() {
  return {
    name: 'copy-theme-boot',
    apply: 'build',
    closeBundle() {
      const from = path.resolve(__dirname, 'src/theme-boot.js');
      const toDir = path.resolve(__dirname, 'dist/src');
      fs.mkdirSync(toDir, { recursive: true });
      fs.copyFileSync(from, path.join(toDir, 'theme-boot.js'));
    },
  };
}

// The base this build is deployed under — GitHub Pages' '/Miziki/' unless
// MIZIKI_BASE overrides it (Netlify previews set it to '/'). Read once
// here so both the `base` config below and serviceWorkerPlugin's own
// precache-path building agree with each other.
const BASE = process.env.MIZIKI_BASE || '/Miziki/';

// BD14 (docs/38_BEFORE_THE_DOMAIN.md): at closeBundle, once every other
// file is already in dist/ (registered after copyThemeBoot above, so its
// copy is included too), list every file and write dist/sw.js from
// src/sw-template.js with the real precache list and build id substituted
// in — see that file's own header comment for the placeholder format.
// Runs for a Netlify preview build too (serviceWorker.register() itself,
// src/main.js, only ever reaches the real `navigator.serviceWorker` where
// it exists, so this doesn't add any risk there).
function serviceWorkerPlugin() {
  return {
    name: 'service-worker',
    apply: 'build',
    closeBundle() {
      const distDir = path.resolve(__dirname, 'dist');
      const paths = [];
      (function walk(dir) {
        for (const name of fs.readdirSync(dir)) {
          const full = path.join(dir, name);
          if (fs.statSync(full).isDirectory()) walk(full);
          else paths.push(BASE + path.relative(distDir, full).split(path.sep).join('/'));
        }
      })(distDir);

      let sw = fs.readFileSync(path.resolve(__dirname, 'src/sw-template.js'), 'utf8');
      sw = sw.replace('"__MIZIKI_PRECACHE_LIST__"', JSON.stringify(paths));
      sw = sw.replace('"__MIZIKI_BUILD_ID__"', JSON.stringify(buildId()));
      fs.writeFileSync(path.join(distDir, 'sw.js'), sw);
    },
  };
}

module.exports = defineConfig({
  // The deployed app is saved to the home screen at this exact path
  // (https://esang-mao.github.io/Miziki/miziki.html) — base must stay
  // '/Miziki/' so every asset URL the build emits resolves correctly
  // under GitHub Pages' project-site prefix. The GitHub Actions workflow
  // never sets MIZIKI_BASE, so that deploy is unaffected by this env var
  // and always gets '/Miziki/'. Netlify (a root-domain preview, not a
  // project-site subpath) sets MIZIKI_BASE=/ in netlify.toml instead.
  base: BASE,
  build: {
    outDir: 'dist',
    rollupOptions: {
      // miziki.html, not index.html, is the one entry point — its name
      // must be preserved in dist/ since that's the saved home-screen URL.
      input: path.resolve(__dirname, 'miziki.html'),
    },
  },
  // serviceWorkerPlugin must run after copyThemeBoot -- it walks dist/ to
  // build the precache list, so everything else needs to already be there.
  plugins: [copyThemeBoot(), serviceWorkerPlugin()],
  // src/util/debug-log.js reads this through a `typeof __BUILD_ID__ !==
  // 'undefined'` guard, so plain Node (tests/unit, not bundled by Vite)
  // just falls back to 'dev' instead of needing this define too.
  define: { __BUILD_ID__: JSON.stringify(buildId()) },
});
