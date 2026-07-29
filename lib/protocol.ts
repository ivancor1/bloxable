// LOCKED CONTRACT — manager-authored. SSE + storage shapes shared by the chat
// route (B3), persistence (B2), and the shell UI (B5).

import type { PatchOp } from './rbx/types'

/** Server → client events on the /api/chat SSE stream. */
export type ChatEvent =
  | { type: 'text_delta'; text: string }
  /** Human-readable activity, e.g. "Adding 14 parts to Workspace". */
  | { type: 'tool_start'; name: string; summary: string }
  /**
   * `chip` is the compact transcript label ("+ 14 parts · Workspace") — the same
   * text persisted to the thread, so a live turn and a reloaded one read alike.
   * `changed` is how many ops actually applied; 0 means the call was rejected and
   * the model will retry, so the UI must not present it as a result.
   */
  | { type: 'tool_done'; name: string; summary: string; chip?: string; changed?: number }
  /** Applied to the client store immediately; viewer and file tree react. */
  | { type: 'patch'; ops: PatchOp[] }
  | { type: 'credits'; remaining: number; total: number }
  /** Honest errors, including verbatim Roblox/Anthropic API failures. */
  | { type: 'error'; message: string }
  | { type: 'done'; threadId: string }

export interface ChatRequest {
  projectId: string
  /** Absent → server creates a new thread and returns its id in `done`. */
  threadId?: string
  message: string
  /** Selected instance id — gives the AI the user's "this" context. */
  selectionId?: string
}

export interface ThreadMessage {
  role: 'user' | 'assistant'
  content: string
  /** Chip lines rendered in the transcript, e.g. "+ 14 parts · Workspace". */
  toolSummaries?: string[]
  at: string // ISO 8601
}

export interface Thread {
  id: string
  /** Auto: first user message, truncated. */
  title: string
  createdAt: string
  messages: ThreadMessage[]
}

export interface ThreadSummary {
  id: string
  title: string
  createdAt: string
}
