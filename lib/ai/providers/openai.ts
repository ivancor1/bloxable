// OpenAI provider.
//
// Uses Chat Completions rather than the Responses API. Both were probed live
// against gpt-5.5 and both stream text and tool calls correctly, but Chat
// Completions is stateless by construction: its assistant-with-tool_calls /
// role:"tool" result shape maps 1:1 onto this app's loop, whereas threading
// rounds through the Responses API without leaving conversations stored on
// OpenAI's servers requires passing encrypted reasoning items back and forth.
//
// Parameters below were verified against the live API, not assumed:
//   - `max_tokens` is REJECTED (400) — current models require `max_completion_tokens`.
//   - `temperature` is REJECTED (400) for any value but the default, so it is not sent.
//
// Caching: OpenAI caches on an exact prefix match of the request, so the static
// prompt and the volatile per-turn context (outline, selection) are sent as TWO
// system messages, static first. Concatenating them — which this file used to do
// — put a string that changes every turn at position zero and made every request
// a cache miss, re-billing the whole system prompt and tool schemas each round.
// `prompt_cache_key` keeps turns of the same project on the same cache.

import OpenAI, { APIUserAbortError } from 'openai'

import { TOOLS } from '../tools'
import type { ProviderSession, ProviderToolCall, ProviderToolResult, ProviderTurn, SessionInit } from './types'

type Message = OpenAI.Chat.Completions.ChatCompletionMessageParam

/** Accumulator for one streamed tool call; arguments arrive as JSON fragments. */
interface PartialCall {
  id: string
  name: string
  args: string
}

export function createOpenAISession(init: SessionInit): ProviderSession {
  const client = new OpenAI({ apiKey: init.apiKey })

  const tools: OpenAI.Chat.Completions.ChatCompletionTool[] = TOOLS.map((tool) => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      // Non-strict function tools: the canonical schemas stay untouched.
      parameters: tool.input_schema as Record<string, unknown>,
    },
  }))

  const messages: Message[] = [
    { role: 'system', content: init.staticPrompt },
    { role: 'system', content: init.contextPrompt },
  ]
  for (const past of init.history) {
    const content = past.content.trim()
    if (!content) continue
    messages.push({ role: past.role, content })
  }
  messages.push({ role: 'user', content: init.message })

  return {
    provider: 'openai',
    model: init.model,

    async next({ signal, onText }): Promise<ProviderTurn> {
      let text = ''
      let refusal = ''
      let finish: string | null = null
      const partial = new Map<number, PartialCall>()

      try {
        const stream = await client.chat.completions.create(
          {
            model: init.model,
            stream: true,
            messages,
            tools,
            max_completion_tokens: init.maxTokens,
            // Privacy: never let OpenAI store this completion for its
            // distillation/evals products. `false` is the documented default
            // for Chat Completions, but the user's project content is in this
            // request, so the opt-out is stated rather than assumed.
            store: false,
            ...(init.cacheKey ? { prompt_cache_key: init.cacheKey } : {}),
          },
          { signal },
        )

        for await (const chunk of stream) {
          const choice = chunk.choices?.[0]
          if (!choice) continue

          const delta = choice.delta
          if (delta?.content) {
            text += delta.content
            onText(delta.content)
          }
          if (delta?.refusal) refusal += delta.refusal

          for (const call of delta?.tool_calls ?? []) {
            const slot = partial.get(call.index) ?? { id: '', name: '', args: '' }
            if (call.id) slot.id = call.id
            if (call.function?.name) slot.name = call.function.name
            if (call.function?.arguments) slot.args += call.function.arguments
            partial.set(call.index, slot)
          }

          if (choice.finish_reason) finish = choice.finish_reason
        }
      } catch (err) {
        if (err instanceof APIUserAbortError || signal?.aborted) {
          return { text, toolCalls: [], stop: 'aborted' }
        }
        throw err
      }

      if (refusal) {
        return { text, toolCalls: [], stop: 'refusal', refusalMessage: refusal }
      }
      // Truncated output means a tool call may be cut mid-JSON — never execute it.
      if (finish === 'length') {
        return { text, toolCalls: [], stop: 'max_tokens' }
      }

      const raw = [...partial.entries()].sort(([a], [b]) => a - b).map(([, call]) => call)

      messages.push({
        role: 'assistant',
        content: text || null,
        ...(raw.length > 0
          ? {
              tool_calls: raw.map((call) => ({
                id: call.id,
                type: 'function' as const,
                function: { name: call.name, arguments: call.args },
              })),
            }
          : {}),
      })

      const toolCalls: ProviderToolCall[] = raw.map((call) => ({
        id: call.id,
        name: call.name,
        // Malformed JSON becomes an empty input: the tool mapper then reports
        // the missing fields and the model self-corrects on the next round.
        input: parseArgs(call.args),
      }))

      return {
        text,
        toolCalls,
        stop: toolCalls.length > 0 ? 'tool_calls' : 'end',
      }
    },

    addToolResults(results: ProviderToolResult[]) {
      for (const result of results) {
        messages.push({
          role: 'tool',
          tool_call_id: result.id,
          content: JSON.stringify(result.payload),
        })
      }
    },
  }
}

function parseArgs(args: string): unknown {
  if (!args.trim()) return {}
  try {
    return JSON.parse(args)
  } catch {
    return {}
  }
}

