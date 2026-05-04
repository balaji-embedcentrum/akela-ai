import { useEffect, useRef, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useStore } from '../store'
import type { Message } from '../store'
import api from '../api'
import { ArrowLeft, Bot } from 'lucide-react'
import { HelpButton } from '../components/HelpDrawer'
import { MessageContent } from '../components/MessageContent'
import { MessageActions } from '../components/MessageActions'
import { ChatInput } from '../components/ChatInput'
import { streamLocalChat, buildLocalHistory } from '../local-chat'

const API_BASE = import.meta.env.DEV ? 'http://localhost:8200' : '/akela-api'

interface UsageStats {
  prompt_tokens?: number
  completion_tokens?: number
  total_tokens?: number
  model?: string
}

interface StreamStats {
  usage: UsageStats
  durationMs: number
  tokensPerSec: number
}

function DMBubble({
  msg,
  isStreaming,
  stats,
  onRegenerate,
}: {
  msg: Message
  isStreaming?: boolean
  stats?: StreamStats
  onRegenerate?: () => void
}) {
  const isAlpha = msg.sender_role === 'alpha'
  const isSystem = msg.sender_role === 'system'

  if (isSystem) {
    return (
      <div style={{
        textAlign: 'center', color: 'var(--system-text)',
        fontSize: 12, fontStyle: 'italic', padding: '6px 0',
      }}>
        ⚡ {msg.content}
      </div>
    )
  }

  return (
    <div style={{
      display: 'flex',
      justifyContent: isAlpha ? 'flex-end' : 'flex-start',
      marginBottom: 8, padding: '0 12px',
    }}>
      <div style={{
        maxWidth: '75%',
        padding: '10px 14px',
        borderRadius: isAlpha ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
        background: isAlpha ? 'var(--accent-dim)' : 'var(--bg-elevated)',
        border: `1px solid ${isAlpha ? 'var(--accent)' : 'var(--border)'}`,
      }}>
        <div style={{ fontSize: 11, fontWeight: 600, marginBottom: 4, color: isAlpha ? 'var(--alpha)' : 'var(--accent)' }}>
          {isAlpha ? '👑 You' : `🐺 ${msg.sender_name}`}
        </div>
        {(() => {
          const persistedTools = msg.msg_metadata?.tool_calls
          if (!isAlpha && !isStreaming && persistedTools && persistedTools.length > 0) {
            return (
              <div style={{ marginBottom: 6 }}>
                {persistedTools.map((t: { name: string; preview: string }, i: number) => (
                  <div key={i} style={{
                    margin: '3px 0', padding: '5px 10px', borderRadius: 6,
                    background: 'var(--bg-secondary)', border: '1px solid var(--border)',
                    fontSize: 12, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 6,
                  }}>
                    <span>🔧</span>
                    <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{t.name}</span>
                    {t.preview && <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>— {t.preview}</span>}
                  </div>
                ))}
              </div>
            )
          }
          return null
        })()}
        <div style={{ fontSize: 14, color: 'var(--text-primary)', lineHeight: 1.6, whiteSpace: isAlpha ? 'pre-wrap' : undefined }} className="chat-markdown">
          {isAlpha ? msg.content : (
            <MessageContent content={msg.content} isStreaming={isStreaming} />
          )}
          {isAlpha && isStreaming && (
            <span style={{
              display: 'inline-block', width: 2, height: 16,
              background: 'var(--text-primary)', marginLeft: 2,
              animation: 'blink 0.8s step-end infinite', verticalAlign: 'text-bottom',
            }} />
          )}
        </div>
        {msg.attachments && msg.attachments.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
            {msg.attachments.map((att: { name: string; type: string }, i: number) => (
              <div key={i} style={{ display:'flex', alignItems:'center', gap:5, padding:'3px 8px', borderRadius:6, background:'rgba(255,255,255,0.06)', border:'1px solid rgba(255,255,255,0.1)', fontSize:12, color:'var(--text-muted)' }}>
                <span>{att.type?.startsWith('image/') ? '🖼' : '📎'}</span>
                <span>{att.name}</span>
              </div>
            ))}
          </div>
        )}
        <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 4, textAlign: 'right' }}>
          {msg.created_at ? new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'streaming...'}
        </div>
        {/* Message actions: copy, regenerate, feedback, stats */}
        {!isStreaming && msg.content && (() => {
          // Use live stats first, then fall back to persisted msg_metadata
          const meta = (msg as any).msg_metadata || (msg as any).metadata
          const effectiveUsage = stats?.usage || meta?.usage
          const effectiveDuration = stats?.durationMs || meta?.duration_ms
          const effectiveTps = stats?.tokensPerSec || meta?.tokens_per_sec
          return (
            <MessageActions
              messageId={msg.id !== 'streaming' ? msg.id : undefined}
              content={msg.content}
              isAgent={!isAlpha && !isSystem}
              usage={effectiveUsage}
              durationMs={effectiveDuration}
              tokensPerSec={effectiveTps}
              onRegenerate={!isAlpha ? onRegenerate : undefined}
            />
          )
        })()}
      </div>
    </div>
  )
}

