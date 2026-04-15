import { useEffect, useState } from 'react'
import { useStore } from '../store'
import type { Agent } from '../store'
import api from '../api'
import { UserPlus, Trash2, RefreshCw, Edit2, Save, X, Zap } from 'lucide-react'

const rankColors: Record<string, string> = {
  alpha: 'var(--alpha)', beta: 'var(--beta)',
  delta: 'var(--delta)', omega: 'var(--omega)',
}

const rankEmoji: Record<string, string> = {
  alpha: '👑', beta: '⭐', delta: '🔵', omega: '🟢',
}

const inputStyle = {
  padding: '8px 10px', background: 'var(--bg-elevated)',
  border: '1px solid var(--border)', borderRadius: 6,
  color: 'var(--text-primary)', fontSize: 12, outline: 'none', width: '100%',
}


function AgentCard({ agent, onDelete, onUpdate, readOnly = false }: {
  agent: Agent, onDelete: (id: string) => void, onUpdate: () => void, readOnly?: boolean
}) {
  const isOnline = agent.status === 'online'
  const rank = agent.rank
  const color = rankColors[rank] || 'var(--text-secondary)'
  const [editing, setEditing] = useState(false)
  const [editDisplayName, setEditDisplayName] = useState(agent.display_name || agent.name)
  const [editSkills, setEditSkills] = useState(agent.skills.join(', '))
  const [editRank, setEditRank] = useState(agent.rank)
  const [editEndpoint, setEditEndpoint] = useState(agent.endpoint_url || '')
  const [editBearerToken, setEditBearerToken] = useState((agent as any).bearer_token || '')
  const [editModel, setEditModel] = useState((agent.soul as any)?.model || '')
  const [editProtocol, setEditProtocol] = useState((agent as any).protocol || 'a2a')
  const [editWorkspaceUrl, setEditWorkspaceUrl] = useState((agent.soul as any)?.workspace_url || '')
  const [discovering, setDiscovering] = useState(false)
  const [saving, setSaving] = useState(false)

  const handleDiscover = async () => {
    if (!editEndpoint.trim()) return
    setDiscovering(true)
    try {
      const r = await api.get(`/agents/${agent.id}/discover`)
      const card = r.data
      if (card.name) setEditDisplayName(card.name)
      if (card.skills?.length) setEditSkills(card.skills.join(', '))
      if (card.model) setEditModel(card.model)
      if (card.streaming) {
        // Store streaming capability in soul so a2a_caller knows to use sendSubscribe
      }
    } catch (e: any) {
      alert(e.response?.data?.detail || 'Could not fetch Agent Card from endpoint')
    } finally {
      setDiscovering(false)
    }
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      await api.put(`/agents/${agent.id}`, {
        display_name: editDisplayName.trim(),
        skills: editSkills.split(',').map(s => s.trim()).filter(Boolean),
        rank: editRank,
        endpoint_url: editEndpoint.trim(),
        protocol: editProtocol,
        bearer_token: editBearerToken.trim(),
        soul: {
          ...((agent.soul as any) || {}),
          model: editModel.trim(),
          workspace_url: editWorkspaceUrl.trim() || undefined,
          a2a_streaming: editProtocol === 'a2a' ? true : undefined,
        },
      })
      setEditing(false)
      onUpdate()
    } catch (e: any) {
      alert(e.response?.data?.detail || 'Failed to update')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{
      background: 'var(--bg-surface)', border: `1px solid ${editing ? color : 'var(--border)'}`,
      borderRadius: 12, padding: 20, position: 'relative',
      borderTop: `3px solid ${color}`,
      transition: 'border-color 0.2s',
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{
            width: 10, height: 10, borderRadius: '50%', marginTop: 2,
            background: isOnline ? 'var(--online)' : 'var(--offline)',
            boxShadow: isOnline ? '0 0 0 3px rgba(76,175,80,0.2)' : 'none',
          }} className={isOnline ? 'pulse-online' : ''} />
          <div>
            <div style={{ fontWeight: 700, fontSize: 15 }}>🐺 {agent.display_name || agent.name}</div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 1 }}>
              @{agent.name} · {isOnline ? 'Online' : agent.last_seen_at
                ? `Last seen ${new Date(agent.last_seen_at).toLocaleTimeString()}`
                : 'Never connected'}
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <span style={{
            fontSize: 11, fontWeight: 700, padding: '3px 9px', borderRadius: 12,
            background: `${color}22`, color,
          }}>
            {rankEmoji[rank]} {rank.toUpperCase()}
          </span>
          {!readOnly && (
            <button className="touch-target" onClick={() => setEditing(!editing)} style={{
              background: 'transparent', border: 'none', color: editing ? color : 'var(--text-muted)',
              cursor: 'pointer', padding: 4,
            }} title="Edit agent">
              <Edit2 size={14} />
            </button>
          )}
        </div>
      </div>

      {/* Skills */}
      {!editing && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6, fontWeight: 600 }}>SKILLS</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {agent.skills.length === 0 ? (
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>None defined</span>
            ) : agent.skills.map(s => (
              <span key={s} style={{
                fontSize: 11, padding: '2px 8px', borderRadius: 10,
                background: 'var(--bg-hover)', color: 'var(--text-secondary)',
                border: '1px solid var(--border)',
              }}>
                {s}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Endpoint URL */}
      {!editing && agent.endpoint_url && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600 }}>ENDPOINT</div>
            {(agent as any).protocol && (agent as any).protocol !== 'openai' && (
              <span style={{
                fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 8,
                background: (agent as any).protocol === 'a2a' ? 'rgba(96,165,250,0.15)'
                          : (agent as any).protocol === 'acp' ? 'rgba(52,211,153,0.15)'
                          : 'rgba(167,139,250,0.15)',
                color: (agent as any).protocol === 'a2a' ? 'var(--accent)'
                     : (agent as any).protocol === 'acp' ? '#34d399'
                     : '#a78bfa',
                border: `1px solid ${
                  (agent as any).protocol === 'a2a' ? 'rgba(96,165,250,0.3)'
                  : (agent as any).protocol === 'acp' ? 'rgba(52,211,153,0.3)'
                  : 'rgba(167,139,250,0.3)'
                }`,
              }}>
                {((agent as any).protocol as string).toUpperCase()}
              </span>
            )}
          </div>
          <code style={{
            fontSize: 11, color: 'var(--accent)', background: 'var(--bg-elevated)',
            padding: '4px 8px', borderRadius: 4, display: 'block',
            border: '1px solid var(--border)', wordBreak: 'break-all',
          }}>{agent.endpoint_url}</code>
        </div>
      )}

      {/* Edit panel */}
      {editing && (
        <div style={{ marginTop: 8 }}>
          <div className="form-row-stack" style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 4 }}>DISPLAY NAME</div>
              <input value={editDisplayName} onChange={e => setEditDisplayName(e.target.value)} style={inputStyle} />
            </div>
            <div style={{ width: 100 }}>
              <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 4 }}>RANK</div>
              <select value={editRank} onChange={e => setEditRank(e.target.value as 'omega' | 'delta' | 'beta' | 'alpha')} style={{ ...inputStyle, width: 100 }}>
                <option value="omega">🟢 Omega</option>
                <option value="delta">🔵 Delta</option>
                <option value="beta">⭐ Beta</option>
                <option value="alpha">👑 Alpha</option>
              </select>
            </div>
          </div>
          <div style={{ marginBottom: 8 }}>
            <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 4 }}>SKILLS (comma-separated)</div>
            <input value={editSkills} onChange={e => setEditSkills(e.target.value)} style={inputStyle} />
          </div>
          <div className="form-row-stack" style={{ display: 'flex', gap: 8, marginBottom: 4 }}>
            <div style={{ flex: 2 }}>
              <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 4 }}>ENDPOINT URL</div>
              <input value={editEndpoint} onChange={e => setEditEndpoint(e.target.value)} placeholder="http://..." style={inputStyle} />
            </div>
            <div style={{ width: 130 }}>
              <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 4 }}>PROTOCOL</div>
              <select value={editProtocol} onChange={e => setEditProtocol(e.target.value)} style={{ ...inputStyle, width: 130 }}>
                <option value="a2a">A2A (default)</option>
                <option value="openai">OpenAI-compatible</option>
              </select>
            </div>
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 8, paddingLeft: 2 }}>
            {editProtocol === 'a2a' && '↳ Google A2A — supports Den chat + Hunt task dispatch. Exposes /.well-known/agent.json and tasks/sendSubscribe.'}
            {editProtocol === 'openai' && '↳ OpenAI-compatible — Den chat only. Task dispatch requires A2A. Exposes /v1/chat/completions.'}
          </div>
          <div style={{ marginBottom: 8 }}>
            <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 4 }}>BEARER TOKEN <span style={{ fontWeight: 400 }}>(optional — sent as Authorization header)</span></div>
            <input value={editBearerToken} onChange={e => setEditBearerToken(e.target.value)} placeholder="Leave blank if not required" type="password" style={inputStyle} />
          </div>
          <div className="form-row-stack" style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 4 }}>MODEL</div>
              <input value={editModel} onChange={e => setEditModel(e.target.value)} placeholder="e.g. MiniMax-M2.7" style={inputStyle} />
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 4 }}>WORKSPACE URL</div>
              <input value={editWorkspaceUrl} onChange={e => setEditWorkspaceUrl(e.target.value)} placeholder="http://host:9102" style={inputStyle} />
            </div>
            {editProtocol === 'a2a' && editEndpoint.trim() && (
              <div style={{ display: 'flex', alignItems: 'flex-end', paddingBottom: 1 }}>
                <button onClick={handleDiscover} disabled={discovering} style={{
                  padding: '8px 12px', background: 'rgba(96,165,250,0.1)',
                  border: '1px solid rgba(96,165,250,0.3)', borderRadius: 6,
                  color: 'var(--accent)', fontSize: 11, cursor: 'pointer',
                  display: 'flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap',
                }}>
                  <Zap size={11} /> {discovering ? 'Fetching…' : 'Discover'}
                </button>
              </div>
            )}
          </div>

          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button onClick={handleSave} disabled={saving} style={{
              padding: '6px 16px', background: 'var(--accent)', border: 'none', borderRadius: 6,
              color: 'white', fontSize: 12, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4,
            }}>
              <Save size={12} /> {saving ? 'Saving...' : 'Save'}
            </button>
            <button onClick={() => setEditing(false)} style={{
              padding: '6px 12px', background: 'var(--bg-elevated)', border: '1px solid var(--border)',
              borderRadius: 6, color: 'var(--text-secondary)', fontSize: 12, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4,
            }}>
              <X size={12} /> Cancel
            </button>
            <div style={{ flex: 1 }} />
            <button onClick={() => onDelete(agent.id)} style={{
              padding: '6px 10px', background: 'rgba(244,67,54,0.1)', border: '1px solid rgba(244,67,54,0.3)',
              borderRadius: 6, color: '#f44336', fontSize: 11, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4,
            }}>
              <Trash2 size={12} /> Delete
            </button>
          </div>

        </div>
      )}

      {/* Footer: Files link + project toggle + delete */}
      {!editing && (() => {
        const fbUrl = (agent.soul as any)?.workspace_url || null
        return (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 12, paddingTop: 10, borderTop: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {fbUrl ? (
            <a
              href={fbUrl}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                fontSize: 12, color: 'var(--accent)', textDecoration: 'none',
                padding: '4px 10px', borderRadius: 6,
                background: 'rgba(96, 165, 250, 0.08)',
                border: '1px solid rgba(96, 165, 250, 0.2)',
                transition: 'all 0.15s',
              }}
              onMouseEnter={e => { e.currentTarget.style.background = 'rgba(96, 165, 250, 0.15)' }}
              onMouseLeave={e => { e.currentTarget.style.background = 'rgba(96, 165, 250, 0.08)' }}
            >
              📁 Workspace
            </a>
            ) : (
            <span style={{ fontSize: 12, color: 'var(--text-muted)', padding: '4px 10px' }}>
              📁 Workspace (offline)
            </span>
            )}
          </div>
          {!readOnly && (
            <button
              onClick={() => onDelete(agent.id)}
              style={{
                background: 'transparent', border: 'none',
                color: 'var(--text-muted)', cursor: 'pointer', padding: 4,
              }}
              title="Remove agent"
            >
              <Trash2 size={14} />
            </button>
          )}
        </div>
        )
      })()}
    </div>
  )
}

