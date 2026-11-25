// AC5 (docs/39_ACCESSIBILITY.md, finding 8): .crate-stage takes arrow/
// Page/Home/End/Enter/Space keys (crate/view.js's own keydown handler,
// stage.tabIndex = 0) but its own `outline:none` silenced even the
// app-wide :focus-visible rule (05-parts.css), since a class selector
// always beats a bare pseudo-class selector regardless of source order.
// A keyboard user tabbing to the stage got no visible focus at all.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const css = readFileSync(
  path.join(__dirname, '..', '..', 'src', 'styles', '10-crate.css'),
  'utf8'
);

test('.crate-stage still suppresses the default outline for non-keyboard focus', () => {
  assert.match(css, /\.crate-stage\{[^}]*outline:none/);
});

test('.crate-stage:focus-visible gets a visible ring, same token the app-wide rule uses', () => {
  const m = /\.crate-stage:focus-visible\{([^}]*)\}/.exec(css);
  assert.ok(m, '.crate-stage:focus-visible rule should exist');
  assert.match(m[1], /outline:\s*2px solid var\(--ring\)/);
});
