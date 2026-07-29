import { NextRequest, NextResponse } from 'next/server'
import { getThread } from '@/lib/store'
import { errorResponse } from '@/app/api/_lib/http'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; tid: string }> }
) {
  const { id, tid } = await params
  try {
    const thread = await getThread(id, tid)
    return NextResponse.json(thread)
  } catch (err) {
    return errorResponse(err)
  }
}
