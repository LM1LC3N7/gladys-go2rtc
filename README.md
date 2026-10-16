# gladys-go2rtc

[Gladys Assistant](https://gladysassistant.com) external integration for
**[go2rtc](https://github.com/AlexxIT/go2rtc)**: every stream of a go2rtc
server becomes a Gladys camera — RTSP and ONVIF cameras, HomeKit cameras,
Tapo, Xiaomi, DVR-IP recorders, USB webcams… — with its image on the
dashboard, a fresh image in the live view, an online / offline badge and
scene triggers. Use the go2rtc that Gladys runs for you (the official image,
as a sub-container), or your own (Frigate's included). **Unofficial
integration, not affiliated with the go2rtc project.**

User documentation: [docs/en.md](docs/en.md) · [docs/fr.md](docs/fr.md).

## How it works

```
Gladys ⇄ SDK ⇄ src/app.js (Go2rtcApp)
                 ├─ src/bundled.js         the go2rtc sub-container: gladys.yaml, start / stop
                 ├─ src/images.js          snapshots under the Gladys limits
                 ├─ src/jpeg.js            MJPEG snapshots shrunk in JavaScript (jpeg-js)
                 ├─ src/go2rtc/client.js   go2rtc's HTTP API
                 ├─ src/go2rtc/http.js     the only network access (node:http)
                 └─ src/devices.js         one camera per stream (pure)
```

- **Streams**: `GET /api/streams` every minute; one camera per stream in
  Discovery, re-published when the list changes.
- **Images**: `GET /api/frame.jpeg?src=<stream>&width=<w>`, the width stepped
  down until the image fits (150 KB for the live view, 60 KB for the image
  pushed at the pace of the configuration). go2rtc resizes H.264/H.265
  itself; an MJPEG source is shrunk here.
- **Status**: every read says whether a camera answers; two failures in a
  row make it offline (badge + `stream_offline`), one success online again
  (`stream_online`).
- **The bundled go2rtc**: started with two config files,
  `-config /config/go2rtc.yaml -config /config/gladys.yaml`. Gladys writes
  the second one (the streams of its form, the API/RTSP password, the
  ports) and never touches the first, which belongs to the user and
  go2rtc's web page.

## Development

```bash
npm install
npm test                                        # node --test, no network
npm run lint && npm run format:check
npm run audit                                   # production dependencies
npx github:GladysAssistant/integration-store .  # store admission checks
e2e/run.sh                                      # Docker: against a REAL go2rtc
```

`e2e/run.sh` needs no camera: it builds the image, starts the go2rtc of the
manifest with the flags of a Gladys sub-container (no capability, read-only,
100 PIDs) fed by ffmpeg test patterns, plus a second go2rtc playing a network
camera the test breaks and repairs, and runs the app in the image (read-only,
256 MB, 0.5 CPU) against it.

## Credits

- [go2rtc](https://github.com/AlexxIT/go2rtc) by Alexey Khit (MIT): the
  bundled image (`alexxit/go2rtc`), and its README, OpenAPI description and
  sources, read to use its API. The answers recorded from it are the test
  fixtures (`test/fixtures/README.md`).
- [AlexxIT/WebRTC](https://github.com/AlexxIT/WebRTC) and
  [Frigate](https://github.com/blakeblackshear/frigate): how they drive
  go2rtc, read as documentation.
- [gladys-tydom](https://github.com/quentinlegay/gladys-tydom): an upstream
  image as a Gladys sub-container.
- [jpeg-js](https://github.com/jpeg-js/jpeg-js) (BSD-3-Clause): the JPEG
  codec of the MJPEG fallback.

This first version was tested against a real go2rtc, without real cameras:
see [TODO.md](TODO.md) for what they must confirm.

## Releasing

**Actions → Release → Run workflow** (patch / minor / major): bumps the
version in `package.json` and the manifest, rolls `CHANGELOG.md`, tags, builds
the multi-arch image to GHCR and publishes the GitHub Release.

## License

Apache-2.0.
