import { BroadcastService } from '../src/services/broadcastService';

const loadId = process.argv[2];
if (!loadId) {
  console.error('Usage: rebroadcastOnce.ts <loadId>');
  process.exit(1);
}

BroadcastService.broadcastLoad(loadId)
  .then(() => {
    console.log(`✅ Rebroadcast complete for ${loadId}`);
    process.exit(0);
  })
  .catch((err) => {
    console.error('❌ Rebroadcast failed:', err);
    process.exit(1);
  });
