/* ================= tag readers: shared byte/text primitives =================
   Moved out of main.js's "file loading" section (step 5b), unchanged.
   Pure functions of bytes — no DOM, no S. Every format module in this
   directory imports from here rather than duplicating these. */

export const txt = (b,p,n) => { let s=''; for(let i=0;i<n;i++) s += String.fromCharCode(b[p+i]); return s; };
export const u32be = (b,p) => (b[p]<<24 | b[p+1]<<16 | b[p+2]<<8 | b[p+3]) >>> 0;
export const synch = (b,p) => (b[p]<<21) | (b[p+1]<<14) | (b[p+2]<<7) | b[p+3];

export function artURL(bytes, start, len, mime){
  if(len <= 0 || start + len > bytes.length) return null;
  return new Blob([bytes.slice(start, start+len)], {type: mime || 'image/jpeg'});
}

export function decodeText(bytes, enc){
  try{
    if(enc === 1){
      if(bytes[0]===0xFF && bytes[1]===0xFE) return new TextDecoder('utf-16le').decode(bytes.slice(2));
      if(bytes[0]===0xFE && bytes[1]===0xFF) return new TextDecoder('utf-16be').decode(bytes.slice(2));
      return new TextDecoder('utf-16le').decode(bytes);
    }
    if(enc === 2) return new TextDecoder('utf-16be').decode(bytes);
    if(enc === 0) return new TextDecoder('iso-8859-1').decode(bytes);
    return new TextDecoder('utf-8').decode(bytes);
  }catch(e){ return txt(bytes, 0, bytes.length); }
}
export const clean = s => (s || '').replace(/\0+$/,'').trim();
