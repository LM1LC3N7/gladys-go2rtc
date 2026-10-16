#!/usr/bin/env bash
# End to end in Docker, without any camera: ffmpeg test patterns as sources.
#   1. the integration image writes /data (read-only rootfs, 256 MB, 0.5 CPU);
#   2. the REAL go2rtc of the manifest starts on those files with the flags
#      Gladys gives a sub-container (no capability, read-only, 100 PIDs,
#      noexec /tmp, the manifest command, /config from the integration data);
#   3. a stream is added through the go2rtc API, as from its web page;
#   4. the app runs in the image against it: Discovery, images, badges,
#      offline / online events (a second go2rtc plays a network camera the
#      test breaks and repairs), buttons; then the "own server" mode;
#   5. the RTSP restream asks for the password; the user file was kept.
# Needs Docker. WEB_PORT=<n> keeps go2rtc's web page on 127.0.0.1:<n> and the
# containers running at the end (KEEP=1), for a look in a browser.
set -euo pipefail
cd "$(dirname "$0")/.."
NET=go2rtc-e2e
IMG=gladys-go2rtc:e2e
GO2RTC=$(grep -o '"docker_image": "alexxit/go2rtc:[^"]*"' gladys-assistant-integration.json | cut -d'"' -f4)
PW=e2e-web-password
DATA=$(mktemp -d "$HOME/.go2rtc-e2e.XXXXXX")
CAM=$(mktemp -d "$HOME/.go2rtc-e2e-camera.XXXXXX")

cleanup() {
  if [ "${KEEP:-0}" != 1 ]; then
    docker rm -f go2rtc-e2e-go2rtc go2rtc-e2e-camera >/dev/null 2>&1 || true
    docker network rm "$NET" >/dev/null 2>&1 || true
    rm -rf "$DATA" "$CAM" 2>/dev/null || true
  fi
}
trap cleanup EXIT

docker build -q -t "$IMG" . >/dev/null
docker image ls "$IMG" --format 'integration image: {{.Size}}'
docker pull -q "$GO2RTC" >/dev/null
echo "go2rtc image: $GO2RTC"
docker network create "$NET" >/dev/null 2>&1 || true
docker rm -f go2rtc-e2e-go2rtc go2rtc-e2e-camera >/dev/null 2>&1 || true

# The network camera: another go2rtc serving a test pattern over RTSP
# (rtsp://camera:8554/live, an alias of pattern_src the test can delete).
cat > "$CAM/go2rtc.yaml" <<'YAML'
log:
  format: text
streams:
  pattern_src: exec:ffmpeg -hide_banner -v error -re -f lavfi -i testsrc=size=1280x720:rate=10 -c:v libx264 -threads 1 -preset ultrafast -tune zerolatency -g 10 -pix_fmt yuv420p -f rtsp {output}
  live: rtsp://127.0.0.1:8554/pattern_src
YAML
chmod 777 "$CAM" && chmod 666 "$CAM/go2rtc.yaml"
docker run -d --name go2rtc-e2e-camera --network "$NET" --network-alias camera \
  -v "$CAM:/config" "$GO2RTC" >/dev/null

run_in_image() {
  docker run --rm --read-only --memory 256m --cpus 0.5 --network "$NET" \
    -v "$DATA:/data" -v "$PWD/e2e:/app/e2e:ro" "$IMG" node /app/e2e/in-image.mjs "$1"
}

echo '--- 1. the integration writes the go2rtc files'
run_in_image prepare
CONF="$DATA/containers/go2rtc/config"
stat -c '%a %U %n' "$CONF" "$CONF/go2rtc.yaml" "$CONF/gladys.yaml" | sed "s#$DATA#/data#"
[ "$(stat -c %a "$CONF")" = 777 ] && [ "$(stat -c %a "$CONF/go2rtc.yaml")" = 666 ]
[ "$(stat -c %a "$DATA/go2rtc-integration.json" 2>/dev/null || echo none)" = none ] # web password set: none generated

