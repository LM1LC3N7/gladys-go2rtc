// -----------------------------------------------------------------------------
// The bundled go2rtc: gladys.yaml, the files under /data (a temp dir here),
// the sub-container started through the SDK fake Gladys.
// -----------------------------------------------------------------------------

import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { BundledGo2rtc, USER_FILE_HEADER, buildGladysYaml, hostPort } from '../src/bundled.js';
import { CONTAINER } from '../src/constants.js';
import { normalizeConfig } from '../src/config.js';

const dirs = [];
afterEach(async () => {
  while (dirs.length) await rm(dirs.pop(), { recursive: true, force: true });
});

const port = (name, containerPort, host = null) => ({
  container_port: containerPort,
  protocol: 'tcp',
  host_port: host,
  label: { en: name },
  name,
  browsable: name === 'go2rtc_web',
});
const container = ({
  status = 'stopped',
  desired = 'stopped',
  hostPorts = [null, null, null],
} = {}) => ({
  name: 'go2rtc',
  status,
  desired,
  started_at: null,
  ports: [
    port('go2rtc_web', 1984, hostPorts[0]),
    port('go2rtc_rtsp', 8554, hostPorts[1]),
    port('go2rtc_webrtc', 8555, hostPorts[2]),
  ],
  devices: [{ class: 'video', granted: false, available: false }],
});

/** A fake Gladys whose supervisor assigns the host ports and runs the container on start. */
async function setup({ containers = [container()] } = {}) {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'go2rtc-'));
  dirs.push(dataDir);
  const gladys = createFakeGladys({ selector: 'go2rtc', containers });
  await gladys.connect();
  const starts = [];
  const stops = [];
  gladys.startContainer = async (name) => {
    starts.push(name);
    gladys.fake.containers = [
      container({ status: 'running', desired: 'running', hostPorts: [41984, 48554, 48555] }),
    ];
  };
  gladys.stopContainer = async (name) => {
    stops.push(name);
    gladys.fake.containers = [container({ status: 'stopped', hostPorts: [41984, 48554, 48555] })];
  };
  let n = 0;
  const bundled = new BundledGo2rtc({
    gladys,
    dataDir,
    randomPassword: () => `generated-password-${(n += 1)}`,
  });
  const configDir = path.join(dataDir, 'containers/go2rtc/config');
  const read = (file) => readFile(path.join(configDir, file), 'utf8');
  return { gladys, bundled, dataDir, configDir, read, starts, stops };
}

const bundledConfig = (raw) => normalizeConfig(raw).bundled;

test('gladys.yaml: auth on the API and RTSP, TCP WebRTC, text logs, quoted streams', () => {
  const yaml = buildGladysYaml({
    password: 'p"w\\',
    streams: [
      { name: 'Entrée : porte', source: 'rtsp://u:p@192.168.1.20/s1#backchannel=0' },
      { name: 'usb', source: 'ffmpeg:device?video=0#video=h264' },
    ],
    webrtcCandidate: '192.168.1.10:48555',
  });
  assert.equal(
    yaml,
    [
      '# Written by the Gladys go2rtc integration at every start: do not edit.',
      '# Streams: Gladys > Integrations > go2rtc > Configuration. Your own',
      '# settings go in go2rtc.yaml, next to this file.',
      'api:',
      '  listen: ":1984"',
      '  username: "admin"',
      '  password: "p\\"w\\\\"',
      'rtsp:',
      '  listen: ":8554"',
      '  username: "admin"',
      '  password: "p\\"w\\\\"',
      'webrtc:',
      '  listen: ":8555/tcp"',
      '  candidates:',
      '    - "192.168.1.10:48555"',
      'log:',
      '  format: "text"',
      'streams:',
      '  "Entrée : porte": "rtsp://u:p@192.168.1.20/s1#backchannel=0"',
      '  "usb": "ffmpeg:device?video=0#video=h264"',
      '',
    ].join('\n'),
  );
  // No stream: no `streams:` key (the user's go2rtc.yaml keeps its own).
  assert.ok(!buildGladysYaml({ password: 'x', streams: [] }).includes('streams:'));
  assert.ok(!buildGladysYaml({ password: 'x', streams: [] }).includes('candidates'));
});

