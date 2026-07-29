// The AI loop. Server-only.
//
// runChat streams ChatEvents (lib/protocol.ts) while driving a model tool-use
// loop. Every tool call is mapped to PatchOps, validated against the official
// Roblox API dump, applied to the tree, persisted, and mirrored to the client as
// a `patch` event so the viewer and file tree stay in step.
//
// The model vendor lives entirely behind ./provider — nothing below this import
// block knows whether Claude or GPT is answering.

import type { ChatEvent, ChatRequest, Thread } from '@/lib/protocol'
import type { PatchOp, RbxTree } from '@/lib/rbx/types'
import { applyPatchOps, getInstances, outline } from '@/lib/rbx/tree'
import { loadReflection, validateOps } from '@/lib/rbx/validate'
import {
  getCredits,
  getProject,
  getThread,
  getTree,
  saveThread,
  saveTree,
  spendCredit,
} from '@/lib/store'

import { describeApplied, createdFrom, mapToolCall } from './execute'
import { STATIC_SYSTEM_PROMPT, buildContextPrompt } from './prompt'
import { MISSING_KEY_MESSAGE, createSession, selectProvider } from './provider'
import type { ProviderToolResult } from './providers/types'

/** Hard stop so a confused model cannot loop forever on one credit. */
const MAX_TOOL_ROUNDS = 24
/** Streaming, so no HTTP-timeout ceiling — this is headroom for big batches. */
const MAX_TOKENS = 32_000
/** How many past thread messages we replay as conversation context. */
const MAX_HISTORY_MESSAGES = 40
const TITLE_LENGTH = 40

type Reflection = Awaited<ReturnType<typeof loadReflection>>

let reflectionCache: Promise<Reflection> | null = null

function getReflection(): Promise<Reflection> {
  if (!reflectionCache) {
    reflectionCache = loadReflection().catch((err) => {
      reflectionCache = null // let the next turn retry after `npm run setup`
      throw err
    })
  }
  return reflectionCache
}

export interface RunChatOptions {
  /** Aborts the in-flight model request when the client disconnects. */
  signal?: AbortSignal
}

