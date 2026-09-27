import { configDefaults, defineConfig } from 'vitest/config';
import { testDatabaseUrl } from './server/testing/postgres';

testDatabaseUrl();

export default defineConfig({
  test: {
    environment: 'node',
    include: ['server/**/*.integration.test.ts'],
    exclude: [...configDefaults.exclude, 'work/**', 'outputs/**'],
    globalSetup: ['./server/testing/integration-setup.ts'],
    testTimeout: 20_000,
  },
});
