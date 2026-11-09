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

// The buffer itself, oldest first -- read from the console with
// `?debug=1` set (nothing in the app's own UI surfaces this today).
export function debugLogEntries(){
  return entries.slice();
}
