#!/usr/bin/env node
// NV1 (11_SMOOTH_NAVIGATION.md): the navigation performance baseline.
//
// Not run in CI — timings vary by machine and this script runs a real
// browser under CPU throttling, which is slow and noisy by nature. Run it
// by hand with `npm run perf`. Every later NV PR re-runs this (optionally
// with `--out <path>` to a scratch file) and adds its own before/after
// table to its PR description; this file's own default output,
// docs/perf/BASELINE.md, is NV1's one-time snapshot and isn't meant to be
// silently overwritten by a later PR's run (pass --out to avoid that).
//
// What it measures, each under 4x CPU throttling (an approximation of an
// iPhone's CPU relative to a dev machine — Chrome DevTools' own "4x
// slowdown" preset) against a synthetic library of 2,000 tracks / 180
// albums (tests/perf/lib/synthetic-library.js — no real audio, no real
// files, just IndexedDB rows shaped like src/library/import.js's
// storeTrack() already writes, so the app's own restoreLibrary() boot
// path loads them unmodified):
//   - time from a tab-bar tap to the next two painted frames, per tab
//   - long tasks (>50ms) during a 5-second library scroll
//   - time to open and close the queue sheet and the full player
//   - time to open and close the gatefold (best-effort: skipped with a
//     note if the crate layout/card selectors don't resolve in time)
//   - frames "dropped" (frame interval > 33ms, i.e. missed 60fps by more
//     than one frame) over a few seconds on the Sundown tab, where
//     drawSun() ticks the sky roughly every 220ms
//
// Uses the Chromium build already installed in this environment
// (PLAYWRIGHT_BROWSERS_PATH) via @playwright/test's chromium launcher,
// rather than `npx playwright install` (which would try to re-download).

