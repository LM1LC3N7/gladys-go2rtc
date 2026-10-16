// -----------------------------------------------------------------------------
// The HTTP transport on loopback servers (the only sockets of the tests).
// -----------------------------------------------------------------------------

import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { CODES } from '../src/go2rtc/errors.js';
import { httpGet } from '../src/go2rtc/http.js';

let server;
let base;
before(async () => {
  server = http.createServer((req, res) => {
    if (req.url === '/json') {
      res.end(JSON.stringify({ auth: req.headers.authorization ?? null }));
    } else if (req.url === '/big') {
      res.end(Buffer.alloc(5000));
    } else if (req.url === '/redirect') {
      res.writeHead(302, { location: '/json' });
      res.end();
    } else if (req.url === '/slow') {
      setTimeout(() => res.end('late'), 500);
    } else {
      res.writeHead(404);
      res.end('stream not found');
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

const get = (path, options = {}) =>
  httpGet(`${base}${path}`, { timeout: 2000, maxBytes: 1000, ...options });

test('a GET with headers, any status resolved', async () => {
  const ok = await get('/json', { headers: { authorization: 'Basic eDp5' } });
  assert.equal(ok.status, 200);
  assert.deepEqual(JSON.parse(ok.body), { auth: 'Basic eDp5' });
  const missing = await get('/nope');
  assert.equal(missing.status, 404);
  assert.equal(missing.body.toString(), 'stream not found');
});

test('no redirect followed', async () => {
  const res = await get('/redirect');
  assert.equal(res.status, 302);
});

test('size cap, deadline, abort, refused connection', async () => {
  await assert.rejects(get('/big'), { code: CODES.TOO_LARGE });
  await assert.rejects(get('/slow', { timeout: 100 }), { code: CODES.TIMEOUT });
  const controller = new AbortController();
  const pending = get('/slow', { signal: controller.signal });
  controller.abort();
  await assert.rejects(pending, { code: CODES.TIMEOUT });
  await assert.rejects(get('/json', { signal: AbortSignal.abort() }), { code: CODES.TIMEOUT });
  const closed = http.createServer();
  await new Promise((resolve) => closed.listen(0, '127.0.0.1', resolve));
  const port = closed.address().port;
  await new Promise((resolve) => closed.close(resolve));
  await assert.rejects(httpGet(`http://127.0.0.1:${port}/`, { timeout: 2000, maxBytes: 10 }), {
    code: CODES.UNREACHABLE,
  });
});

test('a port that does not speak HTTP (an SSH port typed for the API)', async () => {
  const ssh = net.createServer((socket) =>
    socket.once('data', () => socket.end('SSH-2.0-OpenSSH_9.9\r\n')),
  );
  await new Promise((resolve) => ssh.listen(0, '127.0.0.1', resolve));
  try {
    await assert.rejects(
      httpGet(`http://127.0.0.1:${ssh.address().port}/api`, { timeout: 2000, maxBytes: 100 }),
      { code: CODES.BAD_ANSWER },
    );
  } finally {
    ssh.close();
  }
});
