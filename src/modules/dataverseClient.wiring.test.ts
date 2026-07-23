import { describe, it, expect } from 'vitest'
import { dataSourcesInfo } from '../../.power/schemas/appschemas/dataSourcesInfo'

/**
 * Câblage Étape A — garde de l'enregistrement de la data source.
 *
 * NB : on n'importe PAS `getClient`/`@microsoft/power-apps` ici : ce SDK n'est
 * pas chargeable dans l'environnement node de Vitest (il exige le bundle
 * browser/vite). `tsc -b` prouve que `getClient(dataSourcesInfo)` compile
 * (types alignés) ; la CONSTRUCTION runtime du client sera validée à l'étape B
 * en Local Play. Ici on vérifie juste que la table est enregistrée aux valeurs
 * canoniques — c'est ce qui route les 4 ops.
 */
describe('câblage Dataverse — enregistrement acq_acq_projets (dataSourcesInfo)', () => {
  it('la data source acq_acq_projets existe et porte les valeurs canoniques', () => {
    const dsi = dataSourcesInfo as Record<string, { dataSourceType?: string; primaryKey?: string }>
    expect(dsi['acq_acq_projets']).toBeDefined()
    expect(dsi['acq_acq_projets'].dataSourceType).toBe('Dataverse')
    expect(dsi['acq_acq_projets'].primaryKey).toBe('acq_acq_projetid')
  })

  it('le connecteur Dataverse (commondataserviceforapps) est présent', () => {
    const dsi = dataSourcesInfo as Record<string, unknown>
    expect(dsi['commondataserviceforapps']).toBeDefined()
  })
})
