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

function historyDir(id: string): string {
  return path.join(projectDir(id), 'history')
}

function historyStatePath(id: string): string {
  return path.join(historyDir(id), 'state.json')
}

function historySnapshotPath(id: string, name: string): string {
  assertSafeId(name, 'history snapshot')
  return path.join(historyDir(id), `${name}.json`)
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
  lastPublish?: { versionNumber: number; at: string }
  lastEject?: { assetId: string; at: string; moderationState?: string }
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
    if (patch.lastPublish !== undefined) {
      meta.lastPublish = patch.lastPublish
    }
    if (patch.lastEject !== undefined) {
      meta.lastEject = patch.lastEject
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
// History — snapshot-based undo/redo. One snapshot = the full tree BEFORE a
// change (a chat turn's first mutation, or one manual-edit batch). Undo swaps
// the current tree with the newest undo snapshot, parking the current tree on
// the redo stack; any new change clears redo. Snapshots are plain files under
// data/projects/<id>/history/, capped at HISTORY_LIMIT.
// ---------------------------------------------------------------------------

const HISTORY_LIMIT = 30

interface HistoryStateFile {
  undo: string[]
  redo: string[]
}

export interface HistoryCounts {
  undo: number
  redo: number
}

async function loadHistoryState(id: string): Promise<HistoryStateFile> {
  return (await readJson<HistoryStateFile>(historyStatePath(id))) ?? { undo: [], redo: [] }
}

async function removeSnapshots(id: string, names: string[]): Promise<void> {
  for (const name of names) {
    try {
      await fs.unlink(historySnapshotPath(id, name))
    } catch {
      // best effort — a missing snapshot file only means less to undo
    }
  }
}

function snapshotName(): string {
  return `${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`
}

export async function getHistoryCounts(id: string): Promise<HistoryCounts> {
  await getProject(id)
  const state = await loadHistoryState(id)
  return { undo: state.undo.length, redo: state.redo.length }
}

/** Record `tree` (the pre-change tree) as an undo point and clear redo. */
export async function pushHistory(id: string, tree: RbxTree): Promise<HistoryCounts> {
  return withLock(historyStatePath(id), async () => {
    const state = await loadHistoryState(id)
    const name = snapshotName()
    await writeJsonAtomic(historySnapshotPath(id, name), tree)
    state.undo.push(name)
    await removeSnapshots(id, state.redo)
    state.redo = []
    while (state.undo.length > HISTORY_LIMIT) {
      const dropped = state.undo.shift()
      if (dropped) await removeSnapshots(id, [dropped])
    }
    await writeJsonAtomic(historyStatePath(id), state)
    return { undo: state.undo.length, redo: state.redo.length }
  })
}

export async function undoTree(id: string): Promise<{ tree: RbxTree; history: HistoryCounts } | null> {
  return withLock(historyStatePath(id), async () => {
    const state = await loadHistoryState(id)
    const name = state.undo.pop()
    if (!name) return null
    const snapshot = await readJson<RbxTree>(historySnapshotPath(id, name))
    if (!snapshot) {
      // Corrupt/missing snapshot: drop it from the stack and report nothing to undo.
      await writeJsonAtomic(historyStatePath(id), state)
      return null
    }
    const current = await getTree(id)
    const redoName = snapshotName()
    await writeJsonAtomic(historySnapshotPath(id, redoName), current)
    state.redo.push(redoName)
    await removeSnapshots(id, [name])
    await saveTree(id, snapshot)
    await writeJsonAtomic(historyStatePath(id), state)
    return { tree: snapshot, history: { undo: state.undo.length, redo: state.redo.length } }
  })
}

export async function redoTree(id: string): Promise<{ tree: RbxTree; history: HistoryCounts } | null> {
  return withLock(historyStatePath(id), async () => {
    const state = await loadHistoryState(id)
    const name = state.redo.pop()
    if (!name) return null
    const snapshot = await readJson<RbxTree>(historySnapshotPath(id, name))
    if (!snapshot) {
      await writeJsonAtomic(historyStatePath(id), state)
      return null
    }
    const current = await getTree(id)
    const undoName = snapshotName()
    await writeJsonAtomic(historySnapshotPath(id, undoName), current)
    state.undo.push(undoName)
    await removeSnapshots(id, [name])
    await saveTree(id, snapshot)
    await writeJsonAtomic(historyStatePath(id), state)
    return { tree: snapshot, history: { undo: state.undo.length, redo: state.redo.length } }
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
  /** The end user's own Roblox account, connected over OAuth (the eject path). */
  robloxAccount?: RobloxAccount
  /** In-flight OAuth handshake: CSRF state + PKCE verifier, single use. */
  oauthPending?: OauthPending
  /** Latest signed-in-Studio-user report from the helper plugin. */
  studioUser?: StudioUserReport
  /** The operator's universe — all projects publish into places inside it. */
  universeId?: string
  /** Pre-created placeIds inside that universe; projects are assigned one each. */
  placePool?: string[]
}

export interface Settings {
  robloxApiKey?: string
  hasKey: boolean
  universeId?: string
  placePool: string[]
}

const NUMERIC_ID_RE = /^\d+$/

export async function getSettings(): Promise<Settings> {
  const raw = (await readJson<SettingsFile>(settingsPath())) ?? {}
  // An env key (.env.local, same place as the model key) wins over the stored
  // one, so an operator can provision the app without opening Settings at all.
  const envKey = process.env.ROBLOX_API_KEY?.trim()
  const robloxApiKey = envKey || raw.robloxApiKey
  return {
    robloxApiKey,
    hasKey: !!robloxApiKey,
    universeId: raw.universeId,
    placePool: raw.placePool ?? [],
  }
}

export async function saveSettings(patch: {
  robloxApiKey?: string
  universeId?: string
  placePool?: string[]
}): Promise<void> {
  return withLock(settingsPath(), async () => {
    const raw = (await readJson<SettingsFile>(settingsPath())) ?? {}
    if (patch.robloxApiKey !== undefined) {
      const trimmed = patch.robloxApiKey.trim()
      if (trimmed) raw.robloxApiKey = trimmed
      else delete raw.robloxApiKey // empty string clears the stored key
    }
    if (patch.universeId !== undefined) {
      const trimmed = patch.universeId.trim()
      if (trimmed && !NUMERIC_ID_RE.test(trimmed)) {
        throw new ValidationError('Universe ID must be a number')
      }
      if (trimmed) raw.universeId = trimmed
      else delete raw.universeId
    }
    if (patch.placePool !== undefined) {
      const cleaned = patch.placePool.map((p) => p.trim()).filter(Boolean)
      for (const p of cleaned) {
        if (!NUMERIC_ID_RE.test(p)) throw new ValidationError(`Place ID must be a number: ${p}`)
      }
      if (cleaned.length > 0) raw.placePool = [...new Set(cleaned)]
      else delete raw.placePool
    }
    await writeJsonAtomic(settingsPath(), raw)
  })
}

/**
 * Assign a free place from the operator pool to a project that has none yet.
 * Returns the assignment, or null when no universe/pool is configured or the
 * pool is exhausted. Serialized on the settings file so two projects can never
 * grab the same place concurrently.
 */
export async function assignPlaceFromPool(
  projectId: string
): Promise<{ universeId: string; placeId: string } | null> {
  return withLock(settingsPath(), async () => {
    const settings = await getSettings()
    if (!settings.universeId || settings.placePool.length === 0) return null
    const projects = await listProjects()
    const used = new Set(
      projects.map((p) => p.roblox?.placeId).filter((p): p is string => !!p)
    )
    const free = settings.placePool.find((p) => !used.has(p))
    if (!free) return null
    await updateProject(projectId, {
      roblox: { universeId: settings.universeId, placeId: free },
    })
    return { universeId: settings.universeId, placeId: free }
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

// ---------------------------------------------------------------------------
// The end user's own Roblox account (OAuth), used by the eject path to upload a
// model into THEIR inventory. Distinct from `robloxApiKey`, which is the
// operator's own key for publishing places into the operator universe.
//
// Tokens live in the same server-only settings.json and are never returned to
// the browser — `GET /api/roblox/account` reports identity and scopes only.
// ---------------------------------------------------------------------------

export interface RobloxAccount {
  userId: string
  username?: string
  displayName?: string
  accessToken: string
  refreshToken?: string
  /** ISO 8601 expiry of the access token. */
  expiresAt: string
  scope: string
  connectedAt: string
}

export interface OauthPending {
  state: string
  verifier: string
  redirectUri: string
  createdAt: string
  /** Same-origin path to return the browser to, e.g. "/p/abc123". */
  returnTo?: string
}

export async function getRobloxAccount(): Promise<RobloxAccount | null> {
  const raw = (await readJson<SettingsFile>(settingsPath())) ?? {}
  return raw.robloxAccount ?? null
}

export async function saveRobloxAccount(account: RobloxAccount): Promise<void> {
  return withLock(settingsPath(), async () => {
    const raw = (await readJson<SettingsFile>(settingsPath())) ?? {}
    raw.robloxAccount = account
    await writeJsonAtomic(settingsPath(), raw)
  })
}

export async function clearRobloxAccount(): Promise<void> {
  return withLock(settingsPath(), async () => {
    const raw = (await readJson<SettingsFile>(settingsPath())) ?? {}
    delete raw.robloxAccount
    await writeJsonAtomic(settingsPath(), raw)
  })
}

// ---------------------------------------------------------------------------
// The signed-in Studio user, reported by plugin/BloxableHelper.luau over
// POST /api/roblox/eligibility/studio-user. One report at a time — only the
// latest matters for eligibility. userId 0 is a real report meaning Studio
// was signed out, distinct from no report at all (null).
// ---------------------------------------------------------------------------

export interface StudioUserReport {
  /** StudioService:GetUserId() — 0 when Studio is signed out. */
  userId: number
  reportedAt: string
}

export async function getStudioUser(): Promise<StudioUserReport | null> {
  const raw = (await readJson<SettingsFile>(settingsPath())) ?? {}
  return raw.studioUser ?? null
}

export async function saveStudioUser(report: StudioUserReport): Promise<void> {
  return withLock(settingsPath(), async () => {
    const raw = (await readJson<SettingsFile>(settingsPath())) ?? {}
    raw.studioUser = report
    await writeJsonAtomic(settingsPath(), raw)
  })
}

export async function setOauthPending(pending: OauthPending): Promise<void> {
  return withLock(settingsPath(), async () => {
    const raw = (await readJson<SettingsFile>(settingsPath())) ?? {}
    raw.oauthPending = pending
    await writeJsonAtomic(settingsPath(), raw)
  })
}

/** Reads and clears the pending handshake — a state/verifier pair is single use. */
export async function takeOauthPending(): Promise<OauthPending | null> {
  return withLock(settingsPath(), async () => {
    const raw = (await readJson<SettingsFile>(settingsPath())) ?? {}
    const pending = raw.oauthPending ?? null
    if (pending) {
      delete raw.oauthPending
      await writeJsonAtomic(settingsPath(), raw)
    }
    return pending
  })
}
