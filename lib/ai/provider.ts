// Which model provider runs the chat loop, decided by the key that is present.
// Server-only.

import { CLAUDE_MODEL, OPENAI_MODEL_DEFAULT } from '@/lib/config'

import { createAnthropicSession } from './providers/anthropic'
import { createOpenAISession } from './providers/openai'
import type { ProviderSession, SessionInit } from './providers/types'

export const MISSING_KEY_MESSAGE =
  'No AI key found — add OPENAI_API_KEY (or ANTHROPIC_API_KEY) to .env.local and restart.'

export interface ProviderChoice {
  kind: 'openai' | 'anthropic'
  apiKey: string
  model: string
}

type Env = Record<string, string | undefined>

/** OpenAI wins when both keys are set. Returns null when neither is configured. */
export function selectProvider(env: Env = process.env): ProviderChoice | null {
  const openaiKey = env.OPENAI_API_KEY?.trim()
  if (openaiKey) {
    return {
      kind: 'openai',
      apiKey: openaiKey,
      model: env.OPENAI_MODEL?.trim() || OPENAI_MODEL_DEFAULT,
    }
  }

  const anthropicKey = env.ANTHROPIC_API_KEY?.trim()
  if (anthropicKey) {
    return {
      kind: 'anthropic',
      apiKey: anthropicKey,
      model: env.ANTHROPIC_MODEL?.trim() || CLAUDE_MODEL,
    }
  }

  return null
}

export function createSession(
  choice: ProviderChoice,
  init: Omit<SessionInit, 'apiKey' | 'model'>,
): ProviderSession {
  const full: SessionInit = { ...init, apiKey: choice.apiKey, model: choice.model }
  return choice.kind === 'openai' ? createOpenAISession(full) : createAnthropicSession(full)
}
