import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // testcontainers needs >5s on cold image pulls; give every test plenty of headroom.
    testTimeout: 30_000,
    hookTimeout: 60_000,
    // Pick up everything under test/.
    include: ['test/**/*.test.ts'],
    // Each test file gets its own Postgres container — keep them serial so
    // we don't exhaust Docker resources on a typical dev box.
    fileParallelism: false,
    // First real test file landed — surface "no tests" as a failure.
    passWithNoTests: false,
  },
});
