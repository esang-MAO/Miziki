// AC1 (docs/39_ACCESSIBILITY.md, step 1, point 3): every role="dialog"
// element needs a name VoiceOver can read -- a non-empty aria-label, or an
// aria-labelledby whose referenced ids resolve to at least some real text
// between them (one id can be a span that's empty until something fills
// it, same as #trackBy on the full player). Sibling to
// icon-button-labels.test.js: same regex-over-the-real-markup approach
// (no DOM parser in this test env), parses the real miziki.html and fails
// the moment a new dialog ships with no name.
//
// A few dialogs set their real name at runtime rather than in markup --
// the gatefold/sealed front/picture sleeve set aria-label to "[album] by
// [artist]" once something opens them; a few more (built fully in JS, no
// static heading to point at) set aria-label to their title string the
// same way; and socialNavOverlay/recordSheetOverlay point aria-labelledby
// at an id that's only added to the DOM once JS renders that element.
// Each is allow-listed below, but only once this file has checked that
// its own source file still actually wires that name up -- so the
// allow-list can't silently cover for a setter that regressed or was
// removed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function stripAll(str, re){
  let prev;
  do{ prev = str; str = str.replace(re, ''); }while(str !== prev);
  return str;
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '../..');
const html = stripAll(readFileSync(path.join(repoRoot, 'miziki.html'), 'utf8'),
  /<!--[\s\S]*?-->/g);

function fileHas(relPath, re){
  const src = readFileSync(path.join(repoRoot, relPath), 'utf8');
  return re.test(src);
}

// id -> a check that the dialog's own source still wires up a real name,
// so the dialog can be skipped by the static-markup scan below.
const DYNAMIC_DIALOGS = {
  gatefold: () => fileHas('src/gatefold/view.js', /setAttribute\('aria-label',\s*item\.album/),
  sealedFront: () => fileHas('src/gatefold/sealed-front.js', /setAttribute\('aria-label',\s*item\.album/),
  pictureSleeve: () => fileHas('src/gatefold/picture-sleeve.js', /setAttribute\('aria-label',\s*item\.album/),
  dupOverlay: () => fileHas('src/library/duplicates-ui.js', /\$\('#dupOverlay'\)\.setAttribute\('aria-label',\s*title\)/),
  gfTrackMenuOverlay: () => fileHas('src/gatefold/view.js', /overlay\.setAttribute\('aria-label',\s*t\.tags\.title\)/),
  playlistNameSheetBox: () => fileHas('src/library/playlist-sheet.js', /\$\('#playlistNameSheetBox'\)\.setAttribute\('aria-label',\s*title\)/),
  socialNavOverlay: () => fileHas('src/social/screens/friend-store.js', /handleTitle\.id\s*=\s*'socialNavHandleTitle'/),
  recordSheetOverlay: () => fileHas('src/social/screens/friend-store.js', /titleEl\.id\s*=\s*'recordSheetTitle'/),
};

function hasAnyText(markup, id){
  const re = new RegExp('<[a-zA-Z0-9]+\\b[^>]*\\bid\\s*=\\s*"' + id + '"[^>]*>([\\s\\S]*?)<\\/[a-zA-Z0-9]+>');
  const m = markup.match(re);
  if(!m) return false;
  const text = stripAll(m[1], /<[^>]*>/g).replace(/\s+/g, '');
  return text.length > 0;
}

// Finds every role="dialog" element with no usable name. A dialog in
// DYNAMIC_DIALOGS is skipped here only if its own check function passes.
function findUnnamedDialogs(markup){
  const re = /<[a-zA-Z0-9]+\b([^>]*\brole="dialog"[^>]*)>/g;
  const offenders = [];
  let m;
  while((m = re.exec(markup))){
    const attrs = m[1];
    const id = attrs.match(/\bid\s*=\s*"([^"]+)"/)?.[1] || '(no id)';
    if(DYNAMIC_DIALOGS[id] && DYNAMIC_DIALOGS[id]()) continue;
    const labelMatch = attrs.match(/\baria-label\s*=\s*"([^"]*)"/);
    if(labelMatch && labelMatch[1].trim() !== '') continue;
    const labelledbyMatch = attrs.match(/\baria-labelledby\s*=\s*"([^"]*)"/);
    if(labelledbyMatch && labelledbyMatch[1].trim() !== ''){
      const ids = labelledbyMatch[1].trim().split(/\s+/);
      if(ids.some(refId => hasAnyText(markup, refId))) continue;
    }
    offenders.push(id);
  }
  return offenders;
}

test('findUnnamedDialogs: aria-label alone is enough', () => {
  assert.deepEqual(findUnnamedDialogs('<div id="a" role="dialog" aria-label="Queue"></div>'), []);
});

test('findUnnamedDialogs: aria-labelledby where at least one id has real text is enough', () => {
  const markup = '<div id="a" role="dialog" aria-labelledby="t1 t2"></div><span id="t1"></span><span id="t2">Queue</span>';
  assert.deepEqual(findUnnamedDialogs(markup), []);
});

test('findUnnamedDialogs: aria-labelledby where every id is empty is flagged', () => {
  const markup = '<div id="a" role="dialog" aria-labelledby="t"></div><span id="t"></span>';
  assert.deepEqual(findUnnamedDialogs(markup), ['a']);
});

test('findUnnamedDialogs: no name at all is flagged', () => {
  assert.deepEqual(findUnnamedDialogs('<div id="a" role="dialog"></div>'), ['a']);
});

test('every role="dialog" element in miziki.html has a usable name', () => {
  const offenders = findUnnamedDialogs(html);
  assert.deepEqual(offenders, [], 'dialogs missing a name: ' + offenders.join(', '));
});

for(const [id, check] of Object.entries(DYNAMIC_DIALOGS)){
  test(`the #${id} dialog still wires up its own runtime name`, () => {
    assert.ok(check(), `expected #${id}'s own open function to still set a usable name`);
  });
}
