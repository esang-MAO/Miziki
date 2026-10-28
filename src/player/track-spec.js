/* PL8 item 10 (docs/19_PLAYER.md): the track spec line's own pure half --
   what text to show, and what "Untouched"/"Converted"/"Shaped" means --
   kept import-free and DOM-free the same way audio/eq.js is, so both are
   directly unit-testable. The doc's own two asks: "the track spec line
   shows what's actually happening: source format, and the engine rate
   when it differs... no upsampling claims, ever" (specRateSuffix) and
   "tapping it adds one plain-text state" (specState/specStateLabel). */

// Only non-empty when the engine rate actually differs from the source --
// "no upsampling claims, ever" means never implying a conversion
// happened when the two already match.
export function specRateSuffix(sourceRateHz, engineRateHz){
  if(!sourceRateHz || !engineRateHz || engineRateHz === sourceRateHz) return '';
  const khz = engineRateHz / 1000;
  return ' → ' + (Number.isInteger(khz) ? khz : Math.round(khz * 10) / 10) + ' kHz';
}

// "Shaped" is checked first: EQ, normalization or Vinyl each mean the
// signal is no longer a plain pass-through or a plain rate conversion,
// whatever the file or the rates are doing. Absent all three, "Untouched"
// needs every remaining condition the doc names (lossless source, Pure
// mode, rates already matching); anything short of that -- a lossy
// source, or a lossless one whose rate was converted -- reads as
// "Converted": the file's own content isn't being changed, only its rate
// or its own prior encoding account for the gap.
export function specState({ lossless, mode, eqEnabled, loudnessMode, sourceRateHz, engineRateHz }){
  const reasons = [];
  if(eqEnabled) reasons.push('EQ');
  if(loudnessMode && loudnessMode !== 'off') reasons.push('normalization');
  if(mode === 'vinyl') reasons.push('Vinyl');
  if(reasons.length) return { state: 'shaped', reasons };

  const ratesMatch = !sourceRateHz || !engineRateHz || sourceRateHz === engineRateHz;
  if(lossless && mode === 'pure' && ratesMatch) return { state: 'untouched', reasons: [] };
  return { state: 'converted', reasons: [] };
}

export function specStateLabel(result){
  if(!result) return '';
  if(result.state === 'untouched') return 'Untouched';
  if(result.state === 'converted') return 'Converted';
  return 'Shaped: ' + result.reasons.join(', ');
}
