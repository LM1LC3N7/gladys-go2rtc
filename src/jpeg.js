// -----------------------------------------------------------------------------
// JPEG helpers (pure). go2rtc resizes the snapshots of H.264/H.265 sources
// itself (`width` of /api/frame.jpeg runs its ffmpeg), but hands the JPEG of
// an MJPEG source (USB webcam, HTTP camera) as it is: a 1080p one is ~120 KB,
// above what Gladys takes. That case is shrunk here, in pure JavaScript
// (jpeg-js: decode, area-average downscale, encode), never with a native
// dependency. Decoding is bounded (megapixels, memory) for the 256 MB box.
// -----------------------------------------------------------------------------

import jpegJs from 'jpeg-js';
import { JPEG_QUALITIES, MAX_DECODE_MEGAPIXELS, WIDTH_STEPS } from './constants.js';
import { CODES, Go2rtcError } from './go2rtc/errors.js';

const SOF_MARKERS = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
]);

/** `{ width, height }` read from the frame header, or null. */
export function jpegSize(buf) {
  if (!buf || buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  let i = 2;
  while (i + 9 < buf.length) {
    if (buf[i] !== 0xff) return null;
    const marker = buf[i + 1];
    if (marker === 0xff) {
      i += 1; // fill byte
      continue;
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) {
      i += 2; // markers without a length
      continue;
    }
    if (SOF_MARKERS.has(marker)) {
      return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
    }
    if (marker === 0xda || marker === 0xd9) return null; // scan data before any frame header
    i += 2 + buf.readUInt16BE(i + 2);
  }
  return null;
}

/** Area-average downscale of an RGBA image to `targetWidth` (never up). */
export function downscale(image, targetWidth) {
  const { data, width, height } = image;
  if (targetWidth >= width) return image;
  const w = Math.max(1, Math.round(targetWidth));
  const h = Math.max(1, Math.round((height * w) / width));
  const out = new Uint8Array(w * h * 4);
  const xs = new Int32Array(w + 1);
  const ys = new Int32Array(h + 1);
  for (let i = 0; i <= w; i += 1) xs[i] = Math.min(width, Math.round((i * width) / w));
  for (let j = 0; j <= h; j += 1) ys[j] = Math.min(height, Math.round((j * height) / h));
  for (let j = 0; j < h; j += 1) {
    const y0 = ys[j];
    const y1 = Math.max(ys[j + 1], y0 + 1);
    for (let i = 0; i < w; i += 1) {
      const x0 = xs[i];
      const x1 = Math.max(xs[i + 1], x0 + 1);
      let r = 0;
      let g = 0;
      let b = 0;
      let n = 0;
      for (let y = y0; y < y1; y += 1) {
        let p = (y * width + x0) * 4;
        for (let x = x0; x < x1; x += 1, p += 4) {
          r += data[p];
          g += data[p + 1];
          b += data[p + 2];
          n += 1;
        }
      }
      const o = (j * w + i) * 4;
      out[o] = Math.round(r / n);
      out[o + 1] = Math.round(g / n);
      out[o + 2] = Math.round(b / n);
      out[o + 3] = 255;
    }
  }
  return { data: out, width: w, height: h };
}

/**
 * The JPEG re-encoded at most `maxWidth` wide and `maxBytes` long: the widths
 * of WIDTH_STEPS from `maxWidth` down, each at the JPEG_QUALITIES in turn.
 * Throws IMAGE_TOO_LARGE when even the smallest does not fit.
 */
export function shrinkJpeg(jpeg, { maxWidth, maxBytes, codec = jpegJs }) {
  let decoded;
  try {
    decoded = codec.decode(jpeg, {
      useTArray: true,
      formatAsRGBA: true,
      maxResolutionInMP: MAX_DECODE_MEGAPIXELS,
      maxMemoryUsageInMB: 160,
    });
  } catch (err) {
    throw new Go2rtcError(CODES.BAD_ANSWER, `Unreadable JPEG from go2rtc: ${err.message}`);
  }
  const widths = [...new Set([maxWidth, ...WIDTH_STEPS.filter((w) => w < maxWidth)])].map((w) =>
    Math.min(w, decoded.width),
  );
  for (const width of [...new Set(widths)]) {
    const scaled = downscale(decoded, width);
    for (const quality of JPEG_QUALITIES) {
      const out = Buffer.from(codec.encode(scaled, quality).data);
      if (out.length <= maxBytes) return out;
    }
  }
  throw new Go2rtcError(CODES.IMAGE_TOO_LARGE, 'The image stays too large even shrunk');
}
