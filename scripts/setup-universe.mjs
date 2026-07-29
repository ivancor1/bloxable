// One-time operator setup for the hosted-universe model (STRATEGY.md Tier "host
// by default"). Given a universe you created once in Studio plus an API key with
// universe-places:write, this script:
//   1. introspects the key (POST /api-keys/v1/introspect — verified in RESEARCH.md
//      Part 1 Q4) and prints owner + scoped universes, enabled/expired state;
//   2. enumerates the universe's places (GET develop.roblox.com/v1/universes/{u}/places
//      — anonymous, verified) to build the place pool;
//   3. writes universeId + placePool into data/settings.json.
//
// Usage:
//   node scripts/setup-universe.mjs --universe 1234567890
//   ROBLOX_API_KEY=... node scripts/setup-universe.mjs --universe 1234567890
// The key is read from data/settings.json (saved via the app's Settings sheet)
// or the ROBLOX_API_KEY env var. It is never printed.

import { readFile, writeFile, mkdir, rename } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SETTINGS = path.join(ROOT, 'data', 'settings.json')

function arg(name) {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}

const universeId = arg('universe')
if (!universeId || !/^\d+$/.test(universeId)) {
  console.error('Usage: node scripts/setup-universe.mjs --universe <numeric universe id>')
  process.exit(1)
}

let settings = {}
try {
  settings = JSON.parse(await readFile(SETTINGS, 'utf8'))
} catch {
  // no settings yet — fine
}
const apiKey = process.env.ROBLOX_API_KEY || settings.robloxApiKey
if (!apiKey) {
  console.error('No API key: save one in the app Settings sheet or set ROBLOX_API_KEY.')
  process.exit(1)
}

// 1. Introspect the key.
const intro = await fetch('https://apis.roblox.com/api-keys/v1/introspect', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ apiKey }),
})
const introBody = await intro.json().catch(() => null)
if (!intro.ok) {
  console.error(`Key introspection failed (${intro.status}):`, introBody?.message ?? '')
  process.exit(1)
}
console.log(`key name: ${introBody.name ?? '?'}  owner userId: ${introBody.authorizedUserId ?? '?'}`)
console.log(`enabled: ${introBody.enabled}  expired: ${introBody.expired}`)
const scopes = Array.isArray(introBody.scopes) ? introBody.scopes : []
for (const s of scopes) {
  console.log(`scope: ${s.name} [${(s.operations ?? []).join(', ')}] universes: ${JSON.stringify(s.universeIds ?? [])}`)
}
const placeScope = scopes.find((s) => s.name === 'universe-places')
const covers =
  placeScope &&
  (placeScope.universeIds?.includes('*') || placeScope.universeIds?.includes(universeId))
if (!covers) {
  console.warn(`WARNING: the key's universe-places scope does not obviously cover universe ${universeId}. Publishing may 401.`)
}

// 2. Enumerate places (anonymous endpoint).
const places = []
let cursor = ''
do {
  const res = await fetch(
    `https://develop.roblox.com/v1/universes/${universeId}/places?limit=100&sortOrder=Asc&cursor=${encodeURIComponent(cursor)}`
  )
  if (!res.ok) {
    console.error(`Listing places failed (${res.status}): ${await res.text()}`)
    process.exit(1)
  }
  const body = await res.json()
  for (const p of body.data ?? []) places.push({ id: String(p.id), name: p.name })
  cursor = body.nextPageCursor ?? ''
} while (cursor)

if (places.length === 0) {
  console.error('Universe has no places (or is not visible). Create places in Studio first.')
  process.exit(1)
}
console.log(`\nplaces in universe ${universeId}:`)
for (const p of places) console.log(`  ${p.id}  ${p.name}`)

// 3. Write settings (atomic, preserving the stored key).
settings.universeId = universeId
settings.placePool = places.map((p) => p.id)
await mkdir(path.dirname(SETTINGS), { recursive: true })
const tmp = path.join(path.dirname(SETTINGS), `.tmp-settings-${randomUUID()}`)
await writeFile(tmp, JSON.stringify(settings, null, 2))
await rename(tmp, SETTINGS)
console.log(`\nwrote universeId + ${places.length}-place pool to data/settings.json`)
console.log('Projects now auto-assign a free place on first Publish.')
