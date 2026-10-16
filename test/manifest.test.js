// -----------------------------------------------------------------------------
// The manifest is the contract with Gladys and the store: these tests tie it
// to the code, so a key renamed on one side only fails here.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DEFAULTS, slotKeys } from '../src/config.js';
import {
  ACTIONS,
  CONTAINER,
  MODES,
  OFFLINE_REASONS,
  REFRESH_INTERVALS,
  SCENE_TRIGGERS,
  STREAM_SLOTS,
} from '../src/constants.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const manifest = JSON.parse(read('gladys-assistant-integration.json'));
const pkg = JSON.parse(read('package.json'));
const handlers = read('src/handlers.js');
const app = read('src/app.js');

function* texts(node, path = '') {
  if (Array.isArray(node)) {
    for (const [i, item] of node.entries()) yield* texts(item, `${path}[${i}]`);
  } else if (node && typeof node === 'object') {
    if ('en' in node || 'fr' in node) {
      yield [path, node];
      return;
    }
    for (const [key, value] of Object.entries(node)) yield* texts(value, `${path}.${key}`);
  }
}

const byKey = (list, key) => list.find((item) => item.key === key);
const keys = (list) => (list ?? []).map((item) => item.key);
const fields = Object.fromEntries(manifest.config_schema.map((f) => [f.key, f]));

test('the store basics', () => {
  assert.equal(manifest.manifest_version, 1);
  assert.equal(manifest.type, 'device');
  assert.match(manifest.gladys_version, /^>=5\.1\.0$/, 'scene triggers need 5.1');
  assert.equal(manifest.version, pkg.version);
  assert.equal(manifest.docker_image, `ghcr.io/lm1lc3n7/gladys-go2rtc:${manifest.version}`);
  assert.equal(pkg.name, 'gladys-go2rtc');
  assert.deepEqual(manifest.transports, ['local']);
  assert.deepEqual(manifest.categories, ['security', 'multimedia']);
  assert.equal(manifest.location, undefined, 'no house location needed');
  assert.equal(manifest.network_discovery, undefined, 'go2rtc is reached by address');
  assert.ok(manifest.name.length >= 3 && manifest.name.length <= 30);
  for (const lang of ['en', 'fr']) {
    const length = manifest.description[lang].length;
    assert.ok(length >= 10 && length <= 100, `description.${lang}: ${length} characters`);
    assert.ok(read(`docs/${lang}.md`).length >= 300, `docs/${lang}.md is too short for the store`);
  }
  assert.match(fields.intro.description.en, /Unofficial integration, not affiliated/);
  assert.match(fields.intro.description.fr, /non officielle, sans lien/);
});

test('every text is bilingual', () => {
  for (const [path, text] of texts(manifest)) {
    assert.ok(text.en?.trim() && text.fr?.trim(), `${path} needs en and fr`);
  }
});

test('the configuration matches the code', () => {
  for (const [key, value] of Object.entries(DEFAULTS)) {
    assert.equal(fields[key].default, value, key);
  }
  assert.deepEqual(
    fields.mode.options.map((o) => o.value),
    [MODES.BUNDLED, MODES.EXTERNAL],
  );
  assert.deepEqual(
    fields.refresh_interval.options.map((o) => o.value),
    REFRESH_INTERVALS,
  );
  const slots = Array.from({ length: STREAM_SLOTS }, (_, i) => slotKeys(i + 1));
  assert.deepEqual(keys(manifest.config_schema), [
    'intro',
    'mode',
    'bundled_section',
    'web_password',
    ...slots.flatMap((slot) => [slot.name, slot.source]),
    'webrtc_address',
    'external_section',
    'url',
    'username',
    'password',
    'images_section',
    'refresh_interval',
  ]);
  for (const key of ['web_password', 'password']) assert.equal(fields[key].type, 'secret', key);
});

