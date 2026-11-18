#!/usr/bin/env node
// BD12 (docs/38_BEFORE_THE_DOMAIN.md): the one end-to-end check that no CI
// job ran before this -- import a real file, play it, reload, and prove
// the library survived. Everything else (lint, unit tests, both builds)
// already ran on every PR; nothing proved the built app actually imports
// and plays a track, or that a reload doesn't lose the library.
//
// Plain Node + @playwright/test's chromium launcher, not the
// @playwright/test runner -- same posture as tests/perf/nav.perf.js and
// tests/audio-render/run.js, so this adds no new test-framework config.
// Run by hand with `npm run test:e2e`; wired into .github/workflows/
// pr-checks.yml as its own required job, against the real built `dist/`
// (GitHub Pages' own /Miziki/ base, served by the same static server
// tests/perf/lib/static-server.js already uses).
//
// No network: social config is empty in a fresh checkout, so this path
// never touches Supabase.
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { serveDist } from '../perf/lib/static-server.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');

// Mirrors tests/perf/nav.perf.js's own findChromiumExecutable() -- the
// only Chromium build this environment actually installs is the full
// chrome-linux(64) one, not @playwright/test's default
// chrome-headless-shell expectation.
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
  return undefined; // fall back to @playwright/test's own resolution
}

// A real, decodable PCM WAV file (mono tone), same shape as nav.perf.js's
// own buildWavFile() -- small and fast to synthesize but genuine audio for
// decodeAudioData() to actually decode, so the real addFiles() import path
// does real work, not a stub.
function buildWavFile(name, hz, durationSec = 3, sampleRate = 44100){
  const frames = Math.round(durationSec * sampleRate);
  const dataSize = frames * 4; // stereo, 16-bit = 4 bytes/frame
  const buf = Buffer.alloc(44 + dataSize);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + dataSize, 4); buf.write('WAVE', 8);
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(2, 22); buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 4, 28); buf.writeUInt16LE(4, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(dataSize, 40);
  for(let i = 0; i < frames; i++){
    const sample = Math.round(Math.sin(2 * Math.PI * hz * i / sampleRate) * 8000);
    const off = 44 + i * 4;
    buf.writeInt16LE(sample, off);
    buf.writeInt16LE(sample, off + 2);
  }
  return { name, mimeType: 'audio/wav', buffer: buf };
}

// "mm:ss" (src/util/text.js's fmt()) back to whole seconds, for comparing
// two #timeElapsed readings.
function parseElapsed(s){
  const m = /^(\d+):(\d\d)$/.exec((s || '').trim());
  if(!m) return null;
  return (+m[1]) * 60 + (+m[2]);
}

async function waitForSongRows(page, count){
  await page.click('#tabbar [data-route="library"]').catch(() => {});
  await page.click('[data-view="songs"]').catch(() => {});
  await page.waitForFunction(
    (n) => document.querySelectorAll('li[data-id]').length >= n,
    count,
    { timeout: 20000 },
  );
}

