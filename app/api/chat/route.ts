// B3 — SSE chat endpoint. One `data:` line per ChatEvent (lib/protocol.ts),
// flushed as it happens; `:` comment lines are heartbeats and are ignored by
// EventSource-style parsers.

import { runChat } from '@/lib/ai'
import type { ChatEvent, ChatRequest } from '@/lib/protocol'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const HEARTBEAT_MS = 15_000
const encoder = new TextEncoder()

export async function POST(request: Request) {
  let body: ChatRequest
  try {
    body = (await request.json()) as ChatRequest
  } catch {
    return Response.json({ error: 'Invalid JSON body.' }, { status: 400 })
  }

  if (
    !body ||
    typeof body.projectId !== 'string' ||
    body.projectId.length === 0 ||
    typeof body.message !== 'string'
  ) {
    return Response.json({ error: 'projectId and message are required.' }, { status: 400 })
  }

  // The client going away must actually cancel the model request.
  const abort = new AbortController()
  if (request.signal.aborted) {
    abort.abort()
  } else {
    request.signal.addEventListener('abort', () => abort.abort(), { once: true })
  }

  let closed = false
  let heartbeat: ReturnType<typeof setInterval> | undefined

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const write = (chunk: string) => {
        if (closed) return
        try {
          controller.enqueue(encoder.encode(chunk))
        } catch {
          closed = true // consumer went away mid-write
        }
      }
      const emit = (event: ChatEvent) => write(`data: ${JSON.stringify(event)}\n\n`)

      write(': open\n\n')
      heartbeat = setInterval(() => write(': ping\n\n'), HEARTBEAT_MS)

      try {
        await runChat(body, emit, { signal: abort.signal })
      } catch (err) {
        emit({ type: 'error', message: err instanceof Error ? err.message : String(err) })
      } finally {
        clearInterval(heartbeat)
        if (!closed) {
          closed = true
          try {
            controller.close()
          } catch {
            // already closed by the consumer
          }
        }
      }
    },
    cancel() {
      closed = true
      if (heartbeat) clearInterval(heartbeat)
      abort.abort()
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-store, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
}
