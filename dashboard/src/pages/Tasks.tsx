import { useEffect, useState, useRef } from 'react'
import api from '../api'
import { useStore } from '../store'
import { Plus, ChevronDown, User } from 'lucide-react'

interface HuntProject { id: string; name: string }
interface Sprint { id: string; project_id: string; name: string; status: string }
interface HuntTask {
  id: string; epic_id: string; sprint_id: string | null; assignee_id: string | null
  assignee_name: string | null; title: string; description: string
  status: string; priority: string; labels: string[]; estimate: string | null
  issue_number: number | null; created_at: string
}

// Wolf-themed kanban columns mapped to HuntTask statuses
const WOLF_COLUMNS = [
  { status: 'todo',        label: 'Spotted',    color: '#888',    desc: 'Prey identified' },
  { status: 'in_progress', label: 'Chasing',    color: '#4a9eff', desc: 'On the hunt' },
  { status: 'review',      label: 'Circling',   color: '#f5a623', desc: 'Closing in' },
  { status: 'done',        label: 'Caught',     color: '#4caf50', desc: 'Prey caught' },
  { status: 'blocked',     label: 'Cornered',   color: '#f44336', desc: 'Needs help' },
]

const PRIORITY_COLOR: Record<string, string> = { P0: '#f44336', P1: '#ff9800', P2: '#4a9eff', P3: '#888' }

function Dropdown({ options, value, onChange, placeholder }: {
  options: { id: string; name: string }[]
  value: string | null; onChange: (id: string | null) => void; placeholder: string
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const close = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [])
  const current = options.find(o => o.id === value)
  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button onClick={() => setOpen(o => !o)} style={{
        display: 'flex', alignItems: 'center', gap: 5, padding: '6px 10px',
        background: 'var(--bg-elevated)', border: '1px solid var(--border)',
        borderRadius: 6, cursor: 'pointer', fontSize: 13, color: 'var(--text-base)', whiteSpace: 'nowrap',
      }}>
        <span style={{ fontWeight: current ? 600 : 400 }}>{current?.name || placeholder}</span>
        <ChevronDown size={12} color="var(--text-muted)" />
      </button>
      {open && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, marginTop: 4, zIndex: 100,
          background: 'var(--bg-elevated)', border: '1px solid var(--border)',
          borderRadius: 8, minWidth: 180, overflow: 'hidden', boxShadow: '0 4px 16px rgba(0,0,0,0.3)',
        }}>
          <div onClick={() => { onChange(null); setOpen(false) }} style={{
            padding: '8px 12px', cursor: 'pointer', fontSize: 13,
            color: value === null ? 'var(--alpha)' : 'var(--text-muted)',
          }}
            onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-hover)')}
            onMouseLeave={e => (e.currentTarget.style.background = '')}
          >All {placeholder}</div>
          {options.map(o => (
            <div key={o.id} onClick={() => { onChange(o.id); setOpen(false) }} style={{
              padding: '8px 12px', cursor: 'pointer', fontSize: 13,
              color: value === o.id ? 'var(--alpha)' : 'var(--text-base)',
              fontWeight: value === o.id ? 600 : 400,
            }}
              onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-hover)')}
              onMouseLeave={e => (e.currentTarget.style.background = '')}
            >{o.name}</div>
          ))}
        </div>
      )}
    </div>
  )
}

