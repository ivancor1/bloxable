import { NextRequest, NextResponse } from 'next/server'
import { saveStudioUser } from '@/lib/store'
import { jsonError } from '@/app/api/_lib/http'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * Receiver for plugin/BloxableHelper.luau: the helper POSTs { userId } with
 * StudioService:GetUserId()'s result. 0 is a real report — Studio is signed
 * out — and is stored as such; it is distinct from never having heard from
 * the plugin at all. Only the latest report is kept.
 */
export async function POST(req: NextRequest) {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return jsonError('Invalid JSON body', 400)
  }

  const userId = (body as { userId?: unknown } | null)?.userId
  if (typeof userId !== 'number' || !Number.isSafeInteger(userId) || userId < 0) {
    return jsonError('userId must be a non-negative integer', 400)
  }

  await saveStudioUser({ userId, reportedAt: new Date().toISOString() })
  return NextResponse.json({ ok: true, userId })
}
