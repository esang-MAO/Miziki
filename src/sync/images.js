/* ================= image prep for backup (step 07, B4) =================
   The two kinds of image the backup pipeline ever uploads: a custom cover
   (set in the edit sheet, src/library/edit.js) and the profile picture
   (src/profile/screens.js), which doubles as the account's public avatar
   once signed in. Generated crate-art tiers and the thumb:* thumbnails are
   never uploaded — they're rebuilt locally from whatever art the device
   already has (see src/crate/tiers.js / src/library/thumbs.js), and
   embedded artwork comes back with the file itself, not through backup.

   Re-encoding through a canvas, rather than uploading the original file
   bytes, also strips whatever metadata the source photo carried — EXIF,
   and with it any embedded GPS location. That matters most for the
   avatar: it's the one image in this whole pipeline that's publicly
   readable (point 2 of the spec), so its stripped-clean re-encode is the
   only version of it that ever leaves the device.

   Each output is named by the SHA-256 of its own re-encoded bytes (not
   the source file's bytes) — point 3 of the spec. Re-encoding the same
   source image through this same stepped algorithm twice produces
   byte-identical output, so saving "the same picture" again just
   reuploads under the same name (a harmless overwrite, not a new file),
   while any real change gets a new name. That's what makes every
   uploaded file safe to cache forever: its name never needs to change
   without its content changing too.

   DOM-dependent (Image/canvas), like every other image-prep function in
   this codebase (cropSquareImage in library/edit.js, the crate tiers'
   own stepped downscale) — not unit-testable directly, same accepted gap
   share/styles.js's canvas drawing already has. sha256Hex alone is pure
   and tested (tests/unit/images.test.js). No main.js import, no DOM-free
   module import either — this file is a leaf. */

const COVER_MAX_PX = 1200, COVER_Q = 0.85;
const AVATAR_PX = 512, AVATAR_Q = 0.85;

// SHA-256 of a Blob/ArrayBuffer/typed array, as a lowercase hex string.
// Pure once given bytes — works the same in a browser (globalThis.crypto)
// and in Node 22 (the Web Crypto API is global there too), which is what
// lets this one piece be unit-tested without a DOM.
export async function sha256Hex(bytes){
  const buf = (bytes && typeof bytes.arrayBuffer === 'function') ? await bytes.arrayBuffer() : bytes;
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// A center-cropped square, downscaled in halving steps rather than one big
// drawImage() call — the same anti-aliasing approach src/crate/tiers.js's
// cropSquareImageStepped already uses for its own 640/1200px tiers.
// Duplicated here in miniature rather than imported from crate/tiers.js:
// this file stays a leaf with no import of its own, which is what lets
// every module that calls into src/sync/ stay just as free of the
// library/view.js-sized import chains this engagement has hit before
// (see backup.js's own "never import" note).
function cropSquareStepped(blob, maxDim, quality){
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const side = Math.min(img.width, img.height);
      const sx = (img.width - side) / 2, sy = (img.height - side) / 2;
      const out = Math.min(maxDim, side);   // never upscale
      let canvas = document.createElement('canvas');
      canvas.width = side; canvas.height = side;
      canvas.getContext('2d').drawImage(img, sx, sy, side, side, 0, 0, side, side);
      URL.revokeObjectURL(img.src);
      let curSize = side;
      while(curSize > out * 2){
        const next = Math.max(out, Math.round(curSize / 2));
        const nextCanvas = document.createElement('canvas');
        nextCanvas.width = next; nextCanvas.height = next;
        const nextCx = nextCanvas.getContext('2d');
        nextCx.imageSmoothingEnabled = true; nextCx.imageSmoothingQuality = 'high';
        nextCx.drawImage(canvas, 0, 0, curSize, curSize, 0, 0, next, next);
        canvas = nextCanvas; curSize = next;
      }
      if(curSize !== out){
        const finalCanvas = document.createElement('canvas');
        finalCanvas.width = out; finalCanvas.height = out;
        const finalCx = finalCanvas.getContext('2d');
        finalCx.imageSmoothingEnabled = true; finalCx.imageSmoothingQuality = 'high';
        finalCx.drawImage(canvas, 0, 0, curSize, curSize, 0, 0, out, out);
        canvas = finalCanvas;
      }
      canvas.toBlob(b => b ? resolve(b) : reject(new Error('encode failed')), 'image/jpeg', quality);
    };
    img.onerror = () => reject(new Error('could not read image'));
    img.src = URL.createObjectURL(blob);
  });
}

// Prepares a custom cover for upload: square, capped at 1200px, ~0.85
// quality (point 3). Returns the re-encoded blob plus its own hash, which
// is also the filename backup.js uploads it under.
export async function prepareCoverUpload(blob){
  const out = await cropSquareStepped(blob, COVER_MAX_PX, COVER_Q);
  const hash = await sha256Hex(out);
  return { blob: out, hash };
}

// Prepares the profile picture / public avatar: square, 512px, ~0.85
// quality (point 3).
export async function prepareAvatarUpload(blob){
  const out = await cropSquareStepped(blob, AVATAR_PX, AVATAR_Q);
  const hash = await sha256Hex(out);
  return { blob: out, hash };
}
