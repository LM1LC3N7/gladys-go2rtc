# TODO — go2rtc v1

Handoff document: what is done, what was decided, what comes next. Keep it
up to date at the end of every milestone.

## Working method

- One milestone at a time, one commit per milestone, tests green before moving on.
- After each milestone: `npm run format:check`, `npm run lint`, `npm test`,
  `npm run audit`, `e2e/run.sh` (Docker), then update README, `docs/en.md`,
  `docs/fr.md`, `CHANGELOG.md` and this file.
- The `gladys-assistant-integration` topic is added at the first real release
  only (before, the store would list an empty integration).
- No forum topic of its own, ever, and no forum post from a module session:
  the claim is in /t/10385 (post #224); the release goes in a recap message
  there, with a link to the repo.

## Status

- [x] **Milestone 1 — core** (2026-10-16): two modes, the go2rtc run by
      Gladys (sub-container `alexxit/go2rtc:1.9.14`, `start: manual`, the
      streams of 6 slots of the form written in `gladys.yaml`, the user's
      `go2rtc.yaml` never rewritten, API and RTSP always behind a password,
      web page / RTSP / WebRTC-TCP ports with `{{port:…}}` links, `video`
      hardware class for USB webcams, optional WebRTC candidate) or an
      existing go2rtc (address, basic auth; Frigate's on port 1984); one
      camera per stream (`GET /api/streams`), Discovery re-published when the
      list changes (checked every minute); images from `/api/frame.jpeg`
      stepped down by width under 150 KB (live, onGetImage) or 60 KB (pushed
      at the pace of the configuration, 5 s to 10 min or none, 12/min/camera
      guard), MJPEG sources shrunk in JavaScript (jpeg-js); one capture
      shared per stream, at most two go2rtc requests at a time; per-camera
      badge (local / unreachable after two failed reads), scene triggers
      `stream_offline` (reason source / server / removed) and
      `stream_online`; buttons "Test the connection" and "Check every
      stream". Tested with unit tests (SDK fake Gladys, fake go2rtc shaped
      after recorded answers) and `e2e/run.sh` against a REAL go2rtc 1.9.14
      fed by ffmpeg test patterns. No real camera.
- [ ] **Milestone 2 — real cameras**: a tester's go2rtc with real cameras
      (see "To check with real cameras"), Frigate's go2rtc, a USB webcam in
      the bundled one, a Raspberry Pi (arm64) for the CPU and memory limits.
- [ ] **Milestone 3 — more**:
  - a "camera online" binary sensor per camera (scene conditions, history),
    if testers ask for it beyond the badge and the triggers;
  - a scene action "refresh the image" / "snapshot to the camera" with an
    output, and the PTZ features of ONVIF cameras through go2rtc (not in
    its API today: would need ONVIF directly);
  - the `gpu` hardware class for VAAPI snapshots (`hardware` parameter of
    `/api/frame.jpeg`) on Intel machines;
  - HTTPS go2rtc with a self-signed certificate (pin it like gladys-frigate);
  - more than 6 slots, or a stream list import, if the go2rtc web page is
    not enough;
  - IPv6 WebRTC address.
- [ ] **Milestone 4 — first release**: cover image, Docker image build check,
      `npx github:GladysAssistant/integration-store .`, Release workflow,
      topic, GHCR package public (the main session publishes, with Louis's OK).

## To check with real cameras

- Snapshot time of real cameras: `/api/frame.jpeg` waits for the next key
  frame (GOP of 1 to 4 s usually, more for some cameras in "smart codec"
  mode): does the live image stay under the 15 s of Gladys? The size of a
  real 1280 px snapshot (the test patterns gave 27 to 58 KB).
- H.265 cameras: go2rtc's ffmpeg transcodes the key frame (`/api/frame.jpeg`
  handles H.265 like H.264): CPU and time on a Pi.
- Frigate 0.16+ with port 1984 published: the stream names, and whether
  snapshots while Frigate records are fine.
- A USB webcam with the `video` hardware class: `/dev/video0` readable by
  go2rtc (root without capabilities: the device must be root-owned or
  world-readable, `video` group devices are 660 root:video), the CPU of
  `#video=h264` under the 1 CPU limit, the PID count (x264 threads).
- HomeKit cameras (Aqara G100, topic 10339): pairing and streaming need
  mDNS, impossible in the bundled go2rtc (bridge network): confirm the
  documented path (go2rtc on the host network, "my own go2rtc" here).
- Tapo without RTSP, Xiaomi, DVR-IP: sources from the go2rtc README, as is.
- The supervision screen of Gladys: the "Open go2rtc web page" link, the
  `{{port:go2rtc_web}}` link of the configuration, basic auth in the
  browser, WebRTC with the candidate (TCP host port) vs MSE.
- A Gladys update that recreates the sub-container: `gladys.yaml` and
  `go2rtc.yaml` kept under `<data>/external-integrations/<selector>/containers/go2rtc/config`.

## Decisions

- **Not a duplicate** (checked 2026-10-16): no go2rtc integration in the
  store index (433 entries, main session), on GitHub or in the forum; the
  Gladys core master (0027571e, 2026-10-16) has `rtsp-camera` and nothing
  for go2rtc (`git grep -il go2rtc server front/src` is empty). Neighbours:
  the core RTSP camera service (one RTSP URL per camera, ffmpeg snapshots
  in the Gladys container), guim31/gladys-onvif, William-De71/gladys-tapo,
  LM1LC3N7/gladys-frigate (an existing Frigate: events, objects). **What
  go2rtc adds**: the cameras that have no plain RTSP URL — HomeKit cameras
  (the Aqara G100 asked for in forum topic 10339), DVR-IP recorders,
  Xiaomi, Tapo without RTSP, Ring, Tuya, USB webcams — and one gateway for
  all of them, with a live WebRTC/MSE page and an RTSP restream other
  software can share. Pierre-Gilles invited Louis to take over the go2rtc
  part of Terdious's July proposal (/t/10385 #27, topic 10339).
- **Reuse**: go2rtc itself is the reused project (MIT, AlexxIT, very
  active): the integration only reads its documented HTTP API
  (`api/openapi.yaml`): `/api`, `/api/streams`, `/api/streams?src=&video`,
  `/api/frame.jpeg`. No streaming code here. References read: the go2rtc
  README and sources (v1.9.14), AlexxIT/WebRTC (the Home Assistant card on
  go2rtc), Frigate's go2rtc config generator and nginx (port 1984, the
  `/api/go2rtc/*` paths are Frigate's own API, not a proxy of go2rtc's).
