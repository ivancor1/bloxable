// lib/store/index.ts — server-only fs persistence (B2 ownership).
//
// Every write goes to a temp file in the target directory, then fs.rename()'s
// it into place (atomic on the same filesystem). Read-modify-write sequences
// against a single file (credits.json, a project's project.json) are also
// serialized through an in-process mutex so two concurrent requests can never
// clobber each other's update — this is a local, single-process app, so a
// promise-chain mutex is sufficient (no external DB, no multi-process lock).
//
// `getSettings()` intentionally still returns the raw `robloxApiKey` — it is
// consumed server-internally by the publish and test-connection routes,
// which are the only callers with a real reason to hold the key. The HTTP
// surface (`GET /api/settings`) strips it down to `{ hasKey, masked }` before
// it ever reaches a response body. Nothing in this module logs the key.
//
// Do not import this module from a Client Component.

import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'

import { FREE_DAILY_CREDITS, UNLIMITED_CREDITS } from '@/lib/config'
import type { ProjectMeta, RbxTree } from '@/lib/rbx/types'
import { defaultBaseplateTree } from '@/lib/rbx/template'
import type { Thread, ThreadSummary } from '@/lib/protocol'

// ---------------------------------------------------------------------------
// Errors — routes translate these to real HTTP status codes.
// ---------------------------------------------------------------------------

export class NotFoundError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'NotFoundError'
  }
}

export class ValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ValidationError'
  }
}

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

/** Root of all runtime state. Overridable via BLOXABLE_DATA_DIR for scratch tests. */
function dataDir(): string {
  const override = process.env.BLOXABLE_DATA_DIR
  return override ? path.resolve(override) : path.join(process.cwd(), 'data')
}

const ID_RE = /^[A-Za-z0-9_-]+$/

/** Ids come straight off URL segments; refuse anything that isn't a plain
 * token before it ever touches a file path (no path traversal). */
function assertSafeId(id: string, label: string): void {
  if (!ID_RE.test(id)) {
    throw new ValidationError(`Invalid ${label}`)
  }
}

function projectDir(id: string): string {
  assertSafeId(id, 'project id')
  return path.join(dataDir(), 'projects', id)
}

function projectMetaPath(id: string): string {
  return path.join(projectDir(id), 'project.json')
}

function treePath(id: string): string {
  return path.join(projectDir(id), 'tree.json')
}

function threadsDir(id: string): string {
  return path.join(projectDir(id), 'threads')
}

function threadPath(id: string, tid: string): string {
  assertSafeId(tid, 'thread id')
  return path.join(threadsDir(id), `${tid}.json`)
}

function settingsPath(): string {
  return path.join(dataDir(), 'settings.json')
}

function creditsPath(): string {
  return path.join(dataDir(), 'credits.json')
}

// ---------------------------------------------------------------------------
// Low-level fs helpers
// ---------------------------------------------------------------------------

async function readJson<T>(filePath: string): Promise<T | null> {
  try {
    const raw = await fs.readFile(filePath, 'utf8')
    return JSON.parse(raw) as T
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw err
  }
}

async function writeJsonAtomic(filePath: string, data: unknown): Promise<void> {
  const dir = path.dirname(filePath)
  await fs.mkdir(dir, { recursive: true })
  const tmp = path.join(dir, `.tmp-${path.basename(filePath)}-${randomUUID()}`)
  await fs.writeFile(tmp, JSON.stringify(data, null, 2), 'utf8')
  await fs.rename(tmp, filePath)
}

/** Serializes read-modify-write sequences against the same logical file so
 * concurrent requests (e.g. two chat turns both spending a credit) never
 * lose an update. Keyed by absolute file path. */
const locks = new Map<string, Promise<unknown>>()

function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prevSettled = (locks.get(key) ?? Promise.resolve()).catch(() => undefined)
  const run = prevSettled.then(fn)
  locks.set(
    key,
    run.catch(() => undefined)
  )
  return run
}

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------

export async function listProjects(): Promise<ProjectMeta[]> {
  const dir = path.join(dataDir(), 'projects')
  let entries: string[]
  try {
    entries = await fs.readdir(dir)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw err
  }
  const metas: ProjectMeta[] = []
  for (const id of entries) {
    if (!ID_RE.test(id)) continue
    const meta = await readJson<ProjectMeta>(projectMetaPath(id))
    if (meta) metas.push(meta)
  }
  metas.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  return metas
}

export async function createProject(name: string): Promise<ProjectMeta> {
  const trimmed = name.trim()
  if (!trimmed) throw new ValidationError('Project name is required')
  const id = randomUUID()
  const now = new Date().toISOString()
  const meta: ProjectMeta = { id, name: trimmed, createdAt: now, updatedAt: now }
  await writeJsonAtomic(projectMetaPath(id), meta)
  await writeJsonAtomic(treePath(id), defaultBaseplateTree())
  await fs.mkdir(threadsDir(id), { recursive: true })
  return meta
}

export async function getProject(id: string): Promise<ProjectMeta> {
  const meta = await readJson<ProjectMeta>(projectMetaPath(id))
  if (!meta) throw new NotFoundError(`Project not found: ${id}`)
  return meta
}

export interface ProjectPatch {
  name?: string
  roblox?: { universeId?: string; placeId?: string }
}

