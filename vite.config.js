// package.json has no "type": "module" (tests/client.test.js uses require()
// and must keep working unchanged), so this file is loaded as CommonJS —
// plain require()/module.exports, not import/export.
const { defineConfig } = require('vite');
const path = require('path');
const fs = require('fs');

// miziki.html loads src/miziki-social.js as a plain classic <script src>
// (not type="module"), on purpose — see the comment above that tag — so it
// keeps executing synchronously in place, exactly like the inline copy it
// replaced. Vite only bundles `type="module"` scripts referenced from HTML;
// a plain script src is left completely untouched (confirmed: `vite build`
// warns "can't be bundled without type=module" and never copies the file),
// so without this it would 404 in the built app. This plugin copies the
// file to the same src/ path under outDir, and the HTML references it via
// Vite's %BASE_URL% placeholder so the reference also resolves correctly
// under the '/Miziki/' base, in both dev and the build.
function copySocialClient() {
  return {
    name: 'copy-social-client',
    apply: 'build',
    closeBundle() {
      const from = path.resolve(__dirname, 'src/miziki-social.js');
      const toDir = path.resolve(__dirname, 'dist/src');
      fs.mkdirSync(toDir, { recursive: true });
      fs.copyFileSync(from, path.join(toDir, 'miziki-social.js'));
    },
  };
}

module.exports = defineConfig({
  // The deployed app is saved to the home screen at this exact path
  // (https://esang-mao.github.io/Miziki/miziki.html) — base must stay
  // '/Miziki/' so every asset URL the build emits resolves correctly
  // under GitHub Pages' project-site prefix.
  base: '/Miziki/',
  build: {
    outDir: 'dist',
    rollupOptions: {
      // miziki.html, not index.html, is the one entry point — its name
      // must be preserved in dist/ since that's the saved home-screen URL.
      input: path.resolve(__dirname, 'miziki.html'),
    },
  },
  plugins: [copySocialClient()],
});
