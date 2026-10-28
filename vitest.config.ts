import { defineConfig } from 'vitest/config';

// SPA unit tests: pure logic under lib/ only (no DOM). API tests live in api/.
export default defineConfig({
  test: {
    include: ['lib/**/*.test.ts'],
    environment: 'node',
  },
});
