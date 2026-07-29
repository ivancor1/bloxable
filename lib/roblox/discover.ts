// Roblox connection auto-discovery. Server-only.
//
// The whole point: an Open Cloud API key already knows which universes it can
// publish to, and a universe's places are listable without any auth at all. So
// the user should never copy a Universe ID or a Place ID out of a dashboard —
// pasting the key is enough. Both endpoints are verified in RESEARCH.md Part 1
// (Q4 introspect; "LIST PLACES IN A UNIVERSE — works with NO auth at all").

const INTROSPECT_URL = 'https://apis.roblox.com/api-keys/v1/introspect'
const TIMEOUT_MS = 20_000

export class RobloxError extends Error {
  readonly status: number
  constructor(message: string, status: number) {
    super(message)
    this.name = 'RobloxError'
    this.status = status
  }
}

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

export interface KeyInfo {
  enabled: boolean
  expired: boolean
  expirationTimeUtc: string | null
  /** Universes the key is scoped to. Empty when scoped to "*" (all). */
  universeIds: string[]
  /** True when a universe-places scope grants Write — required to publish. */
  canPublish: boolean
  /** True when the key is scoped to every universe the owner has. */
  allUniverses: boolean
}

async function jsonFetch(url: string, init?: RequestInit): Promise<{ res: Response; text: string }> {
  let res: Response
  try {
    res = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) })
  } catch (err) {
    const timedOut = err instanceof Error && err.name === 'TimeoutError'
    throw new RobloxError(
      timedOut ? 'Roblox request timed out.' : `Roblox request failed: ${err instanceof Error ? err.message : String(err)}`,
      timedOut ? 504 : 502
    )
  }
  return { res, text: await res.text() }
}

/** Introspect a key: validity + the universes it may touch. */
export async function introspectKey(apiKey: string): Promise<KeyInfo> {
  const { res, text } = await jsonFetch(INTROSPECT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ apiKey }),
  })

  let parsed: IntrospectEnvelope
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new RobloxError(`Unexpected response from Roblox: ${text}`, 502)
  }
  if (!res.ok) {
    throw new RobloxError(parsed.errors?.[0]?.message ?? parsed.message ?? text, res.status)
  }

  const scopes = parsed.scopes ?? []
  const placeScopes = scopes.filter((s) => s.name === 'universe-places')
  const canPublish = placeScopes.some((s) =>
    (s.operations ?? []).some((op) => op.toLowerCase() === 'write')
  )
  const allIds = scopes.flatMap((s) => s.universeIds ?? [])
  const allUniverses = allIds.includes('*')
  const universeIds = Array.from(new Set(allIds.filter((v) => !!v && v !== '*')))

  return {
    enabled: !!parsed.enabled,
    expired: !!parsed.expired,
    expirationTimeUtc: parsed.expirationTimeUtc ?? null,
    universeIds,
    canPublish,
    allUniverses,
  }
}

export interface PlaceInfo {
  id: string
  name: string
}

/** List a universe's places. Anonymous — no key needed (RESEARCH Part 1 Q4). */
export async function listPlaces(universeId: string): Promise<PlaceInfo[]> {
  const places: PlaceInfo[] = []
  let cursor = ''
  do {
    const url = `https://develop.roblox.com/v1/universes/${encodeURIComponent(universeId)}/places?limit=100&sortOrder=Asc&cursor=${encodeURIComponent(cursor)}`
    const { res, text } = await jsonFetch(url)
    if (!res.ok) {
      throw new RobloxError(`Could not list places for universe ${universeId} (${res.status}).`, res.status)
    }
    let body: { data?: { id?: unknown; name?: unknown }[]; nextPageCursor?: string | null }
    try {
      body = JSON.parse(text)
    } catch {
      throw new RobloxError('Unexpected response listing places.', 502)
    }
    for (const p of body.data ?? []) {
      if (p.id !== undefined) places.push({ id: String(p.id), name: String(p.name ?? 'Place') })
    }
    cursor = body.nextPageCursor ?? ''
  } while (cursor)
  return places
}

export interface Discovery {
  key: KeyInfo
  universeId: string | null
  places: PlaceInfo[]
  /** Every universe the key named, for the picker when there is more than one. */
  candidates: { universeId: string; places: PlaceInfo[] }[]
  /** Human-readable reason discovery could not finish, or null on success. */
  blocked: string | null
}

/**
 * Everything the app needs, from the key alone. `preferUniverseId` pins a
 * choice when the key covers several universes.
 */
export async function discover(apiKey: string, preferUniverseId?: string): Promise<Discovery> {
  const key = await introspectKey(apiKey)

  if (key.expired) {
    return { key, universeId: null, places: [], candidates: [], blocked: 'This API key has expired — create a new one.' }
  }
  if (!key.enabled) {
    return { key, universeId: null, places: [], candidates: [], blocked: 'This API key is disabled.' }
  }
  if (!key.canPublish) {
    return {
      key,
      universeId: null,
      places: [],
      candidates: [],
      blocked: "This key can't publish — add the 'universe-places' system with the Write operation.",
    }
  }
  if (key.universeIds.length === 0) {
    return {
      key,
      universeId: null,
      places: [],
      candidates: [],
      blocked: key.allUniverses
        ? 'This key is scoped to all universes, so we cannot tell which one to use — paste a Universe ID below.'
        : 'This key is not scoped to any experience yet — edit it and select one.',
    }
  }

  const candidates: { universeId: string; places: PlaceInfo[] }[] = []
  for (const universeId of key.universeIds) {
    try {
      candidates.push({ universeId, places: await listPlaces(universeId) })
    } catch {
      candidates.push({ universeId, places: [] }) // private/unlistable — keep it selectable
    }
  }

  const chosen =
    candidates.find((c) => c.universeId === preferUniverseId) ??
    candidates.find((c) => c.places.length > 0) ??
    candidates[0]

  return {
    key,
    universeId: chosen?.universeId ?? null,
    places: chosen?.places ?? [],
    candidates,
    blocked:
      chosen && chosen.places.length === 0
        ? 'That experience has no places we can see. Add one in Studio, then reconnect.'
        : null,
  }
}
