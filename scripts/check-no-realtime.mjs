#!/usr/bin/env node
// BD7 (docs/38_BEFORE_THE_DOMAIN.md): fails the PR if the app's own code
// ever calls Supabase's realtime `.channel(` again.
//
// The plan's own wording called for checking dist/ (the built output,
// which is what actually ships) rather than src/ -- but @supabase/
// supabase-js's own SupabaseClient/RealtimeClient classes call `.channel(`
// internally as part of defining that exact method (confirmed by
// inspecting the built chunk directly: `channel(e,t={config:{}}){return
// this.realtime.channel(e,t)}`), and that whole library gets bundled into
// dist/ regardless of whether this app's own code ever calls it (it's
// reachable the moment the two social config keys are non-empty, per
// CLAUDE.md's Security section). Scanning the built output would always
// find a hit from the vendored library itself, with no way to tell that
// apart from a real app call site without sourcemaps. Scanning src/
// directly -- this app's own code, nothing vendored -- is the check that
// actually answers the question the plan is asking, and it's the same
// "walk src/*.js" shape scripts/cycles.mjs and check-doc-links.mjs already
// use for exactly this reason.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'src');

function walk(dir, out){
  for(const name of readdirSync(dir)){
    const full = path.join(dir, name);
    const st = statSync(full);
    if(st.isDirectory()) walk(full, out);
    else if(name.endsWith('.js')) out.push(full);
  }
  return out;
}

const hits = [];
for(const file of walk(SRC, [])){
  const text = readFileSync(file, 'utf8');
  if(text.includes('.channel(')) hits.push(path.relative(ROOT, file));
}

if(hits.length){
  console.error('src/ still contains a .channel( call (realtime socket): ' + hits.join(', '));
  process.exit(1);
}
console.log('src/ has no .channel( call -- no realtime socket in the app\'s own code.');
