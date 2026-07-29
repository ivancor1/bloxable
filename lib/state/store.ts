'use client'

// Manager-authored store CONTRACT stub. B5 completes the API-backed actions and
// may add private helpers, but the state/action SHAPE below is locked — B4 (viewer)
// and the shell both compile against it.

import { create } from 'zustand'
import type { PatchOp, ProjectMeta, RbxTree } from '@/lib/rbx/types'
import type { ChatEvent, ChatRequest, Thread, ThreadMessage, ThreadSummary } from '@/lib/protocol'
import { applyPatchOps as applyOps } from '@/lib/rbx/tree'
import { FREE_DAILY_CREDITS } from '@/lib/config'

export interface AppState {
  projects: ProjectMeta[]
  projectId: string | null
  tree: RbxTree | null
  /** Monotonic counter bumped on every tree change — cheap dirty flag for the viewer. */
  treeVersion: number
  selectionId: string | null
  threads: ThreadSummary[]
  activeThreadId: string | null
  messages: ThreadMessage[]
  streaming: boolean
  credits: { remaining: number; total: number; unlimited: boolean }

  // Pure/client actions (implemented here)
  applyPatchOps(ops: PatchOp[]): void
  select(id: string | null): void

  // API-backed actions (B5 implements against app/api routes)
  loadInitial(): Promise<void>
  createProject(name: string): Promise<void>
  switchProject(id: string): Promise<void>
  openThread(id: string | null): Promise<void>
  sendMessage(text: string): Promise<void>
}

// ---------------------------------------------------------------------------
// Tool-chip encoding — DESIGN.md renders one-line chips within an assistant
// turn, with a working spinner row while a tool is in flight. ThreadMessage.
// toolSummaries is a locked `string[]`, so pending/error state is carried as
// a plain-text prefix rather than a new field. Exported so components/ui can
// parse the same convention when rendering.
// ---------------------------------------------------------------------------
export const PENDING_PREFIX = '… ' // "… "
export const ERROR_PREFIX = '! '

/** Tool names (D5, ARCHITECTURE.md) that mutate the tree and deserve a chip. */
const MUTATING_TOOLS = new Set([
  'create_instances',
  'update_instances',
  'delete_instances',
  'write_script',
  'insert_template',
])

function glyphFor(name: string): string {
  if (name === 'create_instances' || name === 'insert_template') return '+'
  if (name === 'delete_instances') return '−' // '−'
  return '✎' // '✎' — update_instances, write_script
}

