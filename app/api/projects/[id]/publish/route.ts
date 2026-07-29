import { NextRequest, NextResponse } from 'next/server'
import { promises as fs } from 'node:fs'
import { buildPlace } from '@/lib/rbx/build'
import { getProject, getSettings } from '@/lib/store'
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

  const universeId = meta.roblox?.universeId
  const placeId = meta.roblox?.placeId
  if (!universeId || !placeId) {
    return jsonError('Connect a Roblox universe and place first — open Settings.', 400)
  }

  const { robloxApiKey } = await getSettings()
  if (!robloxApiKey) {
    return jsonError('Add your Roblox API key in Settings before publishing.', 400)
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

  return NextResponse.json({
    versionNumber: parsed.versionNumber,
    warnLarge: bytes >= PUBLISH_SIZE_WARN,
  })
}
