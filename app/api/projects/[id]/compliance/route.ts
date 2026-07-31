// GET/PUT the project's Maturity & Compliance record.
//
// GET returns the saved record (or null), the CURRENT tree's hash, and a
// `stale` flag — stale means the game changed after the questionnaire was
// answered, so the UI prompts a retake.
//
// PUT stores answers. The client sends the hash of the tree it actually
// pre-filled/answered against (not the server's current one) so staleness
// stays honest even if the tree moves between answering and saving. Nothing
// here talks to Roblox — Bloxable never submits the questionnaire; the user
// mirrors these answers into Creator Dashboard themselves.

import { NextRequest, NextResponse } from 'next/server'
import { getTree } from '@/lib/store'
import { getCompliance, saveCompliance, type ComplianceRecord } from '@/lib/compliance/store'
import { cleanAnswers, isQuestionId } from '@/lib/compliance/questions'
import type { QuestionId } from '@/lib/compliance/questions'
import type { PrefillReason } from '@/lib/compliance/prefill'
import { treeHash } from '@/lib/compliance/hash'
import { errorResponse, jsonError } from '@/app/api/_lib/http'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  try {
    const [record, tree] = await Promise.all([getCompliance(id), getTree(id)])
    const currentTreeHash = treeHash(tree)
    return NextResponse.json({
      record,
      currentTreeHash,
      stale: record !== null && record.treeHash !== currentTreeHash,
    })
  } catch (err) {
    return errorResponse(err)
  }
}

function cleanSources(raw: unknown): ComplianceRecord['sources'] {
  const out: ComplianceRecord['sources'] = {}
  if (typeof raw !== 'object' || raw === null) return out
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (isQuestionId(key) && (value === 'prefill' || value === 'user')) out[key as QuestionId] = value
  }
  return out
}

function cleanReasons(raw: unknown): ComplianceRecord['prefillReasons'] {
  const out: ComplianceRecord['prefillReasons'] = {}
  if (typeof raw !== 'object' || raw === null) return out
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!isQuestionId(key) || typeof value !== 'object' || value === null) continue
    const r = value as Partial<PrefillReason>
    if (typeof r.rule !== 'string' || typeof r.detail !== 'string' || !Array.isArray(r.evidence)) continue
    out[key as QuestionId] = {
      rule: r.rule,
      detail: r.detail,
      evidence: r.evidence.filter((e): e is string => typeof e === 'string').slice(0, 12),
    }
  }
  return out
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return jsonError('Invalid JSON body', 400)
  }
  const b = (body ?? {}) as {
    answers?: unknown
    sources?: unknown
    prefillReasons?: unknown
    treeHash?: unknown
    completedAt?: unknown
  }

  if (typeof b.treeHash !== 'string' || !b.treeHash) {
    return jsonError('treeHash must be the hash of the tree the answers were given against', 400)
  }
  if (b.completedAt !== null && b.completedAt !== undefined && typeof b.completedAt !== 'string') {
    return jsonError('completedAt must be an ISO string or null', 400)
  }

  const record: ComplianceRecord = {
    formatVersion: 1,
    answers: cleanAnswers(b.answers),
    sources: cleanSources(b.sources),
    prefillReasons: cleanReasons(b.prefillReasons),
    treeHash: b.treeHash,
    completedAt: typeof b.completedAt === 'string' ? b.completedAt : null,
    updatedAt: new Date().toISOString(),
  }

  try {
    await saveCompliance(id, record)
    const currentTreeHash = treeHash(await getTree(id))
    return NextResponse.json({
      record,
      currentTreeHash,
      stale: record.treeHash !== currentTreeHash,
    })
  } catch (err) {
    return errorResponse(err)
  }
}
