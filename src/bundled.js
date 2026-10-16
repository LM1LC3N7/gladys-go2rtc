// -----------------------------------------------------------------------------
// The go2rtc that Gladys runs: the `go2rtc` sub-container of the manifest
// (official image alexxit/go2rtc, `start: manual`).
//
// Gladys mounts its /config volume from <integration data>/containers/go2rtc/
// config, which this container sees under /data. The sub-container command
// reads two files there, the second one last (it wins on the keys it sets):
//   go2rtc.yaml  the user's: the go2rtc web page edits it and saves the
//                streams and HomeKit pairings made there. Never rewritten.
//   gladys.yaml  written here at every start: the streams typed in Gladys,
//                and the api / rtsp / webrtc / log settings Gladys relies on.
//
// The API is always behind a password (Gladys publishes the ports on the
// LAN, and go2rtc's API can run commands through exec sources): the web
// password of the configuration, else a random one kept in /data.
//
// go2rtc runs as root WITHOUT capabilities (Gladys drops them all), so it
// cannot write in a folder owned by uid 1000: the config folder is opened to
// everyone (0777) and its user file is 0666.
// -----------------------------------------------------------------------------

import { randomBytes } from 'node:crypto';
import * as nodeFs from 'node:fs/promises';
import path from 'node:path';
import { CONTAINER } from './constants.js';

const STATE_FILE = 'go2rtc-integration.json';

export const USER_FILE_HEADER = `# Your own go2rtc settings. Gladys never rewrites this file: the go2rtc web
# page edits it (Config) and saves the streams and HomeKit pairings made there.
# Gladys writes gladys.yaml next to it, read after this file: the streams of
# the Gladys configuration and the api, rtsp, webrtc and log settings.
`;

const q = (value) => JSON.stringify(String(value)); // a JSON string is a YAML double-quoted scalar

/**
 * gladys.yaml for the bundled go2rtc.
 * @param {object} options
 * @param {string} options.password API and RTSP password (user `admin`)
 * @param {{ name: string, source: string }[]} options.streams
 * @param {string|null} [options.webrtcCandidate] `host:port` the browsers reach
 */
export function buildGladysYaml({ password, streams, webrtcCandidate = null }) {
  const lines = [
    '# Written by the Gladys go2rtc integration at every start: do not edit.',
    '# Streams: Gladys > Integrations > go2rtc > Configuration. Your own',
    '# settings go in go2rtc.yaml, next to this file.',
    'api:',
    '  listen: ":1984"',
    `  username: ${q(CONTAINER.USERNAME)}`,
    `  password: ${q(password)}`,
    'rtsp:',
    '  listen: ":8554"',
    `  username: ${q(CONTAINER.USERNAME)}`,
    `  password: ${q(password)}`,
    'webrtc:',
    // Only the TCP port is published by Gladys.
    '  listen: ":8555/tcp"',
    ...(webrtcCandidate ? ['  candidates:', `    - ${q(webrtcCandidate)}`] : []),
    'log:',
    '  format: "text"',
  ];
  if (streams.length > 0) {
    lines.push('streams:');
    for (const { name, source } of streams) lines.push(`  ${q(name)}: ${q(source)}`);
  }
  return `${lines.join('\n')}\n`;
}

/** The host port Gladys assigned to a declared port, or null. */
export function hostPort(container, portName) {
  const port = (container?.ports ?? []).find((p) => p.name === portName);
  return Number.isInteger(port?.host_port) ? port.host_port : null;
}

export class BundledGo2rtc {
  /**
   * @param {object} options
   * @param {object} options.gladys the SDK client (getContainers, startContainer, stopContainer)
   * @param {string} [options.dataDir] the writable volume, /data
   * @param {object} [options.fs] node:fs/promises (tests inject a temp dir instead)
   */
  constructor({
    gladys,
    dataDir = '/data',
    fs = nodeFs,
    randomPassword = () => randomBytes(18).toString('base64url'),
  }) {
    this.gladys = gladys;
    this.dataDir = dataDir;
    this.fs = fs;
    this.randomPassword = randomPassword;
  }

