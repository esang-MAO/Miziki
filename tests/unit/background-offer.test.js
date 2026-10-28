import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

// RF7 (docs/12_REFINE.md): the background-playback return offer card's
// own once-only state (bgNoteHidden/bgCheckReturnOffer/resolveBgOffer).
// player/background.js's own real imports (./transport.js, ./controls.js,
// ../audio/engine.js, ../storage/meta.js, ../shell/nav-stack.js) each pull
// in wide chains (or real DOM/History-API side effects) other test files
// already stop at the door — so each is mocked flat here, the same "stop
// the chain at the door" reasoning as controls.test.js/engine.test.js.
// ../shell/nav-stack.js in particular has no imports of its own, but its
// openLayer()/closeLayer() touch document.activeElement/history.pushState/
// history.go()/applyInert(), none of which this file stubs — mocked to
// plain spies instead, since neither of bgCheckReturnOffer()'s/
// resolveBgOffer()'s own assertions here depend on nav-stack.js's real
// history-stack behavior, only on background.js's own direct DOM writes
// to the card element.
const elCache = new Map();
function fakeEl(){
  const classes = new Set();
  const attrs = {};
  return {
    classList: {
      add(...cs){ cs.forEach(c => classes.add(c)); },
      remove(...cs){ cs.forEach(c => classes.delete(c)); },
      contains(c){ return classes.has(c); },
    },
    setAttribute(k, v){ attrs[k] = String(v); },
    getAttribute(k){ return attrs[k] ?? null; },
    style: {},
    textContent: '',
  };
}
mock.module(new URL('../../src/util/dom.js', import.meta.url).href, {
  namedExports: {
    $(sel){ if(!elCache.has(sel)) elCache.set(sel, fakeEl()); return elCache.get(sel); },
  },
});
mock.module(new URL('../../src/player/transport.js', import.meta.url).href, {
  namedExports: { play(){}, pause(){}, seek(){} },
});
mock.module(new URL('../../src/player/controls.js', import.meta.url).href, {
  namedExports: { prevTrack(){}, nextTrack(){} },
});
mock.module(new URL('../../src/audio/engine.js', import.meta.url).href, {
  namedExports: { ensureContext: async () => {}, decodeAudioFile: async () => {} },
});
mock.module(new URL('../../src/storage/meta.js', import.meta.url).href, {
  namedExports: { queueSave(){} },
});
mock.module(new URL('../../src/ui/path-note.js', import.meta.url).href, {
  namedExports: { setPathNote(){} },
});
// PL2 (docs/19_PLAYER.md, "one clock"): background.js's new currentPos()
// import (bgPosition(), for the lock-screen scrubber) would otherwise
// reach the real player/clock.js, whose own real sleep-timer.js import
// needs `el` from util/dom.js — not provided by this file's own minimal
// dom.js mock above. Stopped at the door, same reasoning as every other
// mock in this file; none of this file's own assertions touch bgPosition().
mock.module(new URL('../../src/player/clock.js', import.meta.url).href, {
  namedExports: { currentPos(){ return 0; } },
});
// PL7 item 1: background.js's new lock-screen-artwork imports would
// otherwise reach the real library/thumbs.js, whose own real chain (edit.js,
// credits.js, record-art/looks.js needing `el` from util/dom.js, etc.) is
// exactly what this file's mocks above already stop at the door. None of
// this file's own assertions touch lock-screen artwork.
mock.module(new URL('../../src/library/thumbs.js', import.meta.url).href, {
  namedExports: { peekLockscreenArtwork(){ return null; }, ensureLockscreenArtwork: async () => [] },
});
// A bare no-op mock would leave resolveBgOffer()'s closeLayer('bg-offer')
// call without a way to run the close callback openLayer() was given —
// background.js relies on that callback (closeBgOfferCardInstant) actually
// firing to hide the card, the same way the real nav-stack.js would run it.
// So this mock tracks each id's own registered close() and invokes it.
const navLayerClosers = new Map();
mock.module(new URL('../../src/shell/nav-stack.js', import.meta.url).href, {
  namedExports: {
    openLayer(id, close){ navLayerClosers.set(id, close); },
    closeLayer(id){ const close = navLayerClosers.get(id); if(close) close(); navLayerClosers.delete(id); },
  },
});

const fakeStorage = {};
globalThis.localStorage = {
  setItem(k, v){ fakeStorage[k] = v; },
  getItem(k){ return (k in fakeStorage) ? fakeStorage[k] : null; },
  removeItem(k){ delete fakeStorage[k]; },
};