- **The bundled go2rtc**: the official image (`alexxit/go2rtc`, pinned
  1.9.14, the latest release, 95 MB compressed amd64), `start: manual`
  (started once its files are written, stopped in "my own go2rtc" mode).
  Like gladys-tydom (tydom2mqtt as a sub-container). It runs fine under the
  Gladys sub-container sandbox (measured: no capability, read-only rootfs,
  100 PIDs, `noexec` /tmp): 54 PIDs peak and 101 MB with 5 ffmpeg test
  sources and snapshots; `memory_mb: 512`, `cpu: 1` leave room for a USB
  webcam transcode.
- **Two config files**:
  `go2rtc -config /config/go2rtc.yaml -config /config/gladys.yaml`.
  go2rtc merges them (the last wins on the keys it sets) and its web
  page / `PUT /api/streams` / HomeKit pairing write the FIRST one only:
  the user's, never rewritten by Gladys. `gladys.yaml`
  holds what Gladys relies on (API and RTSP password, `webrtc.listen`
  `:8555/tcp` + candidate, text logs) and the streams of the form. YAML is
  written with JSON-quoted scalars (no YAML library).
- **Permissions**: go2rtc runs as root WITHOUT capabilities (Gladys drops
  them all), so it cannot write in a folder owned by uid 1000: the
  integration (uid 1000, owner of /data) makes the config folder 0777 and
  `go2rtc.yaml` 0666; checked in `e2e/run.sh` (a `PUT /api/streams` saved).
- **Security**: Gladys publishes the sub-container ports on 0.0.0.0, and
  go2rtc's API runs commands through `exec:` sources (from its config;
  the API itself refuses exec/echo sources and sources with spaces): the
  API and the RTSP server always have a password (the web password, else a
  random one in `/data/go2rtc-integration.json`). Requests from localhost
  skip go2rtc's auth: only inside its own container. `/api/streams` does
  NOT mask the credentials of the sources (recorded): the integration keeps
  only the stream names and scrubs `scheme://user:pass@` from every error
  text; no source in the logs (tested).
- **Images**: `/api/frame.jpeg?width=` is honoured for H.264/H.265 only
  (go2rtc's ffmpeg); an MJPEG source comes back as the camera sent it
  (117 KB for a 1080p `-q:v 2` pattern, above Gladys' limit). Detected from
  the JPEG header (width above the one asked), it is shrunk with
  **jpeg-js** 0.4.4 (pure JS, BSD-3-Clause, no dependency, 14 M downloads a
  week; stable, last release 2022 — a codec, not a moving target), decode
  bounded to 9 MP / 160 MB, one at a time. No native image library (sharp
  would need libvips in the image), no ffmpeg in the integration container.
  The width that fitted is remembered per stream. Sizes: the whole
  `image/jpg;base64,…` string is counted by Gladys (150 KB = 115 185 JPEG
  bytes); the pushed image is kept under 60 KB because Gladys' device
  screen sends the stored image back within a 100 KB request (seen with
  gladys-frigate).
- **Status of a camera**: from the reads themselves (images, or a probe
  `GET /api/streams?src=&video` every 5 minutes when no image is pushed):
  go2rtc connects the source lazily, so `/api/streams` alone does not tell
  whether a camera answers. Two failures in a row for offline, one success
  for online; the first reading only arms. go2rtc answers a dead source
  with an EMPTY 200 after its 5 s dial timeout (recorded).
- **Gentle with go2rtc**: one image round at a time, cameras in turn; at
  most two go2rtc requests at a time (each snapshot starts an ffmpeg in
  go2rtc, and the sub-container has 100 PIDs: 12 parallel snapshots broke a
  libx264 encoder in a probe).
- **External ids**: `stream:<encodeURIComponent(name)>`: go2rtc names are
  free text (spaces, colons, accents); the stream name is the identity.
- **Form**: Gladys has no multi-line field: 6 name/source slots, the rest
  through the go2rtc web page (its streams show up in Discovery too).
  Sources are `string` (not `secret`) so the user can read and fix them;
  stored like any config value, never logged.
- `gladys_version >=5.1.0` (scene triggers; sub-containers, named ports and
  placeholders are older). Main container: 256 MB, 0.5 CPU, read-only
  rootfs, `/data` writable (the go2rtc files, the generated password).
- Tests never touch the network: the transport is injected
  (`test/http.test.js` uses loopback servers for the real one).
