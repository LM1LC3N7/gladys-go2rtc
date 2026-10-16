# go2rtc

**Unofficial integration, not affiliated with the go2rtc project.** It turns
the streams of a [go2rtc](https://github.com/AlexxIT/go2rtc) server into
Gladys cameras. go2rtc (open source, by AlexxIT) speaks almost every camera
language: RTSP and ONVIF cameras, HomeKit cameras (Aqara G100…), TP-Link
Tapo and Kasa, Xiaomi, DVR-IP recorders, Ring, Tuya, USB webcams, HTTP
snapshot URLs… One go2rtc stream = one camera in Gladys, whatever the brand.

Two ways to use it:

- **the go2rtc run by Gladys**: nothing to install, Gladys starts the
  official go2rtc image next to the integration; you type your streams in
  the configuration, or add them in the go2rtc web page;
- **your own go2rtc**: a go2rtc you already run (Docker, Home Assistant
  add-on…), or the one inside **Frigate**.

**Development version (0.1)**: tested against a real go2rtc 1.9.14 fed by
video test patterns (H.264, MJPEG, a network camera broken and repaired),
not yet with real cameras. Tell us on the forum what works with yours.

## What you get

| Surface                      | Content                                                                                                                                         |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| One camera per **stream**    | Its image on the dashboard, refreshed at the pace you choose; a fresh image when you open the live view or a scene sends the camera image       |
| A badge per camera           | **local** while the camera sends images to go2rtc, **unreachable** after two failed reads in a row                                              |
| Scene triggers               | **Camera offline** (the camera does not answer, its stream left go2rtc, or go2rtc does not answer) and **Camera back online**                   |
| Buttons of the configuration | **Test the connection to go2rtc**, **Check every stream** (go2rtc connects each one: online with its video codec, or why not)                   |
| go2rtc run by Gladys         | Its web page (live video in WebRTC or MSE, adding streams, HomeKit pairing) and an RTSP restream of every stream for other software (VLC, NVR…) |

## The go2rtc run by Gladys

1. Install the integration. In **Configuration**, keep **The go2rtc run by
   Gladys**.
2. Choose a **Web password**: it protects the go2rtc web page and the RTSP
   restream (user `admin`). Without it, Gladys picks a random password and
   the web page stays closed.
3. Fill a **Stream: name** and a **Stream: source** per camera (6 slots; for
   more, add them in the go2rtc web page). The name becomes the camera name
   in Gladys; renaming it later creates a new camera.
4. Save. The first start downloads the go2rtc image (about 95 MB): the
   status may say "does not answer yet" for a minute.
5. Open **Discovery** and add your cameras.

Examples of sources (see the
[go2rtc documentation](https://github.com/AlexxIT/go2rtc#module-streams)):

| Camera                    | Source                                                                                   |
| ------------------------- | ---------------------------------------------------------------------------------------- |
| RTSP (most IP cameras)    | `rtsp://user:password@192.168.1.20:554/stream1`                                          |
| ONVIF                     | `onvif://user:password@192.168.1.20`                                                     |
| TP-Link Tapo (no RTSP)    | `tapo://cloud-password@192.168.1.21`                                                     |
| DVR-IP recorder (XMeye)   | `dvrip://user:password@192.168.1.22:34567?channel=0&subtype=0`                           |
| HTTP snapshot or MJPEG    | `http://192.168.1.23/snapshot.jpg` or `ffmpeg:http://192.168.1.23/video.mjpg#video=h264` |
| USB webcam on this server | `ffmpeg:device?video=0&video_size=1280x720#video=h264` (see below)                       |

**USB webcam**: the go2rtc container only sees the video devices you allow.
Grant the **video** hardware to the go2rtc container in Gladys (install
screen, or the hardware access of the integration), then use the source
above (`video=0` is `/dev/video0`). `#video=h264` makes go2rtc encode H.264
for the browsers; it costs CPU (the container may use one core).

**The web page**: the address is in the configuration screen
(`http://<your Gladys>:<port>/`), and the supervision of the integration
shows an "Open" link. Log in with `admin` and your web password. The video
plays in WebRTC or MSE. For WebRTC, type the IP address of the Gladys
machine in **Address of this Gladys machine (WebRTC)**; without it the page
uses MSE, which works in recent browsers (Chrome, Firefox, Edge, Safari 17+).

**RTSP restream**: `rtsp://admin:<web password>@<your Gladys>:<port>/<stream name>`
(the port is in the configuration screen). Handy to feed another software
with the cameras go2rtc already reaches (Tapo, HomeKit…).

**Your own settings**: Gladys writes the streams of the form in
`gladys.yaml` and never touches `go2rtc.yaml` next to it, which the go2rtc
web page edits (Config): a stream added there, a HomeKit pairing, your
`ffmpeg` presets survive restarts and updates. The settings Gladys needs
(API and RTSP password, ports, logs) and the streams of the form win over
the same keys of `go2rtc.yaml`.

**HomeKit cameras** (Aqara G100…): go2rtc needs mDNS with them, to pair
and to find them again, and mDNS does not cross the isolated network of the
Gladys containers. Run go2rtc on the host network (Docker
`network_mode: host`), pair the camera in its web page, then choose **your
own go2rtc** below.

## Your own go2rtc (or Frigate's)

1. In **Configuration**, choose **My own go2rtc server (or Frigate's)**.
2. **go2rtc address**: the address of its API, port 1984 by default:
   `http://192.168.1.10:1984`. Use the LAN address of the machine:
   `localhost` would point inside the Gladys containers.
3. If go2rtc asks for a password (`api: username / password` in its
   config), fill **go2rtc user name** and **go2rtc password**.
4. Save, then open **Discovery**: every stream of your go2rtc is listed.

**Frigate**: Frigate runs go2rtc inside its container on port 1984. Publish
it in your `docker-compose.yml` (`- "1984:1984"` under `ports:`), then use
`http://<Frigate host>:1984`. That port has no password unless you set one
in the `go2rtc:` section of Frigate's config (`api: username / password`):
keep it on your local network. The cameras of Frigate's go2rtc are the ones
of its `go2rtc: streams:` section.

Gladys only reads your go2rtc (the stream list and snapshots): it never
changes its configuration. When you choose this mode, the go2rtc run by
Gladys is stopped.

## Images

- The dashboard shows the last image Gladys received; **Image refresh**
  sets how often a new one is sent (every 5 seconds to every 10 minutes, or
  none). Each image is a snapshot: go2rtc connects to the camera if nobody
  watches it, waits for a key frame and converts it to JPEG. A fast pace
  loads your cameras and the Gladys machine more; one image a minute is a
  good start.
- The live view (and the "send a camera image" scene action) asks for a
  fresh image, up to 1280 pixels wide.
- Gladys accepts images up to 150 KB (60 KB for the image kept on the
  camera): go2rtc resizes H.264 and H.265 streams itself; an MJPEG stream
  (USB webcam, HTTP camera) is resized by the integration.
- With **None**, no image is sent and each camera's status is checked every
  5 minutes.

## Scenes

- **Camera offline**: a camera (or none for any) and optionally a reason:
  `source` (the camera does not answer go2rtc), `server` (go2rtc does not
  answer), `removed` (the stream is no longer in go2rtc). Variables: the
  stream name and the reason. A camera is offline after two failed reads in
  a row, so a single hiccup sends nothing.
- **Camera back online**: a camera that was offline sends images again.

A camera that is already offline when the integration starts sends no
event: only changes do.

## Troubleshooting

- **"go2rtc does not answer"**: check the address and the port, and that
  the go2rtc machine accepts connections from the Gladys machine.
- **"refused the user name or password"**: the `api:` user and password of
  your go2rtc.
- **"does not answer like go2rtc"**: the address points to another service
  (the RTSP port 8554, Frigate's web port…): use the API port, 1984.
- **"The go2rtc container could not start"**: see the logs of the
  integration (Configuration → supervision); the go2rtc image may not be
  downloaded yet.
- **A camera stays unreachable**: press **Check every stream**: go2rtc says
  why (timeout, refused password, unknown codec). Try the same source in the
  go2rtc web page.
- The integration never writes a camera address or password in its logs.

## Privacy

Everything stays on your network: the integration talks to go2rtc only, and
go2rtc to your cameras. Camera addresses typed in the configuration are
stored by Gladys like any configuration value (visible to Gladys
administrators). The go2rtc run by Gladys always asks for a password on its
web page and RTSP restream, because Gladys publishes those ports on your
local network.
