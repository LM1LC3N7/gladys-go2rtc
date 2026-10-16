// -----------------------------------------------------------------------------
// The integration against the SDK's fake Gladys and the fake go2rtc, through
// the exact wiring of the container (src/handlers.js).
// -----------------------------------------------------------------------------

import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { Go2rtcApp } from '../src/app.js';
import {
  ACTIONS,
  IMAGE_PREFIX,
  MAX_IMAGE_LENGTH,
  MAX_STORED_IMAGE_LENGTH,
  SCENE_TRIGGERS,
} from '../src/constants.js';
import { buildCameraDevice } from '../src/devices.js';
import { registerHandlers } from '../src/handlers.js';
import { createFakeGo2rtc, realJpeg } from './helpers/fakeGo2rtc.js';
import { createFakeTimers } from './helpers/fakeTimers.js';

const T0 = Date.parse('2026-10-16T08:00:00Z');
const SELECTOR = 'go2rtc';
const idOf = (name) => `ext:${SELECTOR}:stream:${encodeURIComponent(name)}`;
const cameraOf = (name) => buildCameraDevice(createFakeGladys({ selector: SELECTOR }), name);

const streams = () => ({
  garden: { kind: 'h264', width: 1920, height: 1080, online: true, bytesPerWidth: 50 },
  'Entrée : porte': { kind: 'h264', width: 1280, height: 720, online: true, bytesPerWidth: 40 },
  usb: {
    kind: 'mjpeg',
    width: 640,
    height: 360,
    online: true,
    jpeg: realJpeg(640, 360, { quality: 70, noise: 10 }),
  },
});

function fakeBundled() {
  return {
    calls: { ensure: [], stop: 0 },
    fail: null,
    ports: { web: 41984, rtsp: 48554, webrtc: 48555 },
    async ensure(bundled) {
      this.calls.ensure.push(bundled);
      if (this.fail) throw new Error(this.fail);
      return {
        url: 'http://go2rtc:1984',
        username: 'admin',
        password: bundled.webPassword || 'generated-pw',
        generatedPassword: !bundled.webPassword,
        restarted: true,
        ports: this.ports,
      };
    },
    async stop() {
      this.calls.stop += 1;
      return true;
    },
  };
}

let running;
afterEach(async () => {
  await running?.stop();
  running = undefined;
});

async function setup({
  config = {},
  created = ['garden', 'usb'],
  server = createFakeGo2rtc({
    streams: streams(),
    auth: { username: 'admin', password: config.web_password || 'generated-pw' },
  }),
} = {}) {
  const gladys = createFakeGladys({
    selector: SELECTOR,
    config,
    devices: created.map(cameraOf),
  });
  const timers = createFakeTimers();
  const clock = { now: T0 };
  const logs = [];
  const logger = Object.fromEntries(
    ['debug', 'info', 'warn', 'error'].map((level) => [
      level,
      (...args) => logs.push(`${level} ${args.join(' ')}`),
    ]),
  );
  const bundled = fakeBundled();
  const app = new Go2rtcApp({
    gladys,
    logger,
    request: server.request,
    bundled,
    now: () => clock.now,
    timers,
    wait: async (ms) => {
      clock.now += ms;
    },
  });
  running = app;
  registerHandlers(gladys, app, logger);
  await gladys.connect();
  const later = (ms) => {
    clock.now += ms;
  };
  return { gladys, server, timers, clock, logs, bundled, app, later };
}

const events = (gladys, key) => gladys.fake.sceneEvents.filter((e) => e.key === key);
const transportsOf = (gladys, name) =>
  gladys.fake.transports.filter((t) => t.device_external_id === idOf(name)).map((t) => t.transport);
const imagesOf = (gladys, name) =>
  gladys.fake.cameraImages.filter((i) => i.device_external_id === idOf(name));

