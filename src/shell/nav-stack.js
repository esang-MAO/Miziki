// NV2 (docs/11_SMOOTH_NAVIGATION.md): a single history-based layer stack so
// Back, Escape and every overlay's own close button all close exactly the
// topmost open layer, everywhere in the app. Before this step, the only
// existing precedent (src/wiring/gatefold.js's global Escape handler) was a
// hand-written priority chain covering just four of the ~13 overlays in the
// app, with no History API involvement anywhere in src/ at all.
//
// `layers` is the ground truth of what's open, kept in exact sync with real
// `history.pushState()` entries pushed by `openLayer()` — one entry per
// open layer, each carrying `{navLayer: id}` as its state object. Closing a
// layer is always `closeLayer(id)`, called equally from a UI close button
// and from programmatic/cascading code (e.g. showRoute() force-closing the
// gatefold on tab switch) — never a bare direct close function call. This
// is deliberate: every close, however it started, needs to consume exactly
// one history entry (via history.go(-1)) so Back and the X button are
// always in sync and never double-close.
//
// `popstate` (fired on a real Back/swipe-back, AND on history.go() itself)
// is handled by diffing the ids `history.state` currently implies are open
// against `layers`' own ids (idsToClose, a pure function, unit-tested) and
// closing whatever's left over — never by assuming popstate always means
// "close exactly one layer," since closeLayer()'s own history.go(-n) call
// fires its own trailing popstate(s) once `layers` has already been updated
// eagerly, and the diff then correctly finds nothing further to do.

const layers = [];
let lastFocused = null;
let appRoot = null;

// Pure, unit-tested: given the ids the stack currently thinks are open and
// the ids a popstate's own state implies should be open, returns the ids
// that need to be closed (topmost/most-recently-opened first), so a single
// Back press that skipped over several pushState entries at once (e.g. a
// fast double machine-back, or a history.go(-2)) still closes every layer
// in between, in the right order.
export function idsToClose(currentIds, targetIds){
  const target = new Set(targetIds);
  const toClose = [];
  for(let i = currentIds.length - 1; i >= 0; i--){
    const id = currentIds[i];
    if(target.has(id)) break; // everything below a still-open id is untouched
    toClose.push(id);
  }
  return toClose;
}

function currentLayerIds(){
  return layers.map(l => l.id);
}

function focusFirstIn(container){
  if(!container) return;
  const target = container.querySelector(
    '[autofocus], button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
  );
  (target || container).focus?.({ preventScroll: true });
}

function applyInert(){
  if(!appRoot) return;
  // Background becomes inert (unreachable by focus/AT) whenever at least
  // one layer is open; the topmost layer's own container is never made
  // inert, since it's the thing that should be reachable.
  if(layers.length === 0){
    appRoot.removeAttribute('inert');
    return;
  }
  appRoot.setAttribute('inert', '');
}

// Registers a newly-opened overlay as the topmost layer: pushes one history
// entry, remembers the currently-focused element to restore on close, and
// moves focus into `opts.container` if given. `close` is the function this
// layer's own UI (its X button, a background tap, etc.) should call to
// dismiss itself — nav-stack wraps it so the same function also runs
// whenever the layer is closed via Back/Escape/a programmatic cascade.
// `opts.instantClose`, when given, is a cheap synchronous teardown used
// instead of `close` by `forceCloseLayer()` — for the few overlays (the
// gatefold, the sealed sheet) that otherwise have a ~250-600ms exit
// animation that would look wrong racing against an unrelated navigation
// (e.g. switching library tabs out from under an open gatefold).
//
// Synchronous, no `await` anywhere in this function or its callers' usual
// path — pushState must happen in the same tick as the user gesture that
// opened the layer, same as every other DOM mutation in an open handler,
// so this never interferes with the iOS bgPrime()-before-await rule (rule 9).
export function openLayer(id, close, opts = {}){
  if(layers.some(l => l.id === id)) return; // already open, not a re-push
  lastFocused = document.activeElement;
  layers.push({ id, close, instantClose: opts.instantClose || close, container: opts.container || null });
  history.pushState({ navLayer: id }, '');
  applyInert();
  if(opts.container) focusFirstIn(opts.container);
}

