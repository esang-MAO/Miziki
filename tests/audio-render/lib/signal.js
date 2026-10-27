// Small, pure signal-measurement helpers shared by every spec. No
// imports, no DOM -- safe to run inside the harness page or (if a future
// spec wants to) directly in Node for arithmetic-only checks.

// RMS of one channel of a rendered AudioBuffer over [startSec, startSec+lenSec).
export function rmsWindow(buffer, channel, startSec, lenSec){
  const data = buffer.getChannelData(channel);
  const sr = buffer.sampleRate;
  const start = Math.max(0, Math.round(startSec * sr));
  const end = Math.min(data.length, Math.round((startSec + lenSec) * sr));
  if(end <= start) return 0;
  let sum = 0;
  for(let i = start; i < end; i++) sum += data[i] * data[i];
  return Math.sqrt(sum / (end - start));
}

export function rmsToDb(rms){
  return rms > 0 ? 20 * Math.log10(rms) : -Infinity;
}

// Convenience: dBFS of a window, across every channel, taking the louder one.
export function windowDb(buffer, startSec, lenSec){
  let maxRms = 0;
  for(let ch = 0; ch < buffer.numberOfChannels; ch++){
    maxRms = Math.max(maxRms, rmsWindow(buffer, ch, startSec, lenSec));
  }
  return rmsToDb(maxRms);
}
