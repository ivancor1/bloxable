// EXPERIMENT (unverified capability — RESEARCH.md Part 1 Q2 "adjacent, worth
// testing"): can AssetService:CreatePlaceAsync mint a NEW place inside a
// universe when driven through the Luau Execution API? If yes, the place pool
// refills itself and manual Studio provisioning dies. If Roblox rejects it,
// this script reports the real error and we provision in Studio batches.
//
// Endpoints verified in RESEARCH.md Part 1 Q5:
//   POST /cloud/v2/universes/{u}/places/{p}/luau-execution-session-tasks  (40/min)
//   poll the returned operation path until state is COMPLETE/FAILED.
// Key needs universe.place.luau-execution-session:write. Note: CreatePlaceAsync
// historically also requires the universe setting "Allow this game to create
// places" (Game Settings → Security) — flip it on before judging a failure.
//
// Usage:
//   node scripts/mint-place.mjs --universe <id> --place <existing placeId> --template <templatePlaceId> [--name "Pool Place"]

import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : fallback
}

const universeId = arg('universe')
const placeId = arg('place')
const templateId = arg('template')
const name = arg('name', `Bloxable Pool ${new Date().toISOString().slice(0, 16)}`)
if (![universeId, placeId, templateId].every((v) => v && /^\d+$/.test(v))) {
  console.error('Usage: node scripts/mint-place.mjs --universe <id> --place <existing placeId> --template <templatePlaceId> [--name <name>]')
  process.exit(1)
}

let settings = {}
try {
  settings = JSON.parse(await readFile(path.join(ROOT, 'data', 'settings.json'), 'utf8'))
} catch {
  /* ignore */
}
const apiKey = process.env.ROBLOX_API_KEY || settings.robloxApiKey
if (!apiKey) {
  console.error('No API key: save one in the app Settings sheet or set ROBLOX_API_KEY.')
  process.exit(1)
}

const script = `
local AssetService = game:GetService("AssetService")
local ok, result = pcall(function()
  return AssetService:CreatePlaceAsync(${JSON.stringify(name)}, ${templateId})
end)
if ok then
  print("CREATED_PLACE_ID=" .. tostring(result))
  return { created = true, placeId = result }
else
  print("CREATE_FAILED: " .. tostring(result))
  return { created = false, error = tostring(result) }
end
`

const base = `https://apis.roblox.com/cloud/v2/universes/${universeId}/places/${placeId}`
const createRes = await fetch(`${base}/luau-execution-session-tasks`, {
  method: 'POST',
  headers: { 'x-api-key': apiKey, 'Content-Type': 'application/json' },
  body: JSON.stringify({ script }),
})
const createBody = await createRes.json().catch(() => null)
if (!createRes.ok) {
  console.error(`Task creation failed (${createRes.status}):`, JSON.stringify(createBody))
  process.exit(1)
}
const taskPath = createBody?.path
console.log('task created:', taskPath, 'state:', createBody?.state)
if (!taskPath) {
  console.error('No task path in response:', JSON.stringify(createBody))
  process.exit(1)
}

for (let i = 0; i < 60; i++) {
  await new Promise((r) => setTimeout(r, 3000))
  const poll = await fetch(`https://apis.roblox.com/cloud/v2/${taskPath}`, {
    headers: { 'x-api-key': apiKey },
  })
  const body = await poll.json().catch(() => null)
  const state = body?.state
  process.stdout.write(`poll ${i + 1}: ${state}\n`)
  if (state === 'COMPLETE') {
    console.log('output:', JSON.stringify(body?.output ?? body, null, 2))
    process.exit(0)
  }
  if (state === 'FAILED') {
    console.error('task failed:', JSON.stringify(body?.error ?? body, null, 2))
    process.exit(1)
  }
}
console.error('timed out waiting for the task — check quotas (5/min versioned, 40/min current).')
process.exit(1)
