import { NextRequest, NextResponse } from 'next/server'
import { promises as fs } from 'node:fs'
import { buildPlace } from '@/lib/rbx/build'
import { assignPlaceFromPool, getProject, getSettings, saveSettings, updateProject } from '@/lib/store'
import { discover, RobloxError } from '@/lib/roblox/discover'
import { PUBLISH_SIZE_LIMIT, PUBLISH_SIZE_WARN } from '@/lib/config'
import { errorResponse, jsonError } from '@/app/api/_lib/http'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const PUBLISH_TIMEOUT_MS = 60_000

// Exact copy from ARCHITECTURE.md's honest-limitation list — keep verbatim.
const TOO_LARGE_MESSAGE = 'Too large for Open Cloud publish (10 MiB) — export instead.'

interface RobloxErrorEnvelope {
  errors?: { code?: number; message?: string }[]
  message?: string
}

function extractRobloxError(text: string): string | null {
  try {
    const parsed = JSON.parse(text) as RobloxErrorEnvelope
    if (Array.isArray(parsed.errors) && parsed.errors[0]?.message) return parsed.errors[0].message
    if (typeof parsed.message === 'string') return parsed.message
  } catch {
    // not JSON — caller falls back to the raw text
  }
  return null
}

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  let meta
  try {
    meta = await getProject(id)
  } catch (err) {
    return errorResponse(err)
  }

  const settings = await getSettings()
  const robloxApiKey = settings.robloxApiKey
  if (!robloxApiKey) {
    return jsonError('Add your Roblox API key in Settings before publishing.', 400)
  }

  // A project without a target gets one assigned from the operator place pool —
  // the Lovable model: the user never picks a universe, they just hit Publish.
  let universeId = meta.roblox?.universeId
  let placeId = meta.roblox?.placeId
  if (!universeId || !placeId) {
    // Nothing configured yet? Derive it from the key rather than making anyone
    // copy IDs out of a dashboard (RESEARCH Part 1 Q4 — the key names its own
    // universes, and place lists are public).
    if (!settings.universeId || settings.placePool.length === 0) {
      try {
        const found = await discover(robloxApiKey)
        if (found.universeId && found.places.length > 0) {
          await saveSettings({
            universeId: found.universeId,
            placePool: found.places.map((p) => p.id),
          })
        } else if (found.blocked) {
          return jsonError(found.blocked, 400)
        }
      } catch (err) {
        if (err instanceof RobloxError) return jsonError(err.message, err.status)
        return errorResponse(err)
      }
    }
    const assigned = await assignPlaceFromPool(id)
    if (assigned) {
      universeId = assigned.universeId
      placeId = assigned.placeId
      meta = await getProject(id)
    }
  }
  if (!universeId || !placeId) {
    return jsonError(
      'Every place in your experience is already taken — add another place in Studio, then reconnect in Settings.',
      400
    )
  }

  let filePath: string
  let bytes: number
  try {
    ;({ filePath, bytes } = await buildPlace(id, 'rbxl'))
  } catch (err) {
    return errorResponse(err)
  }

  // Hard-block before ever touching the network.
  if (bytes > PUBLISH_SIZE_LIMIT) {
    return jsonError(TOO_LARGE_MESSAGE, 413)
  }

  const fileBytes = await fs.readFile(filePath)

  let robloxRes: Response
  try {
    robloxRes = await fetch(
      `https://apis.roblox.com/universes/v1/${encodeURIComponent(universeId)}/places/${encodeURIComponent(placeId)}/versions?versionType=Published`,
      {
        method: 'POST',
        headers: {
          'x-api-key': robloxApiKey,
          'Content-Type': 'application/octet-stream',
        },
        body: fileBytes,
        signal: AbortSignal.timeout(PUBLISH_TIMEOUT_MS),
      }
    )
  } catch (err) {
    const timedOut = err instanceof Error && err.name === 'TimeoutError'
    return jsonError(
      timedOut
        ? 'Roblox publish request timed out after 60s.'
        : `Roblox publish request failed: ${err instanceof Error ? err.message : String(err)}`,
      timedOut ? 504 : 502
    )
  }

  const text = await robloxRes.text()

  if (!robloxRes.ok) {
    const message = extractRobloxError(text) ?? (text || `Roblox publish failed with status ${robloxRes.status}`)
    return jsonError(message, robloxRes.status)
  }

  let parsed: { versionNumber?: unknown }
  try {
    parsed = JSON.parse(text)
  } catch {
    return jsonError(`Unexpected response from Roblox: ${text}`, 502)
  }

  if (typeof parsed.versionNumber !== 'number') {
    return jsonError(`Unexpected response from Roblox: ${text}`, 502)
  }

  let updatedMeta = meta
  try {
    updatedMeta = await updateProject(id, {
      lastPublish: { versionNumber: parsed.versionNumber, at: new Date().toISOString() },
    })
  } catch {
    // The publish itself succeeded; a failed meta stamp must not fail the request.
  }

  return NextResponse.json({
    versionNumber: parsed.versionNumber,
    warnLarge: bytes >= PUBLISH_SIZE_WARN,
    playUrl: `https://www.roblox.com/games/start?placeId=${placeId}`,
    meta: updatedMeta,
  })
}
