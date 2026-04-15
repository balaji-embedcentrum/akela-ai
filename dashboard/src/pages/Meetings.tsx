import { useEffect, useState } from 'react'
import api from '../api'
import { useStore } from '../store'
import { Mic2, Play, Plus, Trash2, ChevronDown, ChevronRight, Clock, Calendar, Check } from 'lucide-react'

interface StandupConfig {
  id: string
  name: string
  description: string
  project_id: string | null
  schedule_time: string | null
  schedule_days: string | null
  created_at: string
  last_run_at: string | null
}

interface MeetingRun {
  id: string
  standup_config_id: string | null
  project_id: string | null
  name: string | null
  type: string
  status: string
  transcript: { responses?: MeetingRunResponse[]; started_at?: string }
  scheduled_at: string
  completed_at: string | null
}

interface MeetingRunResponse {
  agent_name: string
  content: string
  timestamp?: string
}

export function Meetings() {
  const { activeProject } = useStore()
  const [configs, setConfigs] = useState<StandupConfig[]>([])
  const [selected, setSelected] = useState<StandupConfig | null>(null)
  const [runs, setRuns] = useState<MeetingRun[]>([])
  const [expandedRuns, setExpandedRuns] = useState<Set<string>>(new Set())
  const [creating, setCreating] = useState(false)
  const [running, setRunning] = useState(false)
  const [editForm, setEditForm] = useState<Partial<StandupConfig>>({})
  const [editDirty, setEditDirty] = useState(false)
  const [saving, setSaving] = useState(false)

  // New standup form state
  const [newForm, setNewForm] = useState({ name: '', description: '', schedule_time: '', schedule_days: '' })

  const loadConfigs = async () => {
    if (!activeProject) { setConfigs([]); setSelected(null); setRuns([]); return }
    try {
      const r = await api.get(`/meetings/configs?project_id=${activeProject.id}`)
      setConfigs(r.data)
    } catch (e) {
      console.error(e)
    }
  }

  const loadRuns = async (configId: string) => {
    try {
      const r = await api.get(`/meetings/configs/${configId}/runs`)
      setRuns(r.data)
    } catch (e) {
      console.error(e)
    }
  }

  useEffect(() => { loadConfigs() }, [activeProject?.id])

  const selectConfig = (cfg: StandupConfig) => {
    setSelected(cfg)
    setEditForm({ name: cfg.name, description: cfg.description, schedule_time: cfg.schedule_time ?? '', schedule_days: cfg.schedule_days ?? '' })
    setEditDirty(false)
    loadRuns(cfg.id)
    setExpandedRuns(new Set())
  }

  const handleCreate = async () => {
    if (!newForm.name.trim() || !activeProject) return
    try {
      await api.post('/meetings/configs', {
        name: newForm.name.trim(),
        description: newForm.description.trim(),
        schedule_time: newForm.schedule_time || null,
        schedule_days: newForm.schedule_days || null,
        project_id_fk: activeProject.id,
      })
      setNewForm({ name: '', description: '', schedule_time: '', schedule_days: '' })
      setCreating(false)
      await loadConfigs()
    } catch (e) {
      console.error(e)
      alert('Failed to create standup config')
    }
  }

  const handleSaveEdit = async () => {
    if (!selected) return
    setSaving(true)
    try {
      const r = await api.put(`/meetings/configs/${selected.id}`, {
        name: editForm.name || selected.name,
        description: editForm.description ?? selected.description,
        schedule_time: editForm.schedule_time || null,
        schedule_days: editForm.schedule_days || null,
      })
      setSelected(r.data)
      setEditDirty(false)
      await loadConfigs()
    } catch (e) {
      console.error(e)
      alert('Failed to save changes')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (cfg: StandupConfig) => {
    if (!confirm(`Delete standup "${cfg.name}"? This will also delete all run history.`)) return
    try {
      await api.delete(`/meetings/configs/${cfg.id}`)
      if (selected?.id === cfg.id) {
        setSelected(null)
        setRuns([])
      }
      await loadConfigs()
    } catch (e) {
      console.error(e)
    }
  }

  const handleRun = async () => {
    if (!selected) return
    setRunning(true)
    try {
      await api.post(`/meetings/configs/${selected.id}/run`)
      await loadRuns(selected.id)
      await loadConfigs()
    } catch (e) {
      console.error(e)
      alert('Failed to run standup')
    } finally {
      setRunning(false)
    }
  }

  const toggleRun = (runId: string) => {
    setExpandedRuns(prev => {
      const s = new Set(prev)
      s.has(runId) ? s.delete(runId) : s.add(runId)
      return s
    })
  }

  const statusColor = (status: string) =>
    status === 'complete' ? 'var(--success)' : status === 'active' ? 'var(--alpha)' : 'var(--text-muted)'
  const statusBg = (status: string) =>
    status === 'complete' ? 'rgba(76,175,80,0.1)' : status === 'active' ? 'rgba(245,166,35,0.1)' : 'rgba(120,120,120,0.1)'

  const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']
  const toggleDay = (day: string) => {
    const current = (editForm.schedule_days || '').split(',').filter(Boolean)
    const next = current.includes(day) ? current.filter(d => d !== day) : [...current, day]
    setEditForm(f => ({ ...f, schedule_days: next.join(',') }))
    setEditDirty(true)
  }

  if (!activeProject) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', color: 'var(--text-muted)' }}>
        <Mic2 size={40} style={{ marginBottom: 12, opacity: 0.3 }} />
        <div style={{ fontSize: 15 }}>Select a project in the sidebar to see howls.</div>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden' }}>
      {/* ── Left panel: standup config list ── */}
      <div style={{
        width: 280, borderRight: '1px solid var(--border)', display: 'flex', flexDirection: 'column',
        background: 'var(--bg-surface)', flexShrink: 0,
      }}>
        <div style={{ padding: '18px 16px 12px', borderBottom: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
            <h2 style={{ fontSize: 15, fontWeight: 700, margin: 0 }}>The Howl</h2>
            <button
              onClick={() => setCreating(c => !c)}
              style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 6, padding: '4px 8px', cursor: 'pointer', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 4, fontSize: 12 }}
            >
              <Plus size={13} /> New
            </button>
          </div>
          <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: 0 }}>{activeProject.name} · Scheduled standups</p>
        </div>

        {/* New standup form */}
        {creating && (
          <div style={{ padding: 12, borderBottom: '1px solid var(--border)', background: 'var(--bg-elevated)' }}>
            <input
              placeholder="Standup name *"
              value={newForm.name}
              onChange={e => setNewForm(f => ({ ...f, name: e.target.value }))}
              style={inputStyle}
            />
            <input
              placeholder="Description"
              value={newForm.description}
              onChange={e => setNewForm(f => ({ ...f, description: e.target.value }))}
              style={{ ...inputStyle, marginTop: 6 }}
            />
            <input
              placeholder="Time (HH:MM)"
              value={newForm.schedule_time}
              onChange={e => setNewForm(f => ({ ...f, schedule_time: e.target.value }))}
              style={{ ...inputStyle, marginTop: 6 }}
            />
            <input
              placeholder="Days (e.g. mon,tue,wed)"
              value={newForm.schedule_days}
              onChange={e => setNewForm(f => ({ ...f, schedule_days: e.target.value }))}
              style={{ ...inputStyle, marginTop: 6 }}
            />
            <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
              <button onClick={handleCreate} style={{ ...btnStyle, flex: 1, background: 'var(--alpha)', color: '#000' }}>Create</button>
              <button onClick={() => setCreating(false)} style={{ ...btnStyle, flex: 1 }}>Cancel</button>
            </div>
          </div>
        )}

        {/* Config list */}
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {configs.length === 0 ? (
            <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
              No standup configs yet.<br />Click New to create one.
            </div>
          ) : configs.map(cfg => (
            <div
              key={cfg.id}
              onClick={() => selectConfig(cfg)}
              style={{
                padding: '12px 14px', cursor: 'pointer', borderBottom: '1px solid var(--border)',
                background: selected?.id === cfg.id ? 'var(--bg-elevated)' : 'transparent',
                borderLeft: selected?.id === cfg.id ? '3px solid var(--alpha)' : '3px solid transparent',
                transition: 'background 0.15s',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                  <Mic2 size={13} color="var(--alpha)" />
                  <span style={{ fontSize: 13, fontWeight: 600 }}>{cfg.name}</span>
                </div>
                <button
                  onClick={e => { e.stopPropagation(); handleDelete(cfg) }}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 2, opacity: 0.5 }}
                  title="Delete"
                >
                  <Trash2 size={12} />
                </button>
              </div>
              {cfg.schedule_time && (
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
                  <Clock size={10} /> {cfg.schedule_time}
                  {cfg.schedule_days && <span> · {cfg.schedule_days}</span>}
                </div>
              )}
              {cfg.last_run_at && (
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                  Last run: {new Date(cfg.last_run_at).toLocaleDateString()}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* ── Right panel: config detail + run history ── */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 28 }}>
        {!selected ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-muted)' }}>
            <Mic2 size={40} style={{ marginBottom: 12, opacity: 0.3 }} />
            <div style={{ fontSize: 15 }}>Select a standup to view details</div>
            <div style={{ fontSize: 13, marginTop: 4 }}>or create a new one with the + New button</div>
          </div>
        ) : (
          <>
            {/* Config detail */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 }}>
              <div>
                <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 4 }}>{selected.name}</h1>
                <p style={{ color: 'var(--text-muted)', fontSize: 13, margin: 0 }}>
                  {selected.description || 'No description'}
                </p>
              </div>
              <button
                onClick={handleRun}
                disabled={running}
                style={{
                  padding: '9px 18px', background: 'var(--alpha)', border: 'none',
                  borderRadius: 8, color: '#000', fontWeight: 700,
                  cursor: running ? 'wait' : 'pointer',
                  display: 'flex', alignItems: 'center', gap: 7, fontSize: 13,
                  flexShrink: 0,
                }}
              >
                <Play size={14} />
                {running ? 'Starting...' : 'Run Now'}
              </button>
            </div>

            {/* Edit fields */}
            <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 10, padding: 18, marginBottom: 24 }}>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 12, color: 'var(--text-muted)' }}>SCHEDULE</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
                <div>
                  <label style={labelStyle}>Name</label>
                  <input
                    value={editForm.name ?? ''}
                    onChange={e => { setEditForm(f => ({ ...f, name: e.target.value })); setEditDirty(true) }}
                    style={inputStyle}
                  />
                </div>
                <div>
                  <label style={labelStyle}>Time (HH:MM)</label>
                  <input
                    placeholder="09:00"
                    value={editForm.schedule_time ?? ''}
                    onChange={e => { setEditForm(f => ({ ...f, schedule_time: e.target.value })); setEditDirty(true) }}
                    style={inputStyle}
                  />
                </div>
              </div>
              <div style={{ marginBottom: 12 }}>
                <label style={labelStyle}>Description</label>
                <input
                  value={editForm.description ?? ''}
                  onChange={e => { setEditForm(f => ({ ...f, description: e.target.value })); setEditDirty(true) }}
                  style={inputStyle}
                />
              </div>
              <div style={{ marginBottom: 14 }}>
                <label style={labelStyle}>Days</label>
                <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                  {DAYS.map(day => {
                    const active = (editForm.schedule_days || '').split(',').includes(day)
                    return (
                      <button
                        key={day}
                        onClick={() => toggleDay(day)}
                        style={{
                          padding: '4px 10px', borderRadius: 6, border: '1px solid var(--border)',
                          background: active ? 'var(--alpha)' : 'var(--bg-elevated)',
                          color: active ? '#000' : 'var(--text-muted)',
                          fontWeight: active ? 700 : 400,
                          cursor: 'pointer', fontSize: 12, textTransform: 'uppercase',
                        }}
                      >
                        {day}
                      </button>
                    )
                  })}
                </div>
              </div>
              {editDirty && (
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    onClick={handleSaveEdit}
                    disabled={saving}
                    style={{ ...btnStyle, background: 'var(--alpha)', color: '#000', display: 'flex', alignItems: 'center', gap: 6 }}
                  >
                    <Check size={13} /> {saving ? 'Saving...' : 'Save Changes'}
                  </button>
                  <button
                    onClick={() => { setEditForm({ name: selected.name, description: selected.description, schedule_time: selected.schedule_time ?? '', schedule_days: selected.schedule_days ?? '' }); setEditDirty(false) }}
                    style={btnStyle}
                  >
                    Discard
                  </button>
                </div>
              )}
            </div>

            {/* Run history */}
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 12, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 6 }}>
              <Calendar size={13} /> RUN HISTORY
            </div>
            {runs.length === 0 ? (
              <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '32px 0', fontSize: 13 }}>
                No runs yet. Click Run Now to trigger the first Howl.
              </div>
            ) : runs.map(run => {
              const expanded = expandedRuns.has(run.id)
              const responses = run.transcript?.responses ?? []
              return (
                <div key={run.id} style={{
                  background: 'var(--bg-surface)', border: '1px solid var(--border)',
                  borderRadius: 10, marginBottom: 10, overflow: 'hidden',
                }}>
                  <div
                    onClick={() => toggleRun(run.id)}
                    style={{ padding: '12px 16px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                      <span style={{ fontSize: 13 }}>
                        {new Date(run.scheduled_at).toLocaleString()}
                      </span>
                      <span style={{
                        fontSize: 11, padding: '2px 8px', borderRadius: 10,
                        background: statusBg(run.status), color: statusColor(run.status),
                      }}>
                        {run.status}
                      </span>
                    </div>
                    <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                      {responses.length} response{responses.length !== 1 ? 's' : ''}
                    </span>
                  </div>
                  {expanded && (
                    <div style={{ borderTop: '1px solid var(--border)', padding: '10px 16px 14px' }}>
                      {responses.length === 0 ? (
                        <div style={{ color: 'var(--text-muted)', fontSize: 12 }}>No responses recorded.</div>
                      ) : responses.map((resp, i) => (
                        <div key={i} style={{
                          padding: '8px 12px', background: 'var(--bg-elevated)',
                          borderRadius: 8, marginBottom: 8, fontSize: 13,
                        }}>
                          <div style={{ fontWeight: 600, color: 'var(--delta)', marginBottom: 4, fontSize: 12 }}>
                            {resp.agent_name}
                            {resp.timestamp && (
                              <span style={{ fontWeight: 400, color: 'var(--text-muted)', marginLeft: 8 }}>
                                {new Date(resp.timestamp).toLocaleTimeString()}
                              </span>
                            )}
                          </div>
                          <div style={{ color: 'var(--text-base)', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{resp.content}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </>
        )}
      </div>
    </div>
  )
}

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '7px 10px', background: 'var(--bg-elevated)',
  border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text-base)',
  fontSize: 13, boxSizing: 'border-box', outline: 'none',
}

const labelStyle: React.CSSProperties = {
  fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', display: 'block', marginBottom: 4,
  textTransform: 'uppercase', letterSpacing: '0.05em',
}

const btnStyle: React.CSSProperties = {
  padding: '7px 14px', background: 'var(--bg-elevated)', border: '1px solid var(--border)',
  borderRadius: 6, color: 'var(--text-base)', cursor: 'pointer', fontSize: 13, fontWeight: 600,
}
