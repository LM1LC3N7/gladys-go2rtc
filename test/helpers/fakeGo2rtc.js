// -----------------------------------------------------------------------------
// A go2rtc in memory, behind the transport of src/go2rtc/http.js. Its
// answers are shaped after the ones recorded from go2rtc 1.9.14
// (test/fixtures/README.md): /api, /api/streams, the probe of
// /api/streams?src=&video, /api/frame.jpeg (an empty 200 when the source
// fails, the JPEG of an MJPEG source whatever the width asked).
// -----------------------------------------------------------------------------

import { readFileSync } from 'node:fs';
import jpegJs from 'jpeg-js';
import { CODES, Go2rtcError } from '../../src/go2rtc/errors.js';

export const fixture = (name) =>
  JSON.parse(readFileSync(new URL(`../fixtures/${name}`, import.meta.url), 'utf8'));

/**
 * A JPEG header carrying only its size (SOI, SOF0, EOI), padded to `bytes`:
 * enough for the code that reads the dimensions and the length.
 */
export function headerJpeg(width, height, bytes = 64) {
  const sof = Buffer.from([
    0xff,
    0xc0,
    0x00,
    0x11,
    0x08,
    height >> 8,
    height & 0xff,
    width >> 8,
    width & 0xff,
    0x03,
    0x01,
    0x22,
    0x00,
    0x02,
    0x11,
    0x01,
    0x03,
    0x11,
    0x01,
  ]);
  const head = Buffer.concat([Buffer.from([0xff, 0xd8]), sof]);
  const tail = Buffer.from([0xff, 0xd9]);
  return Buffer.concat([head, Buffer.alloc(Math.max(0, bytes - head.length - 2)), tail]);
}

const realJpegs = new Map();
/** A real, decodable JPEG: a gradient with deterministic noise (heavy to compress). */
export function realJpeg(width, height, { quality = 90, noise = 60 } = {}) {
  const key = `${width}x${height}q${quality}n${noise}`;
  if (!realJpegs.has(key)) {
    const data = Buffer.alloc(width * height * 4);
    let seed = 42;
    const rand = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const i = (y * width + x) * 4;
        const n = (rand() - 0.5) * noise;
        data[i] = Math.max(0, Math.min(255, (x * 255) / width + n));
        data[i + 1] = Math.max(0, Math.min(255, (y * 255) / height + n));
        data[i + 2] = Math.max(0, Math.min(255, 128 + n));
        data[i + 3] = 255;
      }
    }
    realJpegs.set(key, Buffer.from(jpegJs.encode({ data, width, height }, quality).data));
  }
  return realJpegs.get(key);
}

const json = (value, status = 200) => ({
  status,
  headers: { 'content-type': 'application/json' },
  body: Buffer.from(JSON.stringify(value)),
});
const textAnswer = (value, status) => ({
  status,
  headers: { 'content-type': 'text/plain; charset=utf-8' },
  body: Buffer.from(value),
});

/**
 * @param {object} [options]
 * @param {Record<string, object>} [options.streams] name -> {
 *     kind: 'h264' | 'mjpeg', width, height, online,
 *     bytesPerWidth (h264: JPEG bytes per pixel of width), jpeg (mjpeg: the camera's JPEG) }
 * @param {{ username: string, password: string } | null} [options.auth]
 * @param {string} [options.basePath] go2rtc's api.base_path
 */
export function createFakeGo2rtc({
  streams = {},
  auth = null,
  basePath = '',
  version = '1.9.14',
} = {}) {
  const server = {
    streams: { ...streams },
    auth,
    down: false,
    version,
    requests: [],
    /** Paths asked, without the base. */
    paths: () => server.requests.map((r) => r.path),
    frames: (name) =>
      server.requests.filter((r) => r.path.startsWith('/api/frame.jpeg') && r.src === name),
    request,
  };

  function answer(path, query) {
    if (path === '/api') {
      return json({
        config_path: '/config/go2rtc.yaml',
        host: 'go2rtc:1984',
        version: server.version,
      });
    }
    const src = query.get('src');
    if (path === '/api/streams' && src === null) {
      return json(
        Object.fromEntries(
          Object.entries(server.streams).map(([name, s]) => [
            name,
            {
              producers: [{ url: s.url ?? `rtsp://user:secret@192.0.2.10/${name}` }],
              consumers: null,
            },
          ]),
        ),
      );
    }
    const stream = server.streams[src];
    if (path === '/api/streams') {
      if (!stream) return textAnswer('', 404);
      if (!stream.online) return textAnswer('streams: dial tcp 192.0.2.10:554: i/o timeout', 500);
      const codec = stream.kind === 'mjpeg' ? 'JPEG' : 'H264';
      return json({ producers: [{ medias: [`video, recvonly, ${codec}`] }], consumers: [] });
    }
    if (path === '/api/frame.jpeg') {
      if (!stream) return textAnswer('stream not found', 404);
      if (stream.failWith) return textAnswer(stream.failWith, 500);
      // go2rtc 1.9.14: a source that fails gives an empty 200 after its 5 s dial timeout.
      if (!stream.online) return { status: 200, headers: {}, body: Buffer.alloc(0) };
      if (stream.kind === 'mjpeg') {
        return { status: 200, headers: { 'content-type': 'image/jpeg' }, body: stream.jpeg };
      }
      const asked = Number(query.get('width')) || stream.width;
      const width = Math.min(asked, stream.width);
      const height = Math.round((stream.height * width) / stream.width);
      const bytes = Math.round(width * (stream.bytesPerWidth ?? 40));
      return {
        status: 200,
        headers: { 'content-type': 'image/jpeg' },
        body: headerJpeg(width, height, bytes),
      };
    }
    return textAnswer('', 404);
  }

  async function request(url, { headers = {}, signal } = {}) {
    const target = new URL(url);
    let path = target.pathname;
    if (basePath && path.startsWith(basePath)) path = path.slice(basePath.length);
    const record = {
      path: `${path}${target.search}`,
      src: target.searchParams.get('src'),
      authorization: headers.authorization ?? null,
    };
    server.requests.push(record);
    await Promise.resolve();
    if (signal?.aborted) throw new Go2rtcError(CODES.TIMEOUT, 'Request aborted');
    if (server.down) throw new Go2rtcError(CODES.UNREACHABLE, 'ECONNREFUSED');
    if (server.auth) {
      const expected = `Basic ${Buffer.from(`${server.auth.username}:${server.auth.password}`).toString('base64')}`;
      if (headers.authorization !== expected) return textAnswer('Unauthorized', 401);
    }
    return answer(path, target.searchParams);
  }

  return server;
}
