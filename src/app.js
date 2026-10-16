// -----------------------------------------------------------------------------
// Go2rtcApp: the integration. One go2rtc server at a time (the user's, or
// the bundled sub-container), one Gladys camera per stream.
//
//   start(config)   (re)connects: bundled container ensured or stopped,
//                   stream list read, Discovery published, loops started
//   server loop     every minute: /api + /api/streams (alive? new streams?)
//   refresh loop    every `refresh_interval` s: one image per created camera,
//                   in turn, pushed to Gladys (60 KB); with '0', a status
//                   probe every 5 minutes instead
//   getImage        onGetImage: a fresh image (150 KB)
//
// Every read of a camera says whether it is online: two failures in a row
// make it offline (badge + `stream_offline` event), one success online again
// (`stream_online`). The first reading only arms: no event at start.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { BundledGo2rtc } from './bundled.js';
import { normalizeConfig } from './config.js';
import {
  INTERVALS,
  MAX_IMAGE_LENGTH,
  MAX_PUSHES_PER_MINUTE,
  MAX_STORED_IMAGE_LENGTH,
  MODES,
  OFFLINE_AFTER_FAILURES,
  OFFLINE_REASONS,
  SCENE_TRIGGERS,
  TIMEOUTS,
} from './constants.js';
import { buildCameraDevice, createdStreams, streamNameOf } from './devices.js';
import { Go2rtcClient } from './go2rtc/client.js';
import { CODES, SERVER_CODES } from './go2rtc/errors.js';
import { httpGet } from './go2rtc/http.js';
import { StreamImages } from './images.js';
import { T, reasonOf } from './i18n.js';

/** Codes that say the camera behind a stream failed. */
const STREAM_FAILURES = new Set([CODES.NO_FRAME, CODES.SOURCE, CODES.TIMEOUT]);
const MAX_LISTED_NAMES = 10;
const CHECK_BUDGET_MS = 100_000; // the check_streams button waits 120 s

