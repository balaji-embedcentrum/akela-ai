/**
 * <LocalTaskWorker /> — browser-resident Hunt task dispatcher for local agents.
 *
 * Hunt tasks assigned to agents with protocol='local' can't be dispatched
 * server-side because their endpoint URL lives only in this browser's
 * localStorage. Instead, the API server publishes Redis events that a
 * dashboard-side SSE endpoint forwards to us; we then call the user's
 * local agent directly and post the streamed response back to Akela.
 *
 *   server publishes → /api/hunt/local/subscribe (SSE)
 *                    → this worker receives task_assigned
 *                    → fetches localStorage[agentName] → {url, bearer}
 *                    → POST  url/   with A2A message/stream
 *                    → relays deltas to /api/hunt/local/tasks/{id}/events
 *                    → on terminal state: /api/hunt/local/tasks/{id}/done
 *
 * The worker renders nothing. Mount it once somewhere that lives for the
 * whole authenticated session (e.g. inside <ProtectedLayout />).
 *
 * Known v1 limitations (tracked upstream):
 *   - No multi-tab claim lock — two open Akela tabs will both run the task
 *     (akela-ai#12).
 *   - No cancel / retry / resume hooks (akela-ai#13).
 */

import { useEffect, useRef } from 'react'
import { useStore } from '../store'
import { getLocalConfig } from '../local-chat'

const API_BASE =
  import.meta.env.VITE_API_URL ||
  (import.meta.env.DEV ? 'http://localhost:8200' : '')

type TaskAssignedEvent = {
  task_id: string
  agent_id: string
  agent_name: string
  task_title: string
  task_description: string
  dispatch_content: string
  room: string
}

