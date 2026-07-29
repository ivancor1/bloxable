import { NextResponse } from 'next/server'
import { getSettings } from '@/lib/store'
import { jsonError } from '@/app/api/_lib/http'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const INTROSPECT_TIMEOUT_MS = 20_000

interface IntrospectScope {
  name?: string
  operations?: string[]
  universeIds?: string[]
}

interface IntrospectEnvelope {
  name?: string
  authorizedUserId?: string
  scopes?: IntrospectScope[]
  enabled?: boolean
  expired?: boolean
  expirationTimeUtc?: string
  errors?: { code?: number; message?: string }[]
  message?: string
}

export async function POST() {
  const { robloxApiKey } = await getSettings()
  if (!robloxApiKey) {
    return jsonError('No Roblox API key saved yet — add one in Settings.', 400)
  }

  let res: Response
  try {
    res = await fetch('https://apis.roblox.com/api-keys/v1/introspect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiKey: robloxApiKey }),
      signal: AbortSignal.timeout(INTROSPECT_TIMEOUT_MS),
    })
  } catch (err) {
    const timedOut = err instanceof Error && err.name === 'TimeoutError'
    return jsonError(
      timedOut
        ? 'Roblox connection test timed out.'
        : `Roblox connection test failed: ${err instanceof Error ? err.message : String(err)}`,
      timedOut ? 504 : 502
    )
  }

  const text = await res.text()
  let parsed: IntrospectEnvelope
  try {
    parsed = JSON.parse(text)
  } catch {
    return jsonError(`Unexpected response from Roblox: ${text}`, 502)
  }

  if (!res.ok) {
    const message = parsed.errors?.[0]?.message ?? parsed.message ?? text
    return jsonError(message, res.status)
  }

  const universeIds = Array.from(
    new Set(
      (parsed.scopes ?? [])
        .flatMap((scope) => scope.universeIds ?? [])
        .filter((v): v is string => !!v && v !== '*')
    )
  )

  return NextResponse.json({
    enabled: !!parsed.enabled,
    expired: !!parsed.expired,
    expirationTimeUtc: parsed.expirationTimeUtc ?? null,
    universeIds,
  })
}
