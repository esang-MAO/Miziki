/* ================= tag readers: format dispatch =================
   Moved out of main.js's "file loading" section (step 5b), unchanged —
   readHeader/readTags/readDetails/findArtworkBlob are the public surface
   of src/library/tags/: everything that needs to read a music file's
   bytes (today, just src/library/import.js) goes through these four,
   plus emptyDetails (re-exported here for convenience — the same default
   details object a caller falls back to when a file has none). */
import { txt, clean } from './bytes.js';
import { emptyDetails } from './details.js';
import { flacTags, flacDetails, flacPicture } from './flac.js';
import { mp4Info, mp4Tags, mp4Details, mp4Cover } from './mp4.js';
import { mp3Info } from './mp3.js';
import { id3Tags, id3Details, id3Apic } from './id3.js';
import { wavTags, wavDetails } from './wav.js';

export { emptyDetails };

function readHeader(buf){
  const b = new Uint8Array(buf), dv = new DataView(buf);
  const tag = txt(b,0,4);
  if(tag === 'fLaC'){
    const p = 18;                       // 4 magic + 4 block header + 10 into STREAMINFO
    return {codec:'FLAC', lossless:true,
      rate: (b[p]<<12) | (b[p+1]<<4) | (b[p+2]>>4),
      ch: ((b[p+2]>>1) & 0x07) + 1,
      bits: (((b[p+2] & 1) << 4) | (b[p+3] >> 4)) + 1};
  }
  if(tag === 'RIFF'){
    let i = 12;
    while(i < Math.min(b.length - 8, 100000)){
      const id = txt(b,i,4), size = dv.getUint32(i+4, true);
      if(id === 'fmt ') return {codec:'WAV', lossless:true,
        ch:dv.getUint16(i+10,true), rate:dv.getUint32(i+12,true), bits:dv.getUint16(i+22,true)};
      i += 8 + size + (size % 2);
    }
    return {codec:'WAV', lossless:true};
  }
  if(tag === 'FORM'){
    for(let i = 12; i < Math.min(b.length - 8, 100000); i++){
      if(txt(b,i,4) === 'COMM') return {codec:'AIFF', lossless:true,
        ch:(b[i+8]<<8)|b[i+9], bits:(b[i+14]<<8)|b[i+15]};
    }
    return {codec:'AIFF', lossless:true};
  }
  if(txt(b,4,4) === 'ftyp') return mp4Info(b);
  const mp3 = mp3Info(b);
  if(mp3) return mp3;
  return {codec:'Audio'};
}

function readTags(buf, filename){
  let t = {};
  try{
    const b = new Uint8Array(buf), tag = txt(b,0,4);
    if(tag === 'fLaC') t = flacTags(b);
    else if(txt(b,4,4) === 'ftyp') t = mp4Tags(b);
    else if(txt(b,0,3) === 'ID3') t = id3Tags(b, 0);
    else if(tag === 'RIFF') t = wavTags(b);
    else if(tag === 'FORM'){
      for(let i = 12; i < Math.min(b.length - 10, 2000000); i++){
        if(b[i]===0x49 && b[i+1]===0x44 && b[i+2]===0x33){ t = id3Tags(b, i); break; }
      }
    }
  }catch(e){}
  return {
    title: clean(t.title) || filename.replace(/\.[^.]+$/,''),
    artist: clean(t.artist) || 'Unknown Artist',
    album: clean(t.album) || 'Unknown Album',
    albumArtist: clean(t.albumArtist) || clean(t.artist) || 'Unknown Artist',
    track: t.track || 0,
    disc: t.disc || 0
  };
}

function readDetails(buf){
  try{
    const b = new Uint8Array(buf), tag = txt(b,0,4);
    if(tag === 'fLaC') return flacDetails(b);
    if(txt(b,4,4) === 'ftyp') return mp4Details(b);
    if(txt(b,0,3) === 'ID3') return id3Details(b, 0);
    if(tag === 'RIFF') return wavDetails(b);
    if(tag === 'FORM'){
      for(let i = 12; i < Math.min(b.length - 10, 2000000); i++){
        if(b[i]===0x49 && b[i+1]===0x44 && b[i+2]===0x33) return id3Details(b, i);
      }
    }
  }catch(e){}
  return emptyDetails();
}

function findArtworkBlob(buf){
  try{
    const b = new Uint8Array(buf);
    if(txt(b,0,4) === 'fLaC') return flacPicture(b);
    if(txt(b,4,4) === 'ftyp') return mp4Cover(b);
    if(txt(b,0,3) === 'ID3')  return id3Apic(b, 0);
    if(txt(b,0,4) === 'RIFF' || txt(b,0,4) === 'FORM'){
      // some encoders bolt an ID3 chunk onto WAV/AIFF; most do not
      for(let i = 12; i < Math.min(b.length - 10, 4000000); i++){
        if(b[i]===0x49 && b[i+1]===0x44 && b[i+2]===0x33){
          const url = id3Apic(b, i); if(url) return url;
        }
      }
    }
  }catch(e){}
  return null;
}

export { readHeader, readTags, readDetails, findArtworkBlob };
