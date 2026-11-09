// LI5 (docs/35_LEAD_IN.md): a dev-only invariant check. `import.meta.env.DEV`
// is the literal Vite constant-folds at build time (same mechanism LI1's
// deluxe.js call-site gate relies on) -- in a production build this whole
// branch is dead code the minifier removes, so assert() costs nothing
// shipped to a user. A call site's own arguments are still evaluated
// eagerly by JS either way (functions can't skip that), so don't pass an
// argument with a side effect assert() is meant to be the only place that
// causes.
export function assert(condition, message){
  if(import.meta.env.DEV && !condition){
    throw new Error('Assertion failed' + (message ? ': ' + message : ''));
  }
}