echo '--- 2. go2rtc as Gladys runs a sub-container'
PUBLISH=127.0.0.1::1984
[ -n "${WEB_PORT:-}" ] && PUBLISH="127.0.0.1:$WEB_PORT:1984"
docker run -d --name go2rtc-e2e-go2rtc --network "$NET" --network-alias go2rtc \
  --read-only --cap-drop ALL --security-opt no-new-privileges --pids-limit 100 \
  --memory 512m --memory-swap 512m --cpus 1 --shm-size 64m \
  --tmpfs /tmp:rw,noexec,nosuid,size=64m \
  -v "$CONF:/config" -p "$PUBLISH" \
  "$GO2RTC" go2rtc -config /config/go2rtc.yaml -config /config/gladys.yaml >/dev/null
sleep 3
docker logs go2rtc-e2e-go2rtc 2>&1 | head -8
echo "web page: http://$(docker port go2rtc-e2e-go2rtc 1984/tcp) (admin / $PW)"

node_in_net() {
  docker run --rm --network "$NET" node:24-alpine node -e "$1"
}

echo '--- 3. a stream added through the go2rtc API (its web page), password required'
node_in_net "
const auth = { authorization: 'Basic ' + Buffer.from('admin:$PW').toString('base64') };
const url = 'http://go2rtc:1984/api/streams?name=user_cam&src=' + encodeURIComponent('rtsp://camera:8554/live');
(async () => {
  const anonymous = await fetch('http://go2rtc:1984/api/streams');
  if (anonymous.status !== 401) throw new Error('the API answers without the password: ' + anonymous.status);
  const put = await fetch(url, { method: 'PUT', headers: auth });
  console.log('anonymous: 401, PUT user_cam:', put.status);
  if (put.status !== 200) throw new Error(await put.text());
})();"
grep -q 'user_cam' "$CONF/go2rtc.yaml" && echo 'ok - go2rtc saved it in go2rtc.yaml (writable without capabilities)'

( for i in $(seq 1 600); do docker exec go2rtc-e2e-go2rtc cat /sys/fs/cgroup/pids.current 2>/dev/null || true; sleep 0.2; done ) > "$DATA/pids.log" &
SAMPLER=$!

echo '--- 4. the app against the real go2rtc'
run_in_image run
run_in_image external
kill "$SAMPLER" 2>/dev/null || true

echo '--- 5. RTSP restream and files'
docker run --rm --network "$NET" --entrypoint ffprobe "$GO2RTC" -v error -rtsp_transport tcp \
  -show_entries stream=codec_name,width,height -of csv=p=0 "rtsp://admin:$PW@go2rtc:8554/pattern"
if docker run --rm --network "$NET" --entrypoint ffprobe "$GO2RTC" -v error -rtsp_transport tcp \
  -show_entries stream=codec_name -of csv=p=0 rtsp://go2rtc:8554/pattern >/dev/null 2>&1; then
  echo 'FAIL: the RTSP restream answers without the password'
  exit 1
fi
echo 'ok - the RTSP restream needs the password'
grep -q '^# Your own go2rtc settings' "$CONF/go2rtc.yaml" && grep -q 'user_cam' "$CONF/go2rtc.yaml"
echo "ok - go2rtc.yaml kept (header and the stream of the web page)"
echo "go2rtc peak PIDs: $(sort -n "$DATA/pids.log" | tail -1) (limit 100)"
echo "go2rtc memory peak: $(( $(docker exec go2rtc-e2e-go2rtc cat /sys/fs/cgroup/memory.peak) / 1048576 )) MB"

echo '--- the entry point, read-only, without Gladys (expected: the SDK asks for its env)'
docker run --rm --read-only --memory 256m --cpus 0.5 -v "$DATA:/data" "$IMG" 2>&1 | grep -m1 "^Error" || true
echo 'e2e: all green'
