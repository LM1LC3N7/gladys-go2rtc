# CLAUDE.md

Project rules for coding assistants (Claude Code reads this file) and for
human contributors. Read **[TODO.md](./TODO.md) first**: status, decisions
already taken and the next milestones.

## What this is

A Gladys Assistant **external integration** of type `device`: a Node.js
service (Node 22+, ESM, no build step) in its own sandboxed Docker container,
talking to Gladys through `@gladysassistant/integration-sdk` (v0.15). It
turns the streams of a **go2rtc** server into Gladys cameras, through
go2rtc's documented HTTP API: the go2rtc that Gladys runs as a sub-container
(official image `alexxit/go2rtc`, declared in the manifest), or the user's
own (Frigate's included). Runtime dependencies: the SDK and `jpeg-js` (to
shrink the snapshots of MJPEG sources). Unofficial: not affiliated with the
go2rtc project.

## Commands

```bash
npm install
npm test                                  # node --test, the built-in runner
node --test test/app.test.js              # one file
npm run lint                              # ESLint
npm run format:check                      # Prettier, as the CI runs it
npm run format                            # Prettier, fix in place
npm run audit                             # npm audit --omit=dev
npx github:GladysAssistant/integration-store .   # store admission checks
e2e/run.sh                                # Docker: the image against a REAL go2rtc
```

Run `format:check`, `lint`, `test` and `audit` before every commit, and
`e2e/run.sh` when the go2rtc side changes (client, bundled files, images).

## Architecture

```
index.js                SDK bootstrap only
src/handlers.js         every SDK handler -> the app (shared with the tests)
src/app.js              Go2rtcApp: mode, server loop (streams, Discovery,
                        status), image round, onGetImage, online/offline
                        badges and scene events, buttons
src/bundled.js          the go2rtc sub-container: gladys.yaml, the user file,
                        permissions, start / stop through the SDK
src/images.js           snapshots under the Gladys limits (widths, memo,
                        shared captures)
src/jpeg.js             JPEG header, downscale, jpeg-js shrink (pure)
src/go2rtc/client.js    the go2rtc API: info, streams, probe, frame
src/go2rtc/http.js      the only network access (node:http(s) GET, deadline,
                        size cap, no redirect, abortable)
src/go2rtc/errors.js    Go2rtcError codes, scrub() of credentials
src/limiter.js          at most N tasks at a time
src/devices.js          the camera device, external ids (pure)
src/config.js           config_schema normalized: address, slots, WebRTC host
src/constants.js        keys, limits, timings, the sub-container contract
src/i18n.js             runtime texts (en/fr)
test/fixtures/          answers recorded from a real go2rtc 1.9.14
test/helpers/           a fake go2rtc behind the transport, fake timers;
                        Gladys is the SDK's fake
e2e/                    run.sh + in-image.mjs: the real go2rtc in Docker
```

## go2rtc, as used

- `GET /api` (version), `GET /api/streams` (names only: the sources carry
  credentials, unmasked), `GET /api/streams?src=<name>&video` (connects the
  source: 200 + codecs, or 500 + reason), `GET /api/frame.jpeg?src=&width=`
  (resized for H.264/H.265; an MJPEG source as it is; a dead source = EMPTY
  200 after 5 s). Basic auth; requests from localhost skip it.
- The bundled one:
  `go2rtc -config /config/go2rtc.yaml -config /config/gladys.yaml`.
  The first file is the user's (go2rtc's web page writes there), the
  second Gladys' (written at every start, wins on its keys). `/config` is
  `/data/containers/go2rtc/config` for the integration.

## Rules

- **Unofficial**: every user-facing surface says it is not affiliated with
  the go2rtc project. No go2rtc logo.
- **Keys are forever**: the manifest keys (config, actions, triggers and
  their `reason` values in `src/constants.js`), the external id shape
  `stream:<encodeURIComponent(name)>`, the feature key `image`, the
  sub-container name and port names (`{{port:go2rtc_web}}` is in user
  screens). Never rename them.
- **Never the sources**: a stream source holds the camera password, and
  go2rtc's error texts may hold it too: keep stream names only, `scrub()`
  every go2rtc text, never log a source, a URL with credentials or a
  password (`test/app.test.js` checks the logs).
- **Never rewrite the user's go2rtc.yaml**: create it if missing, chmod it,
  nothing else. Gladys' settings go in `gladys.yaml`.
- **Auth always on** for the bundled go2rtc (its ports are on the LAN).
- **Gentle with go2rtc and the cameras**: one image round at a time, two
  go2rtc requests at most, captures shared, the width that fits
  remembered; 12 pushed images per minute per camera at most.
- **One event per transition**: two failures for offline, one success for
  online, the first reading only arms.
- **Read-only rootfs**: write only under `/data`.
- **Versions belong to the Release workflow** (Actions → Release). Never
  edit `version` in `package.json` or in the manifest, nor the
  `docker_image` tag. The go2rtc image tag of `containers` is ours to bump
  (and to test with `e2e/run.sh`).
- **Changelog**: every user-visible change adds a line under
  `## [Unreleased]` in `CHANGELOG.md`.
- **Manifest texts** are `{ en, fr }` objects; the catalog description holds
  10 to 100 characters per language; `test/manifest.test.js` ties the
  manifest to the code.
- **User-facing text** is bilingual, `docs/en.md` and `docs/fr.md` kept in
  sync. Comments explain why, in English.
- **Tests never touch the network** (the transport is injected; the loopback
  servers of `test/http.test.js` are the only sockets).

## CI and pushes

- Group the commits and push **at most once a day**, unless the maintainer
  explicitly asks otherwise: the GitHub Actions quota is limited.
- If every CI job fails in under 2 seconds, the quota is exhausted: it is
  not a bug in the code.