test('bundled: Discovery gets one camera per stream, the status the web page', async () => {
  const { gladys, bundled, timers } = await setup({
    config: { stream_1_name: 'garden', stream_1_source: 'rtsp://u:p@192.168.1.20/s1' },
  });
  assert.equal(bundled.calls.ensure.length, 1);
  assert.deepEqual(bundled.calls.ensure[0].streams, [
    { slot: 1, name: 'garden', source: 'rtsp://u:p@192.168.1.20/s1' },
  ]);
  const devices = gladys.fake.discoveredDevices;
  assert.deepEqual(
    devices.map((d) => [d.name, d.external_id]),
    [
      ['Entrée : porte', idOf('Entrée : porte')],
      ['garden', idOf('garden')],
      ['usb', idOf('usb')],
    ],
  );
  assert.deepEqual(
    devices[0].features.map((f) => [f.external_id, f.category, f.type, f.read_only]),
    [[`${idOf('Entrée : porte')}:image`, 'camera', 'image', true]],
  );
  const status = gladys.fake.connectionStatus;
  assert.equal(status.connected, true);
  assert.match(status.message.en, /^go2rtc 1\.9\.14 answers: 3 streams\./);
  assert.match(status.message.en, /port 41984 of this Gladys machine, user admin/);
  assert.match(status.message.en, /Set a web password/);
  assert.match(status.message.fr, /répond : 3 flux/);
  assert.deepEqual(timers.delays().sort(), [2_000, 60_000]);
});

test('onGetImage: a fresh image under 150 KB, the camera marked online', async () => {
  const { gladys, server, later } = await setup();
  const ack = await gladys.fake.getImage(cameraOf('garden'));
  assert.equal(ack.success, true);
  assert.ok(ack.data.image.startsWith(IMAGE_PREFIX));
  assert.ok(ack.data.image.length <= MAX_IMAGE_LENGTH);
  assert.equal(server.frames('garden').length, 1, '1280 px fits at once');
  assert.deepEqual(transportsOf(gladys, 'garden'), ['local']);
  const unknown = await gladys.fake.getImage({ external_id: 'ext:other:cam:1' });
  assert.equal(unknown.success, false);
  assert.match(unknown.error, /Unknown camera/);
  server.streams.garden.online = false;
  later(5_000); // past the 2 s reuse of the last image
  const failed = await gladys.fake.getImage(cameraOf('garden'));
  assert.equal(failed.success, false);
  assert.match(failed.error, /No image of "garden": the camera sent no image/);
});

test('the image round: one image per created camera, under 60 KB, then every minute', async () => {
  const ctx = await setup();
  const { gladys, timers } = ctx;
  await timers.run((ms) => ms === 2_000);
  for (const name of ['garden', 'usb']) {
    const [image] = imagesOf(gladys, name);
    assert.ok(image.image.length <= MAX_STORED_IMAGE_LENGTH, name);
    assert.deepEqual(transportsOf(gladys, name), ['local']);
  }
  assert.equal(imagesOf(gladys, 'Entrée : porte').length, 0, 'not created: no image');
  assert.deepEqual(timers.delays(), [60_000, 60_000]);
});

test('offline after two failed reads, back online after one: badges and scene events', async () => {
  const ctx = await setup({ created: ['garden'] });
  const { gladys, server, timers } = ctx;
  const round = async () => {
    ctx.later(60_000);
    await timers.run();
  };
  await round(); // online
  server.streams.garden.online = false;
  await round();
  assert.deepEqual(transportsOf(gladys, 'garden'), ['local'], 'one failure is not offline');
  await round();
  assert.deepEqual(transportsOf(gladys, 'garden'), ['local', 'unreachable']);
  assert.deepEqual(events(gladys, SCENE_TRIGGERS.OFFLINE), [
    {
      key: 'stream_offline',
      data: { camera: idOf('garden'), stream: 'garden', reason: 'source' },
    },
  ]);
  await round();
  assert.equal(events(gladys, SCENE_TRIGGERS.OFFLINE).length, 1, 'one event per transition');
  server.streams.garden.online = true;
  await round();
  assert.deepEqual(transportsOf(gladys, 'garden'), ['local', 'unreachable', 'local']);
  assert.deepEqual(events(gladys, SCENE_TRIGGERS.ONLINE), [
    { key: 'stream_online', data: { camera: idOf('garden'), stream: 'garden' } },
  ]);
});

