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
  'no-unused-vars': ['warn', { args: 'after-used', argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
  'no-redeclare': 'error',
  'no-dupe-keys': 'error',
  'no-unreachable': 'error',
  'no-const-assign': 'error',
  'no-import-assign': 'error',   // catches reassigning an imported `let` — refactor rule 7 in CLAUDE.md
};

module.exports = [
  { ignores: ['dist/**', 'node_modules/**'] },

  // src/ — ES modules, browser runtime, except the two deliberate classic
  // scripts carved out below (see CLAUDE.md's repo-layout entries for why
  // each one is a plain script rather than a module).
  {
    files: ['src/**/*.js'],
    ignores: ['src/audio/scratch-processor.js', 'src/miziki-social.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: { ...globals.browser },
    },
    rules: SAFETY_NET_RULES,
  },

  // src/miziki-social.js — a plain classic script (no import/export),
  // loaded via <script src> immediately before src/main.js so MizikiSocial
  // is already a real global by the time main.js runs.
  {
    files: ['src/miziki-social.js'],
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
      'src/profile/storefront.js',
      'src/profile/settings.js',
      'src/social/screens/friend-store.js',
      'src/social/screens/home.js',
      'src/social/demo.js',
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