  get configDir() {
    return path.join(this.dataDir, CONTAINER.CONFIG_DIR);
  }

  /** The web password of the configuration, else the generated one (kept in /data). */
  async password(webPassword) {
    if (webPassword) return { password: webPassword, generated: false };
    const file = path.join(this.dataDir, STATE_FILE);
    let state;
    try {
      state = JSON.parse(await this.fs.readFile(file, 'utf8')) ?? {};
    } catch {
      state = {};
    }
    if (typeof state.generatedPassword !== 'string' || state.generatedPassword.length < 16) {
      state = { ...state, generatedPassword: this.randomPassword() };
      await this.fs.writeFile(file, JSON.stringify(state), { mode: 0o600 });
    }
    return { password: state.generatedPassword, generated: true };
  }

  async container() {
    const containers = await this.gladys.getContainers();
    const entry = (containers ?? []).find((c) => c.name === CONTAINER.NAME);
    if (!entry) throw new Error('Gladys knows no go2rtc sub-container (manifest)');
    return entry;
  }

  /** The config folder and the user file, writable by go2rtc. */
  async prepareFiles() {
    const dir = this.configDir;
    await this.fs.mkdir(dir, { recursive: true });
    await this.fs.chmod(dir, 0o777);
    const userFile = path.join(dir, CONTAINER.USER_FILE);
    try {
      await this.fs.writeFile(userFile, USER_FILE_HEADER, { flag: 'wx' });
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
    }
    // The umask applies to writeFile: chmod. A file go2rtc itself created
    // (owned by root) cannot be changed, and does not need to be.
    await this.fs.chmod(userFile, 0o666).catch(() => {});
    return dir;
  }

  /**
   * Write gladys.yaml and (re)start go2rtc when it changed or is not running.
   * With a WebRTC address, the candidate needs the host port Gladys assigns
   * at the first start: written then, with one more restart.
   * @param {ReturnType<import('./config.js').normalizeConfig>['bundled']} bundled
   */
  async ensure(bundled) {
    const { password, generated } = await this.password(bundled.webPassword);
    const dir = await this.prepareFiles();
    const file = path.join(dir, CONTAINER.GLADYS_FILE);
    let entry = await this.container();
    let restarted = false;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const webrtcPort = hostPort(entry, CONTAINER.PORTS.WEBRTC.name);
      const candidate =
        bundled.webrtcAddress && webrtcPort ? `${bundled.webrtcAddress}:${webrtcPort}` : null;
      const yaml = buildGladysYaml({
        password,
        streams: bundled.streams,
        webrtcCandidate: candidate,
      });
      const current = await this.fs.readFile(file, 'utf8').catch(() => null);
      if (current !== yaml) {
        await this.fs.writeFile(file, yaml);
        await this.fs.chmod(file, 0o644);
      } else if (entry.status === 'running') {
        break;
      }
      await this.gladys.startContainer(CONTAINER.NAME);
      restarted = true;
      entry = await this.container();
      if (!bundled.webrtcAddress || candidate) break;
    }
    return {
      url: CONTAINER.URL,
      username: CONTAINER.USERNAME,
      password,
      generatedPassword: generated,
      restarted,
      ports: {
        web: hostPort(entry, CONTAINER.PORTS.WEB.name),
        rtsp: hostPort(entry, CONTAINER.PORTS.RTSP.name),
        webrtc: hostPort(entry, CONTAINER.PORTS.WEBRTC.name),
      },
    };
  }

  /** The user runs their own go2rtc: stop ours if it runs. */
  async stop() {
    const entry = await this.container();
    if (entry.status === 'running' || entry.desired === 'running') {
      await this.gladys.stopContainer(CONTAINER.NAME);
      return true;
    }
    return false;
  }
}
