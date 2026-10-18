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
// RF5 (docs/12_REFINE.md, point 4) changed every timed measurement below
// from one sample to REPS (15) repetitions, reporting the median and p95
// instead — a single run is noisy enough (GC pauses, other processes on
// the machine) that one sample can make a real regression or improvement
// look like machine noise, or the reverse. It also added two rows that
// aren't click-to-frame timings at all: restoreLibrary() wall-clock time
// at 2,000 tracks (also median/p95 over REPS reloads), and the backup
// doc's own byte size at the same library size (a single deterministic
// computation, not a timing sample — see buildBackupDocSizeReport() below).
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
//   - restoreLibrary() wall-clock time, a full page reload to the library
//     list actually rendering, at 2,000 tracks
//   - the backup doc's own byte size at 2,000 tracks / 180 albums, every
//     track played at least once (a steady-state estimate, not a cold one)
//
// Running every timed measurement 15x (instead of once) makes a full run
// take noticeably longer than NV1's original pass — expected, and still
// fine for a by-hand, not-in-CI tool.
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
import { buildSyntheticLibrary, buildSyntheticLocalState } from './lib/synthetic-library.js';
import { trackIdentityKey, albumKey } from '../../src/record-art/tiers.js';
import { toDoc } from '../../src/sync/backup-doc.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const CPU_THROTTLE_RATE = 4;
const TRACK_COUNT = 2000;
const ALBUM_COUNT = 180;
const REPS = 15;   // RF5, point 4: 15 repetitions per timed measurement

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

