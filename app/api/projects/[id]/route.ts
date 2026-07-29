import { NextRequest, NextResponse } from 'next/server'
import { getProject, getTree, listThreads, updateProject } from '@/lib/store'
import { errorResponse, jsonError } from '@/app/api/_lib/http'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  try {
    const [meta, tree, threads] = await Promise.all([
      getProject(id),
      getTree(id),
      listThreads(id),
    ])
    return NextResponse.json({ meta, tree, threads })
  } catch (err) {
    return errorResponse(err)
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return jsonError('Invalid JSON body', 400)
  }

  const b = (body ?? {}) as { name?: unknown; roblox?: unknown }
  const patch: { name?: string; roblox?: { universeId?: string; placeId?: string } } = {}

  if (b.name !== undefined) {
    if (typeof b.name !== 'string' || !b.name.trim()) {
      return jsonError('name must be a non-empty string', 400)
    }
    patch.name = b.name
  }

  if (b.roblox !== undefined) {
    if (typeof b.roblox !== 'object' || b.roblox === null) {
      return jsonError('roblox must be an object', 400)
    }
    const { universeId, placeId } = b.roblox as { universeId?: unknown; placeId?: unknown }
    if (universeId !== undefined && typeof universeId !== 'string') {
      return jsonError('roblox.universeId must be a string', 400)
    }
    if (placeId !== undefined && typeof placeId !== 'string') {
      return jsonError('roblox.placeId must be a string', 400)
    }
    patch.roblox = {
      ...(universeId !== undefined ? { universeId } : {}),
      ...(placeId !== undefined ? { placeId } : {}),
    }
  }

  try {
    const meta = await updateProject(id, patch)
    return NextResponse.json(meta)
  } catch (err) {
    return errorResponse(err)
  }
}
