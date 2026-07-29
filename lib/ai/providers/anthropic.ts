// Anthropic (Claude) provider. Behaviour preserved from the original loop:
// a cached static system block, a volatile context block, and tool_use /
// tool_result blocks threaded through the messages array.

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

  return {
    provider: 'anthropic',
    model: init.model,

    async next({ signal, onText }): Promise<ProviderTurn> {
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