export function AgentChat() {
  const { agentName } = useParams<{ agentName: string }>()
  const navigate = useNavigate()
  const { token, agents, clearUnread, localAgentConfigs } = useStore()
  const [messages, setMessages] = useState<Message[]>([])
  const [sending, setSending] = useState(false)
  const [typing, setTyping] = useState(false)
  const [streamingText, setStreamingText] = useState('')
  const [isStreaming, setIsStreaming] = useState(false)
  const [toolSteps, setToolSteps] = useState<{ tool_name: string; preview: string }[]>([])
  const [lastStats, setLastStats] = useState<StreamStats | null>(null)
  const [lastUserMessage, setLastUserMessage] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)
  const eventSourceRef = useRef<EventSource | null>(null)

  const agent = agents.find(a => a.name === agentName)
  const room = `dm:${agentName}`
  const localConfig = agentName ? localAgentConfigs[agentName] : null
  const localAbortRef = useRef<AbortController | null>(null)

  // Reset ALL state when switching between agents
  useEffect(() => {
    setMessages([])
    setSending(false)
    setTyping(false)
    setStreamingText('')
    setIsStreaming(false)
    setToolSteps([])
    setLastStats(null)
    setLastUserMessage('')
    if (agentName) clearUnread(agentName)
  }, [agentName])

  // Load messages
  useEffect(() => {
    if (!token || !agentName) return
    api.get(`/chat/messages/alpha?room=${room}&limit=100`)
      .then(r => {
        const sorted = [...r.data].sort(
          (a: Message, b: Message) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
        )
        setMessages(sorted)
      })
      .catch(console.error)
  }, [token, agentName])

  // SSE for real-time messages
  useEffect(() => {
    if (!token || !agentName) return
    const url = `${API_BASE}/chat/subscribe/alpha?room=${room}&token=${token}`
    const es = new EventSource(url)
    eventSourceRef.current = es

    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data)
        if (data.type === 'message') {
          setMessages(prev => {
            if (prev.some(m => m.id === data.id)) return prev
            return [...prev, data as Message]
          })
          setTyping(false)
          setIsStreaming(false)
          setStreamingText('')
        } else if (data.type === 'stream_chunk' && data.sender_name?.toLowerCase() === agentName?.toLowerCase()) {
          setStreamingText(data.full_text)
          setIsStreaming(true)
          setTyping(false)
        } else if (data.type === 'stream_end') {
          setIsStreaming(false)
          setStreamingText('')
          // Capture usage stats from stream_end
          if (data.usage || data.duration_ms) {
            setLastStats({
              usage: data.usage || {},
              durationMs: data.duration_ms || 0,
              tokensPerSec: data.tokens_per_sec || 0,
            })
          }
          // Clear tool steps after a delay so user can see them
          setTimeout(() => setToolSteps([]), 5000)
        } else if (data.type === 'tool_step' && data.sender_name?.toLowerCase() === agentName?.toLowerCase()) {
          setToolSteps(prev => [...prev, { tool_name: data.tool_name, preview: data.preview }])
        } else if (data.type === 'typing' && data.agent_name?.toLowerCase() === agentName?.toLowerCase()) {
          if (!isStreaming) {
            setTyping(true)
            setTimeout(() => setTyping(false), 90000)
          }
        }
      } catch {}
    }

    return () => {
      es.close()
      eventSourceRef.current = null
    }
  }, [token, agentName])

  // Auto-scroll
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, typing, streamingText])

  const sendMessage = async (text: string, attachments: { name: string; type: string; base64: string }[]) => {
    if (!text.trim() && attachments.length === 0) return
    setSending(true)
    setLastUserMessage(text.trim())
    setLastStats(null)
    try {
      // Persist user message via server (unchanged — also dispatches to remote agents)
      await api.post('/chat/messages/alpha', {
        content: text.trim(),
        room,
        attachments,
      })
      setTyping(true)
    } catch (e) {
      console.error('Send failed:', e)
    }
    setSending(false)

    // If this DM target has a local config, call it directly from the browser
    if (localConfig && agentName) {
      handleLocalDM(text.trim())
    }
  }

  /** Stream a response from a local agent in a DM. */
  const handleLocalDM = async (content: string) => {
    if (!localConfig || !agentName) return
    const abortController = new AbortController()
    localAbortRef.current = abortController

    setTyping(true)
    const history = buildLocalHistory(messages, agentName, 6)
    const allMessages = [...history, { role: 'user', content }]

    let fullText = ''
    let usage: Record<string, unknown> = {}
    let model = ''
    const startTs = Date.now()

    try {
      for await (const chunk of streamLocalChat(localConfig, allMessages, abortController.signal)) {
        if (chunk.type === 'content' && chunk.text) {
          fullText += chunk.text
          setStreamingText(fullText)
          setIsStreaming(true)
          setTyping(false)
        } else if (chunk.type === 'tool_use' && chunk.toolName) {
          setToolSteps(prev => [...prev, { tool_name: chunk.toolName!, preview: chunk.preview || '' }])
        } else if (chunk.type === 'done') {
          usage = chunk.usage || {}
          model = chunk.model || ''
        }
      }
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        console.error(`[local-dm] ${agentName} error:`, err)
      }
      setIsStreaming(false)
      setStreamingText('')
      setTyping(false)
      localAbortRef.current = null
      return
    }

    localAbortRef.current = null
    setIsStreaming(false)
    setStreamingText('')
    setTyping(false)

    if (!fullText.trim()) return

    const durationMs = Date.now() - startTs
    const completionTokens = (usage as { completion_tokens?: number }).completion_tokens || 0
    const tokensPerSec = completionTokens > 0 && durationMs > 0
      ? Math.round(completionTokens / (durationMs / 1000) * 10) / 10 : 0
    setLastStats({ usage: usage as any, durationMs, tokensPerSec })

    const meta = { usage: { ...usage, model }, duration_ms: durationMs, tokens_per_sec: tokensPerSec, model }

    // Relay to server for persistence
    try {
      const relayRes = await api.post('/chat/relay', {
        agent_name: agentName,
        content: fullText,
        room,
        msg_metadata: meta,
      })
      if (relayRes.data?.id) {
        setMessages(prev => {
          if (prev.some(m => m.id === relayRes.data.id)) return prev
          return [...prev, relayRes.data as Message]
        })
      }
    } catch (e) {
      console.error('[local-dm] relay failed:', e)
      setMessages(prev => [...prev, {
        id: crypto.randomUUID(),
        sender_name: agentName,
        sender_role: 'agent',
        content: fullText,
        room,
        mentions: [],
        mention_type: 'normal',
        created_at: new Date().toISOString(),
        msg_metadata: meta,
      } as Message])
    }

    setToolSteps([])
  }

  const handleRegenerate = async () => {
    if (!lastUserMessage) return
    setLastStats(null)
    try {
      await api.post('/chat/messages/alpha', {
        content: lastUserMessage,
        room,
      })
      setTyping(true)
    } catch (e) {
      console.error('Regenerate failed:', e)
    }
    if (localConfig && agentName) {
      handleLocalDM(lastUserMessage)
    }
  }

  // Determine which message gets the live stats (last agent message)
  // All other agent messages read stats from msg.metadata (persisted)
  const lastAgentMsgIndex = [...messages].reverse().findIndex(m => m.sender_role === 'agent')
  const statsTargetIndex = lastAgentMsgIndex >= 0 ? messages.length - 1 - lastAgentMsgIndex : -1

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      {/* Header */}
      <div style={{
        padding: '12px 16px',
        borderBottom: '1px solid var(--border)',
        background: 'var(--bg-surface)',
        display: 'flex', alignItems: 'center', gap: 12,
      }}>
        <button
          onClick={() => navigate('/den')}
          style={{
            border: 'none', background: 'none', color: 'var(--text-secondary)',
            cursor: 'pointer', padding: 4, display: 'flex',
          }}
        >
          <ArrowLeft size={18} />
        </button>
        <div style={{
          width: 10, height: 10, borderRadius: '50%',
          background: agent?.status === 'online' ? 'var(--online)' : 'var(--offline)',
        }} />
        <div>
          <div style={{ fontWeight: 600, fontSize: 15, color: 'var(--text-primary)' }}>
            🐺 {agentName}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
            {agent?.status === 'online' ? 'Online' : 'Offline'} · {agent?.rank?.toUpperCase() || 'OMEGA'} · Private Chat
          </div>
        </div>
        <div style={{ marginLeft: 'auto' }}>
          <HelpButton pageId="agentchat" />
        </div>
      </div>

      {/* Messages */}
      <div ref={scrollRef} style={{
        flex: 1, overflowY: 'auto', padding: '16px 0',
        background: 'var(--bg-base)',
      }}>
        {messages.length === 0 && (
          <div style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center',
            justifyContent: 'center', height: '100%', gap: 12,
            color: 'var(--text-muted)',
          }}>
            <Bot size={48} strokeWidth={1} />
            <div style={{ fontSize: 16, fontWeight: 500 }}>Chat with {agentName}</div>
            <div style={{ fontSize: 13 }}>Send a message to start a private conversation</div>
          </div>
        )}
        {(() => {
          const todayStr = new Date().toDateString()
          const yesterdayStr = new Date(Date.now() - 86400000).toDateString()
          const groups: { label: string; isToday: boolean; indices: number[] }[] = []
          messages.forEach((m, idx) => {
            const d = m.created_at ? new Date(m.created_at) : new Date()
            const ds = d.toDateString()
            const label = ds === todayStr ? 'Today' : ds === yesterdayStr ? 'Yesterday'
              : d.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })
            const last = groups[groups.length - 1]
            if (last && last.label === label) { last.indices.push(idx) }
            else { groups.push({ label, isToday: ds === todayStr, indices: [idx] }) }
          })

          return groups.map(group => {
            const bubbles = group.indices.map(idx => {
              const msg = messages[idx]
              return (
                <DMBubble
                  key={msg.id}
                  msg={msg}
                  stats={idx === statsTargetIndex ? (lastStats ?? undefined) : undefined}
                  onRegenerate={idx === statsTargetIndex ? handleRegenerate : undefined}
                />
              )
            })

            if (group.isToday) {
              return (
                <div key={group.label}>
                  <div style={{
                    textAlign: 'center', fontSize: 11, color: 'var(--text-muted)',
                    margin: '8px 0 12px', display: 'flex', alignItems: 'center', gap: 8,
                  }}>
                    <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
                    Today
                    <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
                  </div>
                  {bubbles}
                </div>
              )
            }

            return (
              <details key={group.label} style={{ marginBottom: 4 }}>
                <summary style={{
                  cursor: 'pointer', fontSize: 11, color: 'var(--text-muted)',
                  margin: '8px 0 8px', display: 'flex', alignItems: 'center', gap: 8,
                  listStyle: 'none', userSelect: 'none',
                }}>
                  <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
                  <span style={{
                    padding: '2px 10px', borderRadius: 10,
                    border: '1px solid var(--border)', background: 'var(--bg-elevated)',
                    whiteSpace: 'nowrap',
                  }}>
                    {group.label} · {group.indices.length} messages
                  </span>
                  <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
                </summary>
                <div style={{ marginTop: 8 }}>{bubbles}</div>
              </details>
            )
          })
        })()}
        {isStreaming && streamingText && (
          <DMBubble
            isStreaming
            msg={{
              id: 'streaming',
              sender_name: agentName || '',
              sender_role: 'agent',
              content: streamingText,
              mention_type: 'normal',
              mentions: [],
              room,
              created_at: '',
            } as Message}
          />
        )}
        {/* Tool step events — show when agent executes a tool */}
        {toolSteps.map((t, i) => (
          <div key={i} style={{
            margin: '8px 0', padding: '8px 12px', borderRadius: 8,
            background: 'var(--bg-secondary)', border: '1px solid var(--border)',
            fontSize: 13, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 8,
          }}>
            <span style={{ fontSize: 14 }}>🔧</span>
            <span style={{ fontWeight: 500, color: 'var(--text-primary)' }}>{t.tool_name}</span>
            <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              — {t.preview}
            </span>
          </div>
        ))}
        {typing && !isStreaming && (
          <div style={{
            padding: '4px 12px', fontSize: 12, color: 'var(--text-muted)',
            fontStyle: 'italic', animation: 'fadeIn 0.2s ease',
          }}>
            🐺 {agentName} is thinking...
          </div>
        )}
        <style>{`@keyframes blink { 0%, 50% { opacity: 1; } 50.01%, 100% { opacity: 0; } }`}</style>
      </div>

      <ChatInput
        placeholder={`Message ${agentName}...`}
        disabled={sending}
        onSend={sendMessage}
        isActive={typing || isStreaming}
        onStop={async () => {
          try {
            await api.post('/chat/stop', { room })
            if (localAbortRef.current) {
              localAbortRef.current.abort()
              localAbortRef.current = null
            }
            setTyping(false)
            setIsStreaming(false)
            setStreamingText('')
          } catch (e) { console.error('Stop failed:', e) }
        }}
      />
    </div>
  )
}
