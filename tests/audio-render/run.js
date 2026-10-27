#!/usr/bin/env node
// The offline-render harness runner (PL1, docs/19_PLAYER.md):
// "each audio PR adds an offline render test (OfflineAudioContext), run
// in Playwright WebKit as well as Chromium ... since iOS runs WebKit."
//
// Not run in CI, and not part of `npm run test:unit` -- same posture as
// tests/perf/nav.perf.js: it drives a real browser, which is slow and
// needs that browser actually installed. Run it by hand (`npm run
// test:audio-render`) before opening or reviewing an audio PR, and paste
// its numbers into the PR description the way NV1's baseline numbers
// already get pasted in.
//
// Runs every spec under tests/audio-render/specs/ (or just the one named
// by --spec) in every browser engine that's actually installed in this
// environment, skipping (not failing) an engine that isn't -- Chromium is
// the only one this project's containers ship by default; WebKit has to
// be installed separately (`npx playwright install webkit`, needs real
// network access) or run on a machine that already has it. A spec is
// loaded fresh per engine, per run -- no shared state between them.
//
// Each spec (tests/audio-render/specs/*.js) is a plain ES module that
// imports real src/ production code directly (served unbundled -- see
// lib/serve-repo.js) and exports an async run() returning
// { checks: [{name, value, pass}], pass }. The harness page
// (harness.html) loads it inside the browser, so OfflineAudioContext,
// AudioWorkletNode, etc. are all real, not mocked.
import { chromium, webkit } from '@playwright/test';
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { serveRepo } from './lib/serve-repo.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const SPECS_DIR = path.join(__dirname, 'specs');

// Mirrors tests/perf/nav.perf.js's own findChromiumExecutable() --
// @playwright/test's default resolution expects chrome-headless-shell,
// which this environment doesn't install; only the full chromium build
// (chrome-linux64/chrome) is actually present. WebKit has no such
// workaround available here since it isn't installed at all -- that's
// reported as a skip, not silently worked around.
function findExecutable(engine){
  const browsersPath = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if(!browsersPath || !existsSync(browsersPath)) return undefined;
  const prefix = engine === 'chromium' ? /^chromium-\d+$/ : /^webkit-\d+$/;
  const subdir = engine === 'chromium' ? 'chrome-linux64' : 'pw_run.sh';
  const dir = readdirSync(browsersPath).find(d => prefix.test(d));
  if(!dir) return undefined;
  if(engine === 'chromium'){
    const exe = path.join(browsersPath, dir, subdir, 'chrome');
    return existsSync(exe) ? exe : undefined;
  }
  // WebKit's own launcher script, when present.
  const exe = path.join(browsersPath, dir, subdir);
  return existsSync(exe) ? exe : undefined;
}

function parseArgs(argv){
  const out = { specName: null };
  for(let i = 0; i < argv.length; i++){
    if(argv[i] === '--spec' && argv[i+1]){ out.specName = argv[i+1]; i++; }
  }
  return out;
}

function listSpecs(){
  return readdirSync(SPECS_DIR).filter(f => f.endsWith('.js')).map(f => f.replace(/\.js$/, ''));
}

async function launchEngine(engine){
  const launcher = engine === 'chromium' ? chromium : webkit;
  const executablePath = findExecutable(engine);
  try{
    const browser = await launcher.launch(executablePath ? { executablePath } : {});
    return { browser, skipped: false };
  }catch(err){
    return { browser: null, skipped: true, reason: err.message.split('\n')[0] };
  }
}

async function runSpecInEngine(engine, specName, baseURL){
  const { browser, skipped, reason } = await launchEngine(engine);
  if(skipped){
    return { engine, specName, skipped: true, reason };
  }
  try{
    const page = await browser.newPage();
    const url = `${baseURL}tests/audio-render/harness.html?spec=${encodeURIComponent('./specs/' + specName + '.js')}`;
    await page.goto(url);
    await page.waitForFunction(() => window.__harnessDone === true, { timeout: 30000 });
    const { result, error } = await page.evaluate(() => ({
      result: window.__harnessResult, error: window.__harnessError,
    }));
    if(error) return { engine, specName, skipped: false, error };
    return { engine, specName, skipped: false, result };
  }finally{
    await browser.close();
  }
}

async function main(){
  const { specName } = parseArgs(process.argv.slice(2));
  const specs = specName ? [specName] : listSpecs();
  const { server, baseURL } = await serveRepo(ROOT);

  const engines = ['chromium', 'webkit'];
  let anyFailed = false;

  for(const spec of specs){
    console.log(`\n=== ${spec} ===`);
    for(const engine of engines){
      const r = await runSpecInEngine(engine, spec, baseURL);
      if(r.skipped){
        console.log(`  [${engine}] SKIPPED — ${r.reason} (not installed in this environment)`);
        continue;
      }
      if(r.error){
        anyFailed = true;
        console.log(`  [${engine}] ERROR — ${r.error.message}`);
        continue;
      }
      const { checks, pass } = r.result;
      if(!pass) anyFailed = true;
      console.log(`  [${engine}] ${pass ? 'PASS' : 'FAIL'}`);
      for(const c of checks){
        console.log(`    ${c.pass ? '✓' : '✗'} ${c.name}: ${typeof c.value === 'number' ? c.value.toFixed(1) + ' dBFS' : c.value}`);
      }
    }
  }

  server.close();
  if(anyFailed){
    console.error('\nOne or more offline-render checks failed.');
    process.exitCode = 1;
  }else{
    console.log('\nAll offline-render checks passed (engines with no installed browser were skipped, not counted as failures).');
  }
}

main();
