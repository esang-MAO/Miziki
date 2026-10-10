/* ================= tag readers: MP3 header (rate/channels, LAME gapless) =================
   Moved out of main.js's "file loading" section (step 5b), unchanged.
   ID3 tag/details/artwork reading lives in id3.js — this file is only the
   raw MPEG frame header mp3Info() scans for. */
import { txt, u32be, synch } from './bytes.js';

// The Xing/Info header (written by LAME and most other encoders) lives
// inside the payload of the first MPEG audio frame, right after the side
// info whose size depends on MPEG version and channel mode. LAME appends
// its own extension after Xing's own optional fields, which is where the
// encoder delay/padding actually lives (see PLAYBACK spec §1). Bails out
// (returns null) on anything that doesn't match the expected layout
// exactly, rather than guessing — malformed/absent gapless data means
// standard playback, per spec.
export function mp3GaplessInfo(b, frameStart, mpegVer, mono){
  const sideInfoSize = mpegVer === 3 ? (mono ? 17 : 32) : (mono ? 9 : 17);
  const xingOff = frameStart + 4 + sideInfoSize;
  if(xingOff + 8 > b.length) return null;
  const magic = txt(b, xingOff, 4);
  if(magic !== 'Xing' && magic !== 'Info') return null;
  const flags = u32be(b, xingOff + 4);
  let p = xingOff + 8;
  if(flags & 0x1) p += 4;    // frame count field
  if(flags & 0x2) p += 4;    // byte count field
  if(flags & 0x4) p += 100;  // seek TOC
  if(flags & 0x8) p += 4;    // quality indicator
  if(p + 36 > b.length || txt(b, p, 4) !== 'LAME') return null;
  const delayOff = p + 21;   // 9-byte version string + 2 header bytes + 4+2+2 replay gain + 2 flags/bitrate
  if(delayOff + 3 > b.length) return null;
  const b1 = b[delayOff], b2 = b[delayOff+1], b3 = b[delayOff+2];
  // stored as two 12-bit fields packed into 3 bytes
  const storedDelay = (b1 << 4) | (b2 >> 4);
  const storedPadding = ((b2 & 0x0F) << 8) | b3;
  // LAME's own encoder/decoder filterbank adds a fixed 528+1 sample
  // latency on top of whatever it explicitly stores — the widely-used
  // convention (ffmpeg, foobar2000 and others) is to fold that constant
  // into the trim rather than leaving it for the decoder to also apply
  const delay = storedDelay + 528 + 1;
  const padding = Math.max(0, storedPadding - 528 - 1);
  if(!isFinite(delay) || !isFinite(padding)) return null;
  return {delay, padding};
}

export function mp3Info(b){
  let i = 0;
  if(txt(b,0,3) === 'ID3') i = 10 + synch(b,6);
  const lim = Math.min(b.length - 4, i + 400000);
  for(; i < lim; i++){
    if(b[i] === 0xFF && (b[i+1] & 0xE0) === 0xE0){
      const ver = (b[i+1]>>3) & 3, layer = (b[i+1]>>1) & 3, rIdx = (b[i+2]>>2) & 3;
      if(ver === 1 || layer === 0 || rIdx === 3) continue;
      const base = [44100, 48000, 32000][rIdx];
      const rate = ver === 3 ? base : ver === 2 ? base/2 : base/4;
      const mono = ((b[i+3]>>6) & 3) === 3;
      return {codec: layer===1?'MP3':layer===2?'MP2':'MP1', rate,
              ch: mono ? 1 : 2, lossless:false, gapless: mp3GaplessInfo(b, i, ver, mono)};
    }
  }
  return null;
}
