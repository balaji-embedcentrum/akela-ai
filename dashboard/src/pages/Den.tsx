import { useEffect, useRef, useState } from 'react'
import { useStore } from '../store'
import type { Message, Conversation, Workspace } from '../store'
import api from '../api'
import { Radio, AtSign, Plus, Folder, Trash2, GripVertical, MessageSquare, FolderPlus } from 'lucide-react'
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

const ALL_COMMANDS = [
  { cmd: '/create-project', desc: 'Create a new project', icon: '🎯', usage: '"Name"' },
  { cmd: '/create-sprint', desc: 'Create a sprint', icon: '🏃', usage: '"Name" [/start YYYY-MM-DD] [/end YYYY-MM-DD]' },
  { cmd: '/create-epic', desc: 'Create an epic', icon: '🟣', usage: '"Name" [/priority P0-P3] [/date YYYY-MM-DD]' },
  { cmd: '/create-story', desc: 'Create a story', icon: '📖', usage: '"Name" #epic [/points N] [/priority P2]' },
  { cmd: '/create-task', desc: 'Create a task', icon: '☐', usage: '"Name" #story [#agent] [/priority P2]' },
  { cmd: '/create-subtask', desc: 'Create a subtask', icon: '↳', usage: '"Name" #task [#agent]' },
  { cmd: '/assign', desc: 'Assign task to agent', icon: '👤', usage: '#task #agent' },
  { cmd: '/status', desc: 'Change task status', icon: '🔄', usage: '#task <todo|in_progress|review|done|blocked>' },
  { cmd: '/list-projects', desc: 'List all projects', icon: '📋', usage: '' },
  { cmd: '/list-sprints', desc: 'List sprints in project', icon: '📋', usage: '' },
  { cmd: '/list-epics', desc: 'List epics in project', icon: '📋', usage: '' },
  { cmd: '/help', desc: 'Show all commands', icon: '❓', usage: '' },
  { cmd: '/agents', desc: 'List the pack', icon: '🐺', usage: '' },
  { cmd: '/standup', desc: 'Quick howl (all agents)', icon: '📢', usage: '' },
  { cmd: '/create-standup', desc: 'Schedule a standup', icon: '📅', usage: '"Name" [#project] [/time HH:MM] [/days mon,...]' },
  { cmd: '/run-standup', desc: 'Run a named standup', icon: '▶️', usage: '"Name"' },
]

// Hash context: what each # position means for each command
const HASH_CONTEXTS: Record<string, string[]> = {
  'create-story': ['epic'],
  'create-task': ['story', 'agent'],
  'create-subtask': ['task', 'agent'],
  'assign': ['task', 'agent'],
  'status': ['task'],
}

interface HashHint { name: string; display: string; icon: string; type: string }

interface ToolStep { stream_id: string; sender_name: string; tool_name: string; preview: string }

function MessageBubble({ msg, isStreaming, stats, toolSteps, onRegenerate }: { msg: Message; isStreaming?: boolean; stats?: StreamStats; toolSteps?: ToolStep[]; onRegenerate?: () => void }) {
  const isAlpha = msg.sender_role === 'alpha'
  const isSystem = msg.sender_role === 'system'
  const isBroadcast = msg.mention_type === 'broadcast'
  const isDirect = msg.mention_type === 'direct'

  if (isSystem) {
    return (
      <div style={{
        textAlign: 'center', color: 'var(--system-text)',
        fontSize: 12, fontStyle: 'italic', padding: '6px 0',
      }}>
        {String.fromCharCode(0x26A1)} {msg.content}
      </div>
    )
  }

  const borderColor = isBroadcast ? 'var(--broadcast-border)' : isDirect ? 'var(--mention-border)' : isAlpha ? '#d4a017' : '#2dd4bf'
  const bg = isBroadcast ? 'var(--broadcast)' : isDirect ? 'var(--mention)' : isAlpha ? 'rgba(212,160,23,0.06)' : 'rgba(45,212,191,0.06)'

  return (
    <div style={{
      padding: '8px 12px', marginBottom: 6, borderRadius: 8,
      background: bg, borderLeft: `3px solid ${borderColor}`,
      animation: 'fadeIn 0.2s ease',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
        <span style={{
          fontSize: 13, fontWeight: 700,
          color: isAlpha ? 'var(--alpha)' : 'var(--text-primary)',
        }}>
          {isAlpha ? '👑' : '🐺'} {msg.sender_name}
        </span>
        {isAlpha && (
          <span style={{
            fontSize: 9, padding: '1px 5px', borderRadius: 8,
            background: 'rgba(255,215,0,0.15)', color: 'var(--alpha)',
          }}>Alpha</span>
        )}
        {isBroadcast && (
          <span style={{
            fontSize: 10, padding: '1px 6px', borderRadius: 10,
            background: 'rgba(74,158,255,0.15)', color: 'var(--broadcast-border)',
            display: 'flex', alignItems: 'center', gap: 3,
          }}>
            <Radio size={9} /> @all
          </span>
        )}
        {isDirect && (
          <span style={{
            fontSize: 10, padding: '1px 6px', borderRadius: 10,
            background: 'rgba(245,166,35,0.15)', color: 'var(--mention-border)',
            display: 'flex', alignItems: 'center', gap: 3,
          }}>
            <AtSign size={9} /> DM
          </span>
        )}
        <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 'auto' }}>
          {msg.created_at ? new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}
        </span>
      </div>
      {/* Tool steps — shown above content when agent used tools */}
      {toolSteps && toolSteps.length > 0 && (
        <div style={{ marginBottom: 8 }}>
          {toolSteps.map((t, i) => (
            <div key={i} style={{
              display: 'flex', alignItems: 'center', gap: 7, fontSize: 12,
              color: 'var(--text-muted)', padding: '3px 0',
            }}>
              <span style={{ fontSize: 13 }}>🔧</span>
              <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{t.tool_name}</span>
              {t.preview && <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 300 }}>— {t.preview}</span>}
            </div>
          ))}
        </div>
      )}
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
          {msg.attachments.map((att, i) => (
            <div key={i} style={{
              display: 'flex', alignItems: 'center', gap: 5,
              padding: '3px 8px', borderRadius: 6,
              background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)',
              fontSize: 12, color: 'var(--text-muted)',
            }}>
              <span>{att.type?.startsWith('image/') ? '🖼' : '📎'}</span>
              <span>{att.name}</span>
            </div>
          ))}
        </div>
      )}
      {/* Message actions: stats, copy, regenerate, feedback */}
      {!isStreaming && msg.content && (() => {
        // Use live stats first, then fall back to persisted msg_metadata
        const meta = (msg as any).msg_metadata || (msg as any).metadata
        const effectiveUsage = stats?.usage || meta?.usage
        const effectiveDuration = stats?.durationMs || meta?.duration_ms
        const effectiveTps = stats?.tokensPerSec || meta?.tokens_per_sec
        return (
          <MessageActions
            messageId={msg.id}
            content={msg.content}
            isAgent={!isAlpha && !isSystem}
            usage={effectiveUsage}
            durationMs={effectiveDuration}
            tokensPerSec={effectiveTps}
            onRegenerate={!isAlpha && !isSystem ? onRegenerate : undefined}
          />
        )
      })()}
    </div>
  )
}