function PreyCard({ task, slug, onMove }: { task: HuntTask; slug: string | null; onMove: (id: string, status: string) => void }) {
  // Exclude 'blocked' from the forward-move chain; it's a side-state set manually
  const statuses = ['todo', 'in_progress', 'review', 'done']
  const currentIdx = statuses.indexOf(task.status)

  return (
    <div style={{
      background: 'var(--bg-surface)', border: '1px solid var(--border)',
      borderRadius: 8, padding: '11px 13px', marginBottom: 8,
      borderLeft: `3px solid ${PRIORITY_COLOR[task.priority] || '#888'}`,
      cursor: 'default', transition: 'border-color 0.15s, transform 0.1s',
    }}
      onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--border-light)'; e.currentTarget.style.transform = 'translateY(-1px)' }}
      onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.transform = 'translateY(0)' }}
    >
      {task.issue_number && (
        <div style={{ fontSize: 10, fontWeight: 700, fontFamily: 'monospace', color: 'var(--text-muted)', marginBottom: 4, letterSpacing: '0.03em' }}>
          {slug || '??'}-{task.issue_number}
        </div>
      )}
      <div style={{ fontWeight: 600, fontSize: 13, marginBottom: task.description ? 6 : 8, lineHeight: 1.35 }}>{task.title}</div>
      {task.description && (
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 8, lineHeight: 1.4 }}>
          {task.description.slice(0, 80)}{task.description.length > 80 ? '…' : ''}
        </div>
      )}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: 'var(--text-muted)' }}>
          <User size={10} />
          <span>{task.assignee_name || 'Unassigned'}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <span style={{
            fontSize: 10, fontWeight: 700, padding: '1px 5px', borderRadius: 4,
            background: `${PRIORITY_COLOR[task.priority] || '#888'}22`,
            color: PRIORITY_COLOR[task.priority] || '#888',
          }}>{task.priority}</span>
          {currentIdx < statuses.length - 1 && (
            <button
              onClick={() => onMove(task.id, statuses[currentIdx + 1])}
              title={`Move to ${WOLF_COLUMNS[currentIdx + 1]?.label}`}
              style={{
                fontSize: 10, padding: '2px 7px', background: 'var(--bg-elevated)',
                border: '1px solid var(--border)', borderRadius: 4, cursor: 'pointer',
                color: 'var(--text-muted)',
              }}
              onMouseEnter={e => (e.currentTarget.style.color = 'var(--text-base)')}
              onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-muted)')}
            >→</button>
          )}
        </div>
      </div>
    </div>
  )
}

