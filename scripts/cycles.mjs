#!/usr/bin/env node
// LI5 (docs/35_LEAD_IN.md): import-cycle groundwork for finding bugs --
// a smaller, more tangled dependency graph is easier to reason about and
// easier to test (CLAUDE.md's refactor rule 8 already singles out
// main.js-only imports as a backlog, not a pattern; this script makes the
// rest of the graph's own shape visible the same way). Run standalone
// (`node scripts/cycles.mjs`) to print today's two numbers, or with
// `--check` (what `.github/workflows/pr-checks.yml` does) to fail if
// either has grown past its recorded ceiling -- so the numbers can only
// go down, never silently back up.
//
// Pure graph math over `import ... from './x.js'`/`import(...)` statements
// under src/ -- relative imports only (a bare `import 'some-package'` or
// a non-.js asset import, e.g. `?raw`, is never part of this app's own
// module graph, so it's excluded rather than resolved).

import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(ROOT, '..', 'src');

// Today's counts -- the ceiling this script enforces under --check. Only
// ever lowered as the graph actually improves, never raised to paper over
// a regression. (Plan 35 guessed 54/38 when it was written; this script's
// own measured count at the time LI5 lands is 63/40 -- these two numbers,
// not the plan's guess, are the real starting ceiling.)
const MAX_CYCLE_MODULES = 63;
const MAX_MUTUAL_PAIRS = 40;

function walk(dir, out){
  for(const name of readdirSync(dir)){
    const full = path.join(dir, name);
    const st = statSync(full);
    if(st.isDirectory()) walk(full, out);
    else if(name.endsWith('.js')) out.push(full);
  }
  return out;
}

const IMPORT_RE = /\bfrom\s+['"](\.[^'"]+)['"]/g;
const DYNAMIC_IMPORT_RE = /\bimport\(\s*['"](\.[^'"]+)['"]\s*\)/g;

function resolveRelative(fromFile, spec){
  const clean = spec.split('?')[0]; // strip ?raw and similar query suffixes
  let resolved = path.resolve(path.dirname(fromFile), clean);
  if(!resolved.endsWith('.js')){
    // Only a .js specifier is this app's own module graph (a .svg/.css/
    // .json import is an asset, not a node in this graph).
    return null;
  }
  return resolved;
}

function buildGraph(files){
  const fileSet = new Set(files);
  const graph = new Map(files.map(f => [f, new Set()]));
  for(const file of files){
    const text = readFileSync(file, 'utf8');
    const specs = [];
    for(const m of text.matchAll(IMPORT_RE)) specs.push(m[1]);
    for(const m of text.matchAll(DYNAMIC_IMPORT_RE)) specs.push(m[1]);
    for(const spec of specs){
      const resolved = resolveRelative(file, spec);
      if(resolved && fileSet.has(resolved)) graph.get(file).add(resolved);
    }
  }
  return graph;
}

// Tarjan's SCC algorithm -- returns an array of components (each an array
// of file paths); a component of size 1 is not a cycle unless the module
// imports itself, which none here do.
function stronglyConnectedComponents(graph){
  let index = 0;
  const indices = new Map(), lowlinks = new Map(), onStack = new Set();
  const stack = [];
  const components = [];

  function strongconnect(v){
    indices.set(v, index); lowlinks.set(v, index); index++;
    stack.push(v); onStack.add(v);
    for(const w of graph.get(v) || []){
      if(!indices.has(w)){
        strongconnect(w);
        lowlinks.set(v, Math.min(lowlinks.get(v), lowlinks.get(w)));
      } else if(onStack.has(w)){
        lowlinks.set(v, Math.min(lowlinks.get(v), indices.get(w)));
      }
    }
    if(lowlinks.get(v) === indices.get(v)){
      const component = [];
      let w;
      do {
        w = stack.pop(); onStack.delete(w);
        component.push(w);
      } while(w !== v);
      components.push(component);
    }
  }

  for(const v of graph.keys()){
    if(!indices.has(v)) strongconnect(v);
  }
  return components;
}

function countMutualPairs(graph){
  let count = 0;
  const files = [...graph.keys()];
  for(let i = 0; i < files.length; i++){
    for(let j = i + 1; j < files.length; j++){
      const a = files[i], b = files[j];
      if(graph.get(a).has(b) && graph.get(b).has(a)) count++;
    }
  }
  return count;
}

const files = walk(SRC, []);
const graph = buildGraph(files);
const components = stronglyConnectedComponents(graph);
const cycles = components.filter(c => c.length > 1);
const largestCycleModules = cycles.reduce((max, c) => Math.max(max, c.length), 0);
const mutualPairs = countMutualPairs(graph);

console.log(`Largest import cycle: ${largestCycleModules} modules (ceiling ${MAX_CYCLE_MODULES})`);
console.log(`Mutual-import pairs: ${mutualPairs} (ceiling ${MAX_MUTUAL_PAIRS})`);

if(process.argv.includes('--check')){
  let failed = false;
  if(largestCycleModules > MAX_CYCLE_MODULES){
    console.error(`Largest import cycle grew to ${largestCycleModules} modules, past the ${MAX_CYCLE_MODULES}-module ceiling.`);
    failed = true;
  }
  if(mutualPairs > MAX_MUTUAL_PAIRS){
    console.error(`Mutual-import pairs grew to ${mutualPairs}, past the ${MAX_MUTUAL_PAIRS}-pair ceiling.`);
    failed = true;
  }
  if(failed) process.exit(1);
}
