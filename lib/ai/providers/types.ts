// Provider-neutral shapes for the chat loop.
//
// lib/ai/index.ts owns all orchestration (rounds, validation, patch emission,
// persistence) and never sees a vendor SDK type. A provider owns exactly one
// thing: turning "the conversation so far" into "the next assistant turn",
// including its own wire-format conversation buffer.

/** One tool call the model wants executed, with its arguments already parsed. */
export interface ProviderToolCall {
  id: string
  name: string
  /** Parsed JSON arguments; `{}` when the model emitted unparseable JSON. */
  input: unknown
}

export type TurnStop = 'end' | 'tool_calls' | 'max_tokens' | 'refusal' | 'aborted'

export interface ProviderTurn {
  /** Full assistant text for this turn (also streamed via onText as it arrives). */
  text: string
  toolCalls: ProviderToolCall[]
  stop: TurnStop
  /** Present when stop === 'refusal'. */
  refusalMessage?: string
}

/** Result of executing one tool call, fed back so the model can self-correct. */
export interface ProviderToolResult {
  id: string
  payload: unknown
  isError: boolean
}

export interface SessionInit {
  apiKey: string
  model: string
  /** Stable prefix — cached by providers that support it. */
  staticPrompt: string
  /** Volatile per-turn context (tree outline, selection). */
  contextPrompt: string
  /** Prior turns of this thread, replayed as plain text. */
  history: { role: 'user' | 'assistant'; content: string }[]
  /** The message being answered now. */
  message: string
  maxTokens: number
  /**
   * Stable per-project key so the provider's prompt cache routes repeat turns of
   * the same project to the same cached prefix. Optional: providers that do not
   * take a cache key ignore it.
   */
  cacheKey?: string
}

export interface ProviderSession {
  readonly provider: 'anthropic' | 'openai'
  readonly model: string
  /** Streams one assistant turn and records it in the conversation buffer. */
  next(opts: { signal?: AbortSignal; onText: (delta: string) => void }): Promise<ProviderTurn>
  /** Appends tool results for the next call to next(). */
  addToolResults(results: ProviderToolResult[]): void
}

