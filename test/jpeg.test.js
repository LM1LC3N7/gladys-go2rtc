import { test } from 'node:test';
import assert from 'node:assert/strict';
import jpegJs from 'jpeg-js';
import { CODES } from '../src/go2rtc/errors.js';
import { downscale, jpegSize, shrinkJpeg } from '../src/jpeg.js';
import { headerJpeg, realJpeg } from './helpers/fakeGo2rtc.js';

test('jpegSize reads the frame header', () => {
  assert.deepEqual(jpegSize(headerJpeg(1920, 1080)), { width: 1920, height: 1080 });
  assert.deepEqual(jpegSize(realJpeg(64, 48)), { width: 64, height: 48 });
  assert.equal(jpegSize(Buffer.from('not a jpeg')), null);
  assert.equal(jpegSize(null), null);
  // Scan data before any frame header.
  assert.equal(jpegSize(Buffer.from([0xff, 0xd8, 0xff, 0xda, 0, 4, 0, 0, 0, 0, 0, 0])), null);
  // Garbage between segments.
  assert.equal(jpegSize(Buffer.from([0xff, 0xd8, 0x00, 0x11, 0, 0, 0, 0, 0, 0, 0, 0])), null);
});

test('downscale averages blocks and keeps the aspect ratio', () => {
  const data = new Uint8Array(4 * 2 * 4);
  // A 4x2 image: left half black, right half white.
  for (let y = 0; y < 2; y += 1) {
    for (let x = 0; x < 4; x += 1) {
      const v = x < 2 ? 0 : 255;
      data.set([v, v, v, 255], (y * 4 + x) * 4);
    }
  }
  const small = downscale({ data, width: 4, height: 2 }, 2);
  assert.equal(small.width, 2);
  assert.equal(small.height, 1);
  assert.deepEqual([...small.data], [0, 0, 0, 255, 255, 255, 255, 255]);
  const same = { data, width: 4, height: 2 };
  assert.equal(downscale(same, 8), same, 'never up');
});

test('shrinkJpeg: an MJPEG frame brought under the limit', () => {
  const big = realJpeg(1920, 1080, { quality: 95, noise: 80 });
  assert.ok(big.length > 115_000, `the test image is ${big.length} bytes`);
  const small = shrinkJpeg(big, { maxWidth: 1280, maxBytes: 115_185 });
  assert.ok(small.length <= 115_185);
  const size = jpegSize(small);
  assert.ok(size.width <= 1280);
  assert.equal(size.height, Math.round((1080 * size.width) / 1920));
  assert.equal(jpegJs.decode(small).width, size.width, 'a valid JPEG');
});

test('shrinkJpeg: never upscaled, refused when nothing fits, unreadable input', () => {
  const tiny = realJpeg(200, 100);
  assert.equal(jpegSize(shrinkJpeg(tiny, { maxWidth: 1280, maxBytes: 100_000 })).width, 200);
  assert.throws(() => shrinkJpeg(tiny, { maxWidth: 1280, maxBytes: 10 }), {
    code: CODES.IMAGE_TOO_LARGE,
  });
  assert.throws(() => shrinkJpeg(headerJpeg(1920, 1080, 500), { maxWidth: 640, maxBytes: 100 }), {
    code: CODES.BAD_ANSWER,
  });
});
