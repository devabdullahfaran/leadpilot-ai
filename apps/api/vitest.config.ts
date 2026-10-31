import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const globalSetup = join(dirname(fileURLToPath(import.meta.url)), 'test/helpers/global-setup.ts')

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          include: ['test/unit/**/*.test.ts'],
          environment: 'node',
        },
      },
      {
        // Needs a local PostgreSQL (psql on PATH). The database is recreated from the migrations + seed.
        test: {
          name: 'db',
          include: ['test/db/**/*.test.ts'],
          environment: 'node',
          globalSetup,
          fileParallelism: false,
          testTimeout: 20000,
          hookTimeout: 60000,
          sequence: { groupOrder: 1 },
        },
      },
      {
        // Runs after the db project (shared database), one file at a time.
        test: {
          name: 'integration',
          include: ['test/integration/**/*.test.ts'],
          environment: 'node',
          globalSetup,
          fileParallelism: false,
          testTimeout: 30000,
          hookTimeout: 60000,
          sequence: { groupOrder: 2 },
        },
      },
    ],
  },
})
