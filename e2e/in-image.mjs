// -----------------------------------------------------------------------------
// End-to-end checks run INSIDE the integration image (read-only rootfs,
// 256 MB, 0.5 CPU, /data volume), against a REAL go2rtc started by
// e2e/run.sh with the flags of a Gladys sub-container. The SDK's fake Gladys
// stands in for Gladys. Phases (argv[2]):
//   prepare   BundledGo2rtc.ensure(): /data files written, start requested
//   run       the app on the bundled go2rtc: Discovery, images, badges,
//             offline / online events, buttons
//   external  the app on the same go2rtc as "my own server"
// Prints one line per check; exits 1 on the first failure.
// -----------------------------------------------------------------------------

import assert from 'node:assert/strict';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { Go2rtcApp } from '/app/src/app.js';
import { BundledGo2rtc } from '/app/src/bundled.js';
import { normalizeConfig } from '/app/src/config.js';
import {
  ACTIONS,
  IMAGE_PREFIX,
  MAX_IMAGE_LENGTH,
  MAX_STORED_IMAGE_LENGTH,
} from '/app/src/constants.js';
import { registerHandlers } from '/app/src/handlers.js';
import { jpegSize } from '/app/src/jpeg.js';

const WEB_PASSWORD = 'e2e-web-password';
const pattern = (size, rate, gop) =>
  `exec:ffmpeg -hide_banner -v error -re -f lavfi -i testsrc2=size=${size}:rate=${rate} ` +
  `-c:v libx264 -threads 1 -preset ultrafast -tune zerolatency -g ${gop} -pix_fmt yuv420p -f rtsp {output}`;
// The Gladys configuration: the streams typed in the form.
export const CONFIG = {
  mode: 'bundled',
  web_password: WEB_PASSWORD,
  refresh_interval: '5',
  stream_1_name: 'pattern',
  stream_1_source: pattern('1280x720', 10, 20),
  stream_2_name: 'Entrée : porte',
  stream_2_source: pattern('1920x1080', 10, 20),
  // A USB webcam in MJPEG: go2rtc hands its JPEG as it is.
  stream_3_name: 'usb_mjpeg',
  stream_3_source:
    'exec:ffmpeg -hide_banner -v error -re -f lavfi -i testsrc2=size=1920x1080:rate=5 -c:v mjpeg -q:v 2 -f mjpeg -',
  // A camera on the network (another go2rtc, e2e/run.sh), the test can break it.
  stream_4_name: 'garage',
  stream_4_source: 'rtsp://camera:8554/live',
  // A camera that never answers (documentation address).
  stream_5_name: 'dead',
  stream_5_source: 'rtsp://192.0.2.1:554/nothing',
};

const ok = (line) => console.log(`ok - ${line}`);
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(check, what, ms = 60_000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await check()) return;
    await wait(250);
  }
  throw new Error(`timed out: ${what}`);
}
const quiet = { debug() {}, info() {}, warn() {}, error: console.error };
const logger = {
  debug() {},
  info: (...a) => console.log('  [info]', ...a),
  warn: (...a) => console.log('  [warn]', ...a),
  error: (...a) => console.log('  [error]', ...a),
};
const port = (name, containerPort, hostPort) => ({
  container_port: containerPort,
  protocol: 'tcp',
  host_port: hostPort,
  label: { en: name },
  name,
  browsable: name === 'go2rtc_web',
});
const entry = (status) => ({
  name: 'go2rtc',
  status,
  desired: status,
  started_at: null,
  ports: [
    port('go2rtc_web', 1984, 41984),
    port('go2rtc_rtsp', 8554, 48554),
    port('go2rtc_webrtc', 8555, 48555),
  ],
  devices: [{ class: 'video', granted: false, available: false }],
});

async function prepare() {
  const gladys = createFakeGladys({
    selector: 'go2rtc',
    containers: [entry('stopped')],
    logger: quiet,
  });
  const started = [];
  gladys.startContainer = async (name) => started.push(name);
  await gladys.connect();
  const info = await new BundledGo2rtc({ gladys }).ensure(normalizeConfig(CONFIG).bundled);
  assert.deepEqual(started, ['go2rtc']);
  assert.equal(info.password, WEB_PASSWORD);
  ok('prepare: /data/containers/go2rtc/config written read-only rootfs aside, start requested');
}

/** The camera go2rtc of e2e/run.sh: break and repair its `live` stream. */
const camera = (method, query) =>
  fetch(`http://camera:1984/api/streams?${query}`, { method }).then((r) => r.status);