test('the first reading only arms: a camera offline from the start fires nothing', async () => {
  const server = createFakeGo2rtc({
    streams: { garden: { kind: 'h264', width: 1280, height: 720, online: false } },
    auth: { username: 'admin', password: 'generated-pw' },
  });
  const ctx = await setup({ created: ['garden'], server });
  for (let i = 0; i < 3; i += 1) {
    ctx.later(60_000);
    await ctx.timers.run();
  }
  assert.deepEqual(transportsOf(ctx.gladys, 'garden'), ['unreachable']);
  assert.equal(ctx.gladys.fake.sceneEvents.length, 0);
});

test('go2rtc down: every camera unreachable, reason server; back: status and images again', async () => {
  const ctx = await setup({
    config: { mode: 'external', url: '192.168.1.10' },
    server: createFakeGo2rtc({ streams: streams() }),
  });
  const { gladys, server, timers } = ctx;
  await timers.run((ms) => ms === 2_000); // garden and usb online
  server.down = true;
  ctx.later(60_000);
  await timers.run();
  const status = gladys.fake.connectionStatus;
  assert.equal(status.connected, false);
  assert.match(status.message.en, /^go2rtc does not answer: no connection/);
  assert.deepEqual(transportsOf(gladys, 'garden'), ['local', 'unreachable']);
  assert.deepEqual(
    events(gladys, SCENE_TRIGGERS.OFFLINE).map((e) => [e.data.stream, e.data.reason]),
    [
      ['garden', 'server'],
      ['usb', 'server'],
    ],
  );
  server.down = false;
  ctx.later(60_000);
  await timers.run();
  assert.equal(gladys.fake.connectionStatus.connected, true);
  ctx.later(60_000);
  await timers.run();
  assert.deepEqual(
    events(gladys, SCENE_TRIGGERS.ONLINE).map((e) => e.data.stream),
    ['garden', 'usb'],
  );
});

test('a stream removed from go2rtc: Discovery follows, the camera goes offline', async () => {
  const ctx = await setup({ created: ['garden'] });
  const { gladys, server, timers } = ctx;
  await timers.run((ms) => ms === 2_000);
  delete server.streams.garden;
  ctx.later(60_000);
  await timers.run((ms) => ms === 60_000);
  assert.deepEqual(
    gladys.fake.discoveredDevices.map((d) => d.name),
    ['Entrée : porte', 'usb'],
  );
  assert.deepEqual(events(gladys, SCENE_TRIGGERS.OFFLINE)[0].data, {
    camera: idOf('garden'),
    stream: 'garden',
    reason: 'removed',
  });
  assert.deepEqual(transportsOf(gladys, 'garden'), ['local', 'unreachable']);
});

test('a new stream in go2rtc shows up in Discovery at the next server round', async () => {
  const ctx = await setup();
  ctx.server.streams.porch = { kind: 'h264', width: 1280, height: 720, online: true };
  const before = ctx.gladys.fake.requests.filter((r) => r.path === '/discovered_device').length;
  ctx.later(60_000);
  await ctx.timers.run((ms) => ms === 60_000);
  assert.ok(ctx.gladys.fake.discoveredDevices.some((d) => d.name === 'porch'));
  ctx.later(60_000);
  await ctx.timers.run((ms) => ms === 60_000);
  const after = ctx.gladys.fake.requests.filter((r) => r.path === '/discovered_device').length;
  assert.equal(after, before + 1, 'published only when the list changes');
  await ctx.gladys.fake.scanRequest();
  assert.equal(
    ctx.gladys.fake.requests.filter((r) => r.path === '/discovered_device').length,
    after + 1,
    'and on every scan',
  );
});

test('external mode: the bundled go2rtc stopped, the address and credentials used', async () => {
  const server = createFakeGo2rtc({
    streams: streams(),
    auth: { username: 'frigate', password: 'pw' },
  });
  const { gladys, bundled, app } = await setup({
    config: { mode: 'external', url: '192.168.1.10', username: 'frigate', password: 'pw' },
    server,
  });
  assert.equal(bundled.calls.stop, 1);
  assert.equal(bundled.calls.ensure.length, 0);
  assert.equal(app.client.baseUrl, 'http://192.168.1.10:1984');
  const status = gladys.fake.connectionStatus;
  assert.equal(status.connected, true);
  assert.doesNotMatch(status.message.en, /web page/);
});

