// -----------------------------------------------------------------------------
// The go2rtc client against the fake go2rtc (answers shaped after the
// recorded ones, test/fixtures).
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Go2rtcClient } from '../src/go2rtc/client.js';
import { CODES, scrub } from '../src/go2rtc/errors.js';
import { createFakeGo2rtc, fixture } from './helpers/fakeGo2rtc.js';

const reply =
  (status, body, headers = {}) =>
  async () => ({
    status,
    headers,
    body: Buffer.isBuffer(body) ? body : Buffer.from(body),
  });

test('info and streams, with basic auth', async () => {
  const server = createFakeGo2rtc({
    streams: { 'Entrée : porte': { kind: 'h264', width: 1920, height: 1080, online: true } },
    auth: { username: 'admin', password: 'pw' },
  });
  const client = new Go2rtcClient({
    baseUrl: 'http://go2rtc:1984/',
    username: 'admin',
    password: 'pw',
    request: server.request,
  });
  assert.deepEqual(await client.info(), { version: '1.9.14' });
  assert.deepEqual(await client.streams(), ['Entrée : porte']);
  assert.equal(
    server.requests[0].authorization,
    `Basic ${Buffer.from('admin:pw').toString('base64')}`,
  );
  const frame = await client.frame('Entrée : porte', { width: 640 });
  assert.equal(frame[0], 0xff);
  assert.equal(
    server.requests.at(-1).path,
    '/api/frame.jpeg?src=Entr%C3%A9e%20%3A%20porte&width=640',
  );
});

test('a wrong password, a foreign server', async () => {
  const server = createFakeGo2rtc({ auth: { username: 'admin', password: 'pw' } });
  const client = new Go2rtcClient({ baseUrl: 'http://go2rtc:1984', request: server.request });
  await assert.rejects(client.info(), { code: CODES.AUTH });
  const html = new Go2rtcClient({ baseUrl: 'http://x', request: reply(200, '<html>') });
  await assert.rejects(html.info(), { code: CODES.BAD_ANSWER });
  const list = new Go2rtcClient({ baseUrl: 'http://x', request: reply(200, '[1,2]') });
  await assert.rejects(list.streams(), { code: CODES.BAD_ANSWER });
  const teapot = new Go2rtcClient({ baseUrl: 'http://x', request: reply(418, '') });
  await assert.rejects(teapot.info(), { code: CODES.HTTP, status: 418 });
  const missing = new Go2rtcClient({ baseUrl: 'http://x', request: reply(404, '') });
  await assert.rejects(
    missing.streams(),
    { code: CODES.HTTP },
    'a 404 on the list is not a stream',
  );
});

test('the recorded answers: stream names only, no source kept', async () => {
  for (const file of ['streams-idle.json', 'streams-with-credentials.json']) {
    const body = readFileSync(new URL(`fixtures/${file}`, import.meta.url));
    const client = new Go2rtcClient({ baseUrl: 'http://x', request: reply(200, body) });
    const names = await client.streams();
    assert.ok(names.includes('test_h264'));
    assert.ok(!JSON.stringify(names).includes('topsecret42'));
  }
  const probe = readFileSync(new URL('fixtures/stream-probe.json', import.meta.url));
  const client = new Go2rtcClient({ baseUrl: 'http://x', request: reply(200, probe) });
  assert.deepEqual(await client.probe('test_h264'), { codecs: ['H264'] });
  assert.equal(fixture('api.json').version, '1.9.14');
});

test('frames: empty 200, 404, 500, not a JPEG', async () => {
  const server = createFakeGo2rtc({
    streams: {
      dead: { kind: 'h264', width: 1280, height: 720, online: false },
      failing: { kind: 'h264', width: 1280, height: 720, online: true, failWith: 'exec/rtsp: EOF' },
    },
  });
  const client = new Go2rtcClient({ baseUrl: 'http://go2rtc:1984', request: server.request });
  await assert.rejects(client.frame('dead', { width: 640 }), { code: CODES.NO_FRAME });
  await assert.rejects(client.frame('nope', { width: 640 }), { code: CODES.NOT_FOUND });
  await assert.rejects(client.frame('failing'), { code: CODES.SOURCE, message: 'exec/rtsp: EOF' });
  await assert.rejects(client.probe('dead'), {
    code: CODES.SOURCE,
    message: 'streams: dial tcp 192.0.2.10:554: i/o timeout',
  });
  await assert.rejects(client.probe('nope'), { code: CODES.NOT_FOUND });
  const png = new Go2rtcClient({ baseUrl: 'http://x', request: reply(200, 'PNG...') });
  await assert.rejects(png.frame('a'), { code: CODES.BAD_ANSWER });
});

test('source errors never carry credentials', async () => {
  const client = new Go2rtcClient({
    baseUrl: 'http://x',
    request: reply(500, 'rtsp: 401 Unauthorized for rtsp://admin:hunter2@192.0.2.5:554/live'),
  });
  await assert.rejects(client.probe('a'), (err) => {
    assert.equal(err.message, 'rtsp: 401 Unauthorized for rtsp://***@192.0.2.5:554/live');
    return true;
  });
  assert.equal(scrub('tapo://cloudpass@192.0.2.6 x'), 'tapo://***@192.0.2.6 x');
  assert.equal(scrub('a'.repeat(300)).length, 200);
});

test('a base path, and close() aborts', async () => {
  const server = createFakeGo2rtc({ basePath: '/rtc' });
  const client = new Go2rtcClient({ baseUrl: 'http://host/rtc', request: server.request });
  assert.deepEqual(await client.streams(), []);
  assert.equal(server.requests[0].path, '/api/streams');
  client.close();
  await assert.rejects(client.info(), { code: CODES.TIMEOUT });
});

test('at most two camera requests at a time', async () => {
  let running = 0;
  let peak = 0;
  const request = async () => {
    running += 1;
    peak = Math.max(peak, running);
    await new Promise((resolve) => setTimeout(resolve, 5));
    running -= 1;
    return { status: 200, headers: {}, body: Buffer.from([0xff, 0xd8, 0xff, 0xd9]) };
  };
  const client = new Go2rtcClient({ baseUrl: 'http://x', request });
  await Promise.all(['a', 'b', 'c', 'd', 'e'].map((name) => client.frame(name)));
  assert.equal(peak, 2);
});
