// AC3 (docs/39_ACCESSIBILITY.md, step 3): every visible form field needs
// an accessible name -- a wrapping/associated <label>, an aria-label, or
// an aria-labelledby that resolves to real text. A placeholder is not a
// label (it disappears the moment there's a value, and VoiceOver doesn't
// announce it the same way). Sibling to icon-button-labels.test.js and
// dialog-names.test.js: same regex-over-the-real-markup approach, parses
// the real miziki.html and fails the moment a new field ships unlabelled.
//
// Hidden and file inputs are excepted (type="file"/type="hidden" -- a
// file input gets its name from the button/row that triggers it, same
// posture as every <input id="...File"> in this file already has).
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
const html = stripAll(readFileSync(path.join(__dirname, '../../miziki.html'), 'utf8'),
  /<!--[\s\S]*?-->/g);

function hasAnyText(markup, id){
  const re = new RegExp('<[a-zA-Z0-9]+\\b[^>]*\\bid\\s*=\\s*"' + id + '"[^>]*>([\\s\\S]*?)<\\/[a-zA-Z0-9]+>');
  const m = markup.match(re);
  if(!m) return false;
  const text = stripAll(m[1], /<[^>]*>/g).replace(/\s+/g, '');
  return text.length > 0;
}

function isWrappedInLabel(markup, fieldTag){
  // A <label>...<input .../>...</label> (or textarea) wraps its own
  // control with no `for`/id needed -- cheaply approximated by checking
  // whether the field's own opening tag falls inside some <label>...
  // </label> span in the raw markup. Good enough for this file's own
  // handful of real cases (no two fields ever nest inside the same label).
  const idx = markup.indexOf(fieldTag);
  if(idx === -1) return false;
  const before = markup.lastIndexOf('<label', idx);
  if(before === -1) return false;
  const labelCloseBefore = markup.lastIndexOf('</label>', idx);
  if(labelCloseBefore > before) return false; // the nearest <label> before this field already closed
  const afterCloseIdx = markup.indexOf('</label>', idx);
  return afterCloseIdx !== -1;
}

function findUnlabelledFields(markup){
  const re = /<(input|textarea)\b([^>]*)>/g;
  const offenders = [];
  let m;
  while((m = re.exec(markup))){
    const [full, , attrs] = m;
    if(/\btype\s*=\s*"(file|hidden)"/.test(attrs)) continue;
    const id = attrs.match(/\bid\s*=\s*"([^"]+)"/)?.[1] || '(no id)';
    if(/\baria-label\s*=\s*"[^"]*[^\s"][^"]*"/.test(attrs)) continue;
    const labelledbyMatch = attrs.match(/\baria-labelledby\s*=\s*"([^"]*)"/);
    if(labelledbyMatch && labelledbyMatch[1].trim() !== ''){
      const ids = labelledbyMatch[1].trim().split(/\s+/);
      if(ids.some(refId => hasAnyText(markup, refId))) continue;
    }
    if(isWrappedInLabel(markup, full)) continue;
    offenders.push(id);
  }
  return offenders;
}

test('findUnlabelledFields: aria-label alone is enough', () => {
  assert.deepEqual(findUnlabelledFields('<input id="a" aria-label="Title">'), []);
});

test('findUnlabelledFields: aria-labelledby resolving to text is enough', () => {
  const markup = '<input id="a" aria-labelledby="t"><span id="t">Title</span>';
  assert.deepEqual(findUnlabelledFields(markup), []);
});

test('findUnlabelledFields: wrapped in a <label> is enough, even with no name at all', () => {
  const markup = '<label><span>Liner notes</span><textarea id="a"></textarea></label>';
  assert.deepEqual(findUnlabelledFields(markup), []);
});

test('findUnlabelledFields: a placeholder alone is not a label', () => {
  assert.deepEqual(findUnlabelledFields('<input id="a" placeholder="Add a title">'), ['a']);
});

test('findUnlabelledFields: file and hidden inputs are excepted', () => {
  assert.deepEqual(findUnlabelledFields('<input id="a" type="file"><input id="b" type="hidden">'), []);
});

test('every visible input/textarea in miziki.html has an accessible name', () => {
  const offenders = findUnlabelledFields(html);
  assert.deepEqual(offenders, [], 'form fields missing an accessible name: ' + offenders.join(', '));
});