// @ts-ignore — ChatSidebar kept for future use but currently hidden
function ChatSidebar() {
  const {
    conversations, workspaces, activeConversation,
    setConversations, setWorkspaces, setActiveConversation,
    setActiveRoom, setMessages, activeProject,
  } = useStore()
  const [newWsName, setNewWsName] = useState('')
  const [showNewWs, setShowNewWs] = useState(false)
  const [dragId, setDragId] = useState<string | null>(null)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; convo: Conversation } | null>(null)

  // Each project has its own general room to keep messages scoped
  const generalRoom = activeProject ? `proj-${activeProject.id}` : 'general'

  const loadData = async () => {
    try {
      const projectParam = activeProject ? `?project_id=${activeProject.id}` : ''
      const [convos, wss] = await Promise.all([
        api.get(`/conversations/${projectParam}`),
        api.get('/conversations/workspaces'),
      ])
      setConversations(convos.data)
      setWorkspaces(wss.data)
    } catch (e) { console.error(e) }
  }

  useEffect(() => { loadData() }, [activeProject?.id])

  // Reset to project-scoped general room when project switches
  useEffect(() => {
    setActiveConversation(null)
    setActiveRoom(generalRoom)
    setMessages([])
  }, [activeProject?.id])

  const createChat = async () => {
    try {
      const r = await api.post('/conversations/', {
        title: 'New Chat',
        workspace_id: null,
        project_id: activeProject?.id ?? null,
      })
      await loadData()
      selectConvo(r.data)
    } catch (e) { console.error(e) }
  }

  const createWorkspace = async () => {
    if (!newWsName.trim()) return
    try {
      await api.post('/conversations/workspaces', { name: newWsName.trim() })
      setNewWsName('')
      setShowNewWs(false)
      await loadData()
    } catch (e) { console.error(e) }
  }

  const deleteChat = async (id: string) => {
    try {
      await api.delete(`/conversations/${id}`)
      if (activeConversation?.id === id) {
        setActiveConversation(null)
        setActiveRoom(generalRoom)
        setMessages([])
      }
      await loadData()
    } catch (e) { console.error(e) }
    setContextMenu(null)
  }

  const selectConvo = (c: Conversation) => {
    setActiveConversation(c)
    setActiveRoom(c.room)
  }

  const selectGeneral = () => {
    setActiveConversation(null)
    setActiveRoom(generalRoom)
  }

  const handleDrop = async (workspaceId: string | null) => {
    if (!dragId) return
    try {
      await api.put(`/conversations/${dragId}`, {
        workspace_id: workspaceId || '00000000-0000-0000-0000-000000000000',
      })
      await loadData()
    } catch (e) { console.error(e) }
    setDragId(null)
  }

  const ungrouped = conversations.filter(c => !c.workspace_id)
  const grouped = workspaces.map(ws => ({
    ...ws,
    convos: conversations.filter(c => c.workspace_id === ws.id),
  }))

  return (
    <div style={{
      width: 260, borderLeft: '1px solid var(--border)',
      background: 'var(--bg-surface)', display: 'flex', flexDirection: 'column',
      height: '100%', overflow: 'hidden',
    }}>
      {/* Header */}
      <div style={{
        padding: '12px 12px 8px', borderBottom: '1px solid var(--border)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', letterSpacing: 1 }}>
          CHATS
        </span>
        <div style={{ display: 'flex', gap: 4 }}>
          <button onClick={() => setShowNewWs(true)} title="New Workspace"
            style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 4 }}>
            <FolderPlus size={14} />
          </button>
          <button onClick={createChat} title="New Chat"
            style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', padding: 4 }}>
            <Plus size={14} />
          </button>
        </div>
      </div>

      {/* New workspace input */}
      {showNewWs && (
        <div style={{ padding: '6px 12px', borderBottom: '1px solid var(--border)' }}>
          <input
            value={newWsName}
            onChange={e => setNewWsName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') createWorkspace(); if (e.key === 'Escape') setShowNewWs(false) }}
            placeholder="Workspace name..."
            autoFocus
            style={{
              width: '100%', padding: '6px 8px', fontSize: 12,
              background: 'var(--bg-elevated)', border: '1px solid var(--border)',
              borderRadius: 6, color: 'var(--text-primary)', outline: 'none',
            }}
          />
        </div>
      )}

      {/* Chat list */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '6px 0' }}>
        {/* General channel — always first */}
        <div
          onClick={selectGeneral}
          style={{
            display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px',
            cursor: 'pointer', fontSize: 13,
            background: !activeConversation ? 'var(--bg-hover)' : 'transparent',
            borderLeft: !activeConversation ? '3px solid var(--accent)' : '3px solid transparent',
          }}
        >
          <Radio size={14} color="var(--accent)" />
          <span style={{ fontWeight: !activeConversation ? 600 : 400 }}>The Den</span>
          <span style={{ fontSize: 10, color: 'var(--text-muted)', marginLeft: 'auto' }}>#general</span>
        </div>

        {/* Ungrouped conversations */}
        <div
          onDragOver={e => e.preventDefault()}
          onDrop={() => handleDrop(null)}
        >
          {ungrouped.map(c => (
            <ConvoItem
              key={c.id}
              convo={c}
              active={activeConversation?.id === c.id}
              onSelect={() => selectConvo(c)}
              onDragStart={() => setDragId(c.id)}
              onContextMenu={(e) => {
                e.preventDefault()
                setContextMenu({ x: e.clientX, y: e.clientY, convo: c })
              }}
            />
          ))}
        </div>

        {/* Workspaces */}
        {grouped.map(ws => (
          <WorkspaceGroup
            key={ws.id}
            workspace={ws}
            convos={ws.convos}
            activeId={activeConversation?.id || null}
            onSelect={selectConvo}
            onDragStart={setDragId}
            onDrop={() => handleDrop(ws.id)}
            onContextMenu={(e, c) => {
              e.preventDefault()
              setContextMenu({ x: e.clientX, y: e.clientY, convo: c })
            }}
          />
        ))}
      </div>

      {/* Context menu */}
      {contextMenu && (
        <>
          <div
            onClick={() => setContextMenu(null)}
            style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 999 }}
          />
          <div style={{
            position: 'fixed', left: contextMenu.x, top: contextMenu.y,
            background: 'var(--bg-elevated)', border: '1px solid var(--border)',
            borderRadius: 8, padding: 4, zIndex: 1000, minWidth: 140,
            boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
          }}>
            <button
              onClick={() => deleteChat(contextMenu.convo.id)}
              style={{
                display: 'flex', alignItems: 'center', gap: 8, width: '100%',
                padding: '8px 12px', border: 'none', background: 'transparent',
                color: '#ef4444', cursor: 'pointer', fontSize: 13, borderRadius: 6,
              }}
              onMouseEnter={e => (e.currentTarget.style.background = 'rgba(239,68,68,0.1)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
            >
              <Trash2 size={13} /> Delete Chat
            </button>
          </div>
        </>
      )}
    </div>
  )
}