// RF5, point 4: median/p95 over a sample, filtering out any null a
// best-effort measurement can return (e.g. a selector that never resolved).
function median(sorted){
  if(!sorted.length) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid-1] + sorted[mid]) / 2;
}
function p95(sorted){
  if(!sorted.length) return null;
  return sorted[Math.min(sorted.length - 1, Math.ceil(0.95 * sorted.length) - 1)];
}
function stats(samples){
  const clean = samples.filter(v => v !== null && v !== undefined).sort((a,b) => a-b);
  return { n: clean.length, median: round2(median(clean)), p95: round2(p95(clean)) };
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

// RF5, point 4: runs `measureClickToFrame` for one tab REPS times, clicking
// away to `otherRoute` and back each rep so every sample is a genuine
// switch-in, not a no-op re-click of the already-active tab.
async function measureTabSwitchRepeated(page, route, otherRoute, reps = REPS){
  const samples = [];
  for(let i = 0; i < reps; i++){
    await page.click(`#tabbar [data-route="${otherRoute}"]`).catch(() => {});
    await page.waitForTimeout(120);
    samples.push(await measureClickToFrame(page, `#tabbar [data-route="${route}"]`));
    await page.waitForTimeout(120);
  }
  return stats(samples);
}

// RF5, point 4: the same 5-second scroll window as before, just run REPS
// times — each of the three scroll metrics (count/total/longest) gets its
// own median/p95 across those runs.
async function measureScrollRepeated(page, reps = REPS, durationMs = 5000){
  const counts = [], totals = [], longests = [];
  for(let i = 0; i < reps; i++){
    const r = await measureLongTasksDuringScroll(page, durationMs);
    counts.push(r.count); totals.push(r.totalMs); longests.push(r.longestMs);
    await page.waitForTimeout(100);
  }
  return { count: stats(counts), totalMs: stats(totals), longestMs: stats(longests) };
}

// RF5, point 4: opens then closes `openSel`/`closeSel` REPS times in a row,
// reporting open/close each as their own median/p95 — the generic shape
// behind the player, queue and gatefold sheet measurements below.
async function measureOpenCloseRepeated(page, openSel, closeSel, reps = REPS, waitMs = 200){
  const opens = [], closes = [];
  for(let i = 0; i < reps; i++){
    opens.push(await measureClickToFrame(page, openSel));
    await page.waitForTimeout(waitMs);
    closes.push(await measureClickToFrame(page, closeSel));
    await page.waitForTimeout(waitMs);
  }
  return { open: stats(opens), close: stats(closes) };
}

async function measureDroppedFramesRepeated(page, reps = REPS, durationMs = 3000){
  const frames = [], dropped = [];
  for(let i = 0; i < reps; i++){
    const r = await measureDroppedFrames(page, durationMs);
    frames.push(r.frames); dropped.push(r.dropped);
  }
  return { frames: stats(frames), dropped: stats(dropped) };
}

// RF5, point 4: wall-clock from `page.reload()` to restoreLibrary() actually
// finishing, REPS times — a coarser, Playwright-side timer than the
// in-page `performance.now()` measurements above, since the page itself
// goes away and comes back; still a meaningful, reproducible estimate of
// restoreLibrary()'s own real-world cost at this library size. Waits on
// `#storeNote`'s own "N tracks restored from this device" text (src/main.js's
// restoreLibrary(), written unconditionally once the library has loaded)
// rather than `.tracklist li` — the gatefold measurement just above this one
// switches the library into crate layout, which never renders `.tracklist
// li` rows at all, so that selector alone would hang forever once this runs
// after it.
async function measureRestoreLibraryRepeated(page, reps = REPS){
  const samples = [];
  for(let i = 0; i < reps; i++){
    const t0 = Date.now();
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(
      () => (document.querySelector('#storeNote')?.textContent || '').includes('restored from this device'),
      { timeout: 20000 },
    );
    samples.push(Date.now() - t0);
  }
  return stats(samples);
}

// RF5, point 4: not a timing sample — a single, deterministic estimate of
// library_backup.doc's own byte size (CLAUDE.md's 2MB column cap) at this
// same synthetic library size, every track played at least once (a
// steady-state estimate, not a near-empty cold one). Pure computation, no
// browser involved — src/sync/backup-doc.js's toDoc() needs only the
// localState snapshot tests/perf/lib/synthetic-library.js's own
// buildSyntheticLocalState() builds from the same tracks array.
function buildBackupDocSizeReport(tracks){
  const localState = buildSyntheticLocalState(tracks, { trackIdentityKey, albumKey });
  const doc = toDoc(localState);
  return { bytes: Buffer.byteLength(JSON.stringify(doc), 'utf8') };
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

    const results = { trackCount: TRACK_COUNT, albumCount: ALBUM_COUNT, cpuThrottle: CPU_THROTTLE_RATE, reps: REPS,
      tabs: {}, scroll: null, sheets: {}, sundown: null, restoreLibrary: null, backupDoc: null, notes: [] };

    // --- Backup doc size (RF5, point 4) — pure computation, no page needed ---
    results.backupDoc = buildBackupDocSizeReport(buildSyntheticLibrary(TRACK_COUNT, ALBUM_COUNT));

    // --- Tab switch timing (REPS reps each) ---
    const tabs = await page.$$eval('#tabbar [data-route]', (els) => els
      .filter(el => el.offsetParent !== null || el.style.display !== 'none')
      .map(el => el.getAttribute('data-route')));
    for(const route of tabs){
      const otherRoute = tabs.find(r => r !== route) || 'library';
      console.log(`Tab switch: ${route} (${REPS} reps) …`);
      results.tabs[route] = await measureTabSwitchRepeated(page, route, otherRoute);
    }
    // back to Library for the scroll measurement
    await page.click('#tabbar [data-route="library"]').catch(() => {});
    await page.waitForTimeout(200);

    // --- Library scroll long tasks (REPS reps of a 5s scroll) ---
    console.log(`Scrolling the library for 5s, ${REPS} reps …`);
    results.scroll = await measureScrollRepeated(page, REPS, 5000);

    // --- Queue sheet / player open-close (REPS reps each) ---
    try{
      await page.waitForSelector('#miniTap', { state: 'visible', timeout: 5000 });
      await page.click('#miniTap');   // open once, unmeasured, to check whether the queue button exists
      await page.waitForTimeout(250);
      const queueVisible = await page.$('#queueBtn:visible').catch(() => null);
      if(queueVisible){
        console.log(`Queue sheet open/close, ${REPS} reps …`);
        results.sheets.queue = await measureOpenCloseRepeated(page, '#queueBtn', '#queueClose', REPS, 200);
      } else {
        results.notes.push('Queue sheet: #queueBtn was not visible (queue may have had only one track) — skipped.');
      }
      await page.click('#playerDismiss').catch(() => {});
      await page.waitForTimeout(150);

      console.log(`Player open/close, ${REPS} reps …`);
      results.sheets.player = await measureOpenCloseRepeated(page, '#miniTap', '#playerDismiss', REPS, 200);
    }catch(e){
      results.notes.push('Player/queue sheet timing failed: ' + e.message);
    }

    // --- Gatefold open/close (best-effort, REPS reps) ---
    // The library layout toggle (list/crate) lives in the "Library tools"
    // disclosure on the Profile home screen (#libTools — see its own
    // comment in miziki.html), not under the Library tab itself, so this
    // has to detour through Profile before coming back. Switching into
    // crate layout is a one-time setup step, not part of the measured reps.
    try{
      await page.click('#tabbar [data-route="profile"]');
      await page.waitForSelector('#libToolsToggle', { state: 'visible', timeout: 5000 });
      await page.click('#libToolsToggle');
      await page.waitForSelector('#libLayoutToggle [data-layout="crate"]', { state: 'visible', timeout: 3000 });
      await page.click('#libLayoutToggle [data-layout="crate"]');
      await page.click('#tabbar [data-route="library"]');
      await page.waitForSelector('.crate-card', { state: 'visible', timeout: 5000 });
      const closeSel = '.gf-back, [aria-label="Close"]';
      const openSel = '.crate-card.crate-current, .crate-card';
      const hasClose = await page.$(closeSel).catch(() => null);
      if(hasClose){
        console.log(`Gatefold open/close, ${REPS} reps …`);
        results.sheets.gatefold = await measureOpenCloseRepeated(page, openSel, closeSel, REPS, 300);
      } else {
        results.notes.push('Gatefold timing: close selector never resolved — skipped.');
      }
    }catch(e){
      results.notes.push('Gatefold timing skipped: ' + e.message.split('\n')[0]);
    }

    // --- Sundown sky dropped frames (REPS reps of a 3s window) ---
    try{
      await page.click('#tabbar [data-route="sundown"]');
      await page.waitForTimeout(300);
      console.log(`Sundown dropped frames, ${REPS} reps …`);
      results.sundown = await measureDroppedFramesRepeated(page, REPS, 3000);
    }catch(e){
      results.notes.push('Sundown dropped-frames measurement failed: ' + e.message);
    }

    // --- restoreLibrary() wall-clock time at 2,000 tracks (REPS reloads) ---
    console.log(`restoreLibrary() reload timing, ${REPS} reps …`);
    results.restoreLibrary = await measureRestoreLibraryRepeated(page, REPS);

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

// RF5, point 4: a {n, median, p95} stats object rendered as "median / p95"
// (or "n/a" when nothing was sampled) — one small helper so every table
// below renders it the same way.
function fmtStats(s){
  if(!s || s.n === 0) return 'n/a';
  return `${s.median} / ${s.p95}`;
}

function renderMarkdown(r){
  const lines = [];
  lines.push('# Navigation performance baseline (NV1)');
  lines.push('');
  lines.push(`Generated ${new Date().toISOString()} by \`npm run perf\` (tests/perf/nav.perf.js).`);
  lines.push('');
  lines.push(`Synthetic library: **${r.trackCount} tracks / ${r.albumCount} albums**, no real audio. `
    + `CPU throttled **${r.cpuThrottle}x** (Chrome DevTools' own "4x slowdown" preset, an approximation of an iPhone relative to a dev machine). `
    + `Every timed measurement below is **${r.reps} repetitions**, reported as median / p95 (RF5, \`docs/12_REFINE.md\`, point 4).`);
  lines.push('');
  lines.push('Not run in CI — timings vary by machine. Re-run with `npm run perf` after a later NV PR and add a before/after table to that PR\'s description.');
  lines.push('');
  lines.push('## Tab switch: click to next painted frame (median / p95, ms)');
  lines.push('');
  lines.push('| Tab | Median / p95 (ms) | n |');
  lines.push('|---|---|---|');
  for(const [route, s] of Object.entries(r.tabs)) lines.push(`| ${route} | ${fmtStats(s)} | ${s.n} |`);
  lines.push('');
  lines.push(`## Library scroll (5s, 2,000 rows, ${r.reps} reps)`);
  lines.push('');
  if(r.scroll){
    lines.push(`Long tasks (>50ms) per run — count: **${fmtStats(r.scroll.count)}**, `
      + `total ${fmtStats(r.scroll.totalMs)}ms, longest ${fmtStats(r.scroll.longestMs)}ms (median / p95).`);
  } else {
    lines.push('n/a');
  }
  lines.push('');
  lines.push('## Sheets: open/close (click to next painted frame, median / p95, ms)');
  lines.push('');
  lines.push('| Sheet | Open | Close |');
  lines.push('|---|---|---|');
  for(const [name, t] of Object.entries(r.sheets)) lines.push(`| ${name} | ${fmtStats(t.open)} | ${fmtStats(t.close)} |`);
  lines.push('');
  lines.push(`## Sundown sky: dropped frames (3s on the Sundown tab, ${r.reps} reps)`);
  lines.push('');
  if(r.sundown){
    lines.push(`Frames observed: **${fmtStats(r.sundown.frames)}**, dropped (>33ms, one-frame-missed) `
      + `**${fmtStats(r.sundown.dropped)}** (median / p95).`);
  } else {
    lines.push('n/a');
  }
  lines.push('');
  lines.push(`## restoreLibrary(): reload to library rendered (${r.trackCount} tracks, ${r.reps} reps)`);
  lines.push('');
  lines.push(r.restoreLibrary ? `**${fmtStats(r.restoreLibrary)}** ms (median / p95).` : 'n/a');
  lines.push('');
  lines.push(`## Backup doc size (\`library_backup.doc\`, ${r.trackCount} tracks / ${r.albumCount} albums, every track played at least once)`);
  lines.push('');
  lines.push(r.backupDoc
    ? `**${r.backupDoc.bytes.toLocaleString('en-US')} bytes** (\`JSON.stringify(toDoc(...))\`, UTF-8) — `
      + `well under the 2MB \`jsonb\` column cap (CLAUDE.md's "Backup: what gets synced"). Not a timing sample, so no median/p95 — a single deterministic computation at this library size.`
    : 'n/a');
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
