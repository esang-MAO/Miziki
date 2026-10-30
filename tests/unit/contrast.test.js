// RF12 (docs/12_REFINE.md, point 4): "a small script computes contrast for
// every `color:` declaration resolved against both themes' backgrounds and
// fails below 4.5:1 for text under 18px." This checks exactly the family
// of tokens RF12 itself is about -- --accent, --accent-text and --amber
// (RF12 point 1's own wording: "Every text use of --accent, --amber or
// --miziki-orange becomes --accent-text" -- --miziki-orange itself was
// removed by FS1, docs/25_FROM_SCRATCH.md, which renamed every one of its
// uses onto --amber) -- plus any hardcoded hex literal equal to one of
// those tokens' own values, since that's exactly the kind of bypass-the-
// token bug point 1's grep-based sweep could miss (and did: see
// 03-sleeve-pull.css's .heart-btn fix, found by an early run of this very
// script).
//
// It deliberately does NOT check every arbitrary `color:` declaration in
// the stylesheets. Two reasons, both load-bearing: (1) --on-accent and
// --cool are different token families with their own established
// contrast partner (--on-accent is "text on a solid accent fill" by
// design -- it's meant to be read against --accent, not the page
// background) and were never part of RF12's remit; (2) a long list of
// pre-existing, already-shipped hex literals (sticker/badge/disc-label
// colors, the star-rating amber, a warning pink, a danger red) each sit on
// their own opaque card/chip background, not directly on the sky gradient
// -- checking them against sky produced a wall of false positives on an
// early run and would make the test meaningless noise instead of a real
// gate. See docs/design/refine/README.md's own "Colour (RF12, RF14)"
// section for the "lower of the two sky stops" methodology this reuses,
// written for exactly this accent/amber/miziki-orange question.
//
// Icon/glyph selectors (anything targeting an <svg>, where `color` drives
// `stroke:currentColor` rather than text) are excluded too -- RF12 point 1
// is explicitly about *text*, and point 2's own .tabbar-btn svg treatment
// is a deliberate, documented exception (the active tab's icon stays
// --accent regardless of size, so the active state is legible even though
// it's a graphical element, not body text).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STYLES_DIR = path.join(__dirname, '..', '..', 'src', 'styles');

const ACCENT_FAMILY_TOKENS = ['--accent', '--accent-text', '--amber'];

function stripComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

function parseDeclarations(body) {
  const out = {};
  for (const raw of body.split(';')) {
    const decl = raw.trim();
    if (!decl) continue;
    const idx = decl.indexOf(':');
    if (idx === -1) continue;
    const prop = decl.slice(0, idx).trim();
    const value = decl.slice(idx + 1).trim();
    if (prop) out[prop] = value;
  }
  return out;
}

// A flat, non-nested regex is enough to pull every leaf rule (selector +
// declaration body) out of a stylesheet regardless of @media nesting --
// an @media wrapper's own `{` before any leaf rule is just unmatched text
// to this pattern, so it's skipped rather than mis-parsed.
function eachLeafRule(css, fn) {
  const re = /([^{}]*)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(css))) fn(m[1].trim(), m[2]);
}

function extractRootTokens(css, selectorPattern) {
  const tokens = {};
  eachLeafRule(css, (selector, body) => {
    if (!selectorPattern.test(selector)) return;
    const decls = parseDeclarations(body);
    for (const [prop, value] of Object.entries(decls)) {
      if (prop.startsWith('--')) tokens[prop] = value;
    }
  });
  return tokens;
}

const baseCss = readFileSync(path.join(STYLES_DIR, '00-base.css'), 'utf8');
const themeCss = readFileSync(path.join(STYLES_DIR, '22-theme.css'), 'utf8');

const darkTokens = extractRootTokens(stripComments(baseCss), /^:root$/);
const lightOverrides = extractRootTokens(
  stripComments(themeCss),
  /^:root\[data-theme="light"\]$/
);
const lightTokens = { ...darkTokens, ...lightOverrides };
const THEMES = { dark: darkTokens, light: lightTokens };

function resolveValue(value, tokens, seen = new Set()) {
  const m = /^var\(\s*(--[\w-]+)\s*(?:,\s*([\s\S]+))?\)$/.exec(value.trim());
  if (!m) return value.trim();
  const [, name, fallback] = m;
  if (seen.has(name)) return null;
  seen.add(name);
  if (name in tokens) return resolveValue(tokens[name], tokens, seen);
  if (fallback !== undefined) return resolveValue(fallback, tokens, seen);
  return null;
}

