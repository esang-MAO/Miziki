#!/usr/bin/env node
// LI5 (docs/35_LEAD_IN.md): fails the PR if anything under src/ or
// CLAUDE.md cites a docs/*.md path that doesn't exist -- the same class of
// bug LI0 had to clean up by hand (docs/31_PRESSINGS_AND_LOOKS.md was
// cited by 11 files for months before anyone noticed it had never
// actually been committed).

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const DOC_PATH_RE = /docs\/[A-Za-z0-9_./-]+\.md/g;

// `docs/NN_NAME.md` is CLAUDE.md's own template placeholder ("A plan doc
// (docs/NN_NAME.md) covers...") for naming a *future* plan doc, never a
// real citation -- the one path this check is expected to never find.
const PLACEHOLDER = 'docs/NN_NAME.md';

function walk(dir, out){
  for(const name of readdirSync(dir)){
    const full = path.join(dir, name);
    const st = statSync(full);
    if(st.isDirectory()) walk(full, out);
    else if(name.endsWith('.js')) out.push(full);
  }
  return out;
}

const files = [...walk(path.join(ROOT, 'src'), []), path.join(ROOT, 'CLAUDE.md')];
const cited = new Set();
for(const file of files){
  const text = readFileSync(file, 'utf8');
  for(const m of text.matchAll(DOC_PATH_RE)) cited.add(m[0]);
}

const missing = [...cited].filter(p => p !== PLACEHOLDER && !existsSync(path.join(ROOT, p))).sort();

if(missing.length){
  console.error('Cited doc paths that do not exist:');
  missing.forEach(p => console.error('  ' + p));
  process.exit(1);
}
console.log(`All ${cited.size} cited doc paths exist (or are the known placeholder).`);