async function readJson(res: Response): Promise<unknown> {
  try {
    return await res.json()
  } catch {
    return null
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null
}

/** All B2 error responses (app/api/_lib/http.ts `jsonError`) are `{ error: string }`. */
async function errorMessage(res: Response, fallback: string): Promise<string> {
  const body = await readJson(res)
  return isRecord(body) && typeof body.error === 'string' ? body.error : fallback
}

export const useAppStore = create<AppState>((set, get) => ({
  projects: [],
  projectId: null,
  tree: null,
  treeVersion: 0,
  selectionId: null,
  threads: [],
  activeThreadId: null,
  messages: [],
  streaming: false,
  credits: { remaining: 0, total: FREE_DAILY_CREDITS, unlimited: false },

  applyPatchOps(ops) {
    const { tree, treeVersion, selectionId } = get()
    if (!tree) return
    const result = applyOps(tree, ops)
    const stillSelected =
      selectionId && !ops.some((o) => o.op === 'delete' && o.id === selectionId)
    set({
      tree: result.tree,
      treeVersion: treeVersion + 1,
      selectionId: stillSelected ? selectionId : null,
    })
  },

  select(id) {
    set({ selectionId: id })
  },

  async loadInitial() {
    const [projectsRes, creditsRes] = await Promise.all([
      fetch('/api/projects'),
      fetch('/api/credits'),
    ])
    const projects: ProjectMeta[] = projectsRes.ok ? ((await readJson(projectsRes)) as ProjectMeta[]) ?? [] : []
    const fallback = { remaining: 0, total: FREE_DAILY_CREDITS, unlimited: false }
    const loadedCredits = creditsRes.ok
      ? ((await readJson(creditsRes)) as {
          remaining: number
          total: number
          unlimited?: boolean
        } | null)
      : null
    const credits = loadedCredits
      ? { ...loadedCredits, unlimited: loadedCredits.unlimited === true }
      : fallback

    set({ projects, credits })

    if (projects.length > 0) {
      const mostRecent = [...projects].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0]
      await get().switchProject(mostRecent.id)
    }
  },

  async createProject(name) {
    const res = await fetch('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    })
    if (!res.ok) {
      throw new Error(await errorMessage(res, 'Could not create project'))
    }
    const project = (await readJson(res)) as ProjectMeta
    set({ projects: [project, ...get().projects] })
    await get().switchProject(project.id)
  },

  async switchProject(id) {
    // GET /api/projects/:id returns { meta, tree, threads } in one call
    // (app/api/projects/[id]/route.ts) — no separate tree/threads routes exist.
    const res = await fetch(`/api/projects/${id}`)
    if (!res.ok) {
      throw new Error(await errorMessage(res, 'Could not load project'))
    }
    const data = (await readJson(res)) as { meta: ProjectMeta; tree: RbxTree; threads: ThreadSummary[] } | null
    if (!data) throw new Error('Could not load project')
    const { meta, tree, threads } = data

    set((s) => ({
      projects: s.projects.some((p) => p.id === meta.id)
        ? s.projects.map((p) => (p.id === meta.id ? meta : p))
        : [...s.projects, meta],
      projectId: id,
      tree,
      treeVersion: s.treeVersion + 1,
      selectionId: null,
      threads,
      activeThreadId: null,
      messages: [],
    }))
  },

  async openThread(id) {
    const { projectId } = get()
    if (!projectId) return
    if (id === null) {
      set({ activeThreadId: null, messages: [] })
      return
    }
    const res = await fetch(`/api/projects/${projectId}/threads/${id}`)
    if (!res.ok) {
      throw new Error(await errorMessage(res, 'Could not load thread'))
    }
    const thread = (await readJson(res)) as Thread
    set({ activeThreadId: thread.id, messages: thread.messages })
  },

  async sendMessage(text) {
    const { projectId, activeThreadId, selectionId, streaming } = get()
    const trimmed = text.trim()
    if (!projectId || !trimmed || streaming) return

    const now = new Date().toISOString()
    const userMsg: ThreadMessage = { role: 'user', content: trimmed, at: now }
    const assistantMsg: ThreadMessage = { role: 'assistant', content: '', toolSummaries: [], at: now }
    set((s) => ({ messages: [...s.messages, userMsg, assistantMsg], streaming: true }))

    function updateLastAssistant(updater: (msg: ThreadMessage) => ThreadMessage) {
      set((s) => {
        const msgs = s.messages.slice()
        const last = msgs[msgs.length - 1]
        if (!last || last.role !== 'assistant') return {}
        msgs[msgs.length - 1] = updater(last)
        return { messages: msgs }
      })
    }

    function pushChip(text: string) {
      updateLastAssistant((m) => ({ ...m, toolSummaries: [...(m.toolSummaries ?? []), text] }))
    }

    const body: ChatRequest = { projectId, message: trimmed }
    if (activeThreadId) body.threadId = activeThreadId
    if (selectionId) body.selectionId = selectionId

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok || !res.body) {
        pushChip(`${ERROR_PREFIX}${await errorMessage(res, `Request failed (${res.status})`)}`)
        return
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buf = ''

      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })
        const lines = buf.split('\n')
        buf = lines.pop() ?? ''

        for (const line of lines) {
          const trimmedLine = line.trim()
          if (!trimmedLine.startsWith('data:')) continue
          const jsonStr = trimmedLine.slice(5).trim()
          if (!jsonStr) continue

          let evt: ChatEvent
          try {
            evt = JSON.parse(jsonStr) as ChatEvent
          } catch {
            continue
          }

          switch (evt.type) {
            case 'text_delta':
              updateLastAssistant((m) => ({ ...m, content: m.content + evt.text }))
              break
            case 'tool_start':
              if (MUTATING_TOOLS.has(evt.name)) pushChip(`${PENDING_PREFIX}${evt.summary}`)
              break
            case 'tool_done':
              if (MUTATING_TOOLS.has(evt.name)) {
                updateLastAssistant((m) => {
                  const arr = [...(m.toolSummaries ?? [])]
                  const lastIdx = arr.length - 1
                  const hasPending = lastIdx >= 0 && arr[lastIdx].startsWith(PENDING_PREFIX)
                  // Nothing applied means the call was rejected and the model will
                  // retry. The server keeps no chip for it, so neither do we —
                  // showing one reads as "your request failed" when it has not.
                  if (evt.changed === 0) {
                    if (hasPending) arr.splice(lastIdx, 1)
                    return { ...m, toolSummaries: arr }
                  }
                  // Prefer the server's compact chip so a live turn and a reloaded
                  // thread show identical text.
                  const finalText = evt.chip ?? `${glyphFor(evt.name)} ${evt.summary}`.trim()
                  if (hasPending) {
                    arr[lastIdx] = finalText
                  } else {
                    arr.push(finalText)
                  }
                  return { ...m, toolSummaries: arr }
                })
              }
              break
            case 'patch':
              get().applyPatchOps(evt.ops)
              break
            case 'credits':
              // The SSE event carries numbers only (lib/protocol.ts is a locked
              // contract), so whether the limit is off stays as loaded.
              set({
                credits: {
                  remaining: evt.remaining,
                  total: evt.total,
                  unlimited: get().credits.unlimited,
                },
              })
              break
            case 'error':
              pushChip(`${ERROR_PREFIX}${evt.message}`)
              break
            case 'done': {
              set({ activeThreadId: evt.threadId })
              // No standalone threads-list route — GET /api/projects/:id carries
              // { meta, tree, threads } together; pull just the refreshed threads.
              const projectRes = await fetch(`/api/projects/${projectId}`)
              if (projectRes.ok) {
                const data = (await readJson(projectRes)) as { threads?: ThreadSummary[] } | null
                if (data?.threads) set({ threads: data.threads })
              }
              break
            }
          }
        }
      }
    } catch (e) {
      pushChip(`${ERROR_PREFIX}${e instanceof Error ? e.message : 'Connection lost'}`)
    } finally {
      set({ streaming: false })
    }
  },
}))