const sameList = (a, b) => a.length === b.length && a.every((value, i) => value === b[i]);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export class Go2rtcApp {
  /**
   * @param {object} options
   * @param {import('@gladysassistant/integration-sdk').GladysIntegration} options.gladys
   * @param {object} [options.logger]
   * @param {Function} [options.request] the HTTP transport (tests inject a fake go2rtc)
   * @param {BundledGo2rtc} [options.bundled]
   * @param {() => number} [options.now]
   * @param {{ setTimeout: Function, clearTimeout: Function }} [options.timers]
   * @param {(ms: number) => Promise<void>} [options.wait]
   */
  constructor({
    gladys,
    logger = createLogger({ name: 'go2rtc' }),
    request = httpGet,
    bundled = new BundledGo2rtc({ gladys }),
    now = Date.now,
    timers = globalThis,
    wait = sleep,
  }) {
    this.gladys = gladys;
    this.logger = logger;
    this.request = request;
    this.bundled = bundled;
    this.now = now;
    this.timers = timers;
    this.wait = wait;
    this.images = new StreamImages({ now });
    this.config = normalizeConfig();
    this.client = null;
    this.bundledInfo = null;
    this.server = { online: null, version: null, streams: [] };
    this.cameras = new Map(); // device external id -> { online, failures }
    this.pushWindows = new Map(); // device external id -> { count, resetAt }
    this.handles = new Set();
    this.generation = 0;
    this.queue = Promise.resolve();
    this.lastStatus = null;
  }

  // --- Lifecycle -------------------------------------------------------------

  /** (Re)start with a configuration. Calls are serialized. */
  start(rawConfig) {
    const run = this.queue.then(() => this.run(rawConfig));
    this.queue = run.catch(() => {});
    return run;
  }

  async stop() {
    this.generation += 1;
    this.halt();
  }

  halt() {
    for (const handle of this.handles) this.timers.clearTimeout(handle);
    this.handles.clear();
    this.client?.close();
    this.client = null;
  }

  async run(rawConfig) {
    this.halt();
    const generation = ++this.generation;
    const config = normalizeConfig(rawConfig);
    this.config = config;
    this.images.clear();
    this.cameras.clear();
    this.server = { online: null, version: null, streams: [] };
    this.bundledInfo = null;
    this.lastStatus = null;

    let client;
    if (config.mode === MODES.EXTERNAL) {
      await this.bundled.stop().catch((err) => {
        this.logger.debug(`Bundled go2rtc not stopped: ${err.message}`);
      });
      if (config.external.urlError) {
        const message = {
          empty: T.status.urlEmpty,
          credentials: T.status.urlCredentials,
        }[config.external.urlError];
        await this.setStatus(false, message ?? T.status.urlInvalid);
        return;
      }
      client = new Go2rtcClient({
        baseUrl: config.external.url,
        username: config.external.username,
        password: config.external.password,
        request: this.request,
      });
      this.logger.info(`Using the go2rtc server at ${config.external.url}`);
    } else {
      try {
        this.bundledInfo = await this.bundled.ensure(config.bundled);
      } catch (err) {
        this.logger.error('The bundled go2rtc could not start', err);
        await this.setStatus(false, T.status.bundledFailed(err.message));
        return;
      }
      if (generation !== this.generation) return;
      client = new Go2rtcClient({
        baseUrl: this.bundledInfo.url,
        username: this.bundledInfo.username,
        password: this.bundledInfo.password,
        request: this.request,
      });
      this.logger.info(
        `Bundled go2rtc ${this.bundledInfo.restarted ? 'started' : 'already running'} with ${config.bundled.streams.length} stream(s) from Gladys`,
      );
      await this.waitForApi(client, generation);
    }
    if (generation !== this.generation) {
      client.close();
      return;
    }
    this.client = client;
    await this.refreshServer({ publish: true });
    if (generation !== this.generation) return;
    this.schedule('server', INTERVALS.SERVER_MS, () => this.serverLoop(generation));
    this.schedule('refresh', 2_000, () => this.refreshLoop(generation));
  }

  /** A (re)started container takes a moment to listen. */
  async waitForApi(client, generation) {
    const end = this.now() + TIMEOUTS.BUNDLED_START;
    while (generation === this.generation && this.now() < end) {
      try {
        await client.info();
        return;
      } catch (err) {
        if (err.code === CODES.AUTH) return;
        await this.wait(1_000);
      }
    }
  }

  schedule(_name, delay, task) {
    const handle = this.timers.setTimeout(async () => {
      this.handles.delete(handle);
      try {
        await task();
      } catch (err) {
        this.logger.error('Loop failed', err);
      }
    }, delay);
    this.handles.add(handle);
    return handle;
  }

  // --- The server: alive, stream list, Discovery -----------------------------

  async serverLoop(generation) {
    if (generation !== this.generation) return;
    await this.refreshServer({ publish: false });
    if (generation === this.generation) {
      this.schedule('server', INTERVALS.SERVER_MS, () => this.serverLoop(generation));
    }
  }

  async refreshServer({ publish }) {
    const client = this.client;
    if (!client) {
      if (publish) await this.publishDiscovered();
      return;
    }
    try {
      const [info, streams] = await Promise.all([client.info(), client.streams()]);
      if (client !== this.client) return;
      const changed = !sameList(streams, this.server.streams);
      if (this.server.online !== true) {
        this.logger.info(`go2rtc ${info.version ?? ''} answers: ${streams.length} stream(s)`);
      }
      this.server = { online: true, version: info.version, streams };
      if (publish || changed) await this.publishDiscovered();
      await this.markRemovedStreams();
      await this.setStatus(true, this.okMessage());
    } catch (err) {
      if (client !== this.client) return;
      if (this.server.online !== false) this.logger.warn(`go2rtc does not answer: ${err.message}`);
      this.server = { ...this.server, online: false };
      if (publish) await this.publishDiscovered();
      await this.serverDown();
      await this.setStatus(false, this.errorMessage(err));
    }
  }

  /** Never throws: a refusal of Gladys is not a go2rtc failure. */
  async publishDiscovered() {
    const devices = this.server.streams.map((name) => buildCameraDevice(this.gladys, name));
    await this.gladys.publishDiscoveredDevices(devices).catch((err) => {
      this.logger.warn(`Discovery not published: ${err.message}`);
    });
  }

  /** Discovery (scan button): the stream list read again. */
  async publishDevices() {
    await this.refreshServer({ publish: true });
  }

  okMessage() {
    const count = this.server.streams.length;
    const parts = [T.status.ok({ version: this.server.version, count })];
    const bundled = this.config.mode === MODES.BUNDLED;
    if (count === 0) {
      parts.push(
        bundled
          ? T.status.noStream
          : {
              en: 'Add streams to your go2rtc, then open Discovery.',
              fr: 'Ajoutez des flux à votre go2rtc, puis ouvrez Découverte.',
            },
      );
    }
    if (bundled && this.bundledInfo?.ports.web) {
      parts.push(T.status.webPage(this.bundledInfo.ports.web));
      if (this.bundledInfo.generatedPassword) parts.push(T.status.setWebPassword);
    }
    if (bundled && this.config.bundled.invalidSlots.length > 0) {
      parts.push(T.status.invalidSlots(this.config.bundled.invalidSlots));
    }
    if (bundled && this.config.bundled.webrtcAddressError) parts.push(T.status.invalidWebrtc);
    return {
      en: parts.map((p) => p.en).join(' '),
      fr: parts.map((p) => p.fr).join(' '),
    };
  }

  errorMessage(err) {
    if (err.code === CODES.AUTH) return T.status.auth;
    if (err.code === CODES.BAD_ANSWER || err.code === CODES.HTTP) return T.status.notGo2rtc;
    if (this.config.mode === MODES.BUNDLED) return T.status.starting;
    return T.status.unreachable(err);
  }

  async setStatus(connected, message) {
    const key = JSON.stringify([connected, message]);
    if (key === this.lastStatus) return;
    this.lastStatus = key;
    await this.gladys.setConnectionStatus(connected, message).catch((err) => {
      this.lastStatus = null;
      this.logger.warn(`Connection status not sent: ${err.message}`);
    });
  }

  // --- Images ----------------------------------------------------------------

  /** onGetImage: a fresh image of the camera (150 KB). */
  async getImage(device) {
    const name = streamNameOf(this.gladys, device?.external_id);
    if (name === null) throw new Error(T.errors.unknownCamera);
    const client = this.client;
    if (!client) throw new Error(T.errors.notConnected);
    const camera = { externalId: device.external_id, name };
    try {
      const image = await this.images.capture(client, name, { maxLength: MAX_IMAGE_LENGTH });
      await this.markOnline(camera);
      return image;
    } catch (err) {
      await this.observeFailure(camera, err);
      throw new Error(T.errors.image(name, err), { cause: err });
    }
  }

  async refreshLoop(generation) {
    if (generation !== this.generation) return;
    const started = this.now();
    await this.refreshCameras(generation);
    if (generation !== this.generation) return;
    const period =
      this.config.refreshSeconds > 0 ? this.config.refreshSeconds * 1000 : INTERVALS.STATUS_ONLY_MS;
    const delay = Math.max(1_000, period - (this.now() - started));
    this.schedule('refresh', delay, () => this.refreshLoop(generation));
  }

  /** One image (or one status probe) per created camera, in turn. */
  async refreshCameras(generation) {
    for (const camera of createdStreams(this.gladys)) {
      if (generation !== this.generation || this.server.online !== true) return;
      const stop = await this.refreshCamera(camera);
      if (stop) return;
    }
  }

  /** Resolves true when go2rtc itself failed (the server loop takes over). */
  async refreshCamera(camera) {
    const client = this.client;
    if (!client) return true;
    if (!this.server.streams.includes(camera.name)) {
      await this.markOffline(camera, OFFLINE_REASONS.REMOVED);
      return false;
    }
    try {
      if (this.config.refreshSeconds > 0) {
        const image = await this.images.capture(client, camera.name, {
          maxLength: MAX_STORED_IMAGE_LENGTH,
        });
        await this.markOnline(camera);
        if (this.takePushSlot(camera.externalId)) {
          await this.gladys.publishCameraImage(camera.externalId, image).catch((err) => {
            // A camera not created yet on Gladys' side, or its rate limit.
            this.logger.debug(`Image of ${camera.name} not published: ${err.message}`);
          });
        }
      } else {
        await client.probe(camera.name);
        await this.markOnline(camera);
      }
    } catch (err) {
      if (SERVER_CODES.has(err.code)) return true;
      await this.observeFailure(camera, err);
    }
    return false;
  }

  /** At most 12 pushes a minute per camera (Gladys' limit). */
  takePushSlot(externalId) {
    const time = this.now();
    let window = this.pushWindows.get(externalId);
    if (!window || time >= window.resetAt) {
      window = { count: 0, resetAt: time + 60_000 };
      this.pushWindows.set(externalId, window);
    }
    if (window.count >= MAX_PUSHES_PER_MINUTE) return false;
    window.count += 1;
    return true;
  }

  // --- Online / offline ------------------------------------------------------

  cameraState(externalId) {
    let state = this.cameras.get(externalId);
    if (!state) {
      state = { online: null, failures: 0 };
      this.cameras.set(externalId, state);
    }
    return state;
  }

  async observeFailure(camera, err) {
    if (err.code === CODES.NOT_FOUND) {
      await this.markOffline(camera, OFFLINE_REASONS.REMOVED);
    } else if (STREAM_FAILURES.has(err.code)) {
      const state = this.cameraState(camera.externalId);
      state.failures += 1;
      if (state.failures >= OFFLINE_AFTER_FAILURES) {
        await this.markOffline(camera, OFFLINE_REASONS.SOURCE, err);
      }
    }
  }

  async markOnline(camera) {
    const state = this.cameraState(camera.externalId);
    state.failures = 0;
    if (state.online === true) return;
    const was = state.online;
    state.online = true;
    if (was === false) this.logger.info(`${camera.name} is back online`);
    await this.publishTransports([{ external_id: camera.externalId, transport: 'local' }]);
    if (was === false) {
      await this.sceneEvent(SCENE_TRIGGERS.ONLINE, {
        camera: camera.externalId,
        stream: camera.name,
      });
    }
  }

  async markOffline(camera, reason, err) {
    const state = this.cameraState(camera.externalId);
    if (state.online === false) return;
    const was = state.online;
    state.online = false;
    this.logger.warn(`${camera.name} is offline (${reason}${err ? `: ${reasonOf(err).en}` : ''})`);
    await this.publishTransports([{ external_id: camera.externalId, transport: 'unreachable' }]);
    if (was === true) {
      await this.sceneEvent(SCENE_TRIGGERS.OFFLINE, {
        camera: camera.externalId,
        stream: camera.name,
        reason,
      });
    }
  }

  /** go2rtc does not answer: every camera is unreachable. */
  async serverDown() {
    for (const camera of createdStreams(this.gladys)) {
      await this.markOffline(camera, OFFLINE_REASONS.SERVER);
    }
  }

  /** Created cameras whose stream left go2rtc. */
  async markRemovedStreams() {
    for (const camera of createdStreams(this.gladys)) {
      if (!this.server.streams.includes(camera.name)) {
        await this.markOffline(camera, OFFLINE_REASONS.REMOVED);
      }
    }
  }

  async publishTransports(entries) {
    await this.gladys.publishTransports(entries).catch((err) => {
      this.logger.debug(`Transports not published: ${err.message}`);
    });
  }

  async sceneEvent(key, data) {
    await this.gladys.publishSceneEvent(key, data).catch((err) => {
      this.logger.warn(`Scene event ${key} not sent: ${err.message}`);
    });
  }

  // --- Devices created / deleted in Gladys -----------------------------------

  async deviceCreated(device) {
    const name = streamNameOf(this.gladys, device?.external_id);
    if (name === null || this.server.online !== true) return;
    // The new camera gets its first image now, not at the next round.
    await this.refreshCamera({ externalId: device.external_id, name });
  }

  deviceDeleted(device) {
    this.cameras.delete(device?.external_id);
    this.pushWindows.delete(device?.external_id);
  }

  // --- Configuration buttons -------------------------------------------------

  async testConnection() {
    const client = this.client;
    if (!client) throw new Error(this.lastStatusText() ?? T.errors.notConnected);
    try {
      const [info, streams] = await Promise.all([client.info(), client.streams()]);
      const names =
        streams.slice(0, MAX_LISTED_NAMES).join(', ') +
        (streams.length > MAX_LISTED_NAMES ? '…' : '');
      return T.test.ok({ version: info.version, count: streams.length, names });
    } catch (err) {
      throw new Error(this.errorMessage(err).en, { cause: err });
    }
  }

  /** Each stream connected once by go2rtc: online (codecs) or why not. */
  async checkStreams() {
    const client = this.client;
    if (!client) throw new Error(this.lastStatusText() ?? T.errors.notConnected);
    let streams;
    try {
      streams = await client.streams();
    } catch (err) {
      throw new Error(this.errorMessage(err).en, { cause: err });
    }
    if (streams.length === 0) return T.check.none;
    const end = this.now() + CHECK_BUDGET_MS;
    const queue = [...streams];
    const results = new Map();
    // Two at a time, each started only while the button still waits.
    const worker = async () => {
      while (queue.length > 0) {
        const name = queue.shift();
        const remaining = end - this.now();
        if (remaining < 2_000) {
          results.set(name, T.check.skipped);
          continue;
        }
        try {
          const { codecs } = await client.probe(name, {
            timeout: Math.min(TIMEOUTS.PROBE, remaining),
          });
          results.set(name, T.check.online(codecs));
        } catch (err) {
          results.set(name, T.check.offline(err));
        }
      }
    };
    await Promise.all([worker(), worker()]);
    const lines = streams.map((name) => [name, results.get(name)]);
    return {
      en: lines.map(([name, text]) => `${name}: ${text.en}`).join(' · '),
      fr: lines.map(([name, text]) => `${name} : ${text.fr}`).join(' · '),
    };
  }

  lastStatusText() {
    if (!this.lastStatus) return null;
    const [, message] = JSON.parse(this.lastStatus);
    return message?.en ?? null;
  }
}
