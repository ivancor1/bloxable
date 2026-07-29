// Anthropic (Claude) provider. A cached static system block, a volatile context
// block, and tool_use / tool_result blocks threaded through the messages array.
//
// Caching: the static system block is a fixed breakpoint, and a second
// breakpoint rides the end of the conversation and moves forward each round.
// Without the moving one, a 20-round build re-billed every earlier tool call and
// tool result at full input price on every single round.

import Anthropic, { APIUserAbortError } from '@anthropic-ai/sdk'

import { TOOLS } from '../tools'
import type { ProviderSession, ProviderToolResult, ProviderTurn, SessionInit } from './types'

export function createAnthropicSession(init: SessionInit): ProviderSession {
  const client = new Anthropic({ apiKey: init.apiKey })

  const system: Anthropic.TextBlockParam[] = [
    {
      type: 'text',
      text: init.staticPrompt,
      // Stable prefix: tools render first, then this block. Everything volatile
      // (outline, selection) sits after the breakpoint.
      cache_control: { type: 'ephemeral' },
    },
    { type: 'text', text: init.contextPrompt },
  ]

  const tools: Anthropic.Tool[] = TOOLS.map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.input_schema,
  }))

  const messages: Anthropic.MessageParam[] = []
  for (const past of init.history) {
    const content = past.content.trim()
    if (!content) continue
    messages.push({ role: past.role, content })
  }
  messages.push({ role: 'user', content: init.message })

  // Index of the message currently carrying the rolling cache breakpoint.
  let cacheMarker = -1

  /**
   * Moves the conversation cache breakpoint to the newest block-shaped message,
   * so each round reuses everything written before it. Anthropic allows four
   * breakpoints; this provider uses two (static system + here).
   */
  function rollCacheBreakpoint() {
    const clear = (index: number) => {
      const msg = messages[index]
      if (!msg || !Array.isArray(msg.content)) return
      for (const block of msg.content) {
        delete (block as { cache_control?: unknown }).cache_control
      }
    }

    const last = messages.length - 1
    if (last < 0) return
    const content = messages[last].content
    if (!Array.isArray(content) || content.length === 0) return

    if (cacheMarker >= 0 && cacheMarker !== last) clear(cacheMarker)
    ;(content[content.length - 1] as { cache_control?: { type: 'ephemeral' } }).cache_control = {
      type: 'ephemeral',
    }
    cacheMarker = last
  }

  return {
    provider: 'anthropic',
    model: init.model,

    async next({ signal, onText }): Promise<ProviderTurn> {
      rollCacheBreakpoint()

      let streamed = ''
      let final: Anthropic.Message
      try {
        const stream = client.messages.stream(
          { model: init.model, max_tokens: init.maxTokens, system, tools, messages },
          { signal },
        )
        stream.on('text', (delta) => {
          streamed += delta
          onText(delta)
        })
        final = await stream.finalMessage()
      } catch (err) {
        if (err instanceof APIUserAbortError || signal?.aborted) {
          return { text: streamed, toolCalls: [], stop: 'aborted' }
        }
        throw err
      }

      if (final.stop_reason === 'refusal') {
        return {
          text: streamed,
          toolCalls: [],
          stop: 'refusal',
          refusalMessage: final.stop_details?.explanation ?? undefined,
        }
      }
      // A tool call truncated mid-JSON must never be executed.
      if (final.stop_reason === 'max_tokens') {
        return { text: streamed, toolCalls: [], stop: 'max_tokens' }
      }

      messages.push({ role: 'assistant', content: final.content })

      const toolCalls = final.content
        .filter((block): block is Anthropic.ToolUseBlock => block.type === 'tool_use')
        .map((block) => ({ id: block.id, name: block.name, input: block.input }))

      return {
        text: streamed,
        toolCalls,
        stop: toolCalls.length > 0 ? 'tool_calls' : 'end',
      }
    },

    addToolResults(results: ProviderToolResult[]) {
      messages.push({
        role: 'user',
        content: results.map((result) => ({
          type: 'tool_result' as const,
          tool_use_id: result.id,
          content: JSON.stringify(result.payload),
          is_error: result.isError,
        })),
      })
    },
  }
}

