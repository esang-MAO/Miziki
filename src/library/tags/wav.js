/* ================= tag readers: WAV (RIFF INFO chunk) =================
   Moved out of main.js's "file loading" section (step 5b), unchanged.
   WAV has no standard place for embedded artwork at all — see index.js's
   findArtworkBlob(), which falls through to a bolted-on ID3 chunk if one
   exists, same as it always has. */
import { txt, clean } from './bytes.js';
import { emptyDetails, splitNames, parseYear } from './details.js';

export function wavTags(b){
  const out = {}, dv = new DataView(b.buffer, b.byteOffset);
  const map = {INAM:'title', IART:'artist', IPRD:'album', ITRK:'track'};
  let i = 12;
  while(i + 8 < Math.min(b.length, 200000)){
    const id = txt(b,i,4), size = dv.getUint32(i+4, true);
    if(id === 'LIST' && txt(b, i+8, 4) === 'INFO'){
      let p = i + 12;
      while(p + 8 < i + 8 + size){
        const sid = txt(b,p,4), ssize = dv.getUint32(p+4, true);
        if(map[sid]) out[map[sid]] = clean(new TextDecoder('utf-8').decode(b.slice(p+8, p+8+ssize)));
        p += 8 + ssize + (ssize % 2);
      }
      break;
    }
    if(!size) break;
    i += 8 + size + (size % 2);
  }
  if(out.track) out.track = parseInt(out.track) || 0;
  return out;
}

export function wavDetails(b){
  const d = emptyDetails();
  try{
    const dv = new DataView(b.buffer, b.byteOffset);
    const map = {IGNR:'genre', ICMT:'comment', ICRD:'year', IENG:'engineers'};
    let i = 12;
    while(i + 8 < Math.min(b.length, 200000)){
      const id = txt(b,i,4), size = dv.getUint32(i+4, true);
      if(id === 'LIST' && txt(b, i+8, 4) === 'INFO'){
        let p = i + 12;
        while(p + 8 < i + 8 + size){
          const sid = txt(b,p,4), ssize = dv.getUint32(p+4, true);
          const key = map[sid];
          if(key){
            const val = clean(new TextDecoder('utf-8').decode(b.slice(p+8, p+8+ssize)));
            if(key === 'year') d.year = parseYear(val);
            else if(key === 'engineers') d.engineers = splitNames(val);
            else d[key] = val;
          }
          p += 8 + ssize + (ssize % 2);
        }
        break;
      }
      if(!size) break;
      i += 8 + size + (size % 2);
    }
  }catch(e){}
  return d;
}
