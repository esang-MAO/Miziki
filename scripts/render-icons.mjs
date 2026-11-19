#!/usr/bin/env node
// BD14a (docs/38_BEFORE_THE_DOMAIN.md, addendum 2026-11-19): the fermata
// icon -- a full-bleed ochre (#C47F1E) square with a white fermata, one
// drawing at every size, no size cuts. Replaces the earlier Spindle icon
// (a fermata on a record label) this same step first shipped with. Run by
// hand (`node scripts/render-icons.mjs`) whenever data/fermata-icon.svg
// changes -- the output (public/icons/*.png) is checked into the repo like
// scripts/derive-makeup-table.mjs's own generated table, not regenerated
// on every build.
//
// No raster/canvas library is a project dependency, so this draws the icon
// in a real page and screenshots it -- same "drive a real Playwright
// Chromium" posture as tests/audio-render and tests/perf/nav.perf.js, just
// for a picture instead of audio/timing.
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

// data/fermata-icon.svg already carries literal colours (not the custom-
// property fallbacks the wordmark uses), so it can be read as-is -- no
// colour substitution needed before putting it in a plain page. The SVG's
// own full-square rect is the icon's ground, so the page needs no
// background of its own.
const fermataIcon = readFileSync(path.join(ROOT, 'data/fermata-icon.svg'), 'utf8');

const ICON_SIZES = [180, 192, 512];
const FAVICON_SIZES = [32, 16];

function pageHtml(svg, size){
  // iOS/Android apply their own corner mask, so the icon itself stays a
  // plain square -- no border-radius here. Edge to edge, not inset: the
  // SVG's own full-bleed rect is the ground, so there's no margin to
  // leave around it the way the old disc-on-ground icon needed.
  return `<!doctype html><html><head><style>
    html,body{margin:0;padding:0}
    .icon{width:${size}px;height:${size}px;display:flex;align-items:center;justify-content:center}
    .icon svg{width:100%;height:100%;display:block}
  </style></head><body><div class="icon">${svg}</div></body></html>`;
}

async function renderOne(browser, { size, outPath }){
  const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
  await page.setContent(pageHtml(fermataIcon, size));
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
    for(const size of ICON_SIZES){
      await renderOne(browser, { size, outPath: path.join(outDir, `icon-${size}.png`) });
    }
    for(const size of FAVICON_SIZES){
      await renderOne(browser, { size, outPath: path.join(outDir, `favicon-${size}.png`) });
    }
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error('FAIL', err && err.message ? err.message : err);
  process.exitCode = 1;
});