/** Artifact delta / tool_call event. Sent at most once every 400ms. */
async function postProgressEvent(
  taskId: string,
  token: string,
  body: { artifact_text?: string; tool_call?: string; seq: number },
): Promise<void> {
  try {
    await fetch(`${API_BASE}/api/hunt/local/tasks/${taskId}/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    })
  } catch (err) {
    // Progress events are best-effort — failures don't abort the task.
    console.warn('[LocalTaskWorker] /events failed:', err)
  }
}

async function postDone(
  taskId: string,
  token: string,
  body: { state: string; final_text: string; error?: string },
): Promise<void> {
  try {
    await fetch(`${API_BASE}/api/hunt/local/tasks/${taskId}/done`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    })
  } catch (err) {
    console.error('[LocalTaskWorker] /done failed:', err)
  }
}

/**
 * Call the user's local agent with A2A message/stream and relay its
 * SSE output back to Akela via /events + /done.
 */
async function executeTask(evt: TaskAssignedEvent, token: string): Promise<void> {
  const config = getLocalConfig(evt.agent_name)
  if (!config?.localEndpointUrl) {
    await postDone(evt.task_id, token, {
      state: 'failed',
      final_text: '',
      error: `No local endpoint URL configured for '${evt.agent_name}' in this browser.`,
    })
    return
  }

  const baseUrl = config.localEndpointUrl.replace(/\/+$/, '')
  const prompt = evt.task_description
    ? `${evt.task_title}\n\n${evt.task_description}`
    : evt.task_title

  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (config.localBearerToken) {
    headers.Authorization = `Bearer ${config.localBearerToken}`
  }

  const payload = {
    jsonrpc: '2.0',
    id: crypto.randomUUID(),
    method: 'message/stream',
    params: {
      message: {
        messageId: crypto.randomUUID(),
        role: 'user',
        parts: [{ type: 'text', text: prompt }],
      },
      contextId: evt.task_id,
      taskId: evt.task_id,
    },
  }

  let resp: Response
  try {
    resp = await fetch(baseUrl + '/', {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    })
  } catch (err: any) {
    await postDone(evt.task_id, token, {
      state: 'failed',
      final_text: '',
      error: `Cannot reach local agent at ${baseUrl}: ${err?.message || err}`,
    })
    return
  }

  if (!resp.ok) {
    const text = await resp.text().catch(() => '')
    await postDone(evt.task_id, token, {
      state: 'failed',
      final_text: '',
      error: `Local agent HTTP ${resp.status}: ${text.slice(0, 300)}`,
    })
    return
  }

  const contentType = resp.headers.get('content-type') || ''
  const reader = resp.body?.getReader()
  if (!reader) {
    await postDone(evt.task_id, token, {
      state: 'failed',
      final_text: '',
      error: 'Local agent returned no response body.',
    })
    return
  }

  const decoder = new TextDecoder()
  let buffer = ''
  let accumulated = ''
  let terminalState: string | null = null
  let lastProgressAt = 0
  let seq = 0

  // Non-streaming fallback: local agent replied with a plain JSON-RPC
  // response (because it doesn't implement message/stream). Parse the
  // final artifact, post it, done.
  if (!contentType.includes('text/event-stream')) {
    const bodyText = await new Response(resp.body as any).text()
    try {
      const data = JSON.parse(bodyText)
      const artifacts = data?.result?.artifacts || []
      for (const a of artifacts) {
        for (const p of a.parts || []) {
          if ((p.kind === 'text' || p.type === 'text') && p.text) {
            accumulated += p.text
          }
        }
      }
      await postDone(evt.task_id, token, {
        state: 'completed',
        final_text: accumulated || bodyText.slice(0, 500),
      })
    } catch (err: any) {
      await postDone(evt.task_id, token, {
        state: 'failed',
        final_text: '',
        error: `Could not parse local agent response: ${err?.message}`,
      })
    }
    return
  }

  // Streaming path: parse A2A v0.4.x JSON-RPC envelopes from SSE.
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })

    let idx: number
    while ((idx = buffer.indexOf('\n\n')) >= 0) {
      const frame = buffer.slice(0, idx)
      buffer = buffer.slice(idx + 2)

      for (const line of frame.split('\n')) {
        if (!line.startsWith('data:')) continue
        const dataStr = line.slice(5).trim()
        if (!dataStr) continue
        let env: any
        try {
          env = JSON.parse(dataStr)
        } catch {
          continue
        }
        const result = env?.result
        if (!result) continue

        if (result.artifact) {
          for (const part of result.artifact.parts || []) {
            if (part.kind === 'text' || part.type === 'text') {
              accumulated = part.text || accumulated
            } else if (part.kind === 'data' && part.data?.type === 'tool_call') {
              const now = performance.now()
              if (now - lastProgressAt > 400) {
                lastProgressAt = now
                void postProgressEvent(evt.task_id, token, {
                  tool_call: part.data.name,
                  seq: seq++,
                })
              }
            }
          }
          const now = performance.now()
          if (accumulated && now - lastProgressAt > 400) {
            lastProgressAt = now
            void postProgressEvent(evt.task_id, token, {
              artifact_text: accumulated,
              seq: seq++,
            })
          }
        }

        if (result.status?.state) {
          const state = result.status.state
          if (state === 'completed' || state === 'failed' || state === 'cancelled') {
            terminalState = state
          }
        }
      }
    }
  }

  await postDone(evt.task_id, token, {
    state: terminalState || 'completed',
    final_text: accumulated,
    error: terminalState === 'failed' ? 'Agent reported failure.' : '',
  })
}


export function LocalTaskWorker() {
  const token = useStore(s => s.token)
  const activeRef = useRef<Set<string>>(new Set())

  useEffect(() => {
    if (!token) return

    const abort = new AbortController()
    let reconnectTimer: number | undefined

    const connect = async () => {
      try {
        const resp = await fetch(`${API_BASE}/api/hunt/local/subscribe`, {
          headers: { Authorization: `Bearer ${token}` },
          signal: abort.signal,
        })
        if (!resp.ok || !resp.body) {
          throw new Error(`subscribe HTTP ${resp.status}`)
        }

        const reader = resp.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''

        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })

          let idx: number
          while ((idx = buffer.indexOf('\n\n')) >= 0) {
            const frame = buffer.slice(0, idx)
            buffer = buffer.slice(idx + 2)
            if (frame.startsWith(':')) continue // keepalive

            let eventName = 'message'
            let dataLine = ''
            for (const line of frame.split('\n')) {
              if (line.startsWith('event:')) eventName = line.slice(6).trim()
              else if (line.startsWith('data:')) dataLine += line.slice(5).trim()
            }
            if (eventName !== 'task_assigned' || !dataLine) continue

            let evt: TaskAssignedEvent
            try {
              evt = JSON.parse(dataLine)
            } catch {
              continue
            }

            // De-dupe if the same tab receives the event twice within
            // one SSE session (e.g. Redis re-delivery).
            if (activeRef.current.has(evt.task_id)) continue
            activeRef.current.add(evt.task_id)
            console.info('[LocalTaskWorker] picked up', evt.task_id, 'for', evt.agent_name)

            void executeTask(evt, token).finally(() => {
              activeRef.current.delete(evt.task_id)
            })
          }
        }
      } catch (err: any) {
        if (abort.signal.aborted) return
        console.warn('[LocalTaskWorker] stream error, reconnecting in 5s:', err?.message)
        reconnectTimer = window.setTimeout(connect, 5000)
      }
    }

    void connect()

    return () => {
      abort.abort()
      if (reconnectTimer !== undefined) window.clearTimeout(reconnectTimer)
    }
  }, [token])

  return null
}
