// BD18 (docs/38_BEFORE_THE_DOMAIN.md): tracks.audio(id) (src/storage/repo.js)
// is meant to be the only place outside src/storage/ that hands out a
// track's stored audio bytes -- so a native build's storage swap (the note
// at the foot of repo.js) only ever has one door to change behind. A
// regression guard, not a one-time audit: this walks the real src/ tree
// and fails the moment a `tracks.get(...)` result's `.blob` is read again
// outside src/storage/, rather than relying on every PR remembering the
// rule by hand.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(__dirname, '../../src');

function walk(dir, out){
  for(const name of readdirSync(dir)){
    const full = path.join(dir, name);
    const st = statSync(full);
    if(st.isDirectory()) walk(full, out);
    else if(name.endsWith('.js')) out.push(full);
  }
  return out;
}

// Finds every `const/let X = await tracks.get(...)` binding in `text`,
// then flags any of them whose name is later read as `X.blob` -- the one
// shape (read the record, then reach straight for its audio bytes) the
// door is meant to replace. Reading other fields off the same binding
// (rec.details, rec.tags, ...) is untouched; only `.blob` matters here.
function findTracksGetBlobReads(text){
  const offenders = [];
  const bindRe = /\b(?:const|let)\s+(\w+)\s*=\s*await\s+tracks\.get\(/g;
  let m;
  while((m = bindRe.exec(text))){
    const name = m[1];
    const blobRe = new RegExp('\\b' + name + '\\.blob\\b');
    if(blobRe.test(text)) offenders.push(name);
  }
  return offenders;
}

test('findTracksGetBlobReads: a plain tracks.get() read of another field is fine', () => {
  assert.deepEqual(findTracksGetBlobReads('const rec = await tracks.get(id); use(rec.details);'), []);
});

test('findTracksGetBlobReads: reading .blob off a tracks.get() binding is flagged', () => {
  assert.deepEqual(findTracksGetBlobReads('const rec = await tracks.get(id); use(rec.blob);'), ['rec']);
});

test('findTracksGetBlobReads: a differently-named blob variable does not false-positive', () => {
  assert.deepEqual(findTracksGetBlobReads('const rec = await tracks.get(id); const blob = other.blob;'), []);
});

test('no file outside src/storage/ reads .blob off a tracks.get() result', () => {
  const offenders = [];
  for(const file of walk(SRC, [])){
    const rel = path.relative(SRC, file);
    if(rel.startsWith('storage' + path.sep)) continue; // the door itself
    const text = readFileSync(file, 'utf8');
    for(const name of findTracksGetBlobReads(text)) offenders.push(rel + ': ' + name + '.blob');
  }
  assert.deepEqual(offenders, [], 'read audio bytes via tracks.audio(id) instead: ' + offenders.join(', '));
});