test('first start: folder and files for a capability-less go2rtc, then the container', async () => {
  const { bundled, configDir, read, starts, dataDir } = await setup();
  const info = await bundled.ensure(
    bundledConfig({ stream_1_name: 'garden', stream_1_source: 'rtsp://192.168.1.20/s1' }),
  );
  assert.deepEqual(starts, ['go2rtc']);
  assert.equal(info.url, 'http://go2rtc:1984');
  assert.equal(info.username, 'admin');
  assert.equal(info.password, 'generated-password-1');
  assert.equal(info.generatedPassword, true);
  assert.equal(info.restarted, true);
  assert.deepEqual(info.ports, { web: 41984, rtsp: 48554, webrtc: 48555 });
  assert.equal((await stat(configDir)).mode & 0o777, 0o777);
  assert.equal((await stat(path.join(configDir, 'go2rtc.yaml'))).mode & 0o777, 0o666);
  assert.equal((await stat(path.join(configDir, 'gladys.yaml'))).mode & 0o777, 0o644);
  assert.equal(await read('go2rtc.yaml'), USER_FILE_HEADER);
  assert.match(await read('gladys.yaml'), /"garden": "rtsp:\/\/192\.168\.1\.20\/s1"/);
  assert.match(await read('gladys.yaml'), /password: "generated-password-1"/);
  // The generated password is kept for the next starts.
  const state = JSON.parse(await readFile(path.join(dataDir, 'go2rtc-integration.json'), 'utf8'));
  assert.equal(state.generatedPassword, 'generated-password-1');
  assert.equal((await bundled.password('')).password, 'generated-password-1');
});

test('a running go2rtc with the same file is left alone; a change restarts it', async () => {
  const { bundled, read, starts } = await setup();
  const config = bundledConfig({ web_password: 'web-pw', stream_1_source: 'rtsp://a/1' });
  await bundled.ensure(config);
  const again = await bundled.ensure(config);
  assert.equal(again.restarted, false);
  assert.equal(again.password, 'web-pw');
  assert.equal(again.generatedPassword, false);
  assert.deepEqual(starts, ['go2rtc']);
  await bundled.ensure(bundledConfig({ web_password: 'web-pw', stream_1_source: 'rtsp://a/2' }));
  assert.deepEqual(starts, ['go2rtc', 'go2rtc']);
  assert.match(await read('gladys.yaml'), /"camera_1": "rtsp:\/\/a\/2"/);
});

test('a stopped container with an unchanged file is started', async () => {
  const { gladys, bundled, starts } = await setup();
  const config = bundledConfig({ web_password: 'x' });
  await bundled.ensure(config);
  gladys.fake.containers = [container({ status: 'stopped', desired: 'running' })];
  const info = await bundled.ensure(config);
  assert.equal(info.restarted, true);
  assert.equal(starts.length, 2);
});

test("the user's go2rtc.yaml is never rewritten", async () => {
  const { bundled, configDir, read } = await setup();
  await bundled.ensure(bundledConfig({}));
  const mine = 'streams:\n  hk: homekit://192.168.1.30:51826?device_id=x\n';
  await writeFile(path.join(configDir, 'go2rtc.yaml'), mine);
  await bundled.ensure(bundledConfig({ stream_1_source: 'rtsp://a/1' }));
  assert.equal(await read('go2rtc.yaml'), mine);
});

test('WebRTC: the candidate needs the host port, known after the first start', async () => {
  const { bundled, read, starts } = await setup();
  const info = await bundled.ensure(bundledConfig({ webrtc_address: '192.168.1.10' }));
  assert.deepEqual(starts, ['go2rtc', 'go2rtc'], 'one more restart with the candidate');
  assert.match(await read('gladys.yaml'), /- "192\.168\.1\.10:48555"/);
  assert.equal(info.ports.webrtc, 48555);
  await bundled.ensure(bundledConfig({ webrtc_address: '192.168.1.10' }));
  assert.equal(starts.length, 2, 'then stable');
});

test('stop() only when it runs or is wanted; no container declared is an error', async () => {
  const { gladys, bundled, stops } = await setup();
  assert.equal(await bundled.stop(), false);
  gladys.fake.containers = [container({ status: 'stopped', desired: 'running' })];
  assert.equal(await bundled.stop(), true);
  assert.deepEqual(stops, ['go2rtc']);
  gladys.fake.containers = [];
  await assert.rejects(bundled.ensure(bundledConfig({})), /no go2rtc sub-container/);
});

test('hostPort reads the assigned ports by name', () => {
  const entry = container({ hostPorts: [1, 2, null] });
  assert.equal(hostPort(entry, CONTAINER.PORTS.WEB.name), 1);
  assert.equal(hostPort(entry, CONTAINER.PORTS.WEBRTC.name), null);
  assert.equal(hostPort(undefined, 'x'), null);
});
