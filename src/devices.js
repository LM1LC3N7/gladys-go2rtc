// -----------------------------------------------------------------------------
// One Gladys camera per go2rtc stream (pure).
//
// External id: `ext:<selector>:stream:<encodeURIComponent(name)>`. A go2rtc
// stream name is free text (spaces, colons, accents): encoded, it is unique,
// stable and reversible. The stream name IS the identity: rename a stream in
// go2rtc and Gladys sees a new camera.
// -----------------------------------------------------------------------------

import { DEVICE_FEATURE_CATEGORIES, DEVICE_FEATURE_TYPES } from '@gladysassistant/integration-sdk';
import { DEVICE_TYPE, FEATURE_IMAGE } from './constants.js';

export const streamIds = (gladys, name) =>
  gladys.externalIds(DEVICE_TYPE, encodeURIComponent(name));

/** The stream name of a device of this integration, or null. */
export function streamNameOf(gladys, externalId) {
  const prefix = gladys.externalId(`${DEVICE_TYPE}:`);
  if (typeof externalId !== 'string' || !externalId.startsWith(prefix)) return null;
  const encoded = externalId.slice(prefix.length);
  if (!encoded || encoded.includes(':')) return null;
  try {
    return decodeURIComponent(encoded);
  } catch {
    return null;
  }
}

export function buildCameraDevice(gladys, name) {
  const ids = streamIds(gladys, name);
  return {
    name,
    external_id: ids.device,
    model: 'go2rtc stream',
    should_poll: false,
    features: [
      {
        name: 'Image',
        external_id: ids.feature(FEATURE_IMAGE),
        category: DEVICE_FEATURE_CATEGORIES.CAMERA,
        type: DEVICE_FEATURE_TYPES.CAMERA.IMAGE,
        min: 0,
        max: 1,
        read_only: true,
        has_feedback: false,
        keep_history: false,
      },
    ],
  };
}

/** The created devices of this integration that are streams: [{ externalId, name }]. */
export function createdStreams(gladys, devices = gladys.devices) {
  const result = [];
  for (const device of devices ?? []) {
    const name = streamNameOf(gladys, device?.external_id);
    if (name !== null) result.push({ externalId: device.external_id, name });
  }
  return result.sort((a, b) => a.name.localeCompare(b.name));
}
