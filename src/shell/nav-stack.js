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

// Elements this module itself set `inert` on, so a later recompute (a new
// topmost layer, or every layer closing) can cleanly undo exactly those and
// no others, rather than walking the whole tree guessing what to clear.
const inertedEls = [];

function clearInert(){
  for(const el of inertedEls) el.removeAttribute('inert');
  inertedEls.length = 0;
}

// Marks `inert` on every sibling along the path from `root` down to each of
// `targets`, leaving every target itself -- and every ancestor on the way
// down to each of them, including `root` -- untouched. `inert` can't be
// un-set on a node once an ancestor already carries it (it isn't a CSS
// cascade a child rule can override), so "the background is inert but the
// topmost layer's own container is still reachable" can only be done this
// way: never inerting an ancestor of anything that must stay reachable,
// only that ancestor's *other* children at each level. Nearly every overlay
// in this app (the full player, the gatefold, every sheet) is a direct
// sibling of `root`'s other top-level content, so in the common case this
// only ever inerts one level of siblings -- but a couple of layers (the
// header's search field, the `+` menu) have containers nested inside the
// regular library screen, and this walk handles that exactly the same way,
// with no special case needed.
//
// `targets` can hold more than one element: a layer can be made of several
// separate top-level siblings rather than one single container with
// everything else nested inside it (the Sundown sheet's own scrim,
// src/shell/sundown-sheet.js, is a sibling of the sheet itself, not a
// parent of it -- CSS gives the scrim `pointer-events:auto` while open so a
// tap on it closes the sheet, but `inert`'s own UA style overrides that
// with `!important`, so a scrim marked inert as "just another background
// sibling" silently loses its own tap-to-dismiss). Every target's own path
// to `root` is protected the same way a single target's would be. Falls
// back to inerting `root` wholesale when there is no real path to walk (no
// container was given for this layer, or none of them are actually inside
// `root`) -- the one case this can't do better than the old blanket
// behavior.
function inertSiblingsOnPathTo(root, targets){
  if(!root) return;
  const real = (targets || []).filter(t => t && root.contains?.(t));
  if(real.length === 0){
    root.setAttribute('inert', '');
    inertedEls.push(root);
    return;
  }
  const protectedSet = new Set();
  for(const t of real){
    for(let node = t; node; node = node.parentNode){
      protectedSet.add(node);
      if(node === root) break;
    }
  }
  const touched = new Set();
  for(const t of real){
    let node = t;
    while(node && node !== root){
      const parent = node.parentNode;
      if(!parent || !parent.children) break;
      for(const sib of parent.children){
        if(sib !== node && !protectedSet.has(sib) && !touched.has(sib)){
          touched.add(sib);
          sib.setAttribute('inert', '');
          inertedEls.push(sib);
        }
      }
      node = parent;
    }
  }
}

function applyInert(){
  if(!appRoot) return;
  clearInert();
  // Background becomes inert (unreachable by focus/AT) whenever at least
  // one layer is open; the topmost layer's own container(s) are never made
  // inert, since they're the thing that should be reachable.
  if(layers.length === 0) return;
  const top = layers[layers.length - 1];
  inertSiblingsOnPathTo(appRoot, top.containers);
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
// `opts.container` is normally a single element, but can also be an array —
// for a layer made of more than one top-level sibling that all need to stay
// reachable together (the Sundown sheet and its own scrim; see
// inertSiblingsOnPathTo()'s own comment above). Focus still moves into just
// the first one given, since that's always the layer's own real content
// (the scrim has nothing worth focusing).
//
// Synchronous, no `await` anywhere in this function or its callers' usual
// path — pushState must happen in the same tick as the user gesture that
// opened the layer, same as every other DOM mutation in an open handler,
// so this never interferes with the iOS bgPrime()-before-await rule (rule 9).
export function openLayer(id, close, opts = {}){
  if(layers.some(l => l.id === id)) return; // already open, not a re-push
  lastFocused = document.activeElement;
  const containers = opts.container
    ? (Array.isArray(opts.container) ? opts.container.filter(Boolean) : [opts.container])
    : [];
  layers.push({ id, close, instantClose: opts.instantClose || close, containers });
  history.pushState({ navLayer: id }, '');
  applyInert();
  if(containers[0]) focusFirstIn(containers[0]);
}

function finishClose(closing, opts){
  applyInert();
  if(layers.length === 0 && lastFocused){
    lastFocused.focus?.({ preventScroll: true });
    lastFocused = null;
  } else if(layers.length > 0){
    const top = layers[layers.length - 1];
    if(top.containers[0]) focusFirstIn(top.containers[0]);
  }
  // opts.skipHistory: this close is being immediately followed, in the same
  // synchronous tick, by an openLayer() call for a *different* layer that
  // replaces this one rather than nesting inside it (the gatefold-to-player
  // hand-off, src/shell/handoff.js and the REDUCED branch of
  // gatefoldPlayTrack, src/gatefold/view.js). history.go() is asynchronous
  // — its popstate only fires on a later task — so a pushState from that
  // very next openLayer() call moves the browser's current position before
  // the queued go() actually runs, and go(-n) then counts back from
  // *that* new position instead of the one it was computed against,
  // landing on the old layer's own now-stale entry and closing the layer
  // that just replaced it. Skipping the go() here leaves one harmless,
  // never-visited extra entry in the browser's real history (Back from the
  // new layer still closes it correctly, landing one entry early but with
  // nothing to close there, so a second Back behaves exactly as if this
  // entry had never existed) rather than racing a real navigation.
  if(!opts.viaPopstate && !opts.skipHistory && closing.length > 0){
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

// NV4 (docs/11_SMOOTH_NAVIGATION.md): pull-to-refresh must never start while
// an overlay/sheet is open (a layer and a pull would otherwise compete for
// the same downward drag) — a real, non-test-only accessor, unlike
// _debugLayers() below.
export function hasOpenLayer(){
  return layers.length > 0;
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
