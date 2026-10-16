// -----------------------------------------------------------------------------
// Images under the Gladys limits: widths stepped down, the step remembered,
// an MJPEG source shrunk in JavaScript, captures shared.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  IMAGE_PREFIX,
  MAX_IMAGE_LENGTH,
  MAX_STORED_IMAGE_LENGTH,
  WIDTH_STEPS,
} from '../src/constants.js';
import { Go2rtcClient } from '../src/go2rtc/client.js';
import { CODES } from '../src/go2rtc/errors.js';
import { StreamImages, maxJpegBytes } from '../src/images.js';
import { jpegSize } from '../src/jpeg.js';
import { createFakeGo2rtc, realJpeg } from './helpers/fakeGo2rtc.js';

const decode = (image) => Buffer.from(image.slice(IMAGE_PREFIX.length), 'base64');
const widthsAsked = (server, name) =>
  server.frames(name).map((r) => Number(new URL(`http://x${r.path}`).searchParams.get('width')));

function setup(streams) {
  const server = createFakeGo2rtc({ streams });
  const client = new Go2rtcClient({ baseUrl: 'http://go2rtc:1984', request: server.request });
  const clock = { now: 1_000_000 };
  const images = new StreamImages({ now: () => clock.now });
  return { server, client, clock, images };
}

test('the byte budget of a JPEG, prefix and base64 included', () => {
  assert.equal(maxJpegBytes(MAX_IMAGE_LENGTH), 115_185);
  const jpeg = Buffer.alloc(maxJpegBytes(MAX_IMAGE_LENGTH));
  assert.ok(`${IMAGE_PREFIX}${jpeg.toString('base64')}`.length <= MAX_IMAGE_LENGTH);
  const over = Buffer.alloc(maxJpegBytes(MAX_IMAGE_LENGTH) + 1);
  assert.ok(`${IMAGE_PREFIX}${over.toString('base64')}`.length > MAX_IMAGE_LENGTH);
});

test('live image: the best width that fits, remembered', async () => {
  const { server, client, clock, images } = setup({
    // 120 bytes per pixel of width: 1280 -> 153 KB, 960 -> 115.2 KB, 640 -> 76.8 KB.
    heavy: { kind: 'h264', width: 1920, height: 1080, online: true, bytesPerWidth: 120 },
  });
  const image = await images.capture(client, 'heavy');
  assert.ok(image.startsWith(IMAGE_PREFIX));
  assert.ok(image.length <= MAX_IMAGE_LENGTH);
  assert.equal(jpegSize(decode(image)).width, 640);
  assert.deepEqual(widthsAsked(server, 'heavy'), [1280, 960, 640]);
  clock.now += 5_000;
  await images.capture(client, 'heavy');
  assert.deepEqual(widthsAsked(server, 'heavy').slice(3), [640], 'one request next time');
});

test('stored image: starts at 640 and goes under 60 KB', async () => {
  const { server, client, images } = setup({
    cam: { kind: 'h264', width: 2560, height: 1440, online: true, bytesPerWidth: 100 },
  });
  const image = await images.capture(client, 'cam', { maxLength: MAX_STORED_IMAGE_LENGTH });
  assert.ok(image.length <= MAX_STORED_IMAGE_LENGTH);
  assert.deepEqual(widthsAsked(server, 'cam'), [640, 480, 320]);
  assert.deepEqual(jpegSize(decode(image)), { width: 320, height: 180 });
});

test('a roomy image tries one width better next time', async () => {
  const { server, client, clock, images } = setup({
    cam: { kind: 'h264', width: 1920, height: 1080, online: true, bytesPerWidth: 120 },
  });
  await images.capture(client, 'cam'); // 640 fits, 76.8 KB: not roomy
  server.streams.cam.bytesPerWidth = 20; // the night: a simple scene
  clock.now += 5_000;
  await images.capture(client, 'cam'); // 640 -> 12.8 KB, roomy
  clock.now += 5_000;
  await images.capture(client, 'cam');
  assert.deepEqual(widthsAsked(server, 'cam'), [1280, 960, 640, 640, 960]);
});

test('an MJPEG source go2rtc cannot resize is shrunk here', async () => {
  const jpeg = realJpeg(1920, 1080, { quality: 95, noise: 80 });
  assert.ok(jpeg.length > maxJpegBytes(MAX_IMAGE_LENGTH));
  const { server, client, clock, images } = setup({
    usb: { kind: 'mjpeg', width: 1920, height: 1080, online: true, jpeg },
  });
  const image = await images.capture(client, 'usb');
  assert.ok(image.length <= MAX_IMAGE_LENGTH);
  assert.ok(jpegSize(decode(image)).width <= 1280);
  assert.equal(server.frames('usb').length, 1, 'detected at the first answer');
  clock.now += 5_000;
  const stored = await images.capture(client, 'usb', { maxLength: MAX_STORED_IMAGE_LENGTH });
  assert.ok(stored.length <= MAX_STORED_IMAGE_LENGTH);
  assert.ok(jpegSize(decode(stored)).width <= 640);
});

test('a small MJPEG frame passes as it is', async () => {
  const jpeg = realJpeg(640, 360, { quality: 70, noise: 10 });
  const { client, images } = setup({
    usb: { kind: 'mjpeg', width: 640, height: 360, online: true, jpeg },
  });
  assert.deepEqual(decode(await images.capture(client, 'usb')), jpeg);
});

test('too large at every width: a clear error, nothing remembered', async () => {
  const { server, client, clock, images } = setup({
    cam: { kind: 'h264', width: 4000, height: 3000, online: true, bytesPerWidth: 2000 },
  });
  await assert.rejects(images.capture(client, 'cam'), { code: CODES.IMAGE_TOO_LARGE });
  assert.deepEqual(widthsAsked(server, 'cam'), WIDTH_STEPS);
  clock.now += 5_000;
  await assert.rejects(images.capture(client, 'cam'), { code: CODES.IMAGE_TOO_LARGE });
  assert.equal(widthsAsked(server, 'cam')[5], 1280, 'starts again from the best width');
});

test('captures are shared: joined while running, reused for 2 s', async () => {
  const { server, client, clock, images } = setup({
    cam: { kind: 'h264', width: 1280, height: 720, online: true, bytesPerWidth: 40 },
  });
  const [a, b] = await Promise.all([images.capture(client, 'cam'), images.capture(client, 'cam')]);
  assert.equal(a, b);
  assert.equal(server.frames('cam').length, 1);
  clock.now += 1_500;
  assert.equal(await images.capture(client, 'cam'), a);
  assert.equal(server.frames('cam').length, 1);
  clock.now += 1_000;
  await images.capture(client, 'cam');
  assert.equal(server.frames('cam').length, 2);
  // The stored and the live images are separate captures.
  await images.capture(client, 'cam', { maxLength: MAX_STORED_IMAGE_LENGTH });
  assert.equal(server.frames('cam').length, 3);
});

test('a source error goes through; no time left, no request', async () => {
  const { client, clock, images } = setup({
    dead: { kind: 'h264', width: 1280, height: 720, online: false },
  });
  await assert.rejects(images.capture(client, 'dead'), { code: CODES.NO_FRAME });
  const slow = new StreamImages({ now: () => clock.now });
  await assert.rejects(slow.capture(client, 'dead', { timeout: 500 }), { code: CODES.TIMEOUT });
});
