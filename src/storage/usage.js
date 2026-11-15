/* BD5 (docs/38_BEFORE_THE_DOMAIN.md): "storage you can see" — a small wrapper
   around navigator.storage.estimate() (unsupported in some WebViews, hence
   the feature-detect and the null return) plus the pure string formatting
   Library tools' own usage line and addFiles()'s pre-import fit check both
   need. */
import { formatBytes } from '../util/text.js';

export async function readUsage(){
  try{
    if(!(navigator.storage && navigator.storage.estimate)) return null;
    const { usage, quota } = await navigator.storage.estimate();
    if(typeof quota !== 'number') return null;
    return { usage: usage || 0, quota };
  }catch(_e){ return null; } // feature detection -- expected, not logged
}

export function formatUsage(usage, quota){
  return 'Using ' + formatBytes(usage) + ' of about ' + formatBytes(quota) + ' Miziki can use on this device.';
}
