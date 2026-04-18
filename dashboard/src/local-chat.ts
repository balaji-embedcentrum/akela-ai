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

// ── Protocol detection ───────────────────────────────────────────────

/** Cached protocol per endpoint URL so we don't probe on every message. */
const _protocolCache = new Map<string, 'a2a' | 'openai'>()

/**
 * Detect whether the local agent speaks A2A (JSON-RPC) or OpenAI
 * (/v1/chat/completions). Probes /.well-known/agent.json first — if
 * it exists, this is an A2A agent. Otherwise falls back to OpenAI.
 * Result is cached for the lifetime of the page.
 */
async function detectProtocol(baseUrl: string, headers: Record<string, string>): Promise<'a2a' | 'openai'> {
  const cached = _protocolCache.get(baseUrl)
  if (cached) return cached

  try {
    const res = await fetch(`${baseUrl}/.well-known/agent.json`, {
      headers, signal: AbortSignal.timeout(3000),
    })
    if (res.ok) {
      _protocolCache.set(baseUrl, 'a2a')
      return 'a2a'
    }
  } catch { /* not A2A */ }

  // Also try agent-card.json (A2A SDK 0.3.x)
  try {
    const res = await fetch(`${baseUrl}/.well-known/agent-card.json`, {
      headers, signal: AbortSignal.timeout(3000),
    })
    if (res.ok) {
      _protocolCache.set(baseUrl, 'a2a')
      return 'a2a'
    }
  } catch { /* not A2A */ }

  _protocolCache.set(baseUrl, 'openai')
  return 'openai'
}

// ── Streaming chat (auto-detect protocol) ────────────────────────────

/**
 * Call a local agent, auto-detecting whether it speaks A2A or OpenAI.
 * Yields parsed chunks as they arrive. The caller (Den.tsx) renders
 * each chunk, then calls /chat/relay to persist the final text.
 */
export async function* streamLocalChat(
  config: LocalAgentConfig,
  messages: Array<{ role: string; content: string }>,
  signal?: AbortSignal,
): AsyncGenerator<LocalStreamChunk, void, void> {
  const baseUrl = config.localEndpointUrl.replace(/\/+$/, '')
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (config.localBearerToken) {
    headers['Authorization'] = `Bearer ${config.localBearerToken}`
  }

  const protocol = await detectProtocol(baseUrl, headers)

  if (protocol === 'a2a') {
    yield* _streamA2A(baseUrl, messages, headers, signal)
  } else {
    yield* _streamOpenAI(baseUrl, messages, headers, signal)
  }
}

// ── A2A protocol (JSON-RPC message/send) ─────────────────────────────

async function* _streamA2A(
  baseUrl: string,
  messages: Array<{ role: string; content: string }>,
  headers: Record<string, string>,
  signal?: AbortSignal,
): AsyncGenerator<LocalStreamChunk, void, void> {
  // Build the user message with conversation history as context
  const parts: Array<{ type: string; text: string }> = []
  if (messages.length > 1) {
    const historyLines = messages.slice(0, -1).map(m =>
      `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`
    )
    parts.push({ type: 'text', text: `[Prior conversation]\n${historyLines.join('\n')}\n[End prior conversation]\n\n` })
  }
  parts.push({ type: 'text', text: messages[messages.length - 1].content })

  const payload = {
    jsonrpc: '2.0',
    id: crypto.randomUUID(),
    method: 'message/send',
    params: {
      message: {
        messageId: crypto.randomUUID(),
        role: 'user',
        parts,
      },
    },
  }

  const response = await fetch(baseUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
    signal,
  })

  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(`Local A2A agent ${response.status}: ${text.slice(0, 200)}`)
  }

  const data = await response.json() as {
    result?: {
      artifacts?: Array<{
        parts?: Array<{ kind?: string; type?: string; text?: string }>
      }>
      status?: { state?: string }
      metadata?: { usage?: Record<string, unknown> }
    }
    error?: { message?: string }
  }

  if (data.error) {
    throw new Error(`A2A error: ${data.error.message || JSON.stringify(data.error)}`)
  }

  const task = data.result
  if (!task) {
    yield { type: 'done', usage: {} }
    return
  }

  // Extract text from all artifacts
  let fullText = ''
  for (const artifact of (task.artifacts || [])) {
    for (const part of (artifact.parts || [])) {
      if ((part.kind === 'text' || part.type === 'text') && part.text) {
        fullText += part.text
      }
    }
  }

  if (fullText) {
    yield { type: 'content', text: fullText }
  }

  const usage = task.metadata?.usage || {}
  yield { type: 'done', usage }
}

// ── OpenAI protocol (/v1/chat/completions SSE) ───────────────────────

async function* _streamOpenAI(
  baseUrl: string,
  messages: Array<{ role: string; content: string }>,
  headers: Record<string, string>,
  signal?: AbortSignal,
): AsyncGenerator<LocalStreamChunk, void, void> {
  const url = `${baseUrl}/v1/chat/completions`

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
          if (!delta) { newlineIdx = buffer.indexOf('\n'); continue }

          if (delta.tool_use) {
            yield { type: 'tool_use', toolName: delta.tool_use.name || '', preview: delta.tool_use.preview || '' }
          } else if (delta.tool_calls) {
            for (const tc of delta.tool_calls) {
              const name = tc.function?.name
              if (name) yield { type: 'tool_use', toolName: name, preview: '' }
            }
          } else if (delta.content) {
            yield { type: 'content', text: delta.content }
          }
        } catch { /* skip malformed */ }

        newlineIdx = buffer.indexOf('\n')
      }
    }
  } finally {
    reader.releaseLock()
  }

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
