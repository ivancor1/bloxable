import { NextRequest, NextResponse } from 'next/server'
import { discover, RobloxError } from '@/lib/roblox/discover'
import { getSettings, saveSettings } from '@/lib/store'
import { errorResponse, jsonError } from '@/app/api/_lib/http'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * One-step connect: take (or reuse) an API key, derive the universe and its
 * places from the key itself, and persist the lot. Replaces hand-copying a
 * Universe ID and Place IDs out of the creator dashboard.
 */
export async function POST(req: NextRequest) {
  let body: { apiKey?: unknown; universeId?: unknown } = {}
  try {
    body = await req.json()
  } catch {
    // empty body = reconnect with the stored key
  }

  if (body.apiKey !== undefined && typeof body.apiKey !== 'string') {
    return jsonError('apiKey must be a string', 400)
  }
  if (body.universeId !== undefined && typeof body.universeId !== 'string') {
    return jsonError('universeId must be a string', 400)
  }

  const provided = typeof body.apiKey === 'string' ? body.apiKey.trim() : ''
  const stored = (await getSettings()).robloxApiKey
  const apiKey = provided || stored
  if (!apiKey) {
    return jsonError('Paste a Roblox API key first.', 400)
  }

  let result
  try {
    result = await discover(apiKey, typeof body.universeId === 'string' ? body.universeId.trim() : undefined)
  } catch (err) {
    if (err instanceof RobloxError) return jsonError(err.message, err.status)
    return errorResponse(err)
  }

  // Persist the key even when discovery stalls, so a fixable problem (no places
  // yet) doesn't also lose the key the user just pasted.
  try {
    await saveSettings({
      ...(provided ? { robloxApiKey: provided } : {}),
      ...(result.universeId ? { universeId: result.universeId } : {}),
      ...(result.places.length > 0 ? { placePool: result.places.map((p) => p.id) } : {}),
    })
  } catch (err) {
    return errorResponse(err)
  }

  return NextResponse.json({
    connected: !!result.universeId && result.places.length > 0 && !result.blocked,
    universeId: result.universeId,
    places: result.places,
    candidates: result.candidates.map((c) => ({ universeId: c.universeId, placeCount: c.places.length })),
    expiresAt: result.key.expirationTimeUtc,
    blocked: result.blocked,
  })
}
