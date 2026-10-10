/* ================= tag readers: MP4 / ALAC / AAC =================
   Moved out of main.js's "file loading" section (step 5b), unchanged. */
import { txt, u32be, clean, artURL } from './bytes.js';
import { emptyDetails, splitNames, parseYear } from './details.js';

// Walks the MP4 box tree looking for moov > udta > meta > ilst > ---- with
// mean "com.apple.iTunes" and name "iTunSMPB" — the de facto standard
// (unofficial but universal) home for AAC encoder delay/padding (see
// PLAYBACK spec §1). Bails out anywhere the structure doesn't match
// exactly rather than guessing.
export function mp4BoxChildren(b, start, end, skipHeader){
  const out = [];
  let i = start + (skipHeader || 0);
  while(i + 8 <= end){
    let size = u32be(b, i);
    const type = txt(b, i+4, 4);
    let hdr = 8;
    if(size === 0) size = end - i;
    else if(size === 1){
      if(i + 16 > end) break;
      if(u32be(b, i+8) !== 0) break;   // sizes beyond 32-bit are not realistic here
      size = u32be(b, i+12);
      hdr = 16;
    }
    if(size < hdr || i + size > end) break;
    out.push({type, start: i + hdr, end: i + size});
    i += size;
  }
  return out;
}
export function mp4GaplessInfo(b){
  try{
    const top = mp4BoxChildren(b, 0, b.length, 0);
    const moov = top.find(x => x.type === 'moov'); if(!moov) return null;
    const udta = mp4BoxChildren(b, moov.start, moov.end).find(x => x.type === 'udta'); if(!udta) return null;
    const meta = mp4BoxChildren(b, udta.start, udta.end).find(x => x.type === 'meta'); if(!meta) return null;
    // 'meta' carries a 4-byte version/flags field before its own children,
    // unlike most container boxes
    const ilst = mp4BoxChildren(b, meta.start, meta.end, 4).find(x => x.type === 'ilst'); if(!ilst) return null;
    for(const item of mp4BoxChildren(b, ilst.start, ilst.end)){
      if(item.type !== '----') continue;
      const kids = mp4BoxChildren(b, item.start, item.end);
      const meanBox = kids.find(x => x.type === 'mean'), nameBox = kids.find(x => x.type === 'name'), dataBox = kids.find(x => x.type === 'data');
      if(!meanBox || !nameBox || !dataBox) continue;
      const meanStr = txt(b, meanBox.start + 4, meanBox.end - meanBox.start - 4);
      const nameStr = txt(b, nameBox.start + 4, nameBox.end - nameBox.start - 4);
      if(meanStr !== 'com.apple.iTunes' || nameStr !== 'iTunSMPB') continue;
      const valStr = txt(b, dataBox.start + 8, dataBox.end - dataBox.start - 8).trim();
      const fields = valStr.split(/\s+/);
      if(fields.length < 3) return null;
      const delay = parseInt(fields[1], 16), padding = parseInt(fields[2], 16);
      if(!isFinite(delay) || !isFinite(padding)) return null;
      return {delay, padding};
    }
  }catch(e){ return null; }
  return null;
}

export function mp4Info(b){
  const lim = Math.min(b.length - 40, 4000000);
  for(let i = 8; i < lim; i++){
    if(b[i]===0x61 && b[i+1]===0x6C && b[i+2]===0x61 && b[i+3]===0x63){        // 'alac'
      if(u32be(b, i-4) === 36){                                                 // the magic cookie
        const cs = i + 4;
        return {codec:'ALAC', bits:b[cs+9], ch:b[cs+13], rate:u32be(b,cs+24), lossless:true};
      }
    }
    if(b[i]===0x6D && b[i+1]===0x70 && b[i+2]===0x34 && b[i+3]===0x61){        // 'mp4a'
      return {codec:'AAC', lossless:false, gapless: mp4GaplessInfo(b)};
    }
  }
  return {codec:'MP4 audio', lossless:false};
}

export function mp4RawAtoms(b){
  const out = {}, lim = Math.min(b.length - 8, 8000000);
  let ilst = -1;
  for(let i = 8; i < lim; i++){
    if(b[i]===0x69 && b[i+1]===0x6C && b[i+2]===0x73 && b[i+3]===0x74){ ilst = i; break; }
  }
  if(ilst < 0) return out;
  const end = Math.min(b.length, ilst - 4 + u32be(b, ilst - 4));
  let p = ilst + 4;
  while(p + 16 < end){
    const asize = u32be(b, p);
    if(asize < 8) break;
    const code = txt(b, p+4, 4);
    if(txt(b, p+12, 4) === 'data'){
      const dsize = u32be(b, p+8);
      out[code] = b.slice(p + 8 + 16, p + 8 + dsize);
    }
    p += asize;
  }
  return out;
}

export function mp4Tags(b){
  const atoms = mp4RawAtoms(b), out = {};
  const map = {'\xA9nam':'title', '\xA9ART':'artist', '\xA9alb':'album',
               'aART':'albumArtist', 'trkn':'track', 'disk':'disc'};
  Object.keys(map).forEach(code => {
    const payload = atoms[code];
    if(!payload) return;
    const key = map[code];
    if(key === 'track' || key === 'disc') out[key] = (payload[2]<<8) | payload[3];
    else out[key] = clean(new TextDecoder('utf-8').decode(payload));
  });
  return out;
}

// free-form atoms (producer/engineer/etc credits) are not standardized on
// MP4 — only the ones with real atom codes are read; the rest stay empty
export function mp4Details(b){
  const atoms = mp4RawAtoms(b), d = emptyDetails();
  const text = code => atoms[code] ? clean(new TextDecoder('utf-8').decode(atoms[code])) : '';
  d.composers = splitNames(text('\xA9wrt'));
  d.genre = text('\xA9gen');
  d.year = parseYear(text('\xA9day'));
  d.comment = text('\xA9cmt');
  d.hasLyrics = !!atoms['\xA9lyr'];
  return d;
}

/* ---- embedded artwork ----
   MP4/ALAC keeps it in a 'covr' atom. */
export function mp4Cover(b){
  for(let i = 0; i < b.length - 24; i++){
    if(b[i]===0x63 && b[i+1]===0x6F && b[i+2]===0x76 && b[i+3]===0x72){   // 'covr'
      let p = i + 4;
      const dataSize = u32be(b,p);
      if(txt(b,p+4,4) !== 'data') continue;
      const kind = u32be(b, p+8) & 0xFF;       // 13 = jpeg, 14 = png
      const start = p + 16, len = dataSize - 16;
      const url = artURL(b, start, len, kind === 14 ? 'image/png' : 'image/jpeg');
      if(url) return url;
    }
  }
  return null;
}
