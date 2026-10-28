/* TR2 (docs/19_PLAYER.md): eqStateLabel() is used synchronously by the
   Settings -> Playback row (profile/screens.js) on every render of that
   screen -- a common navigation, not a rare "first use" -- so it can't
   dynamically import eq-sheet.js the way that sheet's own open button
   does. Split into its own tiny leaf so pulling in the label never pulls
   in eq-sheet.js's much heavier sheet-rendering code (renderEqSheet,
   drawCurve, sliderRow, the graphic/parametric band builders, presets). */
import { S } from '../state.js';
import { EQ_PRESET_LABELS, matchPreset, defaultEqState } from '../audio/eq.js';

export function ensureEq(){
  if(!S.eq) S.eq = defaultEqState();
  return S.eq;
}

export function currentStateLabel(eq){
  if(!eq.enabled) return 'OFF';
  if(eq.mode === 'parametric'){
    if(!eq.parametricBands || !eq.parametricBands.length) return 'FLAT · ON';
    return 'CUSTOM · ON';
  }
  const preset = matchPreset(eq.graphicBands, eq.tilt);
  return (preset ? EQ_PRESET_LABELS[preset] : 'CUSTOM') + ' · ON';
}

// exported for the Settings -> Playback row (profile/screens.js), which
// shows this same "CUSTOM · ON" text without needing its own copy of the
// matching logic, and without pulling in the full eq-sheet.js module.
export function eqStateLabel(){ return currentStateLabel(ensureEq()); }
