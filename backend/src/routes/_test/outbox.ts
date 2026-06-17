// routes/_test/outbox.ts
//
// Non-production-only inspection route. Mounted ONLY via the guarded dynamic
// import in index.ts (`if (config.appEnv !== 'production') { ... }`) — this
// file is also physically deleted from the production build artifact by
// deploy-backend.sh as a second, independent layer of defense. Never
// statically import this module from anywhere reachable in production.
//
// GET /_test/outbox — everything the email/push adapters captured instead of
// dispatching live, in this process's lifetime. What E2E tests assert
// against instead of a real inbox/device.

import express from 'express';
import { CaptureStore } from '../../services/integrations/captureStore';
import { asyncHandler } from '../../middleware/errorHandler';

const router = express.Router();

router.get(
  '/outbox',
  asyncHandler(async (_req, res) => {
    res.json({
      emails: CaptureStore.getEmails(),
      pushes: CaptureStore.getPushes(),
    });
  }),
);

router.delete(
  '/outbox',
  asyncHandler(async (_req, res) => {
    CaptureStore.clear();
    res.json({ ok: true });
  }),
);

export default router;