async function run() {
  const gladys = createFakeGladys({
    selector: 'go2rtc',
    config: CONFIG,
    containers: [entry('running')],
    logger: quiet,
  });
  gladys.startContainer = async () => {
    throw new Error('the unchanged go2rtc must not be restarted');
  };
  const app = new Go2rtcApp({ gladys, logger });
  registerHandlers(gladys, app, quiet);
  await gladys.connect();

  const names = gladys.fake.discoveredDevices.map((d) => d.name);
  assert.deepEqual(names, ['dead', 'Entrée : porte', 'garage', 'pattern', 'usb_mjpeg', 'user_cam']);
  ok(`Discovery: ${names.length} cameras, the 5 of Gladys + 1 added in the go2rtc web page`);
  const status = gladys.fake.connectionStatus;
  assert.equal(status.connected, true);
  ok(`status: ${status.message.en}`);

  for (const device of gladys.fake.discoveredDevices) {
    await gladys.fake.deviceCreated(device);
  }
  const byName = Object.fromEntries(gladys.fake.discoveredDevices.map((d) => [d.name, d]));

  for (const name of ['pattern', 'Entrée : porte', 'usb_mjpeg', 'garage', 'user_cam']) {
    const t0 = Date.now();
    const ack = await gladys.fake.getImage(byName[name]);
    assert.equal(ack.success, true, `${name}: ${ack.error}`);
    assert.ok(ack.data.image.startsWith(IMAGE_PREFIX));
    assert.ok(ack.data.image.length <= MAX_IMAGE_LENGTH);
    const size = jpegSize(Buffer.from(ack.data.image.slice(IMAGE_PREFIX.length), 'base64'));
    ok(
      `live image of ${name}: ${size.width}x${size.height}, ${Math.round(ack.data.image.length / 1024)} KB, ${Date.now() - t0} ms`,
    );
  }
  const t0 = Date.now();
  const dead = await gladys.fake.getImage(byName.dead);
  assert.equal(dead.success, false);
  ok(`dead camera: "${dead.error}" after ${Date.now() - t0} ms`);

  const transport = (name) =>
    gladys.fake.transports.filter((t) => t.device_external_id === byName[name].external_id).at(-1)
      ?.transport;
  await until(() => transport('dead') === 'unreachable', 'dead camera unreachable', 90_000);
  await until(
    () => imagesOf('usb_mjpeg').length > 0 && imagesOf('pattern').length > 0,
    'pushed images',
  );
  function imagesOf(name) {
    return gladys.fake.cameraImages.filter(
      (i) => i.device_external_id === byName[name].external_id,
    );
  }
  for (const name of ['pattern', 'Entrée : porte', 'usb_mjpeg', 'garage', 'user_cam']) {
    assert.equal(transport(name), 'local', name);
    const [image] = imagesOf(name);
    assert.ok(image.image.length <= MAX_STORED_IMAGE_LENGTH, name);
  }
  ok('refresh round: images pushed under 60 KB, badges local, dead camera unreachable');
  assert.equal(gladys.fake.sceneEvents.length, 0, 'the first readings only arm');
  ok('no scene event for a camera offline from the start');

  assert.equal(await camera('DELETE', 'src=live'), 200);
  const offline = () =>
    gladys.fake.sceneEvents.find((e) => e.key === 'stream_offline' && e.data.stream === 'garage');
  await until(offline, 'garage offline event', 90_000);
  assert.deepEqual(offline().data, {
    camera: byName.garage.external_id,
    stream: 'garage',
    reason: 'source',
  });
  assert.equal(transport('garage'), 'unreachable');
  ok('the garage camera broken: badge unreachable, stream_offline (reason source)');
  await camera('PUT', 'name=live&src=rtsp://127.0.0.1:8554/pattern_src');
  const online = () =>
    gladys.fake.sceneEvents.find((e) => e.key === 'stream_online' && e.data.stream === 'garage');
  await until(online, 'garage online event', 60_000);
  assert.equal(transport('garage'), 'local');
  ok('the garage camera repaired: badge local, stream_online');

  const test = await gladys.fake.action(ACTIONS.TEST, {});
  assert.equal(test.success, true);
  ok(`button test: ${test.data.message.en}`);
  const check = await gladys.fake.action(ACTIONS.CHECK_STREAMS, {});
  assert.equal(check.success, true);
  assert.match(check.data.message.en, /usb_mjpeg: online \(JPEG\)/);
  assert.match(check.data.message.en, /pattern: online \(H264\)/);
  assert.match(check.data.message.en, /dead: offline/);
  ok(`button check: ${check.data.message.en}`);

  console.log(`rss MB: ${Math.round(process.memoryUsage().rss / 1048576)}`);
  await app.stop();
  await gladys.disconnect();
  ok('stopped cleanly');
}

async function external() {
  const config = {
    mode: 'external',
    url: 'http://go2rtc:1984',
    username: 'admin',
    password: WEB_PASSWORD,
  };
  const gladys = createFakeGladys({ selector: 'go2rtc', config, logger: quiet });
  const app = new Go2rtcApp({ gladys, logger: quiet });
  registerHandlers(gladys, app, quiet);
  await gladys.connect();
  assert.equal(gladys.fake.connectionStatus.connected, true);
  assert.equal(gladys.fake.discoveredDevices.length, 6);
  const ack = await gladys.fake.getImage(gladys.fake.discoveredDevices[3]);
  assert.equal(ack.success, true);
  ok(`external mode, basic auth over the network: ${gladys.fake.connectionStatus.message.en}`);
  await gladys.fake.configUpdated({ ...config, password: 'wrong' });
  assert.equal(gladys.fake.connectionStatus.connected, false);
  ok(`external mode, wrong password: ${gladys.fake.connectionStatus.message.en}`);
  await gladys.fake.configUpdated({ ...config, url: 'http://camera:8554' });
  ok(`external mode, an RTSP port typed: ${gladys.fake.connectionStatus.message.en}`);
  await app.stop();
  await gladys.disconnect();
}

const phases = { prepare, run, external };
await phases[process.argv[2]]();
