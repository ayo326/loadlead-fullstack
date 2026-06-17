import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/services/**', 'src/middleware/**', 'src/routes/**'],
      // thresholds enforced per-file for Tier-1 modules once coverage reaches target

    },
  },
});
