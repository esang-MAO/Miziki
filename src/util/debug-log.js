// LI5 (docs/35_LEAD_IN.md): a tiny in-memory ring buffer of caught errors,
// for finding bugs that only show up on a real device. Never stored,
// synced or uploaded -- CLAUDE.md's "Miziki keeps no engagement numbers"
// rule applies the same way here: this is a debugging aid, read only from
// this device's own console, never telemetry. `DEBUG` is read once, at
// module load (same posture as util/motion.js's REDUCED), from the page's
// own URL -- `?debug=1` -- so a user who never opts in sees no console
// output at all; logError() still appends to the buffer either way, so
// opting in after the fact (then calling debugLogEntries()) still has
// something to show.
const DEBUG = typeof location !== 'undefined' && new URLSearchParams(location.search).get('debug') === '1';
const MAX_ENTRIES = 200;
const entries = [];

// `context`: a short string naming the call site (e.g. "transport.play").
// `err`: whatever the catch block caught -- not required to be an Error.
export function logError(context, err){
  entries.push({ context, err, at: Date.now() });
  if(entries.length > MAX_ENTRIES) entries.shift();
  if(DEBUG) console.error('[debug-log]', context, err);
}

// BD13 (docs/38_BEFORE_THE_DOMAIN.md): the Settings screen's own "Copy
// error log" row surfaces this buffer now, so `?debug=1` and a console are
// no longer the only way to read it -- see that row's own module,
// src/profile/debug-log-sheet.js.
export function debugLogEntries(){
  return entries.slice();
}

// vite.config.js's `define` substitutes this with a short build-time git
// SHA; under plain Node (e.g. tests/unit) or a build where git isn't
// available, it's left undefined and this falls back to 'dev'.
export const BUILD_ID = typeof __BUILD_ID__ !== 'undefined' ? __BUILD_ID__ : 'dev';

function errorMessage(err){
  if(err instanceof Error) return err.message;
  if(typeof err === 'string') return err;
  try{ return JSON.stringify(err); }catch(_e){ return String(err); }
}

// Pure formatter for the "Copy error log" sheet (BD13) -- `env` carries the
// app build id and a browser string, kept as plain data rather than read
// here so this stays testable without a DOM/location. Error text can
// contain a file name, which is why the sheet shows this exact string
// before any copy happens, rather than copying straight from the tap.
export function formatDebugLog(entries, env = {}){
  const buildId = (env && env.buildId) || 'unknown';
  const browser = (env && env.browser) || 'unknown';
  const lines = [
    'Miziki error log',
    'Build: ' + buildId,
    'Browser: ' + browser,
    entries.length + (entries.length === 1 ? ' entry' : ' entries'),
    '',
  ];
  entries.forEach(e => {
    lines.push('[' + new Date(e.at).toISOString() + '] ' + e.context + ': ' + errorMessage(e.err));
  });
  return lines.join('\n');
}