async function main(){
  const distDir = path.join(ROOT, 'dist');
  if(!existsSync(distDir)){
    console.error('dist/ not found -- run `npm run build` first.');
    process.exit(1);
  }

  const { server, url } = await serveDist(distDir);
  const executablePath = findChromiumExecutable();
  // --no-sandbox/--disable-dev-shm-usage: the standard pair a GitHub
  // Actions runner needs for headless Chromium -- without them the
  // sandbox can silently fail to spin up a renderer process on some CI
  // hosts, which doesn't fail the page load itself but leaves anything
  // that depends on it (decodeAudioData, the analysis Worker addFiles()
  // uses) hanging rather than erroring. Harmless locally.
  const browser = await chromium.launch({
    ...(executablePath ? { executablePath } : {}),
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });

  try{
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    // Same reasoning as nav.perf.js's own measureLongTaskDuringImportWhilePlaying():
    // a real iOS user with Reduce Motion skips the sleeve-opening ceremony's
    // requestAnimationFrame-driven steps outright (both the plain CSS media
    // query and util/motion.js's REDUCED flag, read once at module load, so
    // this has to be set before navigation).
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(url, { waitUntil: 'networkidle' });

    const files = [buildWavFile('Smoke Track One.wav', 220), buildWavFile('Smoke Track Two.wav', 330)];
    await page.setInputFiles('#file', files, { timeout: 30000 });
    // A generous timeout -- a shared CI runner's CPU is slower than a dev
    // machine's for the real decode/analyze work addFiles() does per file.
    await page.waitForFunction(
      () => (document.querySelector('#pathNote')?.textContent || '').includes('Importing 2 of 2'),
      null,
      { timeout: 60000 },
    );
    await page.waitForTimeout(1000); // the last file's decode/analyze/store work

    await waitForSongRows(page, 2);
    let rows = await page.locator('li[data-id]').count();
    assert.equal(rows, 2, 'expected both imported tracks to show as rows');

    await page.locator('li[data-id]').first().click();
    await page.waitForFunction(
      () => document.getElementById('miniIndicator')?.classList.contains('playing'),
      null,
      { timeout: 20000 },
    );

    // docs/15_SURFACE_NOISE.md §1: Vinyl (the boot default) plays a
    // needle-drop lead-in before a fresh side's position actually starts
    // moving (src/audio/surface-noise.js's LEAD_IN_SEC) -- #timeElapsed
    // reads "0:00" until that clears, so wait for it to move off zero
    // before taking the "before" sample, not a fixed delay guessing at
    // the lead-in's own length.
    await page.waitForFunction(
      () => document.getElementById('timeElapsed')?.textContent !== '0:00',
      null,
      { timeout: 20000 },
    );
    const before = parseElapsed(await page.textContent('#timeElapsed'));
    assert.ok(before !== null, 'expected a readable elapsed time');
    // Poll rather than a single fixed sleep-then-compare -- #timeElapsed
    // only ticks to a new whole second every so often, and a "before"
    // sample taken right at a rollover can land within a second of
    // "after" even though playback is genuinely advancing underneath.
    await page.waitForFunction(
      (beforeSec) => {
        const m = /^(\d+):(\d\d)$/.exec((document.getElementById('timeElapsed')?.textContent || '').trim());
        if(!m) return false;
        return (+m[1]) * 60 + (+m[2]) > beforeSec;
      },
      before,
      { timeout: 15000 },
    );
    const after = parseElapsed(await page.textContent('#timeElapsed'));
    assert.ok(after > before, `expected playback position to advance (got ${before}s -> ${after}s)`);

    await page.reload({ waitUntil: 'networkidle' });

    await waitForSongRows(page, 2);
    rows = await page.locator('li[data-id]').count();
    assert.equal(rows, 2, 'expected both tracks to survive a reload');

    // AU1 (docs/16_AUDIO.md §2.1): a reload saves the queue/track/position
    // on pagehide and restores it paused -- "the mini player shows the
    // record... never autoplaying" -- the one DOM-visible proof that the
    // last-played track itself (not just the library) survived the reload.
    await page.waitForFunction(
      () => document.querySelector('.mini-player')?.classList.contains('resuming'),
      null,
      { timeout: 20000 },
    );
    const miniTitle = (await page.textContent('#miniTitle') || '').trim();
    assert.equal(miniTitle, 'Smoke Track One', 'expected the last-played track to be restored, paused, after reload');

    console.log('ok   import, play, reload: both tracks survive and the last-played track is restored');

    // BD14: the service worker registered during this session's launch
    // sequence should be active by now -- confirm it, then prove the app
    // still opens with no network at all (dist's own files served from its
    // cache) and the library (already in IndexedDB) still shows.
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.context().setOffline(true);
    await page.reload({ waitUntil: 'networkidle' });
    await waitForSongRows(page, 2);
    rows = await page.locator('li[data-id]').count();
    assert.equal(rows, 2, 'expected the library to load from the service worker cache while offline');
    await page.context().setOffline(false);
    console.log('ok   offline reload: service worker serves the app shell and the library still shows');
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch((err) => {
  console.error('FAIL', err && err.message ? err.message : err);
  process.exitCode = 1;
});
