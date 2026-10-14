// package.json has no "type": "module" (tests/client.test.js uses require()
// and must keep working unchanged — see vite.config.js's own comment), so
// this file is loaded as CommonJS — plain require()/module.exports, the
// same pattern vite.config.js already uses.
const globals = require('globals');

// A small, focused rule set (step 6a) — a safety net against the idOf class
// of bug (step 5d: an import dropped from main.js while a function still
// used it; a missing import inside an ES module doesn't fail the build, it
// throws only when that line runs), not a style linter. No formatting
// rules here on purpose.
const SAFETY_NET_RULES = {
  'no-undef': 'error',
  // step 7g: caughtErrorsIgnorePattern added alongside args/vars — a
  // deliberately-ignored catch(e) is the single most common shape of
  // "unused on purpose" in this codebase (see CLAUDE.md's step 6a/7g
  // entries), and every one of them is now named with a leading `_` so
  // this rule can stop warning on it by the same convention as args/vars,
  // rather than needing its own exemption.
  'no-unused-vars': ['warn', {
    args: 'after-used', argsIgnorePattern: '^_',
    varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_',
  }],
  'no-redeclare': 'error',
  'no-dupe-keys': 'error',
  'no-unreachable': 'error',
  'no-const-assign': 'error',
  'no-import-assign': 'error',   // catches reassigning an imported `let` — refactor rule 7 in CLAUDE.md
  // security hardening, step 01: innerHTML/outerHTML/insertAdjacentHTML
  // with anything but a plain string literal is how song-tag text (an
  // artist/title the user doesn't control) turns into runnable markup —
  // see CLAUDE.md's "Security" notes. A literal like 'Mi<span>zi</span>ki'
  // or '' is fine; concatenating or interpolating any variable into one is
  // not — build the DOM with textContent/createElement/createTextNode
  // instead.
  'no-restricted-syntax': ['error',
    {
      selector: "AssignmentExpression[left.type='MemberExpression'][left.computed=false][left.property.name=/^(innerHTML|outerHTML)$/][right.type!='Literal']",
      message: 'Assigning to innerHTML/outerHTML with anything other than a plain string literal can run untrusted text (e.g. a song tag) as markup. Use textContent/createElement/createTextNode to build the DOM instead.',
    },
    {
      selector: "CallExpression[callee.type='MemberExpression'][callee.computed=false][callee.property.name='insertAdjacentHTML'][arguments.1.type!='Literal']",
      message: 'Calling insertAdjacentHTML with anything other than a plain string literal can run untrusted text (e.g. a song tag) as markup. Use textContent/createElement/createTextNode to build the DOM instead.',
    },
  ],
};

module.exports = [
  { ignores: ['dist/**', 'node_modules/**'] },

  // src/ — ES modules, browser runtime, except the three deliberate classic
  // scripts carved out below (see CLAUDE.md's repo-layout entries for why
  // each one is a plain script rather than a module).
  {
    files: ['src/**/*.js'],
    ignores: ['src/audio/scratch-processor.js', 'src/miziki-social.js', 'src/theme-boot.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: { ...globals.browser },
    },
    rules: SAFETY_NET_RULES,
  },

  // src/miziki-social.js, src/theme-boot.js — plain classic scripts (no
  // import/export). miziki-social.js loads via <script src> immediately
  // before src/main.js so MizikiSocial is already a real global by the
  // time main.js runs; theme-boot.js (D2) loads early in <head>, before
  // main.js even starts fetching, specifically so it can run import-free
  // — see that file's own header comment.
  {
    files: ['src/miziki-social.js', 'src/theme-boot.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'script',
      globals: { ...globals.browser },
    },
    rules: SAFETY_NET_RULES,
  },

  // src/audio/scratch-processor.js — runs in AudioWorkletGlobalScope, not
  // a browser window (no DOM, no fetch — globals.browser doesn't apply),
  // and deliberately has no import/export either; see the file's own
  // header comment and CLAUDE.md's F2 changelog entry for why.
  {
    files: ['src/audio/scratch-processor.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'script',
      globals: { ...globals.audioWorklet },
    },
    rules: SAFETY_NET_RULES,
  },

  // Modules that reach MizikiSocial as a real global rather than importing
  // it (see the repo-layout entry above) — declared explicitly so no-undef
  // doesn't trip on every call site.
  {
    files: [
      'src/main.js',
      'src/history/sessions.js',
      'src/library/delete.js',
      'src/library/edit.js',
      'src/library/import.js',
      'src/player/transport.js',
      'src/gatefold/view.js',
      'src/profile/storefront.js',
      'src/profile/settings.js',
      'src/social/screens/friend-store.js',
      'src/social/screens/home.js',
      'src/social/demo.js',
      'src/sync/backup.js',
      'src/profile/account.js',
      'src/profile/privacy.js',
      'src/shell/runout.js',
    ],
    languageOptions: {
      globals: { MizikiSocial: 'readonly' },
    },
  },

  // tests/unit/*.test.js — ESM, run under Node.
  {
    files: ['tests/unit/**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: { ...globals.node },
    },
    rules: SAFETY_NET_RULES,
  },

  // tests/perf/**/*.js (NV1) — plain Node scripts (ESM) that also contain
  // inline page.evaluate() closures executed inside a real Chromium page,
  // so both Node's and the browser's globals are in play in the same
  // file (indexedDB/document/performance/requestAnimationFrame/
  // PerformanceObserver inside the closures; process/console/import.meta
  // outside them).
  {
    files: ['tests/perf/**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: { ...globals.node, ...globals.browser },
    },
    rules: SAFETY_NET_RULES,
  },

  // tests/client.test.js and config files — plain CommonJS, run under Node.
  {
    files: ['tests/client.test.js', 'vite.config.js', 'eslint.config.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'commonjs',
      globals: { ...globals.node },
    },
    rules: SAFETY_NET_RULES,
  },
];
