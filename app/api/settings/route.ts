import { NextRequest, NextResponse } from 'next/server'
import { getSettings, saveSettings } from '@/lib/store'
import { errorResponse, jsonError } from '@/app/api/_lib/http'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** Never send the real key to the client — last-4 only. */
function maskKey(key: string | undefined): string | null {
  if (!key) return null
  return `••••${key.slice(-4)}`
}

async function publicSettings() {
  const { robloxApiKey, hasKey, universeId, placePool } = await getSettings()
  return { hasKey, masked: maskKey(robloxApiKey), universeId: universeId ?? null, placePool }
}

export async function GET() {
  return NextResponse.json(await publicSettings())
}

export async function PUT(request: NextRequest) {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return jsonError('Invalid JSON body', 400)
  }

  const b = (body ?? {}) as { robloxApiKey?: unknown; universeId?: unknown; placePool?: unknown }
  if (b.robloxApiKey !== undefined && typeof b.robloxApiKey !== 'string') {
    return jsonError('robloxApiKey must be a string', 400)
  }
  if (b.universeId !== undefined && typeof b.universeId !== 'string') {
    return jsonError('universeId must be a string', 400)
  }
  if (
    b.placePool !== undefined &&
    (!Array.isArray(b.placePool) || b.placePool.some((p) => typeof p !== 'string'))
  ) {
    return jsonError('placePool must be an array of strings', 400)
  }

  try {
    await saveSettings({
      robloxApiKey: b.robloxApiKey as string | undefined,
      universeId: b.universeId as string | undefined,
      placePool: b.placePool as string[] | undefined,
    })
  } catch (err) {
    return errorResponse(err)
  }

  return NextResponse.json(await publicSettings())
}
