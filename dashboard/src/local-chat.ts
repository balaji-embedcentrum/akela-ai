/**
 * Browser-direct local agent chat.
 *
 * When an agent runs on the user's laptop (localhost), the browser calls
 * its /v1/chat/completions endpoint directly instead of going through the
 * Akela API server. This module handles:
 *
 *   1. Streaming fetch to the local endpoint
 *   2. SSE line parsing (data: ... / [DONE])
 *   3. Chunk extraction (content deltas, tool_use, usage)
 *   4. localStorage persistence for local agent configs
 *
 * The remote path (server → endpoint_caller → agent) is completely
 * untouched. This module is never imported by any server-side code.
 */

// ── Types ────────────────────────────────────────────────────────────

export interface LocalAgentConfig {
  localEndpointUrl: string
  localBearerToken?: string
}

export interface LocalStreamChunk {
  type: 'content' | 'tool_use' | 'done'
  text?: string
  toolName?: string
  preview?: string
  usage?: Record<string, unknown>
  model?: string
}

// ── localStorage helpers ─────────────────────────────────────────────

const STORAGE_KEY = 'akela_local_agents'

export function getAllLocalConfigs(): Record<string, LocalAgentConfig> {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}')
  } catch {
    return {}
  }
}

export function getLocalConfig(agentName: string): LocalAgentConfig | null {
  const all = getAllLocalConfigs()
  return all[agentName] || null
}

export function setLocalConfig(agentName: string, config: LocalAgentConfig | null): Record<string, LocalAgentConfig> {
  const all = getAllLocalConfigs()
  if (config) {
    all[agentName] = config
  } else {
    delete all[agentName]
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(all))
  return all
}

// ── Streaming chat ───────────────────────────────────────────────────

/**
 * Call a local agent's /v1/chat/completions endpoint with streaming,
 * yielding parsed chunks as they arrive.
 *
 * The caller (Den.tsx) renders each chunk into the streaming message
 * bubble, then calls /chat/relay to persist the final text.
 */
export async function* streamLocalChat(
  config: LocalAgentConfig,
  messages: Array<{ role: string; content: string }>,
  signal?: AbortSignal,
): AsyncGenerator<LocalStreamChunk, void, void> {
  const url = `${config.localEndpointUrl.replace(/\/+$/, '')}/v1/chat/completions`

  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (config.localBearerToken) {
    headers['Authorization'] = `Bearer ${config.localBearerToken}`
  }

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({ messages, stream: true }),
    signal,
  })

  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(`Local agent ${response.status}: ${text.slice(0, 200)}`)
  }

  const reader = response.body?.getReader()
  if (!reader) throw new Error('No response body from local agent')

  const decoder = new TextDecoder()
  let buffer = ''
  let usage: Record<string, unknown> = {}
  let model = ''

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })

      // Process complete lines
      let newlineIdx = buffer.indexOf('\n')
      while (newlineIdx >= 0) {
        const line = buffer.slice(0, newlineIdx).trim()
        buffer = buffer.slice(newlineIdx + 1)

        if (!line.startsWith('data:')) {
          newlineIdx = buffer.indexOf('\n')
          continue
        }

        const payload = line.slice(5).trim()
        if (!payload || payload === '[DONE]') {
          newlineIdx = buffer.indexOf('\n')
          continue
        }

        try {
          const chunk = JSON.parse(payload) as {
            choices?: Array<{
              delta?: {
                content?: string | null
                tool_use?: { name?: string; preview?: string }
                tool_calls?: Array<{ function?: { name?: string } }>
              }
            }>
            usage?: Record<string, unknown>
            model?: string
          }

          if (chunk.usage) usage = chunk.usage
          if (chunk.model && !model) model = chunk.model

          const delta = chunk.choices?.[0]?.delta
          if (!delta) {
            newlineIdx = buffer.indexOf('\n')
            continue
          }

          // Hermes-specific tool_use format
          if (delta.tool_use) {
            yield {
              type: 'tool_use',
              toolName: delta.tool_use.name || '',
              preview: delta.tool_use.preview || '',
            }
          }
          // Standard OpenAI tool_calls format
          else if (delta.tool_calls) {
            for (const tc of delta.tool_calls) {
              const name = tc.function?.name
              if (name) {
                yield { type: 'tool_use', toolName: name, preview: '' }
              }
            }
          }
          // Content chunk
          else if (delta.content) {
            yield { type: 'content', text: delta.content }
          }
        } catch {
          // Skip malformed JSON chunks
        }

        newlineIdx = buffer.indexOf('\n')
      }
    }
  } finally {
    reader.releaseLock()
  }

  // Final chunk with accumulated usage stats
  yield { type: 'done', usage, model }
}

// ── History builder (mirrors server-side build_history) ──────────────

/**
 * Build an OpenAI-compatible message history from the current room's
 * messages. Mirrors the server-side build_history logic:
 *
 *   - Alpha messages → user role
 *   - This agent's messages → assistant role
 *   - Other agents → skipped (private bubble model)
 *   - Consecutive same-role turns merged by concatenation
 *   - Leading assistant turns dropped
 *   - Limited to last N messages
 */
export function buildLocalHistory(
  messages: Array<{ sender_role: string; sender_name: string; content: string }>,
  agentName: string,
  limit = 6,
): Array<{ role: string; content: string }> {
  // Take the last `limit` raw messages from the room
  const recent = messages.slice(-limit)

  const raw: Array<{ role: string; content: string }> = []
  for (const m of recent) {
    const content = (m.content || '').trim()
    if (!content) continue

    if (m.sender_role === 'alpha') {
      raw.push({ role: 'user', content })
    } else if (m.sender_role === 'agent' && m.sender_name === agentName) {
      raw.push({ role: 'assistant', content })
    }
    // Other agents and system messages: skipped (private bubble)
  }

  // Merge consecutive same-role turns
  const history: Array<{ role: string; content: string }> = []
  for (const turn of raw) {
    if (history.length > 0 && history[history.length - 1].role === turn.role) {
      history[history.length - 1].content += '\n\n' + turn.content
    } else {
      history.push({ ...turn })
    }
  }

  // Drop leading assistant turns
  while (history.length > 0 && history[0].role === 'assistant') {
    history.shift()
  }

  return history
}