export async function updateProject(id: string, patch: ProjectPatch): Promise<ProjectMeta> {
  return withLock(projectMetaPath(id), async () => {
    const meta = await getProject(id)
    if (patch.name !== undefined) {
      const trimmed = patch.name.trim()
      if (!trimmed) throw new ValidationError('Project name is required')
      meta.name = trimmed
    }
    if (patch.roblox !== undefined) {
      meta.roblox = { ...meta.roblox, ...patch.roblox }
    }
    meta.updatedAt = new Date().toISOString()
    await writeJsonAtomic(projectMetaPath(id), meta)
    return meta
  })
}

// ---------------------------------------------------------------------------
// Tree
// ---------------------------------------------------------------------------

export async function getTree(id: string): Promise<RbxTree> {
  const tree = await readJson<RbxTree>(treePath(id))
  if (!tree) throw new NotFoundError(`Project tree not found: ${id}`)
  return tree
}

export async function saveTree(id: string, tree: RbxTree): Promise<void> {
  await withLock(projectMetaPath(id), async () => {
    const meta = await getProject(id) // 404s consistently if the project doesn't exist
    await writeJsonAtomic(treePath(id), tree)
    meta.updatedAt = new Date().toISOString()
    await writeJsonAtomic(projectMetaPath(id), meta)
  })
}

// ---------------------------------------------------------------------------
// Threads
// ---------------------------------------------------------------------------

function toSummary(thread: Thread): ThreadSummary {
  return { id: thread.id, title: thread.title, createdAt: thread.createdAt }
}

export async function listThreads(id: string): Promise<ThreadSummary[]> {
  await getProject(id) // 404s consistently if the project is missing
  let entries: string[]
  try {
    entries = await fs.readdir(threadsDir(id))
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw err
  }
  const summaries: ThreadSummary[] = []
  for (const file of entries) {
    if (!file.endsWith('.json')) continue
    const thread = await readJson<Thread>(path.join(threadsDir(id), file))
    if (thread) summaries.push(toSummary(thread))
  }
  summaries.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  return summaries
}

export async function getThread(id: string, tid: string): Promise<Thread> {
  const thread = await readJson<Thread>(threadPath(id, tid))
  if (!thread) throw new NotFoundError(`Thread not found: ${tid}`)
  return thread
}

export async function saveThread(id: string, thread: Thread): Promise<void> {
  await getProject(id) // ensures the project exists before writing under it
  assertSafeId(thread.id, 'thread id')
  await writeJsonAtomic(threadPath(id, thread.id), thread)
}

// ---------------------------------------------------------------------------
// Settings — Roblox API key. `settings.json` is the only file here; universe
// and place ids live on ProjectMeta.roblox instead (see ARCHITECTURE data
// layout). `robloxApiKey` returned by `getSettings()` is for server-internal
// use only (publish / test-connection routes) — never forward it verbatim in
// an HTTP response.
// ---------------------------------------------------------------------------

interface SettingsFile {
  robloxApiKey?: string
}

export async function getSettings(): Promise<{ robloxApiKey?: string; hasKey: boolean }> {
  const raw = (await readJson<SettingsFile>(settingsPath())) ?? {}
  return { robloxApiKey: raw.robloxApiKey, hasKey: !!raw.robloxApiKey }
}

export async function saveSettings(patch: { robloxApiKey?: string }): Promise<void> {
  return withLock(settingsPath(), async () => {
    const raw = (await readJson<SettingsFile>(settingsPath())) ?? {}
    if (patch.robloxApiKey !== undefined) {
      const trimmed = patch.robloxApiKey.trim()
      if (trimmed) raw.robloxApiKey = trimmed
      else delete raw.robloxApiKey // empty string clears the stored key
    }
    await writeJsonAtomic(settingsPath(), raw)
  })
}

// ---------------------------------------------------------------------------
// Credits — day-key rollover vs FREE_DAILY_CREDITS (lib/config).
// ---------------------------------------------------------------------------

interface CreditsFile {
  day: string // YYYY-MM-DD
  used: number
}

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

async function loadRolledCredits(): Promise<CreditsFile> {
  const raw = await readJson<CreditsFile>(creditsPath())
  const day = today()
  if (!raw || raw.day !== day) return { day, used: 0 }
  return raw
}

export interface Credits {
  remaining: number
  total: number
  /** True while UNLIMITED_CREDITS is on: nothing is counted or gated. */
  unlimited: boolean
}

export async function getCredits(): Promise<Credits> {
  if (UNLIMITED_CREDITS) {
    return { remaining: FREE_DAILY_CREDITS, total: FREE_DAILY_CREDITS, unlimited: true }
  }
  return withLock(creditsPath(), async () => {
    const state = await loadRolledCredits()
    return {
      remaining: Math.max(0, FREE_DAILY_CREDITS - state.used),
      total: FREE_DAILY_CREDITS,
      unlimited: false,
    }
  })
}

export async function spendCredit(): Promise<Credits> {
  // No counting while the limit is off — otherwise the day's file quietly fills
  // up and turning the limit back on locks the user out of a day they paid for.
  if (UNLIMITED_CREDITS) {
    return { remaining: FREE_DAILY_CREDITS, total: FREE_DAILY_CREDITS, unlimited: true }
  }
  return withLock(creditsPath(), async () => {
    const state = await loadRolledCredits()
    const used = Math.min(FREE_DAILY_CREDITS, state.used + 1)
    await writeJsonAtomic(creditsPath(), { day: state.day, used })
    return {
      remaining: Math.max(0, FREE_DAILY_CREDITS - used),
      total: FREE_DAILY_CREDITS,
      unlimited: false,
    }
  })
}
