/* ================= tag readers: ID3v2 (MP3, AIFF, and WAV/AIFF files with a
   bolted-on ID3 chunk) =================
   Moved out of main.js's "file loading" section (step 5b), unchanged. */
import { txt, u32be, synch, decodeText, clean, artURL } from './bytes.js';
import { emptyDetails, splitNames, parseYear, creditRoleBucket } from './details.js';

export function id3Tags(b, offset){
  const o = offset || 0, out = {};
  if(txt(b,o,3) !== 'ID3') return out;
  const major = b[o+3], end = o + 10 + synch(b, o+6);
  const map = {TIT2:'title', TPE1:'artist', TALB:'album', TPE2:'albumArtist', TRCK:'track', TPOS:'disc',
               TT2:'title', TP1:'artist', TAL:'album', TRK:'track'};
  let i = o + 10;
  while(i + 10 < Math.min(end, b.length)){
    const id = txt(b, i, 4);
    const size = major >= 4 ? synch(b, i+4) : u32be(b, i+4);
    if(!size || size < 1) break;
    const key = map[id];
    if(key){
      const v = clean(decodeText(b.slice(i + 11, i + 10 + size), b[i+10]));
      out[key] = (key === 'track' || key === 'disc') ? (parseInt(v) || 0) : v;
    }
    i += 10 + size;
  }
  return out;
}

function id3NullWidth(enc){ return (enc === 1 || enc === 2) ? 2 : 1; }
function id3FindNull(bytes, enc, from){
  const w = id3NullWidth(enc);
  for(let i = from; i + w <= bytes.length; i += w){
    if(w === 1){ if(bytes[i] === 0) return i; }
    else if(bytes[i] === 0 && bytes[i+1] === 0) return i;
  }
  return -1;
}
function id3SplitFirstNull(bytes, enc){
  const idx = id3FindNull(bytes, enc, 0);
  if(idx < 0) return {first: decodeText(bytes, enc), rest: new Uint8Array(0)};
  return {first: decodeText(bytes.slice(0, idx), enc), rest: bytes.slice(idx + id3NullWidth(enc))};
}
function id3SplitAllNulls(bytes, enc){
  const parts = [];
  let rest = bytes;
  while(rest.length){
    const idx = id3FindNull(rest, enc, 0);
    if(idx < 0){ parts.push(decodeText(rest, enc)); break; }
    parts.push(decodeText(rest.slice(0, idx), enc));
    rest = rest.slice(idx + id3NullWidth(enc));
  }
  return parts;
}

// a separate, independent walk of the same ID3v2 frame loop as id3Tags —
// a malformed frame here can only cost that one details field, never the
// six identity fields id3Tags already resolved
export function id3Details(b, offset){
  const d = emptyDetails();
  try{
    const o = offset || 0;
    if(txt(b,o,3) !== 'ID3') return d;
    const major = b[o+3], end = o + 10 + synch(b, o+6);
    let i = o + 10;
    while(i + 10 < Math.min(end, b.length)){
      const id = txt(b, i, 4);
      const size = major >= 4 ? synch(b, i+4) : u32be(b, i+4);
      if(!size || size < 1) break;
      try{
        const payload = b.slice(i + 10, i + 10 + size);
        const enc = payload[0];
        const plainText = () => clean(decodeText(payload.slice(1), enc));
        if(id === 'COMM' || id === 'USLT'){
          const split = id3SplitFirstNull(payload.slice(4), enc);
          const str = clean(decodeText(split.rest, enc));
          if(id === 'COMM'){ if(str) d.comment = d.comment ? d.comment + '\n\n' + str : str; }
          else if(str) d.hasLyrics = true;
        } else if(id === 'TXXX'){
          const split = id3SplitFirstNull(payload.slice(1), enc);
          const val = clean(decodeText(split.rest, enc));
          if(/^CATALOGNUMBER$/i.test(split.first)) d.catalog = val;
        } else if(id === 'TIPL' || id === 'IPLS'){
          const parts = id3SplitAllNulls(payload.slice(1), enc).map(clean);
          for(let k = 0; k + 1 < parts.length; k += 2){
            const bucket = creditRoleBucket(parts[k]);
            const names = splitNames(parts[k+1]);
            if(bucket) d[bucket].push(...names);
            else names.forEach(n => d.performers.push({name:n, role:parts[k]}));
          }
        } else if(id === 'TMCL'){
          const parts = id3SplitAllNulls(payload.slice(1), enc).map(clean);
          for(let k = 0; k + 1 < parts.length; k += 2){
            splitNames(parts[k+1]).forEach(n => d.performers.push({name:n, role:parts[k]}));
          }
        } else if(id === 'TCOM'){
          d.composers.push(...splitNames(plainText()));
        } else if(id === 'TEXT'){
          d.lyricists.push(...splitNames(plainText()));
        } else if(id === 'TPE3'){
          d.conductors.push(...splitNames(plainText()));
        } else if(id === 'TPE4'){
          d.remixers.push(...splitNames(plainText()));
        } else if(id === 'TCON'){
          d.genre = plainText();
        } else if(id === 'TDRC' || id === 'TYER'){
          const y = parseYear(plainText());
          if(y) d.year = y;
        } else if(id === 'TPUB'){
          d.label = plainText();
        } else if(id === 'TSRC'){
          d.isrc = plainText();
        }
      }catch(e){}
      i += 10 + size;
    }
  }catch(e){}
  return d;
}

/* ---- embedded artwork ----
   MP3/AIFF (and WAV/AIFF with a bolted-on ID3 chunk) keep it in an ID3
   APIC frame. */
export function id3Apic(b, offset){
  const o = offset || 0;
  if(txt(b,o,3) !== 'ID3') return null;
  const major = b[o+3];
  const end = o + 10 + synch(b, o+6);
  let i = o + 10;
  while(i + 10 < Math.min(end, b.length)){
    const id = txt(b,i,4);
    const size = major >= 4 ? synch(b,i+4) : u32be(b,i+4);
    if(!size || size < 0) break;
    if(id === 'APIC'){
      let p = i + 10 + 1;                      // skip text encoding byte
      let mime = '';
      while(b[p] !== 0 && p < b.length){ mime += String.fromCharCode(b[p]); p++; }
      p += 2;                                  // null terminator + picture type
      while(b[p] !== 0 && p < b.length) p++;   // description
      p++;
      return artURL(b, p, i + 10 + size - p, mime);
    }
    i += 10 + size;
  }
  return null;
}
