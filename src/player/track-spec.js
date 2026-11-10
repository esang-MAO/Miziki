/* PL8 item 10 (docs/19_PLAYER.md): the track spec line's own pure half --
   what text to show, and what "Untouched"/"Converted"/"Shaped" means --
   kept import-free and DOM-free the same way audio/eq.js is, so both are
   directly unit-testable. The doc's own two asks: "the track spec line
   shows what's actually happening: source format, and the engine rate
   when it differs... no upsampling claims, ever" (specRateSuffix) and
   "tapping it adds one plain-text state" (specState/specStateLabel). */

// The file's own format/bit-depth/rate words -- "FLAC · 44.1 kHz · 16-bit ·
// stereo" (TY3, docs/22_TYPE.md) -- factored out so the player's own spec
// line and the gatefold's format line (GF1, docs/29_GATEFOLD.md) read the
// one same wording rather than a second copy of it.
export function fileSpecLine(m){
  if(!m) return '';
  return [m.codec, m.rate ? (m.rate/1000).toFixed(1)+' kHz' : null, m.bits ? m.bits+'-bit' : null,
    m.ch===1?'mono':'stereo', m.lossless ? null : 'lossy'].filter(Boolean).join(' · ');
}

// GS5 (docs/30_GROOVES_AND_SHELF.md): the dead-wax etching's third line
// wants a real pressing's own short stamp -- "FLAC 24/96" -- not
// fileSpecLine()'s full "FLAC · 48.0 kHz · 24-bit · stereo". Codec plus
// bit-depth/sample-rate (kHz, trimmed to a whole number when it is one)
// only; a lossy file with no meaningful bit-depth shows the codec alone.
export function compactFormatLabel(m){
  if(!m) return '';
  // bits/kHz reads as one pair (24/96) -- a bare kHz with no bit-depth
  // (every lossy codec) would look like a random number, so it's left
  // off entirely rather than shown alone.
  if(!m.bits || !m.rate) return m.codec || '';
  const khz = m.rate / 1000;
  const khzText = Number.isInteger(khz) ? khz : Math.round(khz * 10) / 10;
  return [m.codec, m.bits + '/' + khzText].filter(Boolean).join(' ');
}

// UN11 (docs/36_UNIFORMITY.md point 2): the player's own "two spec lines" --
// line one always shows "{format} · {speed} · {file type} · {rate} ·
// {lossy/lossless}" ("7″ · 45 · MP3 · 44.1 kHz · lossy"), dropping mono/
// stereo (shown only in Track info) and the word "full speed" (the
// default, so never worth a word here). `formatChip` is record-art/
// format.js's own formatChipText(S.recordFormat) ("7″ · 45"); `m` is the
// track's meta. Pure and DOM-free, like every other helper in this file.
export function playerSpecLine1(formatChip, m){
  if(!m) return '';
  return [formatChip, m.codec, m.rate ? (m.rate/1000).toFixed(1)+' kHz' : null,
    m.lossless ? 'lossless' : 'lossy'].filter(Boolean).join(' · ');
}

// Line two: only when the record isn't at plain full speed, or wears a
// look -- "Night · 0.80× · about 3¾ semitones lower", or a look's own
// name ("Gold"). `rateLine` is solar.js's formatRateChange(rate) text (or
// null at full speed); `phaseName`/`lookName` are plain strings, already
// resolved by the caller (clock.js already has both in scope). A look
// takes priority when both are true at once -- the plan's own example
// lines never show both together, and the look is the rarer, more
// specific fact of the two.
export function playerSpecLine2(phaseName, rateLine, lookName){
  if(lookName) return lookName;
  if(!rateLine) return '';
  return phaseName + ' · ' + rateLine;
}

// UN11 (docs/36_UNIFORMITY.md point 1): the single progress bar's own
// centre caption -- "Side A · 1 of 2" (this track's 1-based position
// among this side's own tracks) when sides are on, or "Track 3 of 10"
// (position in the whole album) when they're off or the track has no
// side at all. Pure: posInSide/sideLen and albumPos/albumLen are already
// resolved by the caller (clock.js has both sets of indices in scope).
export function sideProgressCaption(side, posInSide, sideLen, albumPos, albumLen){
  if(side) return 'Side ' + side + ' · ' + posInSide + ' of ' + sideLen;
  if(!albumLen) return '';
  return 'Track ' + albumPos + ' of ' + albumLen;
}

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
