# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

### Added

- One Gladys camera per stream of a go2rtc server (RTSP, ONVIF, HomeKit,
  Tapo, Xiaomi, DVR-IP, USB webcams… whatever go2rtc reads), found in
  Discovery and followed every minute.
- Two ways to get go2rtc: the one Gladys runs for you (the official
  `alexxit/go2rtc` 1.9.14 image as a sub-container, streams typed in the
  configuration or added in its web page, the web page and an RTSP restream
  behind a password, USB webcams through the `video` hardware access, an
  optional WebRTC address), or your own go2rtc (address, user name and
  password; Frigate's go2rtc on port 1984).
- Camera images: a fresh one for the live view (up to 1280 px, under
  150 KB) and one pushed to the dashboard at the pace you choose (every 5 s
  to every 10 min, or none), resized by go2rtc, or by the integration for
  MJPEG cameras.
- An online / unreachable badge per camera, and the scene triggers "Camera
  offline" (the camera, go2rtc, or a removed stream) and "Camera back
  online".
- "Test the connection to go2rtc" and "Check every stream" buttons.

[Unreleased]: https://github.com/LM1LC3N7/gladys-go2rtc/commits/main
