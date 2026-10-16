// -----------------------------------------------------------------------------
// The only network access of the integration: one GET to go2rtc on node:http
// or node:https. A deadline for the whole exchange, a size cap on the body,
// no redirect followed, abortable. Resolves { status, headers, body } for
// any status; rejects a Go2rtcError for the transport failures.
// -----------------------------------------------------------------------------

import http from 'node:http';
import https from 'node:https';
import { CODES, Go2rtcError } from './errors.js';

/**
 * @param {string} url absolute http(s) URL
 * @param {object} options
 * @param {Record<string, string>} [options.headers]
 * @param {number} options.timeout ms for the whole exchange
 * @param {number} options.maxBytes body size cap
 * @param {AbortSignal} [options.signal]
 */
export function httpGet(url, { headers = {}, timeout, maxBytes, signal } = {}) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const lib = target.protocol === 'https:' ? https : http;
    let settled = false;
    let timer;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      if (error) {
        req.destroy();
        reject(error);
      } else {
        resolve(value);
      }
    };
    const onAbort = () => finish(new Go2rtcError(CODES.TIMEOUT, 'Request aborted'));
    const req = lib.request(
      target,
      { method: 'GET', headers: { accept: '*/*', ...headers } },
      (res) => {
        const chunks = [];
        let size = 0;
        res.on('data', (chunk) => {
          size += chunk.length;
          if (size > maxBytes) {
            finish(new Go2rtcError(CODES.TOO_LARGE, `Answer above ${maxBytes} bytes`));
            return;
          }
          chunks.push(chunk);
        });
        res.on('end', () =>
          finish(null, {
            status: res.statusCode,
            headers: res.headers,
            body: Buffer.concat(chunks),
          }),
        );
        res.on('error', (err) => finish(new Go2rtcError(CODES.UNREACHABLE, err.message)));
      },
    );
    // Before anything can destroy the request: its error event needs a listener.
    req.on('error', (err) =>
      finish(
        // HPE_*: something answered, not in HTTP (an RTSP port typed for the API).
        String(err.code).startsWith('HPE_')
          ? new Go2rtcError(CODES.BAD_ANSWER, 'Not an HTTP answer')
          : new Go2rtcError(CODES.UNREACHABLE, err.code ?? err.message),
      ),
    );
    timer = setTimeout(
      () =>
        finish(new Go2rtcError(CODES.TIMEOUT, `No answer within ${Math.round(timeout / 1000)} s`)),
      timeout,
    );
    if (signal?.aborted) {
      onAbort();
      return;
    }
    signal?.addEventListener('abort', onAbort, { once: true });
    req.end();
  });
}
