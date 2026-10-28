// package.json has no "type": "module" (tests/client.test.js uses require()
// and must keep working unchanged), so this file is loaded as CommonJS —
// plain require()/module.exports, not import/export.
const { defineConfig } = require('vite');
const path = require('path');
const fs = require('fs');

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

module.exports = defineConfig({
  // The deployed app is saved to the home screen at this exact path
  // (https://esang-mao.github.io/Miziki/miziki.html) — base must stay
  // '/Miziki/' so every asset URL the build emits resolves correctly
  // under GitHub Pages' project-site prefix. The GitHub Actions workflow
  // never sets MIZIKI_BASE, so that deploy is unaffected by this env var
  // and always gets '/Miziki/'. Netlify (a root-domain preview, not a
  // project-site subpath) sets MIZIKI_BASE=/ in netlify.toml instead.
  base: process.env.MIZIKI_BASE || '/Miziki/',
  build: {
    outDir: 'dist',
    rollupOptions: {
      // miziki.html, not index.html, is the one entry point — its name
      // must be preserved in dist/ since that's the saved home-screen URL.
      input: path.resolve(__dirname, 'miziki.html'),
    },
  },
  plugins: [copyThemeBoot()],
});
