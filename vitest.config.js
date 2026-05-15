import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.js'],
    exclude: process.env.RUN_DEPLOYED
      ? []
      : ['tests/deployed-integrity.test.js'],
  },
});
