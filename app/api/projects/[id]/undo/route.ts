import { NextRequest, NextResponse } from 'next/server'
import { undoTree } from '@/lib/store'
import { errorResponse, jsonError } from '@/app/api/_lib/http'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  try {
    const result = await undoTree(id)
    if (!result) return jsonError('Nothing to undo.', 409)
    return NextResponse.json(result)
  } catch (err) {
    return errorResponse(err)
  }
}
