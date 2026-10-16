# Fixtures

Answers recorded on 2026-10-16 from a real go2rtc 1.9.14 (`alexxit/go2rtc:1.9.14`, revision
b5948cf), run with the flags of a Gladys sub-container (no capability, read-only root, 100 PIDs,
`noexec` /tmp) and fed by ffmpeg test patterns (`exec:ffmpeg … -f lavfi -i testsrc2 …`), as in
`e2e/run.sh`. The addresses are documentation addresses (192.0.2.0/24) and the credentials are
made up.

| File                            | Request                                                                      |
| ------------------------------- | ---------------------------------------------------------------------------- |
| `api.json`                      | `GET /api`                                                                   |
| `streams-idle.json`             | `GET /api/streams`, nobody watching (producers carry only their `url`)       |
| `streams-with-credentials.json` | `GET /api/streams` with an RTSP source holding credentials: NOT masked       |
| `stream-probe.json`             | `GET /api/streams?src=test_h264&video` (the source connected by go2rtc)      |
| `stream-probe-broken.txt`       | `GET /api/streams?src=broken&video`, answered 500 after the 5 s dial timeout |

Also observed, and reproduced by `test/helpers/fakeGo2rtc.js`:

- `GET /api` without credentials when the API has a password: `401` with a `Basic realm="go2rtc"`
  challenge (requests from localhost skip the password: never test auth from inside the go2rtc
  container);
- `GET /api/frame.jpeg?src=<unknown>`: `404` `stream not found`;
- `GET /api/frame.jpeg?src=broken`: `200` with an EMPTY body after 5 s;
- `GET /api/frame.jpeg?src=test_mjpeg&width=640` (MJPEG source, 1920×1080, `-q:v 2`): the camera's
  117 KB JPEG, `width` ignored; an H.264 source is resized (1280×720: 44 KB, `width=640`: 16 KB).