test('sections store nothing; links https; placeholders reference declared ports', () => {
  const portNames = manifest.containers.flatMap((c) => c.ports.map((p) => p.name));
  for (const section of manifest.config_schema.filter((f) => f.type === 'section')) {
    assert.equal(section.required, undefined, section.key);
    assert.equal(section.default, undefined, section.key);
    assert.equal(section.placeholder, undefined, section.key);
    assert.ok(!(section.key in DEFAULTS), section.key);
    for (const link of section.links ?? []) assert.match(link.url, /^https:\/\//);
    for (const text of Object.values(section.description)) {
      assert.ok(text.length <= 1000, `${section.key}: ${text.length} characters`);
      for (const [, name] of text.matchAll(/\{\{port:([a-z0-9_]+)\}\}/g)) {
        assert.ok(portNames.includes(name), `{{port:${name}}} is not a declared port`);
      }
    }
  }
  for (const field of manifest.config_schema.filter((f) => f.type !== 'section')) {
    assert.ok(!JSON.stringify(field).includes('{{'), `${field.key}: placeholders only in sections`);
  }
});

test('the bundled go2rtc: the pinned official image, as the code drives it', () => {
  assert.equal(manifest.containers.length, 1);
  const [entry] = manifest.containers;
  assert.equal(entry.name, CONTAINER.NAME);
  assert.equal(entry.docker_image, CONTAINER.IMAGE);
  assert.match(entry.docker_image, /^alexxit\/go2rtc:\d+\.\d+\.\d+$/, 'a pinned release');
  assert.equal(entry.start, 'manual', 'started once its config is written');
  assert.equal(entry.read_only, true);
  assert.deepEqual(entry.volumes, ['/config']);
  assert.equal(CONTAINER.CONFIG_DIR, `containers/${entry.name}${entry.volumes[0]}`);
  assert.deepEqual(entry.command, [
    'go2rtc',
    '-config',
    `/config/${CONTAINER.USER_FILE}`,
    '-config',
    `/config/${CONTAINER.GLADYS_FILE}`,
  ]);
  assert.deepEqual(entry.devices, ['video']);
  assert.ok(entry.memory_mb >= 32 && entry.memory_mb <= 4096);
  assert.ok(entry.cpu >= 0.1 && entry.cpu <= 2);
  assert.deepEqual(
    entry.ports.map((p) => [p.name, p.container_port, p.protocol, p.browsable]),
    [
      [CONTAINER.PORTS.WEB.name, CONTAINER.PORTS.WEB.containerPort, 'tcp', true],
      [CONTAINER.PORTS.RTSP.name, CONTAINER.PORTS.RTSP.containerPort, 'tcp', false],
      [CONTAINER.PORTS.WEBRTC.name, CONTAINER.PORTS.WEBRTC.containerPort, 'tcp', false],
    ],
  );
  assert.equal(CONTAINER.URL, `http://${entry.name}:${CONTAINER.PORTS.WEB.containerPort}`);
});

test('the keys of the manifest are the keys of the code, all registered', () => {
  assert.deepEqual(keys(manifest.actions).sort(), Object.values(ACTIONS).sort());
  for (const name of Object.keys(ACTIONS)) {
    assert.ok(handlers.includes(`onAction(ACTIONS.${name}`), name);
  }
  assert.ok(manifest.actions.every((a) => a.timeout_seconds >= 5 && a.timeout_seconds <= 120));
  assert.equal(byKey(manifest.actions, ACTIONS.CHECK_STREAMS).timeout_seconds, 120);
  assert.equal(manifest.scene_actions, undefined);
  assert.equal(manifest.widgets, undefined);
  assert.deepEqual(keys(manifest.scene_triggers).sort(), Object.values(SCENE_TRIGGERS).sort());
  for (const name of Object.keys(SCENE_TRIGGERS)) {
    assert.ok(app.includes(`SCENE_TRIGGERS.${name}`), `${name} is never fired`);
  }
  for (const handler of ['onGetImage(', 'onScanRequest(', 'onHardwareUpdated(']) {
    assert.ok(handlers.includes(handler), handler);
  }
});

test('the triggers: filters and variables are keys of the events', () => {
  const offline = byKey(manifest.scene_triggers, SCENE_TRIGGERS.OFFLINE);
  assert.deepEqual(
    byKey(offline.fields, 'reason').options.map((o) => o.value),
    Object.values(OFFLINE_REASONS),
  );
  // The data the app sends (test/app.test.js checks the real events).
  const data = {
    [SCENE_TRIGGERS.OFFLINE]: ['camera', 'stream', 'reason'],
    [SCENE_TRIGGERS.ONLINE]: ['camera', 'stream'],
  };
  for (const trigger of manifest.scene_triggers) {
    for (const key of keys([...trigger.fields, ...trigger.variables])) {
      assert.ok(data[trigger.key].includes(key), `${trigger.key}.${key} is not in the event`);
    }
    const camera = byKey(trigger.fields, 'camera');
    assert.equal(camera.source, 'devices');
    assert.equal(camera.options, undefined);
  }
});

test('placeholders are multi-language objects', () => {
  for (const field of manifest.config_schema.filter((f) => f.placeholder !== undefined)) {
    assert.equal(typeof field.placeholder, 'object', field.key);
    assert.ok(field.placeholder.en && field.placeholder.fr, field.key);
  }
});
