// docs/32_SHELF_AND_TURNTABLES.md, ST1: the Deluxe entitlement. There is no
// purchase yet (that's Capacitor/StoreKit, later) — until then `S.deluxe`
// can only be flipped by a dev-only `?deluxe=1`/`?deluxe=0` URL switch
// (applied once at boot in main.js, see applyDeluxeUrlSwitch()). This is
// the one place anything checks the flag.
import { S } from './state.js';

export function hasDeluxe(){
  return !!S.deluxe;
}

// Called once at boot, after prefs have loaded. No visible UI reads or
// writes this — a URL switch is the only way to flip it pre-purchase.
export function applyDeluxeUrlSwitch(search){
  const v = new URLSearchParams(search).get('deluxe');
  if(v === '1') S.deluxe = true;
  else if(v === '0') S.deluxe = false;
  return v === '1' || v === '0';
}
