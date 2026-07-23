/**
 * Couche Dataverse ISOLÉE pour la persistance de l'état projet AcoustiQ dans une
 * colonne Fichier (blob JSON gzipé). Reprend la chaîne SDK prouvée au spike
 * (spike/persist-file-column), en code de prod : client INJECTÉ (1er paramètre
 * partout), aucun import d'App.tsx, aucune UI, aucun branchement.
 *
 * Le caller construit le client une fois au boot via getClient(dataSourcesInfo)
 * et le passe à chaque opération (testable, découplé).
 */
import type { DataClient } from '@microsoft/power-apps/data'
import type { ProjectData } from '../types'
import * as pako from 'pako'

/**
 * Valeurs canoniques (vérifiées portail/spike) — LogicalName tout-minuscule pour
 * l'API OData ; `table` = entity set (pluriel, préfixe acq_ doublé). Source unique.
 */
export const DV_CFG = {
  table: 'acq_acq_projets',
  fileCol: 'acq_donnees',
  pk: 'acq_acq_projetid',
  fields: { name: 'acq_name', num: 'acq_numeroprojet', notes: 'acq_notes' },
} as const

/** Version du format de blob (pour migrations futures). */
export const SCHEMA_VERSION = 1

// ───────────────────────────────────────────────────────────────────────────
// Sérialisation (versionnée)
// ───────────────────────────────────────────────────────────────────────────

/** ProjectData → { schemaVersion, project } → JSON → gzip (chemin OCTETS). */
export function serializeProject(project: ProjectData): Uint8Array {
  const json = JSON.stringify({ schemaVersion: SCHEMA_VERSION, project })
  return pako.gzip(new TextEncoder().encode(json))
}

/**
 * gzip → JSON → { schemaVersion, project }. Si `schemaVersion` est absent ou
 * inattendu, on retourne le contenu TEL QUEL sans throw (le versionnage servira
 * aux migrations ; pour l'instant on lit v1). Tolère aussi un blob « nu »
 * (ProjectData au premier niveau, sans enveloppe).
 */
export function deserializeProject(bytes: Uint8Array): { schemaVersion: number; project: ProjectData } {
  const json = new TextDecoder().decode(pako.ungzip(bytes))
  const parsed = JSON.parse(json) as { schemaVersion?: number; project?: ProjectData }
  const hasWrapper = parsed && typeof parsed === 'object' && 'project' in parsed
  return {
    schemaVersion: typeof parsed?.schemaVersion === 'number' ? parsed.schemaVersion : 0,
    project: (hasWrapper ? parsed.project : (parsed as unknown as ProjectData)) as ProjectData,
  }
}

// ───────────────────────────────────────────────────────────────────────────
// Erreur normalisée
// ───────────────────────────────────────────────────────────────────────────

/** Erreur Dataverse lisible : message + status HTTP (jamais de silent fail). */
function fail(op: string, err: unknown): never {
  const o = err && typeof err === 'object' ? (err as { message?: string; status?: number }) : {}
  const status = o.status != null ? ` (status ${o.status})` : ''
  throw new Error(`Dataverse ${op} échec : ${o.message ?? 'erreur inconnue'}${status}`)
}

// ───────────────────────────────────────────────────────────────────────────
// Opérations Dataverse (client passé en 1er paramètre)
// ───────────────────────────────────────────────────────────────────────────

/**
 * Crée une ligne projet (colonnes claires). Retourne son GUID.
 * `notes` optionnelle (colonne multiligne).
 */
export async function createProjectRow(
  client: DataClient,
  meta: { name: string; numero: string; notes?: string },
): Promise<{ id: string }> {
  const record: Record<string, string> = {
    [DV_CFG.fields.name]: meta.name,
    [DV_CFG.fields.num]: meta.numero,
  }
  if (meta.notes !== undefined) record[DV_CFG.fields.notes] = meta.notes

  const res = await client.createRecordAsync<Record<string, string>, Record<string, unknown>>(
    DV_CFG.table,
    record,
  )
  if (!res.success) fail('createRecordAsync', res.error)
  const id = res.data?.[DV_CFG.pk] as string | undefined
  if (!id) throw new Error(`Dataverse createRecordAsync : ligne créée mais ${DV_CFG.pk} absent de la réponse`)
  return { id }
}

/**
 * Met à jour les colonnes claires d'une ligne existante (name/numero/notes).
 * Le blob se réécrit séparément via uploadProjectBlob sur le même id.
 * Signature SDK vérifiée : updateRecordAsync(tableName, recordId, changes).
 */
export async function updateProjectRow(
  client: DataClient,
  id: string,
  meta: { name: string; numero: string; notes?: string },
): Promise<void> {
  const changes: Record<string, string> = {
    [DV_CFG.fields.name]: meta.name,
    [DV_CFG.fields.num]: meta.numero,
  }
  if (meta.notes !== undefined) changes[DV_CFG.fields.notes] = meta.notes

  const res = await client.updateRecordAsync<Record<string, string>, Record<string, unknown>>(
    DV_CFG.table,
    id,
    changes,
  )
  if (!res.success) fail('updateRecordAsync', res.error)
}

/** Écrit le blob gzipé dans la colonne Fichier de la ligne. */
export async function uploadProjectBlob(client: DataClient, id: string, gz: Uint8Array): Promise<void> {
  const res = await client.uploadFileToRecord(DV_CFG.table, id, DV_CFG.fileCol, 'project.json.gz', gz)
  if (!res.success) fail('uploadFileToRecord', res.error)
}

/** Relit le blob gzipé depuis la colonne Fichier de la ligne. */
export async function downloadProjectBlob(client: DataClient, id: string): Promise<Uint8Array> {
  const res = await client.downloadFileFromRecord(DV_CFG.table, id, DV_CFG.fileCol)
  if (!res.success || !res.data) fail('downloadFileFromRecord', res.error ?? { message: 'data vide' })
  return res.data
}

/** Liste les lignes projet (métadonnées claires ; le blob n'est PAS téléchargé). */
export async function listProjects(
  client: DataClient,
): Promise<{ id: string; name: string; numero: string }[]> {
  // pk ajouté au $select pour garantir le GUID dans la réponse (Dataverse le
  // renvoie par défaut, mais on l'explicite car le mapping le lit).
  const res = await client.retrieveMultipleRecordsAsync<Record<string, unknown>>(DV_CFG.table, {
    select: [DV_CFG.pk, DV_CFG.fields.name, DV_CFG.fields.num],
  })
  if (!res.success) fail('retrieveMultipleRecordsAsync', res.error)
  return (res.data ?? []).map((r) => ({
    id: String(r[DV_CFG.pk] ?? ''),
    name: String(r[DV_CFG.fields.name] ?? ''),
    numero: String(r[DV_CFG.fields.num] ?? ''),
  }))
}

/** Supprime une ligne projet (méthode SDK `deleteRecordAsync`). */
export async function deleteProject(client: DataClient, id: string): Promise<void> {
  const res = await client.deleteRecordAsync(DV_CFG.table, id)
  if (!res.success) fail('deleteRecordAsync', res.error)
}
