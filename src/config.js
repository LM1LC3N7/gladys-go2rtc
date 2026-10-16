// -----------------------------------------------------------------------------
// The configuration the user fills (manifest `config_schema`), normalized.
// -----------------------------------------------------------------------------

import { MODES, REFRESH_INTERVALS, STREAM_SLOTS } from './constants.js';

// Defaults: they MUST match the `default` values of the manifest.
export const DEFAULTS = Object.freeze({
  mode: MODES.BUNDLED,
  refresh_interval: '60',
});

/** go2rtc's own default API port, used when a bare address is typed. */
export const DEFAULT_PORT = 1984;
const MAX_NAME_LENGTH = 64;
const MAX_SOURCE_LENGTH = 2000;
const HOST_NAME = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/i;

const text = (value) => (typeof value === 'string' ? value.trim() : '');
// eslint-disable-next-line no-control-regex
const hasControl = (value) => /[\u0000-\u001f\u007f]/.test(value);

/** The keys of one stream slot of the form (1-based). */
export const slotKeys = (slot) => ({
  name: `stream_${slot}_name`,
  source: `stream_${slot}_source`,
});

/**
 * The address of an existing go2rtc: `http(s)://host:port[/base_path]`.
 * A bare `host` or `host:port` is read as http, port 1984 when none is typed.
 * Credentials in the address are refused (they have their own fields, and an
 * address ends up in logs); so are a query and a fragment.
 *   -> { url } or { error: 'empty' | 'invalid' | 'credentials' }
 */
export function parseServerUrl(value) {
  const raw = text(value);
  if (!raw) return { error: 'empty' };
  const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw);
  let url;
  try {
    url = new URL(hasScheme ? raw : `http://${raw}`);
  } catch {
    return { error: 'invalid' };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return { error: 'invalid' };
  if (url.username || url.password) return { error: 'credentials' };
  if (url.search || url.hash || !url.hostname) return { error: 'invalid' };
  if (!hasScheme && !url.port) url.port = String(DEFAULT_PORT);
  const path = url.pathname.replace(/\/+$/, '');
  return { url: `${url.protocol}//${url.host}${path}` };
}

/** A host name or an IPv4 address, for the WebRTC candidate. */
export function parseHost(value) {
  const raw = text(value);
  if (!raw) return { host: null };
  return HOST_NAME.test(raw) ? { host: raw.toLowerCase() } : { error: 'invalid' };
}

/**
 * The streams typed in the slots of the form, for the bundled go2rtc. A slot
 * with a source and no name is named `camera_<slot>`; a name without a
 * source is ignored. Invalid slots (control characters, too long, a name
 * used twice) are reported by number.
 */
export function parseStreams(raw = {}) {
  const streams = [];
  const invalid = [];
  const names = new Set();
  for (let slot = 1; slot <= STREAM_SLOTS; slot += 1) {
    const keys = slotKeys(slot);
    const source = text(raw[keys.source]);
    if (!source) continue;
    const name = text(raw[keys.name]) || `camera_${slot}`;
    if (
      hasControl(name) ||
      hasControl(source) ||
      name.length > MAX_NAME_LENGTH ||
      source.length > MAX_SOURCE_LENGTH ||
      names.has(name)
    ) {
      invalid.push(slot);
      continue;
    }
    names.add(name);
    streams.push({ slot, name, source });
  }
  return { streams, invalid };
}

export function normalizeConfig(raw = {}) {
  raw = raw ?? {};
  const mode = raw.mode === MODES.EXTERNAL ? MODES.EXTERNAL : MODES.BUNDLED;
  const refresh = REFRESH_INTERVALS.includes(String(raw.refresh_interval))
    ? String(raw.refresh_interval)
    : DEFAULTS.refresh_interval;
  const server = parseServerUrl(raw.url);
  const webrtc = parseHost(raw.webrtc_address);
  const { streams, invalid } = parseStreams(raw);
  return {
    mode,
    refreshSeconds: Number(refresh),
    external: {
      url: server.url ?? null,
      urlError: server.error ?? null,
      username: text(raw.username),
      password: typeof raw.password === 'string' ? raw.password : '',
    },
    bundled: {
      webPassword: typeof raw.web_password === 'string' ? raw.web_password : '',
      streams,
      invalidSlots: invalid,
      webrtcAddress: webrtc.host ?? null,
      webrtcAddressError: webrtc.error ?? null,
    },
  };
}
