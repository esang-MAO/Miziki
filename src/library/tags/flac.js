/* ================= tag readers: FLAC =================
   Moved out of main.js's "file loading" section (step 5b), unchanged. */
import { txt, u32be, artURL } from './bytes.js';
import { emptyDetails, splitNames, parsePerformerEntry, parseYear } from './details.js';

export function flacVorbisMap(b){
  const map = {}, dv = new DataView(b.buffer, b.byteOffset);
  let i = 4;
  while(i + 4 < b.length){
    const last = b[i] & 0x80, type = b[i] & 0x7f;
    const len = (b[i+1]<<16) | (b[i+2]<<8) | b[i+3];
    const s = i + 4;
    if(type === 4){                                    // VORBIS_COMMENT, little-endian
      let p = s + 4 + dv.getUint32(s, true);
      const count = dv.getUint32(p, true); p += 4;
      for(let k = 0; k < count && p + 4 <= s + len; k++){
        const l = dv.getUint32(p, true); p += 4;
        const str = new TextDecoder('utf-8').decode(b.slice(p, p + l)); p += l;
        const eq = str.indexOf('=');
        if(eq > 0){
          const key = str.slice(0,eq).toUpperCase(), val = str.slice(eq+1);
          (map[key] || (map[key] = [])).push(val);
        }
      }
      break;
    }
    if(last) break;
    i = s + len;
  }
  return map;
}

export function flacTags(b){
  const map = flacVorbisMap(b);
  const last = k => map[k] ? map[k][map[k].length - 1] : undefined;
  return {title:last('TITLE'), artist:last('ARTIST'), album:last('ALBUM'), albumArtist:last('ALBUMARTIST'),
          track:parseInt(last('TRACKNUMBER'))||0, disc:parseInt(last('DISCNUMBER'))||0};
}

export function flacDetails(b){
  const map = flacVorbisMap(b);
  const d = emptyDetails();
  const all = k => map[k] || [];
  const last = k => all(k).length ? all(k)[all(k).length - 1] : '';
  const names = k => all(k).reduce((acc, v) => acc.concat(splitNames(v)), []);
  d.composers = names('COMPOSER');
  d.lyricists = names('LYRICIST');
  d.producers = names('PRODUCER');
  d.conductors = names('CONDUCTOR');
  d.arrangers = names('ARRANGER');
  d.engineers = names('ENGINEER');
  d.mixers = names('MIXER');
  d.remixers = names('REMIXER');
  d.performers = all('PERFORMER').map(parsePerformerEntry);
  d.genre = last('GENRE');
  d.year = parseYear(last('DATE') || last('YEAR'));
  d.label = last('LABEL') || last('ORGANIZATION');
  d.catalog = last('CATALOGNUMBER');
  d.isrc = last('ISRC');
  d.comment = all('COMMENT').concat(all('DESCRIPTION')).join('\n\n');
  d.hasLyrics = !!(all('LYRICS').length || all('UNSYNCEDLYRICS').length);
  return d;
}

/* ---- embedded artwork ----
   FLAC keeps it in a PICTURE metadata block. */
export function flacPicture(b){
  let i = 4;
  while(i + 4 < b.length){
    const last = b[i] & 0x80, type = b[i] & 0x7f;
    const len = (b[i+1]<<16) | (b[i+2]<<8) | b[i+3];
    const start = i + 4;
    if(type === 6){
      let p = start + 4;                       // skip picture type
      const mimeLen = u32be(b,p); p += 4;
      const mime = txt(b,p,mimeLen); p += mimeLen;
      const descLen = u32be(b,p); p += 4 + descLen;
      p += 16;                                 // width, height, depth, colours
      const dataLen = u32be(b,p); p += 4;
      return artURL(b, p, dataLen, mime);
    }
    if(last) break;
    i = start + len;
  }
  return null;
}
