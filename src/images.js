// -----------------------------------------------------------------------------
// Camera images in the format Gladys takes: `image/jpg;base64,...`, the
// whole string under 150 KB (live image) or 60 KB (image stored on the
// device, see constants.js).
//
// go2rtc gives a JPEG of the next key frame (/api/frame.jpeg), resized by its
// own ffmpeg for H.264/H.265 sources: we ask for a width and step it down
// until the image fits. The step that fitted is remembered per stream and
// limit, so a capture usually costs one request. An MJPEG source comes back
// as the camera sent it, whatever the width asked: detected from the JPEG
// header, it is shrunk in JavaScript (src/jpeg.js), one at a time.
//
// Captures are shared: one running for a stream is joined, and an image
// younger than 2 s is reused (a dashboard open on several screens does not
// multiply the snapshots).
// -----------------------------------------------------------------------------

import {
  FRESH_IMAGE_MS,
  IMAGE_PREFIX,
  MAX_IMAGE_LENGTH,
  STORED_START_WIDTH,
  TIMEOUTS,
  WIDTH_STEPS,
} from './constants.js';
import { CODES, Go2rtcError } from './go2rtc/errors.js';
import { jpegSize, shrinkJpeg } from './jpeg.js';
import { Limiter } from './limiter.js';

/** Largest JPEG whose `image/jpg;base64,` string fits in `maxLength`. */
export const maxJpegBytes = (maxLength) => Math.floor((maxLength - IMAGE_PREFIX.length) / 4) * 3;

export const toGladysImage = (jpeg) => `${IMAGE_PREFIX}${jpeg.toString('base64')}`;

export class StreamImages {
  constructor({ now = Date.now, shrink = shrinkJpeg } = {}) {
    this.now = now;
    this.shrink = shrink;
    this.shrinkLimiter = new Limiter(1); // a decode holds a few dozen MB
    this.memo = new Map(); // `${name}|${maxLength}` -> index in WIDTH_STEPS
    this.recent = new Map(); // key -> { at, image }
    this.inFlight = new Map(); // key -> Promise<string>
  }

  /**
   * A fresh image of a stream (`image/jpg;base64,...`).
   * @param {import('./go2rtc/client.js').Go2rtcClient} client
   * @param {string} name go2rtc stream name
   * @param {{ maxLength?: number, timeout?: number }} [options]
   */
  capture(client, name, { maxLength = MAX_IMAGE_LENGTH, timeout = TIMEOUTS.LIVE_IMAGE } = {}) {
    const key = `${name}|${maxLength}`;
    const cached = this.recent.get(key);
    if (cached && this.now() - cached.at < FRESH_IMAGE_MS) return Promise.resolve(cached.image);
    const running = this.inFlight.get(key);
    if (running) return running;
    const promise = this.fit(client, name, key, maxLength, this.now() + timeout)
      .then((jpeg) => {
        const image = toGladysImage(jpeg);
        this.recent.set(key, { at: this.now(), image });
        return image;
      })
      .finally(() => this.inFlight.delete(key));
    this.inFlight.set(key, promise);
    return promise;
  }

  async fit(client, name, key, maxLength, deadline) {
    const maxBytes = maxJpegBytes(maxLength);
    const first = maxLength >= MAX_IMAGE_LENGTH ? 0 : WIDTH_STEPS.indexOf(STORED_START_WIDTH);
    for (let index = this.memo.get(key) ?? first; index < WIDTH_STEPS.length; index += 1) {
      const width = WIDTH_STEPS[index];
      const remaining = deadline - this.now();
      if (remaining < 1_000) throw new Go2rtcError(CODES.TIMEOUT, 'No image in time');
      const jpeg = await client.frame(name, {
        width,
        timeout: Math.min(TIMEOUTS.FRAME, remaining),
      });
      if (jpeg.length <= maxBytes) {
        // Well under the limit: try one step better next time (the scene
        // may have become simpler, at night for instance).
        const roomy = jpeg.length < maxBytes / 2;
        this.memo.set(key, roomy ? Math.max(first, index - 1) : index);
        return jpeg;
      }
      const size = jpegSize(jpeg);
      if (size && size.width > width) {
        // go2rtc did not resize it: an MJPEG source.
        const small = await this.shrinkLimiter.run(() =>
          this.shrink(jpeg, { maxWidth: width, maxBytes }),
        );
        this.memo.set(key, index);
        return small;
      }
    }
    this.memo.delete(key);
    throw new Go2rtcError(CODES.IMAGE_TOO_LARGE, 'The image stays too large at every width');
  }

  /** Forget what was learnt about the streams (another server, a restart). */
  clear() {
    this.memo.clear();
    this.recent.clear();
  }
}