function parseColor(value) {
  if (!value) return null;
  const hex = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.exec(value);
  if (hex) {
    let h = hex[1];
    if (h.length === 3) h = h.split('').map((c) => c + c).join('');
    return {
      r: parseInt(h.slice(0, 2), 16),
      g: parseInt(h.slice(2, 4), 16),
      b: parseInt(h.slice(4, 6), 16),
      a: 1,
    };
  }
  const rgba = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+))?\s*\)$/.exec(value);
  if (rgba) {
    return {
      r: parseFloat(rgba[1]),
      g: parseFloat(rgba[2]),
      b: parseFloat(rgba[3]),
      a: rgba[4] !== undefined ? parseFloat(rgba[4]) : 1,
    };
  }
  return null;
}

function srgbToLinear(c) {
  const n = c / 255;
  return n <= 0.03928 ? n / 12.92 : Math.pow((n + 0.055) / 1.055, 2.4);
}

function relativeLuminance({ r, g, b }) {
  return 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b);
}

function contrastRatio(c1, c2) {
  const l1 = relativeLuminance(c1);
  const l2 = relativeLuminance(c2);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

// The literal hex each accent-family token resolves to, per theme -- used
// to also catch a hardcoded hex that bypasses the token entirely (the
// .heart-btn bug this script found).
function accentHexesForTheme(tokens) {
  const hexes = new Set();
  for (const name of ACCENT_FAMILY_TOKENS) {
    if (!(name in tokens)) continue;
    const resolved = resolveValue(`var(${name})`, tokens);
    if (resolved) hexes.add(resolved.toLowerCase());
  }
  return hexes;
}

function isAccentFamilyDeclaration(colorValue, tokens) {
  const trimmed = colorValue.trim();
  const varMatch = /^var\(\s*(--[\w-]+)/.exec(trimmed);
  if (varMatch && ACCENT_FAMILY_TOKENS.includes(varMatch[1])) return true;
  if (/^#[0-9a-fA-F]{3,6}$/.test(trimmed)) {
    return accentHexesForTheme(tokens).has(trimmed.toLowerCase());
  }
  return false;
}

function isIconSelector(selector) {
  // Matches a bare `svg` tag anywhere in the selector (as its own token,
  // not part of a class name like `.svg-something`) -- e.g. `.foo svg`,
  // `svg.bar`, `.foo svg.bar:hover`.
  return /(^|[\s>+~.#\[:])svg(?=$|[\s.#\[:,])/.test(selector);
}

function findCandidateRules(css, filename) {
  const clean = stripComments(css);
  const rules = [];
  eachLeafRule(clean, (selector, body) => {
    if (!selector || selector.startsWith('@') || selector.startsWith(':root')) return;
    if (isIconSelector(selector)) return;
    const decls = parseDeclarations(body);
    if (!('color' in decls)) return;
    const colorValue = decls.color;
    if (/^(currentcolor|inherit|initial|unset)$/i.test(colorValue.trim())) return;
    let fontSize = null;
    if ('font-size' in decls) {
      const raw = decls['font-size'].trim();
      const fm = /^([\d.]+)px$/.exec(raw);
      if (fm) {
        fontSize = parseFloat(fm[1]);
      } else {
        // RF13: font-size is now almost always var(--fs-*) -- resolve it
        // against the same dark-token map every --fs-* token is defined
        // in (00-base.css's bare :root), since none of those tokens is
        // redeclared per theme the way color tokens are.
        const resolved = resolveValue(raw, darkTokens);
        const pm = resolved && /^([\d.]+)px$/.exec(resolved);
        if (pm) fontSize = parseFloat(pm[1]);
      }
    }
    rules.push({ file: filename, selector, colorValue, fontSize });
  });
  return rules;
}

const styleFiles = readdirSync(STYLES_DIR).filter((f) => f.endsWith('.css')).sort();

const allRules = [];
for (const file of styleFiles) {
  const css = readFileSync(path.join(STYLES_DIR, file), 'utf8');
  allRules.push(...findCandidateRules(css, file));
}

test('style files were actually found and scanned', () => {
  assert.ok(styleFiles.length > 5, 'expected several stylesheet files');
  assert.ok(allRules.length > 5, 'expected several text color: rules to check');
});

test('accent/amber/miziki-orange text clears 4.5:1 against both sky stops, under 18px, in both themes', () => {
  const failures = [];

  for (const rule of allRules) {
    const isSmallText = rule.fontSize === null || rule.fontSize < 18;
    if (!isSmallText) continue;

    for (const [themeName, tokens] of Object.entries(THEMES)) {
      if (!isAccentFamilyDeclaration(rule.colorValue, tokens)) continue;

      const resolved = resolveValue(rule.colorValue, tokens);
      const fg = parseColor(resolved);
      if (!fg || fg.a < 1) continue;

      for (const skyVar of ['--sky1', '--sky2']) {
        const bg = parseColor(resolveValue(`var(${skyVar})`, tokens));
        if (!bg) continue;
        const ratio = contrastRatio(fg, bg);
        if (ratio < 4.5) {
          failures.push(
            `${rule.file} :: ${rule.selector} :: color:${rule.colorValue} ` +
            `(font-size:${rule.fontSize ?? 'inherited'}) in ${themeName} theme ` +
            `against ${skyVar} — ratio ${ratio.toFixed(2)}:1`
          );
        }
      }
    }
  }

  assert.deepEqual(failures, [], `contrast failures below 4.5:1:\n${failures.join('\n')}`);
});

// RF14 (docs/12_REFINE.md, point 5): "extend the existing per-minute
// contrast test to cover --muted, --muted-2 and the dial labels." --muted/
// --muted-2 are covered dynamically, per real minute of a real day, by
// tests/unit/clock.test.js's own mutedGradientStops() sweep (that's where
// the function lives). The Day view's two label surfaces never actually
// sit on the moving ring itself, so there's no per-minute sweep to run for
// either -- but each is still a real, checkable invariant, verified here:
//   - .day-dial-label (the disc's own time readout, #dayDialTime/
//     #dayDialAmPm) sits on a solid var(--amber) fill with var(--on-accent)
//     text -- a fixed pair that doesn't move with the sky in either theme
//     (CLAUDE.md: "the disc... keep[s] [its] own colors in both themes").
//   - .day-dial-hourlabel (12P/6P/12A/6A) was moved fully off the ring by
//     RF12's own fix (negative offsets, clear of the conic-gradient band)
//     specifically so it reads var(--paper) against the page's sky
//     background instead -- i.e. it's already covered by the
//     accent/paper-vs-sky sweep in clock.test.js's "every anchor stays
//     >=4.5:1 against paper/muted/accent-text" tests. This test is a
//     regression guard that it stays that way: still var(--paper), still
//     off the ring, never a color read directly against a ring segment.
test('dial labels: the disc readout (on-accent/amber) and hour labels (paper, off the ring) stay legible, both themes', () => {
  const dayArcCss = readFileSync(path.join(STYLES_DIR, '25-day-arc-v2.css'), 'utf8');
  const clean = stripComments(dayArcCss);

  let labelDecls = null;
  let hourlabelDecls = null;
  eachLeafRule(clean, (selector, body) => {
    if (selector === '.day-dial-label') labelDecls = parseDeclarations(body);
    if (selector === '.day-dial-hourlabel') hourlabelDecls = parseDeclarations(body);
  });

  assert.ok(labelDecls, '.day-dial-label rule should exist in 25-day-arc-v2.css');
  assert.ok(hourlabelDecls, '.day-dial-hourlabel rule should exist in 25-day-arc-v2.css');

  // The hour labels must still read var(--paper) -- if this ever changes
  // to something read directly against the ring's own moving colors, this
  // test's "already covered elsewhere" reasoning above stops holding and
  // the new value needs its own per-minute sweep.
  assert.equal(hourlabelDecls.color.trim(), 'var(--paper)');

  for (const [themeName, tokens] of Object.entries(THEMES)) {
    const fg = parseColor(resolveValue(labelDecls.color, tokens));
    const bg = parseColor(resolveValue(labelDecls.background, tokens));
    assert.ok(fg && bg, `${themeName}: .day-dial-label's color/background should resolve to real colors`);
    const ratio = contrastRatio(fg, bg);
    assert.ok(ratio >= 4.5, `${themeName}: .day-dial-label contrast ${ratio.toFixed(2)} below 4.5:1`);
  }
});

// CR8 (docs/13_CRATE.md, "palette additions", point 5): "Extend RF12's
// contrast test to the new tokens against both themes' backgrounds (muted
// >= 4.5 everywhere; secondaries >= 3 for paper text; the shade >= 4.5 on
// --sky2)." --muted already existed (RF14); this is CR8's own light-theme
// value (#6B6258) plus the dark value, both checked against both sky
// stops in both themes, since the README's own "paper text on them"
// numbers for the secondaries were measured against a sky background too
// (docs/design/crate/README.md's own "Palette additions (CR8)" section).
test('CR8: --muted clears 4.5:1 against both sky stops, in both themes', () => {
  const failures = [];
  for (const [themeName, tokens] of Object.entries(THEMES)) {
    const fg = parseColor(resolveValue('var(--muted)', tokens));
    assert.ok(fg, `${themeName}: --muted should resolve to a real color`);
    for (const skyVar of ['--sky1', '--sky2']) {
      const bg = parseColor(resolveValue(`var(${skyVar})`, tokens));
      const ratio = contrastRatio(fg, bg);
      if (ratio < 4.5) {
        failures.push(`${themeName} --muted vs ${skyVar} — ratio ${ratio.toFixed(2)}:1`);
      }
    }
  }
  assert.deepEqual(failures, [], `--muted contrast failures:\n${failures.join('\n')}`);
});

// --amber-shade is meant for "14px+ bold, icons and fills, not small
// text" (the README's own wording) — the one CR8 token this test checks
// against the general <18px text floor's own stricter neighbour (4.5:1),
// per point 5's explicit "the shade >= 4.5 on --sky2" ask, not the lower
// large-text floor its own intended use would otherwise allow.
test('CR8: --amber-shade clears 4.5:1 against --sky2, in both themes', () => {
  const failures = [];
  for (const [themeName, tokens] of Object.entries(THEMES)) {
    const fg = parseColor(resolveValue('var(--amber-shade)', tokens));
    const bg = parseColor(resolveValue('var(--sky2)', tokens));
    assert.ok(fg && bg, `${themeName}: --amber-shade/--sky2 should resolve to real colors`);
    const ratio = contrastRatio(fg, bg);
    if (ratio < 4.5) failures.push(`${themeName} --amber-shade vs --sky2 — ratio ${ratio.toFixed(2)}:1`);
  }
  assert.deepEqual(failures, [], `--amber-shade contrast failures:\n${failures.join('\n')}`);
});

// Secondaries are shades meant to sit as a fill with light text on top
// (the README's own "paper text on them" figures: Prussian 6.3, Verdigris
// 3.3, Puce 5.2, Olive 4.6, all measured in dark theme, where --paper is
// the light cream ink). In light theme --paper flips to the dark
// aubergine ink CR8 point 2 just set, so that pairing would be reading
// dark text against a mid-tone fill -- exactly backwards from what the
// README measured. Point 2's own instruction for light theme is "the
// secondaries with CREAM text," not paper text, so this checks --paper
// in dark theme (the pairing the README's own numbers describe) and
// --cream in light theme (the pairing point 2 actually calls for) --
// both are the light/cream-ish text color each theme would really use on
// top of one of these fills. Olive's own deep variant isn't separately
// named in the README's figure list (it's a darker bridge tone, not a
// fourth fill of its own), so it isn't checked here as a fourth
// secondary -- it has no "light text on top of it" use site yet either.
// FS1 (docs/25_FROM_SCRATCH.md, point 4): "extend the existing contrast
// test to every new/changed token in both themes ... --danger >= 4.5 on
// --popover, light --accent-text >= 4.5 on --sky1/--sky2/--stock-card."
// The light --accent-text/--stock-card case is already covered by
// theme.test.js's own TY1 test (stock-card's light value is unchanged by
// FS1 -- only its *literal paper-slip* reading changed, to #FBF7EE, which
// is lighter still and so only improves that ratio). --popover is dark-
// only (light theme's popovers/menus still read --panel/--chrome), so
// --danger is checked against --popover in dark and against both sky
// stops in light, the same "whatever it actually sits on" pairing CR8's
// own secondaries test below uses.
test('FS1: --danger clears 4.5:1 against the surface it actually sits on, in both themes', () => {
  const failures = [];
  const dangerBg = { dark: ['--popover'], light: ['--sky1', '--sky2'] };
  for (const [themeName, tokens] of Object.entries(THEMES)) {
    const fg = parseColor(resolveValue('var(--danger)', tokens));
    assert.ok(fg, `${themeName}: --danger should resolve to a real color`);
    for (const bgVar of dangerBg[themeName]) {
      const bg = parseColor(resolveValue(`var(${bgVar})`, tokens));
      assert.ok(bg, `${themeName}: ${bgVar} should resolve to a real color`);
      const ratio = contrastRatio(fg, bg);
      if (ratio < 4.5) failures.push(`${themeName} --danger vs ${bgVar} — ratio ${ratio.toFixed(2)}:1`);
    }
  }
  assert.deepEqual(failures, [], `--danger contrast failures:\n${failures.join('\n')}`);
});

test('CR8: secondaries clear 3:1 for the light text each theme would put on them', () => {
  const secondaries = ['--prussian', '--verdigris', '--puce', '--olive'];
  const TEXT_TOKEN = { dark: '--paper', light: '--cream' };
  const failures = [];
  for (const [themeName, tokens] of Object.entries(THEMES)) {
    const fg = parseColor(resolveValue(`var(${TEXT_TOKEN[themeName]})`, tokens));
    assert.ok(fg, `${themeName}: ${TEXT_TOKEN[themeName]} should resolve to a real color`);
    for (const name of secondaries) {
      const bg = parseColor(resolveValue(`var(${name})`, tokens));
      assert.ok(bg, `${themeName}: ${name} should resolve to a real color`);
      const ratio = contrastRatio(fg, bg);
      if (ratio < 3) failures.push(`${themeName} ${TEXT_TOKEN[themeName]} on ${name} — ratio ${ratio.toFixed(2)}:1`);
    }
  }
  assert.deepEqual(failures, [], `secondary contrast failures:\n${failures.join('\n')}`);
});
