/* TY4 (docs/22_TYPE.md): the one drawn Miziki mark -- data/wordmark.svg's
   outlines, parsed once and cloned for every call site that needs its own
   node (an SVG element can only live in one place in the DOM at a time).
   Every caller gets the upright "A" cut; add .wordmark-mini for the
   filled-dot "C" cut, or rotate the returned node -12deg (a plain CSS
   transform, the caller's own rule) for the tilted "F" cut -- see the
   file's own header comment for which cut is which. */
import wordmarkRaw from '../../data/wordmark.svg?raw';

let template = null;

export function wordmarkEl(){
  if(!template){
    // DOMParser, not innerHTML — CLAUDE.md's security rule bans assigning
    // innerHTML from anything but a string literal (eslint.config.js),
    // and this is a build-time asset, not a literal in this file either.
    template = new DOMParser().parseFromString(wordmarkRaw, 'image/svg+xml').documentElement;
  }
  return template.cloneNode(true);
}

// drawShareWordmark (share/styles.js) draws onto a <canvas>, a separate
// document with no access to the live page's --paper/--accent-text, so it
// needs the mark's own two colours baked in as literal values instead.
export function wordmarkMarkup(letterColor, ringColor){
  return wordmarkRaw
    .replace('fill:var(--paper,#EFE9DF)', 'fill:' + letterColor)
    .replace('stroke:var(--accent-text,#E9A24A)', 'stroke:' + ringColor);
}
