/**
 * Provider du client Dataverse (étape B du chantier persistance).
 *
 * Construit le DataClient UNE SEULE FOIS (mémoïsé) via getClient(dataSourcesInfo).
 * getClient est synchrone et local : aucune requête réseau à la construction ;
 * les appels réels (create/upload/list/delete) passent par le bridge du player.
 *
 * Ce module ne fait QUE fournir le client — aucun branchement UI, aucun handler
 * save. Les opérations vivent dans dataverseProjectStore.ts (client injecté).
 */
import { getClient } from '@microsoft/power-apps/data'
import type { DataClient } from '@microsoft/power-apps/data'
import { dataSourcesInfo } from '../../.power/schemas/appschemas/dataSourcesInfo'

let client: DataClient | null = null

/** Retourne le client Dataverse, en le construisant au premier appel (mémoïsé). */
export function getDataverseClient(): DataClient {
  if (client === null) {
    client = getClient(dataSourcesInfo)
  }
  return client
}
