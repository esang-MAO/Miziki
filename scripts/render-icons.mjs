#!/usr/bin/env node
// BD14a (docs/38_BEFORE_THE_DOMAIN.md): "Spindle on the app's dark ground" --
// a fermata printed on a record's amber label, the spindle hole its dot.
// Replaces BD14's original wordmark-on-dark-ground icon (the wordmark
// itself doesn't change; only the icon/favicon picture does). Run by hand
// (`node scripts/render-icons.mjs`) whenever data/spindle*.svg or the
// app's dark-ground gradient changes -- the output (public/icons/*.png) is
// checked into the repo like scripts/derive-makeup-table.mjs's own
// generated table, not regenerated on every build.
//
// No raster/canvas library is a project dependency, so this draws each
// icon in a real page (the spindle's own markup plus the share cards'
// "Night" gradient, src/share/styles.js's SHARE_BG) and screenshots it --
// same "drive a real Playwright Chromium" posture as tests/audio-render
// and tests/perf/nav.perf.js, just for a picture instead of audio/timing.
import { chromium } from '@playwright/test';
import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// Mirrors tests/perf/nav.perf.js's own findChromiumExecutable().
function findChromiumExecutable(){
  const browsersPath = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if(browsersPath && existsSync(browsersPath)){
    const dir = readdirSync(browsersPath).find(d => /^chromium-\d+$/.test(d));
    if(dir){
      const exe = path.join(browsersPath, dir, 'chrome-linux', 'chrome');
      if(existsSync(exe)) return exe;
      const exe64 = path.join(browsersPath, dir, 'chrome-linux64', 'chrome');
      if(existsSync(exe64)) return exe64;
    }
  }
  return undefined;
}

// data/spindle*.svg already carry literal colours (not the custom-property
// fallbacks the wordmark uses), so each can be read as-is -- no colour
// substitution needed before putting it in a plain page.
const spindleFull = readFileSync(path.join(ROOT, 'data/spindle.svg'), 'utf8');
const spindleMid = readFileSync(path.join(ROOT, 'data/spindle-mid.svg'), 'utf8');
const spindleLabel = readFileSync(path.join(ROOT, 'data/spindle-label.svg'), 'utf8');

// A flat ground, not src/share/styles.js's SHARE_BG gradient BD14 used --
// Ken asked (2026-11-18) for the record enlarged toward how tightly Siri/
// Camera/Settings crop their own glyph, and iOS 26's Liquid Glass now
// derives Dark/Tinted/Clear home-screen appearances from this one icon
// algorithmically (Safari only accepts a single icon image for a home-
// screen web app; there's no separate light/dark asset to author the way
// a native app's Icon Composer layers allow). Apple's own guidance for
// that derivation favors a plain, flat background over a gradient, so
// this is `#101A20` -- the same flat color public/manifest.webmanifest's
// `background_color`/`theme_color` and miziki.html's theme-color meta
// already use for the launch/splash background, not a new color.
const BG = '#101A20';

const ICON_SIZES = [180, 192, 512];

function pageHtml(svg, size, { fillPct }){
  // iOS/Android apply their own corner mask, so the icon itself stays a
  // plain square -- no border-radius here.
  return `<!doctype html><html><head><style>
    html,body{margin:0;padding:0}
    .icon{width:${size}px;height:${size}px;background:${BG};
      display:flex;align-items:center;justify-content:center}
    .icon svg{width:${fillPct}%;height:auto;display:block}
  </style></head><body><div class="icon">${svg}</div></body></html>`;
}

async function renderOne(browser, { svg, size, fillPct, outPath }){
  const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
  await page.setContent(pageHtml(svg, size, { fillPct }));
  const buf = await page.locator('.icon').screenshot({ type: 'png' });
  writeFileSync(outPath, buf);
  console.log('wrote', path.relative(ROOT, outPath));
  await page.close();
}

async function main(){
  const executablePath = findChromiumExecutable();
  const browser = await chromium.launch({
    ...(executablePath ? { executablePath } : {}),
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  const outDir = path.join(ROOT, 'public/icons');
  mkdirSync(outDir, { recursive: true });

  try{
    // 98%, not 100% -- data/spindle.svg's own viewBox already insets the
    // disc slightly via its root <g> scale, but at 100% the outer ring
    // grazes this icon's corner-mask preview with zero margin against a
    // real OS mask that isn't pixel-identical to this one; 98% was Ken's
    // own pick after comparing both side by side (2026-11-18).
    for(const size of ICON_SIZES){
      await renderOne(browser, { svg: spindleFull, size, fillPct: 98, outPath: path.join(outDir, `icon-${size}.png`) });
    }
    // favicon-32 from the mid cut (no grooves, heavier fermata), favicon-16
    // from the label cut (disc dropped entirely, per data/spindle-label.svg).
    await renderOne(browser, { svg: spindleMid, size: 32, fillPct: 82, outPath: path.join(outDir, 'favicon-32.png') });
    await renderOne(browser, { svg: spindleLabel, size: 16, fillPct: 88, outPath: path.join(outDir, 'favicon-16.png') });
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error('FAIL', err && err.message ? err.message : err);
  process.exitCode = 1;
});