// background.js's own module-load-time BG_SUPPORTED check needs just
// enough of window.AudioContext/HTMLMediaElement to read true in this
// environment — the same minimal-stub approach shell.test.js/launch.test.js
// already use for whatever a real browser would otherwise provide. A fake
// <audio> element (document.createElement/body.appendChild) and a bare
// `navigator` (so `'mediaSession' in navigator` reads false rather than
// throwing) are what resolveBgOffer(true)'s own toggleBgAudio()->bgPrime()
// path touches; S.ctx stays null in every test here, so applyOutputRoute()
// returns before touching anything audio-graph-shaped.
function AC(){}
AC.prototype.createMediaStreamDestination = function(){};
globalThis.window = { AudioContext: AC };
function HTMLMediaElement(){}
HTMLMediaElement.prototype.srcObject = null;
globalThis.HTMLMediaElement = HTMLMediaElement;
// Node 22's own globalThis.navigator is a read-only getter (NavigatorUA), so
// it can't be reassigned wholesale the way jsdom-style stubs elsewhere in
// this suite reassign globalThis.document — only 'mediaSession' in navigator
// needs to read false here, which the real Node navigator already satisfies.
globalThis.document = {
  createElement(){
    return {
      setAttribute(){}, removeAttribute(){}, style: {}, addEventListener(){},
      preload: '', loop: false, src: '', srcObject: null, paused: true,
      play(){ return Promise.resolve(); }, pause(){},
    };
  },
  body: { appendChild(){} },
};

const {
  bgNoteHidden, bgCheckReturnOffer, resolveBgOffer,
} = await import('../../src/player/background.js');
const { S } = await import('../../src/state.js');

function resetState(){
  for(const k of Object.keys(fakeStorage)) delete fakeStorage[k];
  elCache.clear();
  S.playing = false;
  S.bgAudio = false;
  S.bg.failed = false;
  S.bg.awaitingReturnOffer = false;
  S.ctx = null;
}

test('bgNoteHidden: flags only a real "would stop" case — playing, background off', () => {
  resetState();
  S.playing = true;
  bgNoteHidden();
  assert.equal(S.bg.awaitingReturnOffer, true);

  resetState();
  S.playing = false;
  bgNoteHidden();
  assert.equal(S.bg.awaitingReturnOffer, false);
});

test('bgCheckReturnOffer: shows the card when flagged and playback actually stopped', () => {
  resetState();
  S.playing = true;
  bgNoteHidden();              // flags it, same as hiding while playing with bg off
  S.playing = false;           // the OS suspended it while hidden
  bgCheckReturnOffer();
  const card = elCache.get('#bgOfferCard');
  assert.equal(card.getAttribute('aria-hidden'), 'false');
  assert.equal(card.classList.contains('open'), true);
  // the flag is one-shot — doesn't fire again on a second check with nothing new
  elCache.delete('#bgOfferCard');
  bgCheckReturnOffer();
  assert.equal(elCache.has('#bgOfferCard'), false);
});

test('bgCheckReturnOffer: does nothing when playback never actually stopped', () => {
  resetState();
  S.playing = true;
  bgNoteHidden();
  // still playing on return — nothing to offer
  bgCheckReturnOffer();
  assert.equal(elCache.has('#bgOfferCard'), false);
});

test('bgCheckReturnOffer: does nothing when nothing was flagged on hide', () => {
  resetState();
  S.playing = false;
  bgCheckReturnOffer();
  assert.equal(elCache.has('#bgOfferCard'), false);
});

test('resolveBgOffer: never shown again after either button, this session or a later one', () => {
  resetState();
  S.playing = true;
  bgNoteHidden();
  S.playing = false;
  bgCheckReturnOffer();
  assert.equal(elCache.has('#bgOfferCard'), true);

  resolveBgOffer(false);   // "Not now"
  const card = elCache.get('#bgOfferCard');
  assert.equal(card.getAttribute('aria-hidden'), 'true');
  assert.equal(S.bgAudio, false);

  // a later hide/return in the same session no longer offers it
  elCache.delete('#bgOfferCard');
  S.playing = true;
  bgNoteHidden();
  S.playing = false;
  bgCheckReturnOffer();
  assert.equal(elCache.has('#bgOfferCard'), false);
});

test('resolveBgOffer(true) turns Background playback on', () => {
  resetState();
  S.playing = true;
  bgNoteHidden();
  S.playing = false;
  bgCheckReturnOffer();
  resolveBgOffer(true);   // "Turn on"
  assert.equal(S.bgAudio, true);
});
