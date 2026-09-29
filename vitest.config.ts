import { defineConfig } from 'vitest/config'

// Fuseau FIGÉ pour tous les tests : les conversions en heure murale (A1, #19 —
// src/utils/tempsMesure.ts) dépendent du fuseau du moteur JS, et les tests
// d'heure d'été ne doivent pas réussir ou échouer selon le poste. Fixé avant le
// lancement des workers, qui héritent de l'environnement.
process.env.TZ = 'America/Toronto'

// Config de test isolée (pas de plugins React) : les calculs acoustiques sont
// du TypeScript pur testable en environnement Node.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