import { chromium } from '@playwright/test';
import { execSync } from 'node:child_process';
import { readdirSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { serveDist } from './lib/static-server.js';
import { buildSyntheticLibrary } from './lib/synthetic-library.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const CPU_THROTTLE_RATE = 4;
const TRACK_COUNT = 2000;
const ALBUM_COUNT = 180;

function findChromiumExecutable(){
  const browsersPath = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if(browsersPath && existsSync(browsersPath)){
    const dir = readdirSync(browsersPath).find(d => /^chromium-\d+$/.test(d));
    if(dir){
      const exe = path.join(browsersPath, dir, 'chrome-linux', 'chrome');
      if(existsSync(exe)) return exe;
    }
  }
  return undefined; // fall back to @playwright/test's own resolution
}

function parseArgs(argv){
  const out = { outPath: path.join(ROOT, 'docs/perf/BASELINE.md') };
  for(let i = 0; i < argv.length; i++){
    if(argv[i] === '--out' && argv[i+1]){ out.outPath = path.resolve(argv[i+1]); i++; }
  }
  return out;
}

// Clicks `selector` and resolves once two rAF callbacks have fired after
// the click — an approximation of "painted the next frame," cheap enough
// to run from inside page.evaluate with no Playwright round-trip between
// the click and the start of the timer.
async function measureClickToFrame(page, selector){
  return page.evaluate((sel) => new Promise((resolve) => {
    const el = document.querySelector(sel);
    if(!el){ resolve(null); return; }
    const t0 = performance.now();
    el.click();
    requestAnimationFrame(() => requestAnimationFrame(() => resolve(performance.now() - t0)));
  }), selector);
}

async function measureLongTasksDuringScroll(page, durationMs = 5000){
  return page.evaluate((duration) => new Promise((resolve) => {
    const longTasks = [];
    const obs = new PerformanceObserver((list) => {
      for(const entry of list.getEntries()) longTasks.push(entry.duration);
    });
    try{ obs.observe({ entryTypes: ['longtask'] }); }catch(_e){ /* longtask not supported */ }
    const scroller = document.scrollingElement || document.documentElement;
    const start = performance.now();
    const maxScroll = Math.max(0, scroller.scrollHeight - window.innerHeight);
    function step(){
      const elapsed = performance.now() - start;
      if(elapsed >= duration){
        obs.disconnect();
        resolve({
          count: longTasks.length,
          totalMs: Math.round(longTasks.reduce((a,b) => a+b, 0)),
          longestMs: longTasks.length ? Math.round(Math.max(...longTasks)) : 0,
        });
        return;
      }
      const p = (elapsed % 1500) / 1500;
      scroller.scrollTop = maxScroll * (p < 0.5 ? p*2 : (1-p)*2);
      requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }), durationMs);
}

async function measureDroppedFrames(page, durationMs = 3000){
  return page.evaluate((duration) => new Promise((resolve) => {
    const deltas = [];
    let last = performance.now();
    const start = last;
    function step(now){
      deltas.push(now - last);
      last = now;
      if(now - start < duration){ requestAnimationFrame(step); return; }
      const dropped = deltas.filter(d => d > 33).length;
      resolve({ frames: deltas.length, dropped });
    }
    requestAnimationFrame(step);
  }), durationMs);
}

async function seedLibrary(page){
  const tracks = buildSyntheticLibrary(TRACK_COUNT, ALBUM_COUNT);
  await page.evaluate((recs) => new Promise((resolve, reject) => {
    const req = indexedDB.open('miziki', 4);
    req.onerror = () => reject(req.error || new Error('open failed'));
    req.onsuccess = () => {
      const db = req.result;
      const tx = db.transaction('tracks', 'readwrite');
      const store = tx.objectStore('tracks');
      for(const r of recs) store.put(r);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    };
  }), tracks);
}

async function main(){
  const { outPath } = parseArgs(process.argv.slice(2));

  console.log('Building dist/ …');
  execSync('npm run build', { cwd: ROOT, stdio: 'inherit' });

  const distDir = path.join(ROOT, 'dist');
  const { server, url } = await serveDist(distDir);
  console.log('Serving', distDir, 'at', url);

  const executablePath = findChromiumExecutable();
  const browser = await chromium.launch({ executablePath, headless: true });
  try{
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } }); // iPhone-ish
    page.on('pageerror', (err) => console.log('[pageerror]', err.message));

    // First visit: just boot, so DB.open()'s onupgradeneeded creates the
    // real store schema. No throttling yet — this is setup, not a
    // measurement.
    await page.goto(url, { waitUntil: 'networkidle' });
    await page.waitForTimeout(500);

    console.log(`Seeding synthetic library: ${TRACK_COUNT} tracks / ${ALBUM_COUNT} albums …`);
    await seedLibrary(page);

    // Reload so restoreLibrary() picks up the seeded tracks the same way
    // it would a real re-opened library.
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForFunction(() => document.querySelectorAll('.tracklist li').length > 0, { timeout: 20000 });

    const client = await page.context().newCDPSession(page);
    await client.send('Emulation.setCPUThrottlingRate', { rate: CPU_THROTTLE_RATE });

    const results = { trackCount: TRACK_COUNT, albumCount: ALBUM_COUNT, cpuThrottle: CPU_THROTTLE_RATE, tabs: {}, scroll: null, sheets: {}, sundown: null, notes: [] };

    // --- Tab switch timing ---
    const tabs = await page.$$eval('#tabbar [data-route]', (els) => els
      .filter(el => el.offsetParent !== null || el.style.display !== 'none')
      .map(el => el.getAttribute('data-route')));
    for(const route of tabs){
      const ms = await measureClickToFrame(page, `#tabbar [data-route="${route}"]`);
      if(ms !== null) results.tabs[route] = Math.round(ms * 100) / 100;
      await page.waitForTimeout(150);
    }
    // back to Library for the scroll measurement
    await page.click('#tabbar [data-route="library"]').catch(() => {});
    await page.waitForTimeout(200);

    // --- Library scroll long tasks ---
    console.log('Scrolling the library for 5s …');
    results.scroll = await measureLongTasksDuringScroll(page, 5000);

    // --- Queue sheet open/close ---
    try{
      await page.waitForSelector('#miniTap', { state: 'visible', timeout: 5000 });
      const playerOpenMs = await measureClickToFrame(page, '#miniTap');
      await page.waitForTimeout(250);
      const queueVisible = await page.$('#queueBtn:visible').catch(() => null);
      let queueOpenMs = null, queueCloseMs = null;
      if(queueVisible){
        queueOpenMs = await measureClickToFrame(page, '#queueBtn');
        await page.waitForTimeout(200);
        queueCloseMs = await measureClickToFrame(page, '#queueClose');
        await page.waitForTimeout(150);
      } else {
        results.notes.push('Queue sheet: #queueBtn was not visible (queue may have had only one track) — skipped.');
      }
      const playerCloseMs = await measureClickToFrame(page, '#playerDismiss');
      results.sheets.player = { open: round2(playerOpenMs), close: round2(playerCloseMs) };
      if(queueOpenMs !== null) results.sheets.queue = { open: round2(queueOpenMs), close: round2(queueCloseMs) };
    }catch(e){
      results.notes.push('Player/queue sheet timing failed: ' + e.message);
    }

    // --- Gatefold open/close (best-effort) ---
    // The library layout toggle (list/crate) lives in the "Library tools"
    // disclosure on the Profile home screen (#libTools — see its own
    // comment in miziki.html), not under the Library tab itself, so this
    // has to detour through Profile before coming back.
    try{
      await page.click('#tabbar [data-route="profile"]');
      await page.waitForSelector('#libToolsToggle', { state: 'visible', timeout: 5000 });
      await page.click('#libToolsToggle');
      await page.waitForSelector('#libLayoutToggle [data-layout="crate"]', { state: 'visible', timeout: 3000 });
      await page.click('#libLayoutToggle [data-layout="crate"]');
      await page.click('#tabbar [data-route="library"]');
      await page.waitForSelector('.crate-card', { state: 'visible', timeout: 5000 });
      const gfOpenMs = await measureClickToFrame(page, '.crate-card.crate-current, .crate-card');
      await page.waitForTimeout(300);
      const closeSel = await page.$('.gf-back, [aria-label="Close"]').catch(() => null);
      let gfCloseMs = null;
      if(closeSel) gfCloseMs = await measureClickToFrame(page, '.gf-back, [aria-label="Close"]');
      results.sheets.gatefold = { open: round2(gfOpenMs), close: round2(gfCloseMs) };
    }catch(e){
      results.notes.push('Gatefold timing skipped: ' + e.message.split('\n')[0]);
    }

    // --- Sundown sky dropped frames ---
    try{
      await page.click('#tabbar [data-route="sundown"]');
      await page.waitForTimeout(300);
      results.sundown = await measureDroppedFrames(page, 3000);
    }catch(e){
      results.notes.push('Sundown dropped-frames measurement failed: ' + e.message);
    }

    const md = renderMarkdown(results);
    mkdirSync(path.dirname(outPath), { recursive: true });
    writeFileSync(outPath, md);
    console.log('\nWrote', outPath, '\n');
    console.log(md);
  } finally {
    await browser.close();
    server.close();
  }
}

