import { NextRequest, NextResponse } from 'next/server'
import type { PatchOp } from '@/lib/rbx/types'
import { applyPatchOps } from '@/lib/rbx/tree'
import { loadReflection, strictOpShapeErrors, validateOps } from '@/lib/rbx/validate'
import { getTree, pushHistory, saveTree } from '@/lib/store'
import { errorResponse, jsonError } from '@/app/api/_lib/http'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * Manual (non-AI) edits from the editor — gizmo drags, future property edits.
 * Same validation pipeline as the chat loop: every op is checked against the
 * official API dump before it touches the tree. One request = one undo step.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  let body: { ops?: unknown }
  try {
    body = await req.json()
  } catch {
    return jsonError('Body must be JSON.', 400)
  }
  const ops = body.ops
  if (!Array.isArray(ops) || ops.length === 0) {
    return jsonError('ops must be a non-empty array.', 400)
  }
  if (ops.length > 200) {
    return jsonError('Too many ops in one batch (max 200).', 400)
  }

  // Shape first, values second. An op with keys outside its documented shape
  // (`properties` for `props` was the real case) used to type-check as an op
  // with nothing in it and apply as a silent no-op — reject the batch instead,
  // naming every wrong key, so nothing half-applies.
  const shapeErrors = strictOpShapeErrors(ops)
  if (shapeErrors.length > 0) {
    return jsonError(shapeErrors.join(' | '), 422)
  }

  try {
    const [reflection, tree] = await Promise.all([loadReflection(), getTree(id)])
    const validated = validateOps(reflection, tree, ops as PatchOp[])
    if (validated.ok.length === 0) {
      return jsonError(validated.errors.join(' | ') || 'Nothing to apply.', 422)
    }

    const history = await pushHistory(id, tree)
    const result = applyPatchOps(tree, validated.ok)
    await saveTree(id, result.tree)

    return NextResponse.json({
      applied: validated.ok,
      errors: [...validated.errors, ...result.errors],
      history,
    })
  } catch (err) {
    return errorResponse(err)
  }
}