test('external mode: the address and the credentials explained', async () => {
  let ctx = await setup({ config: { mode: 'external' } });
  assert.deepEqual(ctx.gladys.fake.connectionStatus.connected, false);
  assert.match(ctx.gladys.fake.connectionStatus.message.en, /Type the address of your go2rtc/);
  assert.deepEqual(ctx.timers.delays(), [], 'nothing to poll');
  await ctx.gladys.fake.configUpdated({ mode: 'external', url: 'http://a:b@10.0.0.1:1984' });
  assert.match(ctx.gladys.fake.connectionStatus.message.en, /Remove the user name and password/);
  await ctx.gladys.fake.configUpdated({ mode: 'external', url: 'ftp://10.0.0.1' });
  assert.match(ctx.gladys.fake.connectionStatus.message.en, /is not valid/);
  ctx = await setup({
    config: { mode: 'external', url: '10.0.0.1', username: 'admin', password: 'wrong' },
    server: createFakeGo2rtc({ streams: {}, auth: { username: 'admin', password: 'right' } }),
  });
  assert.match(ctx.gladys.fake.connectionStatus.message.en, /refused the user name or password/);
  const ack = await ctx.gladys.fake.action(ACTIONS.TEST, {});
  assert.equal(ack.success, false);
  assert.match(ack.error, /refused the user name or password/);
});

test('bundled: the container cannot start, or does not answer yet', async () => {
  const server = createFakeGo2rtc({ streams: streams() });
  server.down = true;
  const ctx = await setup({ server });
  assert.equal(ctx.gladys.fake.connectionStatus.connected, false);
  assert.match(ctx.gladys.fake.connectionStatus.message.en, /does not answer yet/);
  assert.ok(ctx.clock.now - T0 >= 30_000, 'waited for the container to listen');
  ctx.bundled.fail = 'image pull failed';
  await ctx.gladys.fake.configUpdated({ web_password: 'x' });
  assert.match(
    ctx.gladys.fake.connectionStatus.message.en,
    /The go2rtc container could not start \(image pull failed\)/,
  );
});

test('a container slow to listen is waited for', async () => {
  const server = createFakeGo2rtc({
    streams: streams(),
    auth: { username: 'admin', password: 'generated-pw' },
  });
  let refused = 3;
  const request = server.request;
  server.request = async (url, options) => {
    if (refused > 0 && url.endsWith('/api')) {
      refused -= 1;
      throw Object.assign(new Error('ECONNREFUSED'), { code: 'unreachable' });
    }
    return request(url, options);
  };
  const ctx = await setup({ server });
  assert.equal(ctx.gladys.fake.connectionStatus.connected, true);
  assert.equal(ctx.clock.now - T0, 3_000);
});

test('the status lists what the configuration got wrong', async () => {
  const { gladys } = await setup({
    config: {
      web_password: 'pw',
      stream_1_name: 'a',
      stream_1_source: 'rtsp://x/1',
      stream_2_name: 'a',
      stream_2_source: 'rtsp://x/2',
      webrtc_address: 'http://x',
    },
  });
  const { message } = gladys.fake.connectionStatus;
  assert.match(message.en, /Ignored stream slot\(s\) 2/);
  assert.match(message.en, /WebRTC address is not a host name/);
  assert.doesNotMatch(message.en, /Set a web password/);
});

test('no stream yet: the status says where to add them', async () => {
  const server = createFakeGo2rtc({
    streams: {},
    auth: { username: 'admin', password: 'generated-pw' },
  });
  const { gladys } = await setup({ server, created: [] });
  assert.match(gladys.fake.connectionStatus.message.en, /answers: 0 streams\. Add streams/);
  assert.deepEqual(gladys.fake.discoveredDevices, []);
});

test("refresh '0': no image pushed, a status probe every 5 minutes", async () => {
  const ctx = await setup({ config: { refresh_interval: '0' }, created: ['garden'] });
  await ctx.timers.run((ms) => ms === 2_000);
  assert.equal(ctx.gladys.fake.cameraImages.length, 0);
  assert.ok(ctx.server.paths().includes('/api/streams?src=garden&video'));
  assert.deepEqual(transportsOf(ctx.gladys, 'garden'), ['local']);
  assert.ok(ctx.timers.delays().includes(300_000));
});

