// -----------------------------------------------------------------------------
// The SDK handlers, wired to the app. Shared by index.js and the tests, so
// the tests run the exact wiring of the container.
// -----------------------------------------------------------------------------

import { ACTIONS } from './constants.js';

export function registerHandlers(gladys, app, logger) {
  // --- Discovery and device lifecycle --------------------------------------------
  gladys.onScanRequest(() => app.publishDevices());
  gladys.onDeviceCreated((device) => app.deviceCreated(device));
  gladys.onDeviceDeleted((device) => app.deviceDeleted(device));

  // --- Camera: a fresh image (dashboard live view, "send a camera image") ---------
  gladys.onGetImage((device) => app.getImage(device));

  // --- Configuration screen buttons -----------------------------------------------
  gladys.onAction(ACTIONS.TEST, () => app.testConnection());
  gladys.onAction(ACTIONS.CHECK_STREAMS, () => app.checkStreams());

  // --- Configuration and hardware grants changed by the user ----------------------
  gladys.onConfigUpdated((config) => {
    logger?.info('Configuration updated: restarting');
    return app.start(config);
  });
  // The supervisor recreated the go2rtc container with the new /dev/video grants.
  gladys.onHardwareUpdated(() => app.start(gladys.config));

  // --- Connection lifecycle: (re)start on every connection, pause while Gladys is away.
  gladys.on('connected', async () => {
    try {
      await app.start(await gladys.getConfig());
    } catch (err) {
      logger?.error('Start failed', err);
    }
  });
  gladys.on('disconnected', () => app.stop());
}
