// Compliance record persistence — server-only, one JSON file per project at
// data/projects/<id>/compliance.json, written with the same tmp-file +
// fs.rename() pattern as lib/store (atomic on the same filesystem; this is a
// local single-process app, and unlike credits there is no concurrent
// read-modify-write on this file — every PUT replaces it whole).
//
// Deliberately its own module instead of an edit to lib/store/index.ts: that
// file is shared surface owned by other work, and this feature only needs a
// sibling file under the same project directory.
//
// Do not import this module from a Client Component.

import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'

import { getProject } from '@/lib/store'
import type { Answers, QuestionId } from './questions'
import type { PrefillReason } from './prefill'

export interface ComplianceRecord {
  formatVersion: 1
  /** The user's questionnaire answers (pre-filled ones included once accepted). */
  answers: Answers
  /** Which answers came from the tree pre-fill vs. an explicit user tap. */
  sources: Partial<Record<QuestionId, 'prefill' | 'user'>>
  /** The tree evidence behind each pre-filled answer, kept for display. */
  prefillReasons: Partial<Record<QuestionId, PrefillReason>>
  /**
   * Hash of the tree the answers were given against (lib/compliance/hash).
   * When the project's current tree hashes differently, the record is STALE
   * and the UI prompts a retake.
   */
  treeHash: string
  /** Set when the user finished the flow with every asked question answered. */
  completedAt: string | null
  updatedAt: string
}

function dataDir(): string {
  const override = process.env.BLOXABLE_DATA_DIR
  return override ? path.resolve(override) : path.join(process.cwd(), 'data')
}

const ID_RE = /^[A-Za-z0-9_-]+$/

function compliancePath(projectId: string): string {
  if (!ID_RE.test(projectId)) throw new Error('Invalid project id')
  return path.join(dataDir(), 'projects', projectId, 'compliance.json')
}

export async function getCompliance(projectId: string): Promise<ComplianceRecord | null> {
  await getProject(projectId) // 404s consistently if the project is missing
  try {
    const raw = await fs.readFile(compliancePath(projectId), 'utf8')
    const parsed = JSON.parse(raw) as ComplianceRecord
    return parsed && parsed.formatVersion === 1 ? parsed : null
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw err
  }
}

export async function saveCompliance(projectId: string, record: ComplianceRecord): Promise<void> {
  await getProject(projectId)
  const filePath = compliancePath(projectId)
  const dir = path.dirname(filePath)
  await fs.mkdir(dir, { recursive: true })
  const tmp = path.join(dir, `.tmp-${path.basename(filePath)}-${randomUUID()}`)
  await fs.writeFile(tmp, JSON.stringify(record, null, 2), 'utf8')
  await fs.rename(tmp, filePath)
}
