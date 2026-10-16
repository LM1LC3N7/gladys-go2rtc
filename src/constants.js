// -----------------------------------------------------------------------------
// Keys, limits and timings. The manifest keys, the trigger keys and the
// external id shape are stored in user scenes and devices: never rename them
// (test/manifest.test.js ties them to the manifest).
// -----------------------------------------------------------------------------

export const MODES = Object.freeze({ BUNDLED: 'bundled', EXTERNAL: 'external' });

export const ACTIONS = Object.freeze({
  TEST: 'test_connection',
  CHECK_STREAMS: 'check_streams',
});

export const SCENE_TRIGGERS = Object.freeze({
  OFFLINE: 'stream_offline',
  ONLINE: 'stream_online',
});

/** `reason` variable of the offline trigger. */
export const OFFLINE_REASONS = Object.freeze({
  SOURCE: 'source', // go2rtc answers, the camera behind the stream does not
  SERVER: 'server', // go2rtc itself does not answer
  REMOVED: 'removed', // the stream is no longer in go2rtc
});

/** Device external ids: `ext:<selector>:stream:<encoded stream name>`. */
export const DEVICE_TYPE = 'stream';
export const FEATURE_IMAGE = 'image';

/** Seconds between two images pushed to Gladys; '0' pushes none. */
export const REFRESH_INTERVALS = Object.freeze([
  '0',
  '5',
  '10',
  '15',
  '30',
  '60',
  '120',
  '300',
  '600',
]);

/** Stream slots of the bundled go2rtc in the configuration form. */
export const STREAM_SLOTS = 6;

// The bundled go2rtc: the sub-container declared in the manifest.
export const CONTAINER = Object.freeze({
  NAME: 'go2rtc',
  IMAGE: 'alexxit/go2rtc:1.9.14',
  // Seen by the integration under /data (Gladys mounts the sub-container
  // volume /config from <integration data>/containers/go2rtc/config).
  CONFIG_DIR: 'containers/go2rtc/config',
  // go2rtc reads both, the second one last: it wins on the keys it sets.
  // The first one is the file the go2rtc web page edits (and where a HomeKit
  // pairing is saved): it belongs to the user, Gladys never rewrites it.
  USER_FILE: 'go2rtc.yaml',
  GLADYS_FILE: 'gladys.yaml',
  // DNS alias of the sub-container on the private network of the integration.
  URL: 'http://go2rtc:1984',
  USERNAME: 'admin',
  PORTS: Object.freeze({
    WEB: { name: 'go2rtc_web', containerPort: 1984 },
    RTSP: { name: 'go2rtc_rtsp', containerPort: 8554 },
    WEBRTC: { name: 'go2rtc_webrtc', containerPort: 8555 },
  }),
});

// Gladys camera images: `image/jpg;base64,...`, the whole string counted.
export const IMAGE_PREFIX = 'image/jpg;base64,';
/** onGetImage (live view, "send a camera image"): the core limit. */
export const MAX_IMAGE_LENGTH = 150 * 1024;
/**
 * The image pushed to the device is stored by Gladys and sent back whole by
 * its device screen (100 KB request limit): kept small, or renaming the
 * camera fails (seen with gladys-frigate).
 */
export const MAX_STORED_IMAGE_LENGTH = 60 * 1024;
export const MAX_PUSHES_PER_MINUTE = 12;

/** Widths asked to go2rtc (`/api/frame.jpeg?width=`), best first. */
export const WIDTH_STEPS = Object.freeze([1280, 960, 640, 480, 320]);
/** First width tried for the stored image. */
export const STORED_START_WIDTH = 640;
/** JPEG qualities of the pure-JS fallback (an MJPEG source go2rtc cannot resize). */
export const JPEG_QUALITIES = Object.freeze([80, 65, 50, 35]);
/** Refuse to decode bigger JPEGs in the 256 MB container (8K would be 33 MP). */
export const MAX_DECODE_MEGAPIXELS = 9;

export const TIMEOUTS = Object.freeze({
  API: 8_000, // /api, /api/streams
  // go2rtc waits for a key frame, then transcodes it: a camera with a long
  // GOP takes a few seconds; a dead one answers an empty 200 after 5 s.
  FRAME: 12_000,
  PROBE: 9_000, // /api/streams?src=&video (connects the source)
  LIVE_IMAGE: 14_000, // onGetImage: Gladys waits 15 s
  BUNDLED_START: 30_000, // the bundled go2rtc answering after a (re)start
});

export const INTERVALS = Object.freeze({
  SERVER_MS: 60_000, // stream list (new streams, go2rtc alive)
  STATUS_ONLY_MS: 300_000, // stream status when no image is pushed
});

/** Two failed reads in a row make a stream offline; one success, online. */
export const OFFLINE_AFTER_FAILURES = 2;
/** An image younger than this is reused (one capture for several screens). */
export const FRESH_IMAGE_MS = 2_000;
/** go2rtc requests at the same time (each snapshot runs an ffmpeg in go2rtc). */
export const MAX_PARALLEL_REQUESTS = 2;
/** Size caps of the answers read from go2rtc. */
export const MAX_JSON_BYTES = 4 * 1024 * 1024;
export const MAX_JPEG_BYTES = 16 * 1024 * 1024;