export function Pack({ globalMode = false }: { globalMode?: boolean }) {
  const { agents, setAgents, activeProject } = useStore()
  const [projectAgentIds, setProjectAgentIds] = useState<Set<string>>(new Set())
  const [showAdd, setShowAdd] = useState(false)
  const [name, setName] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [endpointUrl, setEndpointUrl] = useState('')
  const [bearerToken, setBearerToken] = useState('')
  const [skills, setSkills] = useState('')
  const [rank, setRank] = useState('omega')
  const [protocol, setProtocol] = useState('a2a')
  const [model, setModel] = useState('')
  const [workspaceUrl, setWorkspaceUrl] = useState('')
  const [registered, setRegistered] = useState(false)
  const [loading, setLoading] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [discovering, setDiscovering] = useState(false)

  const resetForm = () => {
    setName(''); setDisplayName(''); setEndpointUrl(''); setBearerToken(''); setSkills('')
    setRank('omega'); setProtocol('a2a'); setModel(''); setWorkspaceUrl('')
    setRegistered(false); setShowAdd(false)
  }

  const load = async () => {
    setRefreshing(true)
    try { const r = await api.get('/agents/'); setAgents(r.data) } catch(e) { console.error(e) }
    finally { setRefreshing(false) }
  }
  useEffect(() => { load() }, [])

const handleDiscoverNew = async () => {
    if (!endpointUrl.trim()) return
    setDiscovering(true)
    try {
      const r = await api.post('/agents/discover-url', { url: endpointUrl.trim(), protocol })
      const card = r.data
      if (card.name) setDisplayName(card.name)
      if (!name.trim() && card.name) setName(card.name.toLowerCase().replace(/\s+/g, '-'))
      if (card.skills?.length) setSkills(card.skills.join(', '))
      if (card.model) setModel(card.model)
    } catch (e: any) {
      alert(e.response?.data?.detail || 'Could not fetch Agent Card from endpoint')
    } finally {
      setDiscovering(false)
    }
  }

  const addAgent = async () => {
    if (!name.trim()) return
    setLoading(true)
    try {
      await api.post('/agents/register', {
        name: name.trim(),
        display_name: displayName.trim() || name.trim(),
        skills: skills.split(',').map(s => s.trim()).filter(Boolean),
        rank,
        protocol,
        endpoint_url: endpointUrl.trim() || undefined,
        bearer_token: bearerToken.trim() || undefined,
        soul: {
          ...(model.trim() ? { model: model.trim() } : {}),
          ...(workspaceUrl.trim() ? { workspace_url: workspaceUrl.trim() } : {}),
          ...(protocol === 'a2a' ? { a2a_streaming: true } : {}),
        },
      })
      setName(''); setDisplayName(''); setEndpointUrl(''); setBearerToken(''); setSkills('')
      setRank('omega'); setProtocol('a2a'); setModel(''); setWorkspaceUrl('')
      setRegistered(true)
      load()
    } catch(e: any) {
      alert(e.response?.data?.detail || 'Failed to register agent')
    } finally {
      setLoading(false)
    }
  }

  const deleteAgent = async (id: string) => {
    if (!confirm('Remove this agent from the pack?')) return
    await api.delete(`/agents/${id}`)
    load()
  }

  useEffect(() => {
    if (!activeProject) { setProjectAgentIds(new Set()); return }
    api.get(`/projects/${activeProject.id}/agents`)
      .then(r => setProjectAgentIds(new Set(r.data.map((a: { agent_id: string }) => a.agent_id))))
      .catch(() => setProjectAgentIds(new Set()))
  }, [activeProject?.id])

  // globalMode = all agents, full edit. project mode = project agents only, read-only.
  const visibleAgents = globalMode
    ? agents
    : activeProject
      ? agents.filter(a => projectAgentIds.has(a.id))
      : agents
  const online = visibleAgents.filter(a => a.status === 'online')

  return (
    <div style={{ padding: 28, overflowY: 'auto', height: '100%' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 4 }}>The Pack</h1>
          <p style={{ color: 'var(--text-muted)', fontSize: 14 }}>
            {globalMode
              ? `${agents.length} agents · ${online.length} online`
              : activeProject
                ? <>{activeProject.name} · {visibleAgents.length} agents · {online.length} online · <span style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>read-only</span></>
                : `${agents.length} agents · ${online.length} online`
            }
          </p>
        </div>
        {globalMode && (
          <div style={{ display: 'flex', gap: 10 }}>
            <button onClick={load} disabled={refreshing} style={{
              padding: '8px 14px', background: 'var(--bg-elevated)',
              border: '1px solid var(--border)', borderRadius: 8,
              color: 'var(--text-secondary)', cursor: refreshing ? 'default' : 'pointer',
              display: 'flex', alignItems: 'center', gap: 6, opacity: refreshing ? 0.6 : 1,
            }}>
              <RefreshCw size={14} style={{ animation: refreshing ? 'spin 0.8s linear infinite' : 'none' }} /> {refreshing ? 'Refreshing…' : 'Refresh'}
              <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
            </button>
            <button onClick={() => setShowAdd(!showAdd)} style={{
              padding: '8px 16px', background: 'var(--accent)',
              border: 'none', borderRadius: 8, color: 'white',
              cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, fontWeight: 600,
            }}>
              <UserPlus size={15} /> Add Agent
            </button>
          </div>
        )}
      </div>

      {/* Add form — global mode only */}
      {globalMode && showAdd && (
        <div style={{
          background: 'var(--bg-surface)', border: '1px solid var(--accent)',
          borderRadius: 12, padding: 20, marginBottom: 24,
        }}>
          <h3 style={{ marginBottom: 14, fontSize: 14, fontWeight: 600 }}>🐺 Register New Agent</h3>

          {/* Row 1: Protocol + Endpoint + Discover */}
          <div style={{ display: 'flex', gap: 12, marginBottom: 4, alignItems: 'flex-end' }}>
            <div style={{ width: 160 }}>
              <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 4 }}>PROTOCOL</div>
              <select
                value={protocol}
                onChange={e => setProtocol(e.target.value)}
                style={{
                  width: '100%', padding: '10px 12px', background: 'var(--bg-elevated)',
                  border: '1px solid var(--border)', borderRadius: 8,
                  color: 'var(--text-primary)', fontSize: 13, outline: 'none',
                }}
              >
                <option value="a2a">A2A (default)</option>
                <option value="openai">OpenAI-compatible</option>
              </select>
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 4 }}>ENDPOINT URL</div>
              <input
                placeholder="https://your-agent-host:port"
                value={endpointUrl}
                onChange={e => setEndpointUrl(e.target.value)}
                style={{
                  width: '100%', padding: '10px 12px', background: 'var(--bg-elevated)',
                  border: '1px solid var(--border)', borderRadius: 8,
                  color: 'var(--text-primary)', fontSize: 13, outline: 'none', boxSizing: 'border-box',
                }}
              />
            </div>
            {protocol === 'a2a' && endpointUrl.trim() && (
              <button onClick={handleDiscoverNew} disabled={discovering} style={{
                padding: '10px 14px', background: 'rgba(96,165,250,0.1)',
                border: '1px solid rgba(96,165,250,0.3)', borderRadius: 8,
                color: 'var(--accent)', fontSize: 12, cursor: 'pointer',
                display: 'flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap', flexShrink: 0,
              }}>
                <Zap size={13} /> {discovering ? 'Fetching…' : 'Discover'}
              </button>
            )}
          </div>
          {/* Protocol hint */}
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 12, paddingLeft: 2 }}>
            {protocol === 'a2a' && '↳ Google A2A — supports Den chat + Hunt task dispatch. Exposes /.well-known/agent.json and tasks/sendSubscribe.'}
            {protocol === 'openai' && '↳ OpenAI-compatible — Den chat only. Task dispatch requires A2A. Exposes /v1/chat/completions.'}
          </div>

          {/* Bearer token */}
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 4 }}>BEARER TOKEN <span style={{ fontWeight: 400 }}>(optional — sent as Authorization header)</span></div>
            <input
              placeholder="Leave blank if not required"
              value={bearerToken}
              onChange={e => setBearerToken(e.target.value)}
              type="password"
              style={{
                width: '100%', padding: '10px 12px', background: 'var(--bg-elevated)',
                border: '1px solid var(--border)', borderRadius: 8,
                color: 'var(--text-primary)', fontSize: 13, outline: 'none', boxSizing: 'border-box',
              }}
            />
          </div>

          {/* Row 2: Identity */}
          <div style={{ display: 'flex', gap: 12, marginBottom: 12 }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 4 }}>DISPLAY NAME <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>(shown in UI)</span></div>
              <input
                placeholder="e.g. Research Bot"
                value={displayName}
                onChange={e => setDisplayName(e.target.value)}
                style={{
                  width: '100%', padding: '10px 12px', background: 'var(--bg-elevated)',
                  border: '1px solid var(--border)', borderRadius: 8,
                  color: 'var(--text-primary)', fontSize: 13, outline: 'none', boxSizing: 'border-box',
                }}
              />
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 4 }}>INTERNAL NAME <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>(unique key, no spaces)</span></div>
              <input
                placeholder="e.g. researcher"
                value={name}
                onChange={e => setName(e.target.value)}
                style={{
                  width: '100%', padding: '10px 12px', background: 'var(--bg-elevated)',
                  border: '1px solid var(--border)', borderRadius: 8,
                  color: 'var(--text-primary)', fontSize: 13, outline: 'none', boxSizing: 'border-box',
                }}
              />
            </div>
            <div style={{ width: 120 }}>
              <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 4 }}>RANK</div>
              <select
                value={rank}
                onChange={e => setRank(e.target.value)}
                style={{
                  width: 120, padding: '10px 12px', background: 'var(--bg-elevated)',
                  border: '1px solid var(--border)', borderRadius: 8,
                  color: 'var(--text-primary)', fontSize: 13, outline: 'none',
                }}
              >
                <option value="omega">🟢 Omega</option>
                <option value="delta">🔵 Delta</option>
                <option value="beta">⭐ Beta</option>
                <option value="alpha">👑 Alpha</option>
              </select>
            </div>
          </div>

          {/* Row 3: Skills + Model */}
          <div style={{ display: 'flex', gap: 12, marginBottom: 12 }}>
            <input
              placeholder="Skills: research, coding, analysis"
              value={skills}
              onChange={e => setSkills(e.target.value)}
              style={{
                flex: 2, padding: '10px 12px', background: 'var(--bg-elevated)',
                border: '1px solid var(--border)', borderRadius: 8,
                color: 'var(--text-primary)', fontSize: 13, outline: 'none',
              }}
            />
            <input
              placeholder="Model (e.g. MiniMax-M2.7)"
              value={model}
              onChange={e => setModel(e.target.value)}
              style={{
                flex: 1, padding: '10px 12px', background: 'var(--bg-elevated)',
                border: '1px solid var(--border)', borderRadius: 8,
                color: 'var(--text-primary)', fontSize: 13, outline: 'none',
              }}
            />
            <input
              placeholder="Workspace URL (e.g. http://host:9102)"
              value={workspaceUrl}
              onChange={e => setWorkspaceUrl(e.target.value)}
              style={{
                flex: 1, padding: '10px 12px', background: 'var(--bg-elevated)',
                border: '1px solid var(--border)', borderRadius: 8,
                color: 'var(--text-primary)', fontSize: 13, outline: 'none',
              }}
            />
          </div>

          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <button
              onClick={addAgent}
              disabled={loading || !name.trim()}
              style={{
                padding: '10px 24px', background: name.trim() ? 'var(--alpha)' : 'var(--bg-elevated)',
                border: 'none', borderRadius: 8, color: name.trim() ? '#000' : 'var(--text-muted)',
                fontWeight: 700, cursor: name.trim() ? 'pointer' : 'default',
              }}
            >
              {loading ? '…' : 'Register Agent'}
            </button>
            <button
              onClick={resetForm}
              style={{
                padding: '10px 18px', background: 'var(--bg-elevated)',
                border: '1px solid var(--border)', borderRadius: 8,
                color: 'var(--text-secondary)', cursor: 'pointer', fontSize: 13,
              }}
            >
              Cancel
            </button>
          </div>

          {registered && (
            <div style={{
              padding: '12px 16px', background: 'rgba(76,175,80,0.1)',
              border: '1px solid var(--success)', borderRadius: 8, marginTop: 12,
            }}>
              <div style={{ fontSize: 12, color: 'var(--success)', fontWeight: 700 }}>
                ✅ Agent registered! It will appear online once its endpoint is reachable.
              </div>
            </div>
          )}
        </div>
      )}

      {/* Grid */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
        gap: 16,
      }}>
        {visibleAgents.map(a => (
          <AgentCard
            key={a.id} agent={a}
            onDelete={globalMode ? deleteAgent : () => {}}
            onUpdate={globalMode ? load : () => {}}
            readOnly={!globalMode}
          />
        ))}
      </div>

      {visibleAgents.length === 0 && !showAdd && (
        <div style={{ textAlign: 'center', color: 'var(--text-muted)', marginTop: 60 }}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>🐺</div>
          {activeProject ? (
            <>
              <div style={{ fontSize: 16, marginBottom: 8 }}>No agents in {activeProject.name}.</div>
              <div style={{ fontSize: 13 }}>Go to Dashboard to assign agents to this project.</div>
            </>
          ) : (
            <>
              <div style={{ fontSize: 16, marginBottom: 8 }}>The pack is empty.</div>
              <div style={{ fontSize: 13 }}>Click "Add Agent" to register your first agent.</div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