export async function runChat(
  req: ChatRequest,
  emit: (e: ChatEvent) => void,
  opts: RunChatOptions = {},
): Promise<void> {
  const provider = selectProvider()
  if (!provider) {
    emit({ type: 'error', message: MISSING_KEY_MESSAGE })
    return
  }

  const message = (req.message ?? '').trim()
  if (!message) {
    emit({ type: 'error', message: 'Empty message.' })
    return
  }

  // ---- project + tree ----------------------------------------------------
  let tree: RbxTree
  let projectName: string
  try {
    const [project, loaded] = await Promise.all([getProject(req.projectId), getTree(req.projectId)])
    projectName = project.name
    tree = loaded
  } catch (err) {
    emit({ type: 'error', message: errorMessage(err) })
    return
  }

  // ---- credits (checked before the model is ever called) -----------------
  let credits: { remaining: number; total: number }
  try {
    credits = await getCredits()
  } catch (err) {
    emit({ type: 'error', message: errorMessage(err) })
    return
  }
  if (credits.remaining <= 0) {
    emit({ type: 'error', message: 'Out of free credits for today.' })
    emit({ type: 'credits', remaining: credits.remaining, total: credits.total })
    return
  }

  // Loaded before the credit is spent: a missing API dump is a setup problem,
  // not something the user should pay a credit for.
  let reflection: Reflection
  try {
    reflection = await getReflection()
  } catch (err) {
    emit({ type: 'error', message: errorMessage(err) })
    return
  }

  try {
    credits = await spendCredit()
  } catch (err) {
    emit({ type: 'error', message: errorMessage(err) })
    return
  }

  // ---- thread ------------------------------------------------------------
  const now = new Date().toISOString()
  let thread: Thread | null = null
  if (req.threadId) {
    try {
      thread = await getThread(req.projectId, req.threadId)
    } catch {
      thread = null
    }
  }
  if (!thread) {
    thread = {
      id: req.threadId ?? crypto.randomUUID(),
      title: truncateTitle(message),
      createdAt: now,
      messages: [],
    }
  }

  // ---- prompt ------------------------------------------------------------
  const selection = req.selectionId ? (getInstances(tree, [req.selectionId])[0] ?? null) : null

  // Baseline for outline de-duplication below. Taken through mapToolCall so it
  // is byte-identical to what get_tree_outline would return: the model is handed
  // the outline in its context, so an immediate re-read is pure cost.
  let lastOutlineSent =
    (mapToolCall('get_tree_outline', {}, tree).readResult?.outline as string | undefined) ?? ''

  const session = createSession(provider, {
    staticPrompt: STATIC_SYSTEM_PROMPT,
    contextPrompt: buildContextPrompt({
      projectName,
      treeOutline: outline(tree),
      selection,
    }),
    history: thread.messages.slice(-MAX_HISTORY_MESSAGES).map((past) => ({
      role: past.role,
      content: past.content,
    })),
    message,
    maxTokens: MAX_TOKENS,
    // Same project -> same cached prefix on providers that key their cache.
    cacheKey: `bloxable:${req.projectId}`,
  })

  // ---- the loop ----------------------------------------------------------
  const chips: string[] = []
  let assistantText = ''
  let round = 0
  let exhausted = false

  for (;;) {
    if (round >= MAX_TOOL_ROUNDS) {
      exhausted = true
      break
    }
    round += 1

    let turn
    try {
      turn = await session.next({
        signal: opts.signal,
        onText: (delta) => {
          assistantText += delta
          emit({ type: 'text_delta', text: delta })
        },
      })
    } catch (err) {
      emit({ type: 'error', message: errorMessage(err) })
      break
    }

    if (turn.stop === 'aborted') break

    if (turn.stop === 'refusal') {
      emit({
        type: 'error',
        message: turn.refusalMessage ?? 'The model declined this request.',
      })
      break
    }

    if (turn.stop === 'max_tokens') {
      // A tool call truncated mid-JSON must not be executed.
      emit({ type: 'error', message: 'Response hit the length limit — ask for a smaller step.' })
      break
    }

    if (turn.toolCalls.length === 0) break

    const results: ProviderToolResult[] = []
    for (const call of turn.toolCalls) {
      const treeBefore = tree
      const mapped = mapToolCall(call.name, call.input, tree, reflection)
      emit({ type: 'tool_start', name: call.name, summary: mapped.activity })

      const errors = [...mapped.errors]
      let applied: PatchOp[] = []

      if (mapped.ops.length > 0) {
        const validated = validateOps(reflection, tree, mapped.ops)
        errors.push(...validated.errors)
        if (validated.ok.length > 0) {
          const result = applyPatchOps(tree, validated.ok)
          errors.push(...result.errors)
          tree = result.tree
          applied = validated.ok
          try {
            await saveTree(req.projectId, tree)
          } catch (err) {
            errors.push(errorMessage(err))
          }
          emit({ type: 'patch', ops: validated.ok })
        }
      }

      // A wholly-rejected call is invisible to the user (the model just retries),
      // so log why — otherwise an intermittent validator mismatch is undiagnosable.
      if (applied.length === 0 && errors.length > 0) {
        console.warn(`[bloxable] ${call.name} applied nothing:`, errors.slice(0, 5).join(' | ').slice(0, 500))
      }
      const summary = describeApplied(call.name, applied, treeBefore)
      emit({
        type: 'tool_done',
        name: call.name,
        summary: summary.activity,
        chip: summary.chip ?? undefined,
        changed: applied.length,
      })
      if (summary.chip) chips.push(summary.chip)

      const created = createdFrom(applied)
      const readResult = { ...(mapped.readResult ?? {}) }
      // Re-sending an outline the model already has is pure cost: a big place is
      // several thousand tokens, and a build loop re-reads after every batch.
      if (typeof readResult.outline === 'string') {
        if (readResult.outline === lastOutlineSent) {
          readResult.outline = 'Unchanged since you last read it.'
        } else {
          lastOutlineSent = readResult.outline
        }
      }
      const payload: Record<string, unknown> = {
        ...readResult,
        ...(created.length > 0 ? { created } : {}),
      }
      if (mapped.ops.length > 0) payload.applied = applied.length
      if (errors.length > 0) payload.errors = errors

      results.push({
        id: call.id,
        payload,
        isError: errors.length > 0 && applied.length === 0,
      })
    }

    session.addToolResults(results)
  }

  if (exhausted) {
    emit({
      type: 'error',
      message: `Stopped after ${MAX_TOOL_ROUNDS} steps. Ask me to continue.`,
    })
  }

  // ---- persist + close ---------------------------------------------------
  const at = new Date().toISOString()
  thread.messages.push({ role: 'user', content: message, at: now })
  thread.messages.push({
    role: 'assistant',
    content: assistantText.trim(),
    ...(chips.length > 0 ? { toolSummaries: chips } : {}),
    at,
  })

  try {
    await saveThread(req.projectId, thread)
  } catch (err) {
    emit({ type: 'error', message: errorMessage(err) })
  }

  emit({ type: 'credits', remaining: credits.remaining, total: credits.total })
  emit({ type: 'done', threadId: thread.id })
}

function truncateTitle(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > TITLE_LENGTH ? `${flat.slice(0, TITLE_LENGTH - 1)}…` : flat
}

/** Surface upstream failures verbatim — never a friendly fiction. */
function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  return String(err)
}
