// docs/32_SHELF_AND_TURNTABLES.md, ST1: the Deluxe entitlement. There is no
// purchase yet (that's Capacitor/StoreKit, later) — until then `S.deluxe`
// can only be flipped by a dev-only `?deluxe=1`/`?deluxe=0` URL switch
// (applied once at boot in main.js, see applyDeluxeUrlSwitch()). This is
// the one place anything checks the flag.
import { S } from './state.js';

export function hasDeluxe(){
  return !!S.deluxe;
}

// LI1 (docs/35_LEAD_IN.md): main.js called this on every launch with no
// build check, so `?deluxe=1` on the live GitHub Pages URL granted Deluxe
// to anyone, and S.deluxe then synced to every device on the account via
// prefs. `isDev` is main.js's `import.meta.env.DEV`, passed in rather than
// read here so the dev-only gate is visible at both ends and this stays
// pure/testable; Vite still replaces and dead-code-eliminates it, since it
// resolves to the same `false` literal in every module either way.
//
// Called once at boot, after prefs have loaded, only when isDev is true.
// No visible UI reads or writes this — a URL switch is the only way to
// flip it pre-purchase, and only in dev.
export function applyDeluxeUrlSwitch(search, isDev){
  if(!isDev) return false;
  const v = new URLSearchParams(search).get('deluxe');
  if(v === '1') S.deluxe = true;
  else if(v === '0') S.deluxe = false;
  return v === '1' || v === '0';
}
