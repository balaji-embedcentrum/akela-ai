import { useStore } from '../store'
import type { Project, Agent } from '../store'
import { Copy, Check, Save, Trash2 } from 'lucide-react'
import { useState, useEffect } from 'react'
import api from '../api'

const COLORS = [
  '#4a9eff', '#f5a623', '#4caf50', '#f44336', '#9c27b0',
  '#00bcd4', '#ff5722', '#607d8b', '#e91e63', '#8bc34a',
]

function ProjectSettings() {
  const { activeProject, projects, agents, setActiveProject, setProjects } = useStore()
  const [name, setName] = useState(activeProject?.name || '')
  const [slug, setSlug] = useState(activeProject?.slug || '')
  const [color, setColor] = useState(activeProject?.color || COLORS[0])
  const [orchestratorType, setOrchestratorType] = useState(activeProject?.orchestrator_type || 'human')
  const [orchestratorId, setOrchestratorId] = useState(activeProject?.orchestrator_id || '')
  const [projectAgentIds, setProjectAgentIds] = useState<Set<string>>(new Set())
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (!activeProject) return
    setName(activeProject.name)
    setSlug(activeProject.slug || '')
    setColor(activeProject.color)
    setOrchestratorType(activeProject.orchestrator_type || 'human')
    setOrchestratorId(activeProject.orchestrator_id || '')
    api.get(`/projects/${activeProject.id}/agents`)
      .then(r => setProjectAgentIds(new Set(r.data.map((a: { agent_id: string }) => a.agent_id))))
      .catch(() => setProjectAgentIds(new Set()))
  }, [activeProject?.id])

  if (!activeProject) {
    return (
      <div style={{ padding: '20px 0', color: 'var(--text-muted)', fontSize: 13 }}>
        Select a project from the sidebar to edit its settings.
      </div>
    )
  }

  const projectAgents: Agent[] = agents.filter(a => projectAgentIds.has(a.id))

  const save = async () => {
    if (!name.trim()) return
    setSaving(true)
    try {
      const r = await api.put(`/projects/${activeProject.id}`, {
        name: name.trim(),
        color,
        orchestrator_type: orchestratorType,
        orchestrator_id: orchestratorType === 'agent' && orchestratorId ? orchestratorId : null,
      })
      const updated: Project = r.data
      setActiveProject(updated)
      setProjects(projects.map(p => p.id === updated.id ? updated : p))
      setSaved(true)
      setTimeout(() => setSaved(false), 1500)
    } catch (e: any) {
      alert(e.response?.data?.detail || 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  const del = async () => {
    if (!confirm(`Delete project "${activeProject.name}"? This cannot be undone.`)) return
    await api.delete(`/projects/${activeProject.id}`)
    const updated = projects.filter(p => p.id !== activeProject.id)
    setProjects(updated)
    setActiveProject(updated[0] || null)
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: 12, marginBottom: 14 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 6 }}>PROJECT NAME</div>
          <input
            value={name}
            onChange={e => setName(e.target.value)}
            style={{
              width: '100%', padding: '8px 12px', background: 'var(--bg-elevated)',
              border: '1px solid var(--border)', borderRadius: 6,
              color: 'var(--text-primary)', fontSize: 13, outline: 'none', boxSizing: 'border-box',
            }}
          />
        </div>
        <div style={{ width: 100 }}>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 6 }}>SLUG</div>
          <input
            value={slug}
            readOnly
            title="Slug is set at creation and cannot be changed"
            style={{
              width: '100%', padding: '8px 12px', background: 'var(--bg)',
              border: '1px solid var(--border)', borderRadius: 6,
              color: 'var(--text-muted)', fontSize: 13, outline: 'none',
              fontFamily: 'monospace', fontWeight: 700, letterSpacing: '0.05em',
              cursor: 'not-allowed', boxSizing: 'border-box',
            }}
          />
        </div>
      </div>

      <div style={{ marginBottom: 18 }}>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>PROJECT COLOR</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {COLORS.map(c => (
            <div
              key={c}
              onClick={() => setColor(c)}
              style={{
                width: 28, height: 28, borderRadius: 6, background: c, cursor: 'pointer',
                border: color === c ? '3px solid white' : '2px solid transparent',
                boxShadow: color === c ? `0 0 0 2px ${c}` : 'none',
                transition: 'all 0.1s',
              }}
            />
          ))}
        </div>
      </div>

      <div style={{ marginBottom: 18 }}>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>ORCHESTRATOR</div>
        <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
          {(['human', 'agent'] as const).map(t => (
            <button
              key={t}
              onClick={() => { setOrchestratorType(t); if (t === 'human') setOrchestratorId('') }}
              style={{
                padding: '6px 16px', borderRadius: 6, cursor: 'pointer', fontSize: 13, fontWeight: 600,
                border: `1px solid ${orchestratorType === t ? 'var(--accent)' : 'var(--border)'}`,
                background: orchestratorType === t ? 'rgba(74,158,255,0.12)' : 'var(--bg-elevated)',
                color: orchestratorType === t ? 'var(--accent)' : 'var(--text-muted)',
              }}
            >
              {t === 'human' ? '👑 Human (you)' : '🐺 Agent'}
            </button>
          ))}
        </div>
        {orchestratorType === 'agent' && (
          <div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6 }}>
              Select which agent orchestrates this project
            </div>
            {projectAgents.length === 0 ? (
              <div style={{ fontSize: 12, color: 'var(--danger)', padding: '8px 12px', background: 'rgba(224,82,82,0.08)', borderRadius: 6, border: '1px solid rgba(224,82,82,0.2)' }}>
                No agents assigned to this project yet. Add agents from the Dashboard first.
              </div>
            ) : (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {projectAgents.map(a => (
                  <button
                    key={a.id}
                    onClick={() => setOrchestratorId(orchestratorId === a.id ? '' : a.id)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 6,
                      padding: '6px 12px', borderRadius: 6, cursor: 'pointer', fontSize: 13,
                      border: `1px solid ${orchestratorId === a.id ? 'var(--alpha)' : 'var(--border)'}`,
                      background: orchestratorId === a.id ? 'rgba(255,193,7,0.12)' : 'var(--bg-elevated)',
                      color: orchestratorId === a.id ? 'var(--alpha)' : 'var(--text-secondary)',
                      fontWeight: orchestratorId === a.id ? 700 : 400,
                    }}
                  >
                    <div style={{
                      width: 6, height: 6, borderRadius: '50%',
                      background: a.status === 'online' ? 'var(--online)' : 'var(--offline)',
                    }} />
                    {a.display_name || a.name}
                    {orchestratorId === a.id && ' 👑'}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        <button
          onClick={save}
          disabled={saving}
          style={{
            padding: '8px 20px', background: 'var(--accent)', border: 'none', borderRadius: 6,
            color: 'white', fontSize: 13, fontWeight: 600, cursor: 'pointer',
            display: 'flex', alignItems: 'center', gap: 6,
          }}
        >
          <Save size={13} /> {saving ? 'Saving…' : saved ? 'Saved!' : 'Save Changes'}
        </button>
        <div style={{ flex: 1 }} />
        <button
          onClick={del}
          style={{
            padding: '8px 16px', background: 'rgba(244,67,54,0.1)',
            border: '1px solid rgba(244,67,54,0.3)', borderRadius: 6,
            color: '#f44336', fontSize: 13, cursor: 'pointer',
            display: 'flex', alignItems: 'center', gap: 6,
          }}
        >
          <Trash2 size={13} /> Delete Project
        </button>
      </div>
    </div>
  )
}

export function Settings() {
  const { user } = useStore()
  const [copied, setCopied] = useState(false)

  const copy = (text: string) => {
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div style={{ padding: 28, overflowY: 'auto', height: '100%', maxWidth: 700 }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 6 }}>Settings</h1>
      <p style={{ color: 'var(--text-muted)', marginBottom: 28, fontSize: 14 }}>
        Manage your pack configuration
      </p>

      {/* Project Settings */}
      <div style={{
        background: 'var(--bg-surface)', border: '1px solid var(--border)',
        borderRadius: 12, padding: 24, marginBottom: 20,
      }}>
        <h2 style={{ fontSize: 15, fontWeight: 600, marginBottom: 16 }}>
          📁 Project Settings
        </h2>
        <ProjectSettings />
      </div>

      {/* Alpha credentials */}
      <div style={{
        background: 'var(--bg-surface)', border: '1px solid var(--border)',
        borderRadius: 12, padding: 24, marginBottom: 20,
      }}>
        <h2 style={{ fontSize: 15, fontWeight: 600, marginBottom: 16, color: 'var(--alpha)' }}>
          👑 Alpha Credentials
        </h2>
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 6 }}>ORCHESTRATOR ID</div>
          <code style={{
            fontSize: 13, color: 'var(--text-primary)', background: 'var(--bg-elevated)',
            padding: '8px 12px', borderRadius: 6, display: 'block',
          }}>
            {user?.id}
          </code>
        </div>
        <div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 6 }}>ADMIN API KEY</div>
          <div style={{ display: 'flex', gap: 10 }}>
            <code style={{
              fontSize: 13, color: 'var(--alpha)', background: 'var(--alpha-dim)',
              padding: '8px 12px', borderRadius: 6, flex: 1, wordBreak: 'break-all',
            }}>
              {user?.admin_api_key}
            </code>
            <button
              onClick={() => copy(user?.admin_api_key || '')}
              style={{
                padding: '8px 12px', background: 'var(--bg-elevated)',
                border: '1px solid var(--border)', borderRadius: 6, cursor: 'pointer',
                color: copied ? 'var(--success)' : 'var(--text-muted)',
              }}
            >
              {copied ? <Check size={14} /> : <Copy size={14} />}
            </button>
          </div>
        </div>
      </div>

      {/* How to configure agents */}
      <div style={{
        background: 'var(--bg-surface)', border: '1px solid var(--border)',
        borderRadius: 12, padding: 24, marginBottom: 20,
      }}>
        <h2 style={{ fontSize: 15, fontWeight: 600, marginBottom: 16 }}>
          🐺 How to Configure an Agent
        </h2>
        <ol style={{ paddingLeft: 20, color: 'var(--text-secondary)', fontSize: 14, lineHeight: 2 }}>
          <li>Go to <strong style={{ color: 'var(--text-primary)' }}>The Pack</strong> → click <strong style={{ color: 'var(--alpha)' }}>Add Agent</strong></li>
          <li>Enter the agent name and skills (comma-separated)</li>
          <li>Copy the generated API key <em>(shown once only)</em></li>
          <li>In your agent code, set:</li>
        </ol>
        <pre style={{
          background: 'var(--bg-elevated)', padding: 16, borderRadius: 8,
          fontSize: 12, color: 'var(--text-primary)', overflow: 'auto',
          marginTop: 12, lineHeight: 1.6,
        }}>{`AKELA_API_KEY=akela_your_key_here
AKELA_API_URL=http://your-server:8200

# In HTTP requests:
Authorization: Bearer akela_your_key_here
# OR
X-API-Key: akela_your_key_here`}</pre>

        <div style={{
          marginTop: 16, padding: '12px 16px', background: 'var(--accent-dim)',
          border: '1px solid var(--accent)', borderRadius: 8,
          fontSize: 13, color: 'var(--text-secondary)',
        }}>
          💡 Agent must send <code style={{ color: 'var(--accent)' }}>PUT /agents/{"{id}"}/heartbeat</code> every 30s to appear online.
        </div>
      </div>

      {/* API reference */}
      <div style={{
        background: 'var(--bg-surface)', border: '1px solid var(--border)',
        borderRadius: 12, padding: 24,
      }}>
        <h2 style={{ fontSize: 15, fontWeight: 600, marginBottom: 16 }}>📖 Quick API Reference</h2>
        <pre style={{
          background: 'var(--bg-elevated)', padding: 16, borderRadius: 8,
          fontSize: 12, color: 'var(--text-primary)', overflow: 'auto', lineHeight: 1.8,
        }}>{`# Register agent (use admin API key)
POST /agents/register
Headers: Authorization: Bearer <admin_key>
Body: {"name": "MyBot", "skills": ["coding"]}

# Agent heartbeat
PUT /agents/{id}/heartbeat
Headers: Authorization: Bearer <agent_key>

# Post message to Den
POST /chat/messages
Headers: Authorization: Bearer <agent_key>
Body: {"room": "general", "content": "@all Hello pack!"}

# Get assigned tasks (Hunt)
GET /hunt/tasks?project_id=<id>
Headers: Authorization: Bearer <agent_key>

# Update task status (Hunt)
PUT /hunt/tasks/{id}/status
Body: {"status": "done"}

# SSE real-time stream
GET /chat/subscribe?room=general
Headers: Authorization: Bearer <agent_key>`}</pre>
      </div>
    </div>
  )
}