function ConvoItem({ convo, active, onSelect, onDragStart, onContextMenu }: {
  convo: Conversation
  active: boolean
  onSelect: () => void
  onDragStart: () => void
  onContextMenu: (e: React.MouseEvent) => void
}) {
  return (
    <div
      draggable
      onDragStart={onDragStart}
      onClick={onSelect}
      onContextMenu={onContextMenu}
      style={{
        display: 'flex', alignItems: 'center', gap: 6, padding: '7px 12px',
        cursor: 'pointer', fontSize: 13,
        background: active ? 'var(--bg-hover)' : 'transparent',
        borderLeft: active ? '3px solid var(--accent)' : '3px solid transparent',
      }}
      onMouseEnter={e => { if (!active) e.currentTarget.style.background = 'rgba(255,255,255,0.03)' }}
      onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'transparent' }}
    >
      <GripVertical size={10} color="var(--text-muted)" style={{ opacity: 0.4 }} />
      <MessageSquare size={13} color="var(--text-muted)" />
      <div style={{ flex: 1, overflow: 'hidden' }}>
        <div style={{
          fontWeight: active ? 600 : 400, fontSize: 13,
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>
          {convo.title}
        </div>
        {convo.last_message && (
          <div style={{
            fontSize: 11, color: 'var(--text-muted)',
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}>
            {convo.last_message}
          </div>
        )}
      </div>
    </div>
  )
}

function WorkspaceGroup({ workspace, convos, activeId, onSelect, onDragStart, onDrop, onContextMenu }: {
  workspace: Workspace
  convos: Conversation[]
  activeId: string | null
  onSelect: (c: Conversation) => void
  onDragStart: (id: string) => void
  onDrop: () => void
  onContextMenu: (e: React.MouseEvent, c: Conversation) => void
}) {
  const [collapsed, setCollapsed] = useState(false)

  return (
    <div
      onDragOver={e => e.preventDefault()}
      onDrop={onDrop}
    >
      <div
        onClick={() => setCollapsed(!collapsed)}
        style={{
          display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px',
          cursor: 'pointer', fontSize: 11, fontWeight: 600,
          color: 'var(--text-muted)', marginTop: 8,
        }}
      >
        <Folder size={12} color={workspace.color} />
        <span>{workspace.name}</span>
        <span style={{ fontSize: 10, marginLeft: 'auto' }}>{convos.length}</span>
      </div>
      {!collapsed && convos.map(c => (
        <div key={c.id} style={{ paddingLeft: 8 }}>
          <ConvoItem
            convo={c}
            active={activeId === c.id}
            onSelect={() => onSelect(c)}
            onDragStart={() => onDragStart(c.id)}
            onContextMenu={e => onContextMenu(e, c)}
          />
        </div>
      ))}
    </div>
  )
}

export function Den() {
  const {
    messages, setMessages, addMessage, activeRoom, setActiveRoom,
    activeConversation, agents, activeProject, notifyTaskUpdate,
    localAgentConfigs,
  } = useStore()

  // Switch room when project changes
  const projectEffectMounted = useRef(false)
  useEffect(() => {
    if (!projectEffectMounted.current) {
      projectEffectMounted.current = true
      if (!activeProject) return  // initial mount, wait for DB project load
    }
    const room = activeProject ? `proj-${activeProject.id}` : 'general'
    setMessages([])
    setActiveRoom(room)
  }, [activeProject?.id])

  const [input, setInput] = useState('')
  const [slashHints, setSlashHints] = useState<typeof ALL_COMMANDS>([])
  const [mentionHints, setMentionHints] = useState<string[]>([])
  const [typingAgents, setTypingAgents] = useState<string[]>([])
  const [streamingMessages, setStreamingMessages] = useState<Record<string, { sender_name: string; full_text: string }>>({})
  // activeToolSteps: per-agent tool steps being accumulated during current stream
  const [activeToolSteps, setActiveToolSteps] = useState<Record<string, ToolStep[]>>({})
  // messageToolSteps: tool steps attached to a finished message, keyed by message id
  const [messageToolSteps, setMessageToolSteps] = useState<Record<string, ToolStep[]>>({})
  const [lastDenStats, setLastDenStats] = useState<StreamStats | null>(null)
  const [lastUserInput, setLastUserInput] = useState('')
  const [projectAgentNames, setProjectAgentNames] = useState<Set<string> | null>(null)
  const [projectAgentCount, setProjectAgentCount] = useState<number | null>(null) // null = no project
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const typingTimeouts = useRef<Record<string, ReturnType<typeof setTimeout>>>({})
  // Abort controllers for in-flight local agent streams (keyed by agent name)
  const localAbortRef = useRef<Record<string, AbortController>>({})

  // Hunt autocomplete data — fetched from DB when project changes
  const [huntEpics, setHuntEpics] = useState<{id: string, title: string}[]>([])
  const [huntStories, setHuntStories] = useState<{id: string, title: string}[]>([])
  const [huntTasks, setHuntTasks] = useState<{id: string, title: string}[]>([])
  const [hashHints, setHashHints] = useState<HashHint[]>([])
  const [activeCommand, setActiveCommand] = useState<typeof ALL_COMMANDS[0] | null>(null)

  useEffect(() => {
    if (!activeProject) { setHuntEpics([]); setHuntStories([]); setHuntTasks([]); return }
    api.get(`/hunt/projects?akela_project_id=${activeProject.id}`).then(r => {
      if (r.data.length > 0) {
        const hpId = r.data[0].id
        Promise.all([
          api.get(`/hunt/projects/${hpId}/epics`),
          api.get(`/hunt/projects/${hpId}/stories`),
          api.get(`/hunt/tasks?project_id=${hpId}`),
        ]).then(([e, s, t]) => {
          setHuntEpics(e.data)
          setHuntStories(s.data)
          setHuntTasks(t.data)
        }).catch(console.error)
      }
    }).catch(console.error)
  }, [activeProject?.id])

  // Load messages for current room — cancel stale fetches when room changes
  useEffect(() => {
    let cancelled = false
    setMessages([])
    api.get(`/chat/messages/alpha?room=${activeRoom}&limit=100`)
      .then(r => {
        if (!cancelled) setMessages(r.data.reverse())
      })
      .catch(e => { if (!cancelled) console.error(e) })
    return () => { cancelled = true }
  }, [activeRoom])

  // Load project agents for @mention filtering and gate
  useEffect(() => {
    if (!activeProject) { setProjectAgentNames(null); setProjectAgentCount(null); return }
    api.get(`/projects/${activeProject.id}/agents`)
      .then(r => {
        const ids = new Set<string>(r.data.map((a: { agent_id: string }) => a.agent_id))
        const names = new Set(agents.filter(a => ids.has(a.id)).map(a => a.name))
        setProjectAgentNames(names.size > 0 ? names : null)
        setProjectAgentCount(names.size)
      })
      .catch(() => { setProjectAgentNames(null); setProjectAgentCount(0) })
  }, [activeProject?.id, agents.length])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // SSE with token in query param + keepalive
  useEffect(() => {
    const token = localStorage.getItem('akela_token') || ''
    const url = `${API_BASE}/chat/subscribe/alpha?room=${activeRoom}&token=${encodeURIComponent(token)}`
    const es = new EventSource(url)
    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data)
        if (data.type === 'message' || data.type === 'system') {
          const senderName = data.sender_name as string
          const msgId = data.id as string
          // If this is a task status system message, notify Hunt to refresh
          if (data.type === 'system' && typeof data.content === 'string' &&
            /task (completed|blocked|timed out|queued|done)/i.test(data.content)) {
            notifyTaskUpdate()
          }
          // Attach any accumulated tool steps to this message
          setActiveToolSteps(prev => {
            if (prev[senderName]?.length) {
              setMessageToolSteps(ms => ({ ...ms, [msgId]: prev[senderName] }))
              const next = { ...prev }
              delete next[senderName]
              return next
            }
            return prev
          })
          addMessage(data as Message)
          // Clear typing indicator for this agent
          setTypingAgents((prev: string[]) => prev.filter((n: string) => n !== senderName))
          if (typingTimeouts.current[senderName]) {
            clearTimeout(typingTimeouts.current[senderName])
            delete typingTimeouts.current[senderName]
          }
          // Remove streaming bubble for this agent
          setStreamingMessages(prev => {
            const next = { ...prev }
            for (const [sid, s] of Object.entries(next)) {
              if (s.sender_name === senderName) delete next[sid]
            }
            return next
          })
        } else if (data.type === 'stream_chunk') {
          const { stream_id, sender_name, full_text } = data
          setStreamingMessages(prev => ({
            ...prev,
            [stream_id]: { sender_name, full_text },
          }))
          // Clear typing indicator for this agent
          setTypingAgents((prev: string[]) => prev.filter((n: string) => n !== sender_name))
        } else if (data.type === 'stream_end') {
          const { stream_id } = data
          setStreamingMessages(prev => {
            const next = { ...prev }
            delete next[stream_id]
            return next
          })
          if (data.usage || data.duration_ms) {
            setLastDenStats({
              usage: data.usage || {},
              durationMs: data.duration_ms || 0,
              tokensPerSec: data.tokens_per_sec || 0,
            })
          }
        } else if (data.type === 'typing') {
          const name = data.agent_name as string
          setTypingAgents((prev: string[]) => prev.includes(name) ? prev : [...prev, name])
          if (typingTimeouts.current[name]) clearTimeout(typingTimeouts.current[name])
          typingTimeouts.current[name] = setTimeout(() => {
            setTypingAgents((prev: string[]) => prev.filter((n: string) => n !== name))
          }, 45000)
        } else if (data.type === 'tool_step') {
          const { stream_id, sender_name, tool_name, preview } = data
          setActiveToolSteps(prev => ({
            ...prev,
            [sender_name]: [...(prev[sender_name] || []), { stream_id, sender_name, tool_name, preview }],
          }))
        }
      } catch {}
    }
    es.onerror = () => {
      console.warn('SSE connection error, will auto-reconnect')
    }
    return () => es.close()
  }, [activeRoom])

  // Clear typing when agent message arrives
  useEffect(() => {
    if (messages.length > 0) {
      const lastMsg = messages[messages.length - 1]
      if (lastMsg.sender_role === 'agent') {
        setTypingAgents((prev: string[]) => prev.filter((n: string) => n !== lastMsg.sender_name))
      }
    }
  }, [messages])

  const getHashItems = (contextType: string | undefined, partial: string): HashHint[] => {
    if (!contextType) return []
    switch (contextType) {
      case 'epic':
        return huntEpics
          .filter(e => !partial || e.title.toLowerCase().includes(partial))
          .slice(0, 8)
          .map(e => ({ name: e.title.replace(/\s+/g, '-'), display: e.title, icon: '🟣', type: 'Epic' }))
      case 'story': {
        const storyHints: HashHint[] = huntStories
          .filter(s => !partial || s.title.toLowerCase().includes(partial))
          .slice(0, 6)
          .map(s => ({ name: s.title.replace(/\s+/g, '-'), display: s.title, icon: '📖', type: 'Story' }))
        // Also show epics (tasks can go under an epic directly)
        const epicFallback: HashHint[] = huntEpics
          .filter(e => !partial || e.title.toLowerCase().includes(partial))
          .slice(0, 4)
          .map(e => ({ name: e.title.replace(/\s+/g, '-'), display: e.title, icon: '🟣', type: 'Epic' }))
        return [...storyHints, ...epicFallback]
      }
      case 'task':
        return huntTasks
          .filter(t => !partial || t.title.toLowerCase().includes(partial))
          .slice(0, 8)
          .map(t => ({ name: t.title.replace(/\s+/g, '-'), display: t.title, icon: '☐', type: 'Task' }))
      case 'agent': {
        const projectAgentList = projectAgentNames
          ? agents.filter(a => projectAgentNames.has(a.name))
          : agents
        return projectAgentList
          .filter(a => !partial || a.name.toLowerCase().includes(partial))
          .slice(0, 8)
          .map(a => ({ name: a.name, display: a.display_name || a.name, icon: '🐺', type: 'Agent' }))
      }
      default:
        return []
    }
  }

  const handleInput = (val: string) => {
    setInput(val)
    if (val.startsWith('/')) {
      // Slash command autocomplete — only while typing the command name (first word)
      const firstWord = val.split(' ')[0]
      if (!val.includes(' ')) {
        setSlashHints(ALL_COMMANDS.filter(h => h.cmd.startsWith(firstWord)))
        setActiveCommand(null)
      } else {
        setSlashHints([])
        // Set persistent hint bar for the matched command
        const matched = ALL_COMMANDS.find(h => h.cmd === firstWord)
        setActiveCommand(matched || null)
      }
      setMentionHints([])

      // Hash autocomplete inside slash commands
      const lastHash = val.lastIndexOf('#')
      if (lastHash >= 0) {
        const afterHash = val.slice(lastHash + 1)
        if (!afterHash.includes(' ')) {
          const cmdMatch = val.match(/^\/([a-z-]+)\s/)
          if (cmdMatch) {
            const cmd = cmdMatch[1]
            const contexts = HASH_CONTEXTS[cmd]
            if (contexts) {
              const beforeLastHash = val.slice(0, lastHash)
              const completedHashes = (beforeLastHash.match(/#\S+/g) || []).length
              const contextType = contexts[completedHashes]
              const partial = afterHash.toLowerCase()
              setHashHints(getHashItems(contextType, partial))
            } else { setHashHints([]) }
          } else { setHashHints([]) }
        } else { setHashHints([]) }
      } else { setHashHints([]) }
    } else {
      setSlashHints([])
      setHashHints([])
      setActiveCommand(null)
      // @mention autocomplete — find the last @ in input
      const atIdx = val.lastIndexOf('@')
      if (atIdx >= 0) {
        const afterAt = val.slice(atIdx + 1)
        if (!afterAt.includes(' ')) {
          const query = afterAt.toLowerCase()
          const projectAgents = projectAgentNames
            ? agents.filter(a => projectAgentNames.has(a.name))
            : agents
          const allOptions = ['all', ...projectAgents.map(a => a.name)]
          const matches = allOptions.filter(n => n.toLowerCase().startsWith(query))
          setMentionHints(matches.length > 0 ? matches : [])
        } else {
          setMentionHints([])
        }
      } else {
        setMentionHints([])
      }
    }
  }

  const selectMention = (name: string) => {
    const atIdx = input.lastIndexOf('@')
    if (atIdx >= 0) {
      setInput(input.slice(0, atIdx) + '@' + name + ' ')
    }
    setMentionHints([])
    setTimeout(() => inputRef.current?.focus(), 0)
  }

  const selectHash = (hashName: string) => {
    const lastHash = input.lastIndexOf('#')
    if (lastHash >= 0) {
      setInput(input.slice(0, lastHash) + '#' + hashName + ' ')
    }
    setHashHints([])
    setTimeout(() => inputRef.current?.focus(), 0)
  }

  const send = async (text?: string, attachments?: { name: string; type: string; base64: string }[]) => {
    const content = (text ?? input).trim()
    if (!content && !(attachments && attachments.length > 0)) return
    setSlashHints([])
    setHashHints([])
    setActiveCommand(null)
    setInput('')
    setLastUserInput(content)
    setLastDenStats(null)
    try {
      // Persist the user message via the server (unchanged — remote agents
      // are dispatched by the server-side endpoint_caller through this path)
      await api.post('/chat/messages/alpha', {
        room: activeRoom,
        content,
        attachments: attachments || [],
      })
    } catch (e) {
      console.error(e)
    }

    // ── Local agent dispatch (browser-direct) ─────────────────────────
    // Parse @mentions from content and call local agents directly.
    // This runs IN ADDITION TO the server post — remote agents are still
    // dispatched by the server. Local agents (which the server can't
    // reach) are called from the browser.
    const mentionMatches = content.match(/@([\w-]+)/g) || []
    const mentionedNames = mentionMatches.map(m => m.slice(1))

    let localTargets: string[] = []
    if (mentionedNames.includes('all')) {
      // @all broadcast — call every agent that has a local config
      localTargets = agents
        .filter(a => localAgentConfigs[a.name])
        .map(a => a.name)
    } else {
      // Specific mentions — call only the ones with local configs
      localTargets = mentionedNames.filter(name => localAgentConfigs[name])
    }

    for (const agentName of localTargets) {
      handleLocalAgentChat(agentName, content, activeRoom)
    }
  }

  /** Stream a response from a local agent running on the user's device. */
  const handleLocalAgentChat = async (agentName: string, content: string, room: string) => {
    const config = localAgentConfigs[agentName]
    if (!config) return

    const streamId = crypto.randomUUID().slice(0, 8)
    const startTs = Date.now()
    const abortController = new AbortController()
    localAbortRef.current[agentName] = abortController

    // Show typing indicator
    setTypingAgents(prev => [...new Set([...prev, agentName])])

    // Build history from current messages (same logic as server-side build_history)
    const history = buildLocalHistory(messages, agentName, 6)
    const allMessages = [...history, { role: 'user', content }]

    let fullText = ''
    let usage: Record<string, unknown> = {}
    let model = ''
    const toolCalls: { name: string; preview: string }[] = []

    try {
      for await (const chunk of streamLocalChat(config, allMessages, abortController.signal)) {
        if (chunk.type === 'content' && chunk.text) {
          fullText += chunk.text
          setStreamingMessages(prev => ({
            ...prev,
            [streamId]: { sender_name: agentName, full_text: fullText },
          }))
          setTypingAgents(prev => prev.filter(n => n !== agentName))
        } else if (chunk.type === 'tool_use' && chunk.toolName) {
          toolCalls.push({ name: chunk.toolName, preview: chunk.preview || '' })
          setActiveToolSteps(prev => ({
            ...prev,
            [agentName]: [...(prev[agentName] || []), {
              stream_id: streamId,
              sender_name: agentName,
              tool_name: chunk.toolName!,
              preview: chunk.preview || '',
            }],
          }))
        } else if (chunk.type === 'done') {
          usage = chunk.usage || {}
          model = chunk.model || ''
        }
      }
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        // User clicked Stop — clean up silently
      } else {
        console.error(`[local-agent] ${agentName} error:`, err)
      }
      setStreamingMessages(prev => { const n = { ...prev }; delete n[streamId]; return n })
      setTypingAgents(prev => prev.filter(n => n !== agentName))
      delete localAbortRef.current[agentName]
      return
    }

    delete localAbortRef.current[agentName]

    // Clear streaming state
    setStreamingMessages(prev => { const n = { ...prev }; delete n[streamId]; return n })
    setTypingAgents(prev => prev.filter(n => n !== agentName))

    if (!fullText.trim()) return

    // Compute stats
    const durationMs = Date.now() - startTs
    const completionTokens = (usage as { completion_tokens?: number }).completion_tokens || 0
    const tokensPerSec = completionTokens > 0 && durationMs > 0
      ? Math.round(completionTokens / (durationMs / 1000) * 10) / 10
      : 0

    setLastDenStats({ usage: usage as any, durationMs, tokensPerSec })

    // Build metadata matching the format endpoint_caller produces
    const meta = {
      usage: { ...usage, model },
      duration_ms: durationMs,
      tokens_per_sec: tokensPerSec,
      model,
      tool_calls: toolCalls,
    }

    // Relay to server for persistence
    try {
      const relayRes = await api.post('/chat/relay', {
        agent_name: agentName,
        content: fullText,
        room,
        msg_metadata: meta,
      })
      if (relayRes.data?.id) {
        // Transfer tool steps from the agent key to the message id
        setActiveToolSteps(prev => {
          if (prev[agentName]?.length) {
            setMessageToolSteps(ms => ({ ...ms, [relayRes.data.id]: prev[agentName] }))
          }
          const next = { ...prev }; delete next[agentName]; return next
        })
        addMessage(relayRes.data as Message)
      }
    } catch (e) {
      console.error('[local-agent] relay failed, adding message locally:', e)
      // Still show the message even if relay fails (offline resilience)
      addMessage({
        id: streamId,
        sender_name: agentName,
        sender_role: 'agent',
        content: fullText,
        room,
        mentions: [],
        mention_type: 'normal',
        created_at: new Date().toISOString(),
        msg_metadata: meta,
      } as Message)
    }
  }

  const handleDenRegenerate = async () => {
    if (!lastUserInput) return
    setLastDenStats(null)
    try {
      await api.post('/chat/messages/alpha', { room: activeRoom, content: lastUserInput })
    } catch (e) {
      console.error(e)
    }
    // Also re-trigger local agents if any were mentioned
    const mentionMatches = lastUserInput.match(/@([\w-]+)/g) || []
    const mentionedNames = mentionMatches.map(m => m.slice(1))
    let localTargets: string[] = []
    if (mentionedNames.includes('all')) {
      localTargets = agents.filter(a => localAgentConfigs[a.name]).map(a => a.name)
    } else {
      localTargets = mentionedNames.filter(name => localAgentConfigs[name])
    }
    for (const agentName of localTargets) {
      handleLocalAgentChat(agentName, lastUserInput, activeRoom)
    }
  }

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { setSlashHints([]); setMentionHints([]); setHashHints([]); setActiveCommand(null) }
    if (e.key === 'Tab' && hashHints.length > 0) {
      e.preventDefault()
      selectHash(hashHints[0].name)
    } else if (e.key === 'Tab' && mentionHints.length > 0) {
      e.preventDefault()
      selectMention(mentionHints[0])
    }
  }

  const roomLabel = activeConversation ? activeConversation.title : 'The Den'
  const projectTag = activeProject ? ` · ${activeProject.name}` : ''
  const roomSub = activeConversation ? `#${activeConversation.room}${projectTag}` : `#general${projectTag} · project communication`

  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden' }}>
      {/* Main chat area */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        {/* Header */}
        <div style={{
          padding: '16px 20px', borderBottom: '1px solid var(--border)',
          background: 'var(--bg-surface)', display: 'flex', alignItems: 'center', gap: 10,
        }}>
          <span style={{ fontSize: 20 }}>{activeConversation ? '💬' : '🐺'}</span>
          <div>
            <div style={{ fontWeight: 700, fontSize: 15 }}>{roomLabel}</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{roomSub}</div>
          </div>
        </div>

        {/* Messages */}
        <div className="den-messages-area" style={{ flex: 1, overflowY: 'auto', padding: '16px 20px' }}>
          {messages.length === 0 && (
            <div style={{ textAlign: 'center', color: 'var(--text-muted)', marginTop: 60, fontSize: 14 }}>
              <div style={{ fontSize: 40, marginBottom: 12 }}>🐺</div>
              {activeConversation ? 'Start a new conversation.' : 'The Den is quiet. Start the conversation.'}
            </div>
          )}
          {(() => {
            const lastAgentIdx = [...messages].reverse().findIndex(m => m.sender_role === 'agent')
            const statsIdx = lastAgentIdx >= 0 ? messages.length - 1 - lastAgentIdx : -1

            // Group messages by date label
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
                const m = messages[idx]
                return (
                  <MessageBubble
                    key={m.id}
                    msg={m}
                    stats={idx === statsIdx ? (lastDenStats ?? undefined) : undefined}
                    toolSteps={messageToolSteps[m.id]}
                    onRegenerate={idx === statsIdx ? handleDenRegenerate : undefined}
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
          {/* Streaming messages — live tokens, with any in-progress tool steps above */}
          {Object.entries(streamingMessages).map(([sid, s]) => (
            <MessageBubble
              key={`stream-${sid}`}
              isStreaming
              toolSteps={activeToolSteps[s.sender_name]}
              msg={{
                id: sid,
                sender_name: s.sender_name,
                sender_role: 'agent',
                content: s.full_text,
                mention_type: 'normal',
                mentions: [],
                room: activeRoom,
                created_at: '',
              } as Message}
            />
          ))}
          <div ref={bottomRef} />
        </div>

        {/* Typing indicator — hide agents that are already streaming */}
        {typingAgents.filter(n => !Object.values(streamingMessages).some(s => s.sender_name === n)).length > 0 && (
          <div style={{
            padding: '4px 20px', fontSize: 12, color: 'var(--text-muted)',
            fontStyle: 'italic', display: 'flex', alignItems: 'center', gap: 6,
          }}>
            <span style={{ display: 'inline-flex', gap: 2 }}>
              <span style={{ width: 4, height: 4, borderRadius: '50%', background: 'var(--accent)', animation: 'blink 1.4s infinite 0s' }} />
              <span style={{ width: 4, height: 4, borderRadius: '50%', background: 'var(--accent)', animation: 'blink 1.4s infinite 0.2s' }} />
              <span style={{ width: 4, height: 4, borderRadius: '50%', background: 'var(--accent)', animation: 'blink 1.4s infinite 0.4s' }} />
            </span>
            {typingAgents.filter(n => !Object.values(streamingMessages).some(s => s.sender_name === n)).join(', ')} {typingAgents.filter(n => !Object.values(streamingMessages).some(s => s.sender_name === n)).length === 1 ? 'is' : 'are'} typing...
            <style>{`@keyframes blink { 0%, 80%, 100% { opacity: 0; } 40% { opacity: 1; } }`}</style>
          </div>
        )}

        {/* Input with hints overlay */}
        <div className="den-input-wrapper" style={{ position: 'relative' }}>
          {/* Persistent command usage hint bar */}
          {activeCommand && activeCommand.usage && slashHints.length === 0 && (
            <div style={{
              position: 'absolute', bottom: '100%', left: 16, right: 16,
              background: 'var(--bg-elevated)', border: '1px solid var(--border)',
              borderRadius: 8, marginBottom: 4, zIndex: 9,
              padding: '8px 14px',
              display: 'flex', gap: 10, alignItems: 'center',
              boxShadow: '0 -2px 12px rgba(0,0,0,0.15)',
            }}>
              <span style={{ fontSize: 14, flexShrink: 0 }}>{activeCommand.icon}</span>
              <span style={{ color: 'var(--accent)', fontFamily: 'monospace', fontWeight: 600, fontSize: 12, flexShrink: 0 }}>{activeCommand.cmd}</span>
              <span style={{ color: 'var(--text-muted)', fontFamily: 'monospace', fontSize: 11, opacity: 0.8 }}>
                {activeCommand.usage.split(/(\[.*?\])/).map((part, i) =>
                  part.startsWith('[')
                    ? <span key={i} style={{ opacity: 0.5 }}>{part}</span>
                    : <span key={i}>{part}</span>
                )}
              </span>
              {activeCommand.cmd === '/create-task' && (
                <span style={{ color: 'var(--text-muted)', fontSize: 10, marginLeft: 'auto', opacity: 0.5, flexShrink: 0 }}>↵ for description</span>
              )}
              <span
                onClick={() => setActiveCommand(null)}
                style={{ color: 'var(--text-muted)', cursor: 'pointer', fontSize: 11, marginLeft: activeCommand.cmd === '/create-task' ? 0 : 'auto', opacity: 0.5, flexShrink: 0 }}
              >Esc</span>
            </div>
          )}

          {/* Slash command autocomplete */}
          {slashHints.length > 0 && (
            <div style={{
              position: 'absolute', bottom: '100%', left: 16, right: 16,
              background: 'var(--bg-elevated)', border: '1px solid var(--border)',
              borderRadius: 8, overflow: 'hidden', marginBottom: 4, zIndex: 10,
              maxHeight: 320, overflowY: 'auto',
              boxShadow: '0 -4px 20px rgba(0,0,0,0.25)',
            }}>
              <div style={{ padding: '6px 14px 4px', fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                Commands
              </div>
              {slashHints.map(h => (
                <div
                  key={h.cmd}
                  onClick={() => { setInput(h.cmd + ' '); setSlashHints([]) }}
                  style={{
                    padding: '7px 14px', cursor: 'pointer', fontSize: 13,
                    display: 'flex', gap: 10, alignItems: 'center',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-hover)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                >
                  <span style={{ fontSize: 14, width: 20, textAlign: 'center', flexShrink: 0 }}>{h.icon}</span>
                  <span style={{ color: 'var(--accent)', fontFamily: 'monospace', fontWeight: 600, flexShrink: 0 }}>{h.cmd}</span>
                  <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>{h.desc}</span>
                  {h.usage && (
                    <span style={{ color: 'var(--text-muted)', fontSize: 10, marginLeft: 'auto', fontFamily: 'monospace', opacity: 0.6, flexShrink: 0 }}>{h.usage}</span>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Hash (#) autocomplete for Hunt items */}
          {hashHints.length > 0 && (
            <div style={{
              position: 'absolute', bottom: '100%', left: 16, right: 16,
              background: 'var(--bg-elevated)', border: '1px solid var(--border)',
              borderRadius: 8, overflow: 'hidden', marginBottom: 4, zIndex: 11,
              maxHeight: 280, overflowY: 'auto',
              boxShadow: '0 -4px 20px rgba(0,0,0,0.25)',
            }}>
              <div style={{ padding: '6px 14px 4px', fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                {hashHints[0]?.type || 'Items'} — Tab to select
              </div>
              {hashHints.map((h, i) => (
                <div
                  key={`${h.type}-${h.name}-${i}`}
                  onClick={() => selectHash(h.name)}
                  style={{
                    padding: '7px 14px', cursor: 'pointer', fontSize: 13,
                    display: 'flex', gap: 10, alignItems: 'center',
                    background: i === 0 ? 'rgba(74,158,255,0.06)' : 'transparent',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-hover)')}
                  onMouseLeave={e => (e.currentTarget.style.background = i === 0 ? 'rgba(74,158,255,0.06)' : 'transparent')}
                >
                  <span style={{ fontSize: 14, width: 20, textAlign: 'center', flexShrink: 0 }}>{h.icon}</span>
                  <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>#{h.name}</span>
                  {h.display !== h.name && (
                    <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>{h.display}</span>
                  )}
                  <span style={{ color: 'var(--text-muted)', fontSize: 10, marginLeft: 'auto', fontFamily: 'monospace', opacity: 0.5, flexShrink: 0 }}>{h.type}</span>
                </div>
              ))}
            </div>
          )}

          {/* @mention autocomplete */}
          {mentionHints.length > 0 && (
            <div style={{
              position: 'absolute', bottom: '100%', left: 16, right: 16,
              background: 'var(--bg-elevated)', border: '1px solid var(--border)',
              borderRadius: 8, overflow: 'hidden', marginBottom: 4, zIndex: 10,
              boxShadow: '0 -4px 20px rgba(0,0,0,0.25)',
            }}>
              <div style={{ padding: '6px 14px 4px', fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                Agents — Tab to select
              </div>
              {mentionHints.map(name => (
                <div
                  key={name}
                  onClick={() => selectMention(name)}
                  style={{
                    padding: '7px 14px', cursor: 'pointer', fontSize: 13,
                    display: 'flex', gap: 10, alignItems: 'center',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-hover)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                >
                  <span style={{ fontSize: 14, width: 20, textAlign: 'center' }}>{name === 'all' ? '📢' : '🐺'}</span>
                  <span style={{ color: name === 'all' ? 'var(--broadcast-border)' : 'var(--text-primary)', fontWeight: 600 }}>@{name}</span>
                  <span style={{ color: 'var(--text-muted)', fontSize: 11, marginLeft: 'auto' }}>
                    {name === 'all' ? 'Broadcast to all agents' : 'Direct message'}
                  </span>
                </div>
              ))}
            </div>
          )}

          {activeProject && projectAgentCount === 0 ? (
            <div style={{
              padding: '16px 20px', borderTop: '1px solid var(--border)',
              background: 'var(--bg-surface)', textAlign: 'center',
              color: 'var(--text-muted)', fontSize: 13,
            }}>
              No agents in <strong style={{ color: 'var(--text-primary)' }}>{activeProject.name}</strong> yet.
              Go to <strong style={{ color: 'var(--accent)' }}>Dashboard</strong> to assign agents to this project.
            </div>
          ) : (
            <ChatInput
              placeholder="Message the pack... @mention, @all, /commands"
              onSend={(text, attachments) => send(text, attachments)}
              onInputChange={handleInput}
              onKeyDown={onKey}
              value={input}
              setValue={setInput}
              inputRef={inputRef}
              isActive={typingAgents.length > 0 || Object.keys(streamingMessages).length > 0}
              onStop={async () => {
                try {
                  // Stop remote agents via server
                  await api.post('/chat/stop', { room: activeRoom })
                  // Abort any in-flight local agent streams
                  Object.values(localAbortRef.current).forEach(c => c.abort())
                  localAbortRef.current = {}
                  setTypingAgents([])
                  setStreamingMessages({})
                } catch (e) { console.error('Stop failed:', e) }
              }}
            />
          )}
        </div>
      </div>

      {/* Right sidebar hidden — use agent DM chats instead */}
      {/* <ChatSidebar /> */}
    </div>
  )
}
