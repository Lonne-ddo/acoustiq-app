import { defineConfig } from 'vitest/config'

// Config de test isolée (pas de plugins React) : les calculs acoustiques sont
// du TypeScript pur testable en environnement Node.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
