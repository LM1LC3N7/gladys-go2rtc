// -----------------------------------------------------------------------------
// One go2rtc server, through its documented HTTP API (api/openapi.yaml of
// AlexxIT/go2rtc), basic auth when a user name is set:
//   GET /api                          version
//   GET /api/streams                  the streams (name -> producers/consumers)
//   GET /api/streams?src=<n>&video    connects the source and describes it
//   GET /api/frame.jpeg?src=<n>&width= a JPEG of the next key frame, resized by
//                                     go2rtc's ffmpeg for H.264/H.265 sources
// No streaming code here: go2rtc does the video, the integration only reads.
// -----------------------------------------------------------------------------

import { MAX_JPEG_BYTES, MAX_JSON_BYTES, MAX_PARALLEL_REQUESTS, TIMEOUTS } from '../constants.js';
import { Limiter } from '../limiter.js';
import { CODES, Go2rtcError, scrub } from './errors.js';
import { httpGet } from './http.js';

const isJpeg = (body) => body.length > 3 && body[0] === 0xff && body[1] === 0xd8;

export class Go2rtcClient {
  /**
   * @param {object} options
   * @param {string} options.baseUrl `http://host:1984` or with go2rtc's `base_path`
   * @param {string} [options.username]
   * @param {string} [options.password]
   * @param {typeof httpGet} [options.request] the transport (tests inject one)
   */
  constructor({ baseUrl, username = '', password = '', request = httpGet }) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.request = request;
    this.headers = username
      ? { authorization: `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}` }
      : {};
    this.limiter = new Limiter(MAX_PARALLEL_REQUESTS);
    this.controller = new AbortController();
  }

  /** Abort every request in flight (the app stops or changes server). */
  close() {
    this.controller.abort();
  }

  async get(path, { timeout, maxBytes, sourceErrors = false }) {
    const res = await this.request(`${this.baseUrl}${path}`, {
      headers: this.headers,
      timeout,
      maxBytes,
      signal: this.controller.signal,
    });
    const { status } = res;
    if (status === 200) return res.body;
    if (status === 401 || status === 403) {
      throw new Go2rtcError(CODES.AUTH, 'go2rtc refused the user name or password', { status });
    }
    if (status === 404 && sourceErrors) {
      throw new Go2rtcError(CODES.NOT_FOUND, 'go2rtc has no stream of that name', { status });
    }
    if (status >= 500 && sourceErrors) {
      const reason = scrub(res.body.toString('utf8')) || `HTTP ${status}`;
      throw new Go2rtcError(CODES.SOURCE, reason, { status });
    }
    throw new Go2rtcError(CODES.HTTP, `go2rtc answered HTTP ${status}`, { status });
  }

  async json(path, options) {
    const body = await this.get(path, { maxBytes: MAX_JSON_BYTES, ...options });
    try {
      return JSON.parse(body.toString('utf8'));
    } catch {
      throw new Go2rtcError(
        CODES.BAD_ANSWER,
        'go2rtc did not answer JSON: is this a go2rtc server?',
      );
    }
  }

  /** `{ version, ... }` of GET /api. */
  async info() {
    const info = await this.json('/api', { timeout: TIMEOUTS.API });
    if (!info || typeof info !== 'object' || Array.isArray(info)) {
      throw new Go2rtcError(
        CODES.BAD_ANSWER,
        'Unexpected answer of /api: is this a go2rtc server?',
      );
    }
    return { version: typeof info.version === 'string' ? info.version : null };
  }

  /** The stream names, sorted. Their sources are not kept (credentials). */
  async streams() {
    const streams = await this.json('/api/streams', { timeout: TIMEOUTS.API });
    if (!streams || typeof streams !== 'object' || Array.isArray(streams)) {
      throw new Go2rtcError(CODES.BAD_ANSWER, 'Unexpected answer of /api/streams');
    }
    return Object.keys(streams).sort((a, b) => a.localeCompare(b));
  }

  /**
   * Connect the source of a stream (go2rtc's probe consumer) and return the
   * codecs it offers: `{ codecs: ['H264'] }`. Throws SOURCE when the camera
   * does not answer go2rtc.
   */
  probe(name, { timeout = TIMEOUTS.PROBE } = {}) {
    return this.limiter.run(async () => {
      const stream = await this.json(`/api/streams?src=${encodeURIComponent(name)}&video`, {
        timeout,
        sourceErrors: true,
      });
      const codecs = new Set();
      for (const producer of Array.isArray(stream?.producers) ? stream.producers : []) {
        for (const media of Array.isArray(producer?.medias) ? producer.medias : []) {
          // "video, recvonly, H264"
          const [kind, , list] = String(media).split(', ');
          if (kind === 'video' && list)
            list.split(',').forEach((codec) => codecs.add(codec.trim()));
        }
      }
      return { codecs: [...codecs] };
    });
  }

  /** A JPEG of the stream, `width` asked to go2rtc (honoured for H.264/H.265 only). */
  frame(name, { width, timeout = TIMEOUTS.FRAME } = {}) {
    return this.limiter.run(async () => {
      const query = `src=${encodeURIComponent(name)}${width ? `&width=${width}` : ''}`;
      const body = await this.get(`/api/frame.jpeg?${query}`, {
        timeout,
        maxBytes: MAX_JPEG_BYTES,
        sourceErrors: true,
      });
      // A source that fails answers 200 with no body (go2rtc 1.9.14).
      if (body.length === 0) {
        throw new Go2rtcError(CODES.NO_FRAME, 'The camera sent no image to go2rtc');
      }
      if (!isJpeg(body)) throw new Go2rtcError(CODES.BAD_ANSWER, 'go2rtc did not answer a JPEG');
      return body;
    });
  }
}
