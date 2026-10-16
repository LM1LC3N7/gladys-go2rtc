import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeConfig, parseHost, parseServerUrl, parseStreams } from '../src/config.js';

test('a go2rtc address: bare host -> http, port 1984', () => {
  assert.deepEqual(parseServerUrl('192.168.1.10'), { url: 'http://192.168.1.10:1984' });
  assert.deepEqual(parseServerUrl(' frigate.lan:1985 '), { url: 'http://frigate.lan:1985' });
  assert.deepEqual(parseServerUrl('http://192.168.1.10:1984/'), {
    url: 'http://192.168.1.10:1984',
  });
  // A scheme typed: the URL as it is (a reverse proxy on 443, go2rtc's base_path).
  assert.deepEqual(parseServerUrl('https://cams.example.org/rtc/'), {
    url: 'https://cams.example.org/rtc',
  });
  assert.deepEqual(parseServerUrl('http://[fd00::10]:1984'), { url: 'http://[fd00::10]:1984' });
});

test('a go2rtc address: refused when empty, foreign or carrying credentials', () => {
  assert.deepEqual(parseServerUrl(''), { error: 'empty' });
  assert.deepEqual(parseServerUrl(undefined), { error: 'empty' });
  assert.deepEqual(parseServerUrl('rtsp://192.168.1.10:8554'), { error: 'invalid' });
  assert.deepEqual(parseServerUrl('http://admin:pw@192.168.1.10:1984'), { error: 'credentials' });
  assert.deepEqual(parseServerUrl('http://192.168.1.10:1984/?x=1'), { error: 'invalid' });
  assert.deepEqual(parseServerUrl('http://bad host'), { error: 'invalid' });
});

test('the WebRTC address: a host name or an IPv4', () => {
  assert.deepEqual(parseHost(''), { host: null });
  assert.deepEqual(parseHost('192.168.1.10'), { host: '192.168.1.10' });
  assert.deepEqual(parseHost('Gladys.LAN'), { host: 'gladys.lan' });
  assert.deepEqual(parseHost('192.168.1.10:8555'), { error: 'invalid' });
  assert.deepEqual(parseHost('http://gladys'), { error: 'invalid' });
});

test('the stream slots: default names, ignored halves, invalid slots', () => {
  const { streams, invalid } = parseStreams({
    stream_1_name: ' garden ',
    stream_1_source: ' rtsp://u:p@192.168.1.20/s1 ',
    stream_2_name: 'name only',
    stream_3_source: 'ffmpeg:device?video=0#video=h264',
    stream_4_name: 'garden',
    stream_4_source: 'rtsp://192.168.1.21/s1',
    stream_5_name: 'x'.repeat(65),
    stream_5_source: 'rtsp://192.168.1.22/s1',
    stream_6_name: 'Entrée : porte',
    stream_6_source: 'tapo://pw@192.168.1.23\nexec:sh',
  });
  assert.deepEqual(streams, [
    { slot: 1, name: 'garden', source: 'rtsp://u:p@192.168.1.20/s1' },
    { slot: 3, name: 'camera_3', source: 'ffmpeg:device?video=0#video=h264' },
  ]);
  assert.deepEqual(invalid, [4, 5, 6]);
});

test('normalizeConfig: defaults and every part', () => {
  const empty = normalizeConfig();
  assert.equal(empty.mode, 'bundled');
  assert.equal(empty.refreshSeconds, 60);
  assert.equal(empty.external.urlError, 'empty');
  assert.deepEqual(empty.bundled.streams, []);
  assert.equal(normalizeConfig(null).mode, 'bundled');

  const config = normalizeConfig({
    mode: 'external',
    url: '10.0.0.5',
    username: ' admin ',
    password: ' secret ',
    refresh_interval: '5',
    web_password: 'web',
    webrtc_address: 'nope:1',
  });
  assert.equal(config.mode, 'external');
  assert.equal(config.refreshSeconds, 5);
  assert.deepEqual(config.external, {
    url: 'http://10.0.0.5:1984',
    urlError: null,
    username: 'admin',
    password: ' secret ',
  });
  assert.equal(config.bundled.webPassword, 'web');
  assert.equal(config.bundled.webrtcAddressError, 'invalid');
  // An interval the manifest does not offer falls back to the default.
  assert.equal(normalizeConfig({ refresh_interval: '3' }).refreshSeconds, 60);
  assert.equal(normalizeConfig({ refresh_interval: '0' }).refreshSeconds, 0);
  assert.equal(normalizeConfig({ mode: 'weird' }).mode, 'bundled');
});