function round2(v){ return v === null || v === undefined ? null : Math.round(v * 100) / 100; }

function renderMarkdown(r){
  const lines = [];
  lines.push('# Navigation performance baseline (NV1)');
  lines.push('');
  lines.push(`Generated ${new Date().toISOString()} by \`npm run perf\` (tests/perf/nav.perf.js).`);
  lines.push('');
  lines.push(`Synthetic library: **${r.trackCount} tracks / ${r.albumCount} albums**, no real audio. `
    + `CPU throttled **${r.cpuThrottle}x** (Chrome DevTools' own "4x slowdown" preset, an approximation of an iPhone relative to a dev machine).`);
  lines.push('');
  lines.push('Not run in CI — timings vary by machine. Re-run with `npm run perf` after a later NV PR and add a before/after table to that PR\'s description.');
  lines.push('');
  lines.push('## Tab switch: click to next painted frame');
  lines.push('');
  lines.push('| Tab | Time (ms) |');
  lines.push('|---|---|');
  for(const [route, ms] of Object.entries(r.tabs)) lines.push(`| ${route} | ${ms ?? 'n/a'} |`);
  lines.push('');
  lines.push('## Library scroll (5s, 2,000 rows)');
  lines.push('');
  if(r.scroll){
    lines.push(`Long tasks (>50ms): **${r.scroll.count}**, total ${r.scroll.totalMs}ms, longest ${r.scroll.longestMs}ms.`);
  } else {
    lines.push('n/a');
  }
  lines.push('');
  lines.push('## Sheets: open/close (click to next painted frame)');
  lines.push('');
  lines.push('| Sheet | Open (ms) | Close (ms) |');
  lines.push('|---|---|---|');
  for(const [name, t] of Object.entries(r.sheets)) lines.push(`| ${name} | ${t.open ?? 'n/a'} | ${t.close ?? 'n/a'} |`);
  lines.push('');
  lines.push('## Sundown sky: dropped frames (3s on the Sundown tab)');
  lines.push('');
  if(r.sundown){
    lines.push(`${r.sundown.frames} frames observed, **${r.sundown.dropped}** over the 33ms (one-frame-missed) threshold.`);
  } else {
    lines.push('n/a');
  }
  if(r.notes.length){
    lines.push('');
    lines.push('## Notes');
    lines.push('');
    for(const n of r.notes) lines.push('- ' + n);
  }
  lines.push('');
  return lines.join('\n');
}

main().catch((e) => { console.error(e); process.exit(1); });