export function Tasks() {
  const { activeProject } = useStore()
  const [huntProject, setHuntProject] = useState<HuntProject | null>(null)
  const [sprints, setSprints] = useState<Sprint[]>([])
  const [tasks, setTasks] = useState<HuntTask[]>([])
  const [selectedSprint, setSelectedSprint] = useState<string | null>(null)

  // Quick-add task
  const [showAdd, setShowAdd] = useState(false)
  const [addTitle, setAddTitle] = useState('')
  const [addEpicId, setAddEpicId] = useState('')
  const [epics, setEpics] = useState<{ id: string; title: string }[]>([])

  const loadHuntProject = async () => {
    if (!activeProject) { setHuntProject(null); setSprints([]); setTasks([]); return }
    try {
      const r = await api.get(`/hunt/projects?akela_project_id=${activeProject.id}`)
      if (r.data.length > 0) {
        setHuntProject(r.data[0])
      } else {
        const created = await api.post('/hunt/projects', { name: activeProject.name, akela_project_id: activeProject.id })
        setHuntProject(created.data)
      }
    } catch (e) { console.error(e) }
  }

  const loadData = async (projectId: string) => {
    try {
      const [sprintR, taskR, epicR] = await Promise.all([
        api.get(`/hunt/projects/${projectId}/sprints`),
        api.get(`/hunt/tasks?project_id=${projectId}${selectedSprint ? `&sprint_id=${selectedSprint}` : ''}`),
        api.get(`/hunt/projects/${projectId}/epics`),
      ])
      setSprints(sprintR.data)
      setTasks(taskR.data)
      setEpics(epicR.data)
      if (epicR.data.length > 0 && !addEpicId) setAddEpicId(epicR.data[0].id)
    } catch (e) { console.error(e) }
  }

  useEffect(() => { loadHuntProject() }, [activeProject?.id])
  useEffect(() => { if (huntProject) loadData(huntProject.id) }, [huntProject?.id, selectedSprint])

  const selectSprint = (id: string | null) => setSelectedSprint(id)

  const moveTask = async (taskId: string, status: string) => {
    await api.put(`/hunt/tasks/${taskId}/status`, { status })
    if (huntProject) loadData(huntProject.id)
  }

  const createTask = async () => {
    if (!addTitle.trim() || !addEpicId) return
    await api.post(`/hunt/epics/${addEpicId}/tasks`, {
      title: addTitle.trim(), priority: 'P2',
      sprint_id: selectedSprint || undefined,
    })
    setAddTitle(''); setShowAdd(false)
    if (huntProject) loadData(huntProject.id)
  }

  return (
    <div style={{ display: 'flex', height: '100%', flexDirection: 'column', overflow: 'hidden' }}>
      {/* ── Header ── */}
      <div style={{
        padding: '12px 20px', borderBottom: '1px solid var(--border)',
        background: 'var(--bg-surface)', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0,
      }}>
        <span style={{ fontWeight: 700, fontSize: 15, marginRight: 4 }}>The Prey</span>
        {activeProject && (
          <span style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 500 }}>
            {activeProject.name}
          </span>
        )}

        {huntProject && (
          <Dropdown
            placeholder="All Sprints"
            options={sprints.map(s => ({ id: s.id, name: s.name }))}
            value={selectedSprint}
            onChange={selectSprint}
          />
        )}

        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            {tasks.length} tasks
          </span>
          {huntProject && epics.length > 0 && (
            <button onClick={() => setShowAdd(s => !s)} style={{
              display: 'flex', alignItems: 'center', gap: 5, padding: '6px 12px',
              background: 'var(--alpha)', border: 'none', borderRadius: 6,
              color: '#000', cursor: 'pointer', fontSize: 13, fontWeight: 700,
            }}>
              <Plus size={13} /> New Task
            </button>
          )}
        </div>
      </div>

      {/* Quick-add form */}
      {showAdd && (
        <div style={{
          padding: '10px 20px', borderBottom: '1px solid var(--border)',
          background: 'var(--bg-elevated)', display: 'flex', gap: 8, alignItems: 'center',
        }}>
          <input
            autoFocus value={addTitle} onChange={e => setAddTitle(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') createTask(); if (e.key === 'Escape') setShowAdd(false) }}
            placeholder="Task title…"
            style={{
              flex: 1, padding: '7px 10px', background: 'var(--bg-surface)',
              border: '1px solid var(--border)', borderRadius: 6,
              color: 'var(--text-base)', fontSize: 13, outline: 'none',
            }}
          />
          <select value={addEpicId} onChange={e => setAddEpicId(e.target.value)} style={{
            padding: '7px 10px', background: 'var(--bg-surface)', border: '1px solid var(--border)',
            borderRadius: 6, color: 'var(--text-base)', fontSize: 13, outline: 'none',
          }}>
            {epics.map(e => <option key={e.id} value={e.id}>{e.title}</option>)}
          </select>
          <button onClick={createTask} style={{
            padding: '7px 14px', background: 'var(--alpha)', border: 'none',
            borderRadius: 6, color: '#000', fontWeight: 700, cursor: 'pointer', fontSize: 13,
          }}>Add</button>
          <button onClick={() => setShowAdd(false)} style={{
            background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 18, lineHeight: 1,
          }}>×</button>
        </div>
      )}

      {/* ── Kanban ── */}
      {!huntProject ? (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', color: 'var(--text-muted)' }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>🐺</div>
          <div style={{ fontSize: 15 }}>Select a project in the sidebar to see the prey.</div>
        </div>
      ) : (
        <div className="tasks-kanban" style={{ flex: 1, display: 'flex', gap: 0, overflow: 'hidden' }}>
          {WOLF_COLUMNS.map((col, i) => {
            const colTasks = tasks.filter(t => t.status === col.status)
            return (
              <div key={col.status} style={{
                flex: 1, display: 'flex', flexDirection: 'column',
                borderRight: i < WOLF_COLUMNS.length - 1 ? '1px solid var(--border)' : 'none',
                overflow: 'hidden',
              }}>
                {/* Column header */}
                <div style={{
                  padding: '12px 14px 10px', borderBottom: `2px solid ${col.color}`,
                  flexShrink: 0,
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: 12, fontWeight: 800, color: col.color, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                      {col.label}
                    </span>
                    <span style={{
                      fontSize: 11, fontWeight: 700, padding: '1px 7px', borderRadius: 10,
                      background: `${col.color}22`, color: col.color,
                    }}>{colTasks.length}</span>
                  </div>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>{col.desc}</div>
                </div>

                {/* Cards */}
                <div style={{ flex: 1, overflowY: 'auto', padding: '10px 10px' }}>
                  {colTasks.map(t => (
                    <PreyCard key={t.id} task={t} slug={activeProject?.slug || null} onMove={moveTask} />
                  ))}
                  {colTasks.length === 0 && (
                    <div style={{ fontSize: 12, color: 'var(--text-muted)', textAlign: 'center', padding: '20px 0', fontStyle: 'italic' }}>
                      —
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