function finishClose(closing, opts){
  applyInert();
  if(layers.length === 0 && lastFocused){
    lastFocused.focus?.({ preventScroll: true });
    lastFocused = null;
  } else if(layers.length > 0){
    const top = layers[layers.length - 1];
    if(top.container) focusFirstIn(top.container);
  }
  if(!opts.viaPopstate && closing.length > 0){
    history.go(-closing.length);
  }
}

// Closes layer `id` (and, if it isn't the topmost layer, every layer above
// it too — closing a background layer out of order closes what was stacked
// on top of it first), using each layer's normal (possibly animated) close.
// `opts.viaPopstate` is set internally by the popstate handler, which has
// already seen history move — so in that path this function must not
// itself call history.go() a second time.
export function closeLayer(id, opts = {}){
  const idx = layers.findIndex(l => l.id === id);
  if(idx === -1) return;
  const closing = layers.splice(idx); // this layer and everything above it
  // Run close callbacks top-down (last opened first), matching the order a
  // user backing out one Escape/Back press at a time would see.
  for(let i = closing.length - 1; i >= 0; i--){
    try{ closing[i].close(); } catch(_e){ /* a layer's own close must not block the rest */ }
  }
  finishClose(closing, opts);
}

// Same as closeLayer, but uses each layer's instant (non-animated) teardown
// — for when something OTHER than the user dismissing this layer invalidates
// it (e.g. switching away from the Library tab while the gatefold is open).
export function forceCloseLayer(id, opts = {}){
  const idx = layers.findIndex(l => l.id === id);
  if(idx === -1) return;
  const closing = layers.splice(idx);
  for(let i = closing.length - 1; i >= 0; i--){
    try{ closing[i].instantClose(); } catch(_e){ /* same as closeLayer */ }
  }
  finishClose(closing, opts);
}

function handlePopstate(ev){
  const targetId = ev.state && ev.state.navLayer;
  const targetIds = targetId ? currentLayerIds().includes(targetId)
    ? currentLayerIds().slice(0, currentLayerIds().indexOf(targetId) + 1)
    : [] : [];
  const toClose = idsToClose(currentLayerIds(), targetIds);
  if(toClose.length === 0) return; // stale/no-op popstate — nothing open, or already in sync
  for(const id of toClose){
    closeLayer(id, { viaPopstate: true });
  }
}

function handleKeydown(ev){
  if(ev.key !== 'Escape') return;
  if(layers.length === 0) return;
  const top = layers[layers.length - 1];
  ev.preventDefault();
  closeLayer(top.id);
}

// --- tab-switch Back exception ---------------------------------------
// Switching tabs uses replaceState (so the tab bar doesn't pile up history
// entries a user would have to Back through one at a time) with one
// exception: leaving the Library tab for any other tab pushes a real entry,
// so a single Back press from a non-Library tab always lands on Library
// first (matching how a phone's own app-switcher-style navigation behaves),
// and only a second Back press from Library actually exits the app.
let lastRoute = null;
let restoreRouteCb = null;

export function onRouteRestore(cb){
  restoreRouteCb = cb;
}

export function recordRoute(route){
  if(layers.length > 0) return; // a layer is on top of the route change; leave its own history entry alone
  if(lastRoute === null){
    history.replaceState({ navRoute: route }, '');
  } else if(lastRoute !== 'library' && route === 'library'){
    history.replaceState({ navRoute: route }, '');
  } else if(lastRoute === 'library' && route !== 'library'){
    history.pushState({ navRoute: route }, '');
  } else {
    history.replaceState({ navRoute: route }, '');
  }
  lastRoute = route;
}

function handleRoutePopstate(ev){
  if(layers.length > 0) return; // handlePopstate owns this one
  const route = ev.state && ev.state.navRoute;
  if(route && restoreRouteCb){
    lastRoute = route;
    restoreRouteCb(route);
  }
}

export function initNavStack(root){
  appRoot = root || document.getElementById('app') || document.body;
  history.replaceState({ navRoute: 'library' }, '');
  lastRoute = 'library';
  window.addEventListener('popstate', (ev) => {
    handlePopstate(ev);
    handleRoutePopstate(ev);
  });
  window.addEventListener('keydown', handleKeydown);
}

// test-only accessor — never used by app code
export function _debugLayers(){
  return layers.map(l => l.id);
}
