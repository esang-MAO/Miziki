#!/usr/bin/env node
// BD14 (docs/38_BEFORE_THE_DOMAIN.md): "Icons at 180, 192 and 512 px
// rendered from data/wordmark.svg on the app's dark ground." Run by hand
// (`node scripts/render-icons.mjs`) whenever the wordmark or the app's
// dark-ground gradient changes -- the output (public/icons/icon-*.png) is
// checked into the repo like scripts/derive-makeup-table.mjs's own
// generated table, not regenerated on every build.
//
// No raster/canvas library is a project dependency, so this draws the
// icon in a real page (the wordmark's own markup plus the share cards'
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

// data/wordmark.svg's own markup, with its two colours baked in as
// literals (src/ui/wordmark.js's wordmarkMarkup(), duplicated here rather
// than imported since that file does a Vite-only `?raw` import this
// plain script can't resolve) -- the "A" cut, paper letters on an accent
// ring, same as every other call site.
const wordmarkRaw = readFileSync(path.join(ROOT, 'data/wordmark.svg'), 'utf8');
const wordmarkSvg = wordmarkRaw
  .replace('fill:var(--paper,#EFE9DF)', 'fill:#EFE9DF')
  .replace('stroke:var(--accent-text,#E9A24A)', 'stroke:#E9A24A');

// src/share/styles.js's SHARE_BG, "Night" style's own top-to-bottom
// gradient (0%/55%/100%) -- the app's dark ground, duplicated here for
// the same reason as the wordmark colours above.
const BG = 'linear-gradient(to bottom, #1D2F38 0%, #101A20 55%, #07080C 100%)';

const SIZES = [180, 192, 512];

function pageHtml(size){
  // The mark is far wider than tall (data/wordmark.svg's own 4759.6x2128.2
  // viewBox) -- sized to 60% of the icon's width, centered, so it reads
  // clearly at even the smallest (180px) size without touching the edges.
  return `<!doctype html><html><head><style>
    html,body{margin:0;padding:0}
    .icon{width:${size}px;height:${size}px;background:${BG};
      display:flex;align-items:center;justify-content:center}
    .icon svg{width:60%}
  </style></head><body><div class="icon">${wordmarkSvg}</div></body></html>`;
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
    for(const size of SIZES){
      const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
      await page.setContent(pageHtml(size));
      const buf = await page.locator('.icon').screenshot({ type: 'png' });
      const outPath = path.join(outDir, `icon-${size}.png`);
      writeFileSync(outPath, buf);
      console.log('wrote', path.relative(ROOT, outPath));
      await page.close();
    }
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error('FAIL', err && err.message ? err.message : err);
  process.exitCode = 1;
});
