// -----------------------------------------------------------------------------
// Go2rtcError: every failure of a go2rtc request, with a code the app maps to
// a status, a badge or a message. Messages never carry a source URL: go2rtc
// does not mask the credentials of `/api/streams`, nor of some error texts.
// -----------------------------------------------------------------------------

export const CODES = Object.freeze({
  UNREACHABLE: 'unreachable', // no TCP connection to go2rtc
  TIMEOUT: 'timeout', // go2rtc did not answer in time
  AUTH: 'auth', // 401: user name or password refused
  NOT_FOUND: 'not_found', // 404: no such stream
  SOURCE: 'source', // 500: the source (camera) failed
  NO_FRAME: 'no_frame', // 200 with no image: the source gave nothing
  HTTP: 'http', // another status
  BAD_ANSWER: 'bad_answer', // not the JSON or JPEG expected
  TOO_LARGE: 'too_large', // answer above the size cap
  IMAGE_TOO_LARGE: 'image_too_large', // no image under the Gladys limit
});

/** Codes that say go2rtc itself is down or refuses us (not one stream). */
export const SERVER_CODES = new Set([CODES.UNREACHABLE, CODES.AUTH, CODES.HTTP, CODES.BAD_ANSWER]);

export class Go2rtcError extends Error {
  constructor(code, message, { status } = {}) {
    super(message);
    this.name = 'Go2rtcError';
    this.code = code;
    if (status !== undefined) this.status = status;
  }
}

/**
 * Remove the credentials of the URLs found in a text (`rtsp://u:p@host`
 * -> `rtsp://***@host`), cut it short, keep one line.
 */
export function scrub(textValue, max = 200) {
  const clean = String(textValue ?? '')
    .replace(/([a-z][a-z0-9+.-]*:\/\/)[^\s/@]+@/gi, '$1***@')
    .replace(/\s+/g, ' ')
    .trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}