test('never more than 12 images a minute per camera', async () => {
  const ctx = await setup({ config: { refresh_interval: '5' }, created: ['garden'] });
  for (let i = 0; i < 15; i += 1) {
    ctx.later(3_000);
    await ctx.timers.run((ms) => ms !== 60_000);
  }
  assert.equal(imagesOf(ctx.gladys, 'garden').length, 12);
  assert.ok(ctx.timers.delays().includes(5_000));
});

test('a camera created in Gladys gets its first image at once; a deleted one is forgotten', async () => {
  const ctx = await setup({ created: [] });
  await ctx.gladys.fake.deviceCreated(cameraOf('Entrée : porte'));
  assert.equal(imagesOf(ctx.gladys, 'Entrée : porte').length, 1);
  assert.deepEqual(transportsOf(ctx.gladys, 'Entrée : porte'), ['local']);
  await ctx.gladys.fake.deviceDeleted(cameraOf('Entrée : porte'));
  assert.equal(ctx.app.cameras.size, 0);
  await ctx.gladys.fake.deviceCreated({ external_id: 'ext:go2rtc:other:1', features: [] });
});

test('the buttons: test the connection, check every stream', async () => {
  const server = createFakeGo2rtc({
    streams: { ...streams(), dead: { kind: 'h264', width: 1280, height: 720, online: false } },
    auth: { username: 'admin', password: 'generated-pw' },
  });
  const { gladys } = await setup({ server });
  const test1 = await gladys.fake.action(ACTIONS.TEST, {});
  assert.equal(test1.success, true);
  assert.equal(
    test1.data.message.en,
    'go2rtc 1.9.14 answers, 4 streams: dead, Entrée : porte, garden, usb.',
  );
  const check = await gladys.fake.action(ACTIONS.CHECK_STREAMS, {});
  assert.equal(check.success, true);
  assert.equal(
    check.data.message.en,
    'dead: offline, the camera failed (streams: dial tcp 192.0.2.10:554: i/o timeout) · ' +
      'Entrée : porte: online (H264) · garden: online (H264) · usb: online (JPEG)',
  );
  assert.match(check.data.message.fr, /usb : en ligne \(JPEG\)/);
  server.streams = {};
  const none = await gladys.fake.action(ACTIONS.CHECK_STREAMS, {});
  assert.equal(none.data.message.en, 'go2rtc has no stream yet.');
});

test('the buttons without a server say why', async () => {
  const { gladys } = await setup({ config: { mode: 'external' } });
  for (const key of [ACTIONS.TEST, ACTIONS.CHECK_STREAMS]) {
    const ack = await gladys.fake.action(key, {});
    assert.equal(ack.success, false);
    assert.match(ack.error, /Type the address of your go2rtc/);
  }
});

test('configuration updated, hardware granted: restarted; disconnected: stopped', async () => {
  const ctx = await setup();
  await ctx.gladys.fake.configUpdated({
    web_password: 'generated-pw',
    stream_1_source: 'rtsp://a/1',
  });
  assert.equal(ctx.bundled.calls.ensure.length, 2);
  assert.deepEqual(ctx.timers.delays().sort(), [2_000, 60_000], 'the old loops cleared');
  await ctx.gladys.fake.hardwareUpdated([{ name: 'go2rtc', devices: [] }]);
  assert.equal(ctx.bundled.calls.ensure.length, 3);
  await ctx.gladys.disconnect();
  assert.deepEqual(ctx.timers.delays(), []);
  assert.equal(ctx.app.client, null);
});

test('no source URL nor password in the logs', async () => {
  const ctx = await setup({
    config: { stream_1_name: 'garden', stream_1_source: 'rtsp://user:hunter2@192.168.1.20/s1' },
  });
  ctx.server.streams.garden.online = false;
  for (let i = 0; i < 3; i += 1) {
    ctx.later(60_000);
    await ctx.timers.run();
  }
  ctx.server.down = true;
  ctx.later(60_000);
  await ctx.timers.run();
  const text = ctx.logs.join('\n');
  assert.match(text, /garden is offline/);
  assert.doesNotMatch(text, /hunter2|secret|generated-pw/);
});
