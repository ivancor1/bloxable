import { NextRequest, NextResponse } from 'next/server'
import { getSettings, saveSettings } from '@/lib/store'
import { jsonError } from '@/app/api/_lib/http'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** Never send the real key to the client — last-4 only. */
function maskKey(key: string | undefined): string | null {
  if (!key) return null
  return `••••${key.slice(-4)}`
}

export async function GET() {
  const { robloxApiKey, hasKey } = await getSettings()
  return NextResponse.json({ hasKey, masked: maskKey(robloxApiKey) })
}

export async function PUT(request: NextRequest) {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return jsonError('Invalid JSON body', 400)
  }

  const key = (body as { robloxApiKey?: unknown } | null)?.robloxApiKey
  if (key !== undefined && typeof key !== 'string') {
    return jsonError('robloxApiKey must be a string', 400)
  }

  await saveSettings({ robloxApiKey: key })

  const { robloxApiKey, hasKey } = await getSettings()
  return NextResponse.json({ hasKey, masked: maskKey(robloxApiKey) })
}
