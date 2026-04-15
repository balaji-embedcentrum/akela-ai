import { useState, useEffect } from 'react'
import { ChevronRight, Trash2, Plus, Circle, CheckCircle2, User } from 'lucide-react'
import api from '../api'
import { type Agent } from '../store'
import { iStyle, labelSt, type Sprint, type Epic, type Story, type HuntTask, type Subtask, type SelItem } from './HuntTypes'
import { IssueId, InlineAdd } from './HuntComponents'

// ── DetailPanel ────────────────────────────────────────────────────────────────
export function DetailPanel({ item, slug, agents, sprints, epics, huntProjectId, onClose, onSaved, onDeleted }: {
  item: SelItem; slug: string | null; agents: Agent[]; sprints: Sprint[]; epics: Epic[]; huntProjectId: string
  onClose: () => void; onSaved: () => void; onDeleted: () => void
}) {
  return (
    <div style={{
      width: 340, borderLeft: '1px solid var(--border)', background: 'var(--bg-surface)',
      display: 'flex', flexDirection: 'column', flexShrink: 0,
    }}>
      <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontWeight: 700, fontSize: 13, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            {item.type === 'new-sprint' ? 'New Sprint' : item.type === 'sprint' ? 'Sprint' : item.type === 'epic' ? 'Epic' : item.type === 'story' ? 'Story' : 'Task'}
          </span>
          {item.type !== 'new-sprint' && (
            <IssueId slug={slug} num={(item.data as any).issue_number ?? null} />
          )}
        </div>
        <button onClick={onClose} style={{
          background: 'var(--accent)', border: 'none', cursor: 'pointer',
          color: '#fff', lineHeight: 0, borderRadius: 6, padding: 5,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <ChevronRight size={14} />
        </button>
      </div>
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {(item.type === 'new-sprint' || item.type === 'sprint') && (
          <SprintForm item={item} huntProjectId={huntProjectId} onSaved={onSaved} onDeleted={onDeleted} />
        )}
        {item.type === 'epic' && (
          <EpicForm epic={item.data} onSaved={onSaved} onDeleted={onDeleted} />
        )}
        {item.type === 'story' && (
          <StoryForm story={item.data} sprints={sprints} epics={epics} onSaved={onSaved} onDeleted={onDeleted} />
        )}
        {item.type === 'task' && (
          <TaskForm task={item.data} agents={agents} sprints={sprints} onSaved={onSaved} onDeleted={onDeleted} />
        )}
      </div>
    </div>
  )
}

// ── SprintForm ────────────────────────────────────────────────────────────────
function SprintForm({ item, huntProjectId, onSaved, onDeleted }: {
  item: SelItem; huntProjectId: string; onSaved: () => void; onDeleted: () => void
}) {
  const sprint = item.type === 'sprint' ? item.data : null
  const [name, setName] = useState(sprint?.name || '')
  const [goal, setGoal] = useState(sprint?.goal || '')
  const [status, setStatus] = useState(sprint?.status || 'planning')
  const [startDate, setStartDate] = useState(sprint?.start_date?.slice(0, 10) || '')
  const [endDate, setEndDate] = useState(sprint?.end_date?.slice(0, 10) || '')
  const [saving, setSaving] = useState(false)

  const save = async () => {
    if (!name.trim()) return
    setSaving(true)
    try {
      if (sprint) {
        await api.put(`/hunt/sprints/${sprint.id}`, { name, goal, status, start_date: startDate || null, end_date: endDate || null })
      } else {
        await api.post(`/hunt/projects/${huntProjectId}/sprints`, { name, goal, status, start_date: startDate || null, end_date: endDate || null })
      }
      onSaved()
    } finally { setSaving(false) }
  }

  const del = async () => {
    if (!sprint || !confirm(`Delete sprint "${sprint.name}"?`)) return
    await api.delete(`/hunt/sprints/${sprint.id}`)
    onDeleted()
  }

  return (
    <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div><label style={labelSt}>Sprint Name</label><input value={name} onChange={e => setName(e.target.value)} style={iStyle} placeholder="Sprint 1" /></div>
      <div><label style={labelSt}>Goal</label><textarea value={goal} onChange={e => setGoal(e.target.value)} rows={2} style={{ ...iStyle, resize: 'vertical' }} placeholder="What are we trying to achieve?" /></div>
      <div>
        <label style={labelSt}>Status</label>
        <select value={status} onChange={e => setStatus(e.target.value)} style={iStyle}>
          <option value="planning">Planning</option>
          <option value="active">Active</option>
          <option value="completed">Completed</option>
        </select>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <div><label style={labelSt}>Start Date</label><input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} style={iStyle} /></div>
        <div><label style={labelSt}>End Date</label><input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} style={iStyle} /></div>
      </div>
      <button onClick={save} disabled={saving} style={{ padding: '8px', background: 'var(--accent)', border: 'none', borderRadius: 6, color: 'white', fontWeight: 700, cursor: 'pointer', fontSize: 13 }}>
        {saving ? 'Saving…' : sprint ? 'Save Changes' : 'Create Sprint'}
      </button>
      {sprint && (
        <button onClick={del} style={{ padding: '6px', background: 'rgba(244,67,54,0.1)', border: '1px solid rgba(244,67,54,0.3)', borderRadius: 6, color: '#f44336', cursor: 'pointer', fontSize: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5 }}>
          <Trash2 size={12} /> Delete Sprint
        </button>
      )}
    </div>
  )
}

// ── EpicForm ──────────────────────────────────────────────────────────────────
function EpicForm({ epic, onSaved, onDeleted }: { epic: Epic; onSaved: () => void; onDeleted: () => void }) {
  const [title, setTitle] = useState(epic.title)
  const [desc, setDesc] = useState(epic.description || '')
  const [priority, setPriority] = useState(epic.priority)
  const [status, setStatus] = useState(epic.status)
  const [dueDate, setDueDate] = useState(epic.due_date?.slice(0, 10) || '')
  const [saving, setSaving] = useState(false)

  const save = async () => {
    setSaving(true)
    try { await api.put(`/hunt/epics/${epic.id}`, { title, description: desc, priority, status, due_date: dueDate || null }); onSaved() }
    finally { setSaving(false) }
  }
  const del = async () => {
    if (!confirm(`Delete epic "${epic.title}" and all its stories/tasks?`)) return
    await api.delete(`/hunt/epics/${epic.id}`)
    onDeleted()
  }

  return (
    <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div><label style={labelSt}>Title</label><input value={title} onChange={e => setTitle(e.target.value)} style={iStyle} /></div>
      <div><label style={labelSt}>Description</label><textarea value={desc} onChange={e => setDesc(e.target.value)} rows={3} style={{ ...iStyle, resize: 'vertical' }} /></div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <div>
          <label style={labelSt}>Priority</label>
          <select value={priority} onChange={e => setPriority(e.target.value)} style={iStyle}>
            {['P0', 'P1', 'P2', 'P3'].map(p => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>
        <div>
          <label style={labelSt}>Status</label>
          <select value={status} onChange={e => setStatus(e.target.value)} style={iStyle}>
            <option value="todo">Todo</option><option value="in_progress">In Progress</option>
            <option value="done">Done</option>
          </select>
        </div>
      </div>
      <div><label style={labelSt}>Due Date</label><input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} style={iStyle} /></div>
      <button onClick={save} disabled={saving} style={{ padding: '8px', background: 'var(--accent)', border: 'none', borderRadius: 6, color: 'white', fontWeight: 700, cursor: 'pointer', fontSize: 13 }}>
        {saving ? 'Saving…' : 'Save Changes'}
      </button>
      <button onClick={del} style={{ padding: '6px', background: 'rgba(244,67,54,0.1)', border: '1px solid rgba(244,67,54,0.3)', borderRadius: 6, color: '#f44336', cursor: 'pointer', fontSize: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5 }}>
        <Trash2 size={12} /> Delete Epic
      </button>
    </div>
  )
}

// ── StoryForm ──────────────────────────────────────────────────────────────────
function StoryForm({ story, sprints, epics, onSaved, onDeleted }: {
  story: Story; sprints: Sprint[]; epics: Epic[]; onSaved: () => void; onDeleted: () => void
}) {
  const [title, setTitle] = useState(story.title)
  const [desc, setDesc] = useState(story.description || '')
  const [priority, setPriority] = useState(story.priority)
  const [status, setStatus] = useState(story.status)
  const [points, setPoints] = useState(story.story_points?.toString() || '')
  const [sprintId, setSprintId] = useState(story.sprint_id || '')
  const [dueDate, setDueDate] = useState(story.due_date?.slice(0, 10) || '')
  const [saving, setSaving] = useState(false)

  const save = async () => {
    setSaving(true)
    try {
      await api.put(`/hunt/stories/${story.id}`, {
        title, description: desc, priority, status,
        story_points: points ? parseInt(points) : null,
        sprint_id: sprintId || null,
        due_date: dueDate || null,
      })
      onSaved()
    } finally { setSaving(false) }
  }
  const del = async () => {
    if (!confirm(`Delete story "${story.title}"?`)) return
    await api.delete(`/hunt/stories/${story.id}`)
    onDeleted()
  }

  return (
    <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div><label style={labelSt}>Title</label><input value={title} onChange={e => setTitle(e.target.value)} style={iStyle} /></div>
      <div><label style={labelSt}>Description</label><textarea value={desc} onChange={e => setDesc(e.target.value)} rows={3} style={{ ...iStyle, resize: 'vertical' }} /></div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <div>
          <label style={labelSt}>Priority</label>
          <select value={priority} onChange={e => setPriority(e.target.value)} style={iStyle}>
            {['P0', 'P1', 'P2', 'P3'].map(p => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>
        <div>
          <label style={labelSt}>Story Points</label>
          <input type="number" value={points} onChange={e => setPoints(e.target.value)} placeholder="e.g. 5" style={iStyle} min={0} />
        </div>
      </div>
      <div>
        <label style={labelSt}>Status</label>
        <select value={status} onChange={e => setStatus(e.target.value)} style={iStyle}>
          <option value="todo">Todo</option><option value="in_progress">In Progress</option>
          <option value="review">Review</option><option value="done">Done</option>
        </select>
      </div>
      <div>
        <label style={labelSt}>Sprint</label>
        <select value={sprintId} onChange={e => setSprintId(e.target.value)} style={iStyle}>
          <option value="">No sprint</option>
          {sprints.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </div>
      <div><label style={labelSt}>Due Date</label><input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} style={iStyle} /></div>
      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Epic: {epics.find(e => e.id === story.epic_id)?.title || '—'}</div>
      <button onClick={save} disabled={saving} style={{ padding: '8px', background: 'var(--accent)', border: 'none', borderRadius: 6, color: 'white', fontWeight: 700, cursor: 'pointer', fontSize: 13 }}>
        {saving ? 'Saving…' : 'Save Changes'}
      </button>
      <button onClick={del} style={{ padding: '6px', background: 'rgba(244,67,54,0.1)', border: '1px solid rgba(244,67,54,0.3)', borderRadius: 6, color: '#f44336', cursor: 'pointer', fontSize: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5 }}>
        <Trash2 size={12} /> Delete Story
      </button>
    </div>
  )
}

// ── TaskForm (with subtasks) ───────────────────────────────────────────────────
function TaskForm({ task, agents, sprints, onSaved, onDeleted }: {
  task: HuntTask; agents: Agent[]; sprints: Sprint[]; onSaved: () => void; onDeleted: () => void
}) {
  const [title, setTitle] = useState(task.title)
  const [desc, setDesc] = useState(task.description || '')
  const [priority, setPriority] = useState(task.priority)
  const [assignee, setAssignee] = useState(task.assignee_id || '')
  const [sprint, setSprint] = useState(task.sprint_id || '')
  const [estimate, setEstimate] = useState(task.estimate || '')
  const [dueDate, setDueDate] = useState(task.due_date?.slice(0, 10) || '')
  const [saving, setSaving] = useState(false)
  const [subtasks, setSubtasks] = useState<Subtask[]>([])
  const [addingSub, setAddingSub] = useState(false)

  useEffect(() => {
    api.get(`/hunt/tasks/${task.id}/subtasks`).then(r => setSubtasks(r.data)).catch(console.error)
  }, [task.id])

  const save = async () => {
    setSaving(true)
    try {
      await api.put(`/hunt/tasks/${task.id}`, {
        title, description: desc, priority,
        assignee_id: assignee || null, sprint_id: sprint || null,
        estimate: estimate || null, due_date: dueDate || null,
      })
      onSaved()
    } finally { setSaving(false) }
  }

  const del = async () => {
    if (!confirm('Delete this task?')) return
    await api.delete(`/hunt/tasks/${task.id}`)
    onDeleted()
  }

  const addSubtask = async (subTitle: string) => {
    const r = await api.post(`/hunt/tasks/${task.id}/subtasks`, { title: subTitle })
    setSubtasks(prev => [...prev, r.data])
    setAddingSub(false)
  }

  const toggleSubtask = async (sub: Subtask) => {
    const newStatus = sub.status === 'done' ? 'todo' : 'done'
    await api.put(`/hunt/subtasks/${sub.id}`, { status: newStatus })
    setSubtasks(prev => prev.map(s => s.id === sub.id ? { ...s, status: newStatus } : s))
  }

  const deleteSubtask = async (subId: string) => {
    await api.delete(`/hunt/subtasks/${subId}`)
    setSubtasks(prev => prev.filter(s => s.id !== subId))
  }

  return (
    <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div><label style={labelSt}>Title</label><input value={title} onChange={e => setTitle(e.target.value)} style={iStyle} /></div>
      <div><label style={labelSt}>Description</label><textarea value={desc} onChange={e => setDesc(e.target.value)} rows={3} style={{ ...iStyle, resize: 'vertical' }} placeholder="Details…" /></div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <div>
          <label style={labelSt}>Priority</label>
          <select value={priority} onChange={e => setPriority(e.target.value)} style={iStyle}>
            {['P0', 'P1', 'P2', 'P3'].map(p => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>
        <div>
          <label style={labelSt}>Estimate</label>
          <input value={estimate} onChange={e => setEstimate(e.target.value)} placeholder="e.g. 2h" style={iStyle} />
        </div>
      </div>
      <div>
        <label style={labelSt}>Assignee</label>
        <select value={assignee} onChange={e => setAssignee(e.target.value)} style={iStyle}>
          <option value="">Unassigned</option>
          {agents.map(a => <option key={a.id} value={a.id}>{(a as any).display_name || a.name}</option>)}
        </select>
      </div>
      <div>
        <label style={labelSt}>Sprint</label>
        <select value={sprint} onChange={e => setSprint(e.target.value)} style={iStyle}>
          <option value="">No sprint</option>
          {sprints.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </div>
      <div><label style={labelSt}>Due Date</label><input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} style={iStyle} /></div>
      <button onClick={save} disabled={saving} style={{ padding: '8px', background: 'var(--accent)', border: 'none', borderRadius: 6, color: 'white', fontWeight: 700, cursor: 'pointer', fontSize: 13 }}>
        {saving ? 'Saving…' : 'Save Changes'}
      </button>

      {/* Subtasks */}
      <div style={{ borderTop: '1px solid var(--border)', paddingTop: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <label style={labelSt}>Subtasks ({subtasks.filter(s => s.status === 'done').length}/{subtasks.length})</label>
          <button onClick={() => setAddingSub(true)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 3, fontSize: 11 }}
            onMouseEnter={e => (e.currentTarget.style.color = 'var(--text-base)')}
            onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-muted)')}
          ><Plus size={12} /> Add</button>
        </div>
        {subtasks.map(sub => (
          <div key={sub.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0', borderBottom: '1px solid var(--border)' }}>
            <button onClick={() => toggleSubtask(sub)} style={{ background: 'none', border: 'none', cursor: 'pointer', lineHeight: 0, flexShrink: 0, color: sub.status === 'done' ? 'var(--success)' : 'var(--text-muted)' }}>
              {sub.status === 'done' ? <CheckCircle2 size={14} /> : <Circle size={14} />}
            </button>
            <span style={{ flex: 1, fontSize: 12, color: sub.status === 'done' ? 'var(--text-muted)' : 'var(--text-base)', textDecoration: sub.status === 'done' ? 'line-through' : 'none' }}>
              {sub.title}
            </span>
            {sub.assignee_name && <span style={{ fontSize: 11, color: 'var(--text-muted)' }}><User size={9} style={{ display: 'inline', marginRight: 2 }} />{sub.assignee_name}</span>}
            <button onClick={() => deleteSubtask(sub.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', lineHeight: 0, opacity: 0.5 }}
              onMouseEnter={e => (e.currentTarget.style.opacity = '1')}
              onMouseLeave={e => (e.currentTarget.style.opacity = '0.5')}
            ><Trash2 size={11} /></button>
          </div>
        ))}
        {addingSub && (
          <InlineAdd placeholder="Subtask title…" onAdd={addSubtask} onCancel={() => setAddingSub(false)} />
        )}
        {subtasks.length === 0 && !addingSub && (
          <div style={{ fontSize: 12, color: 'var(--text-muted)', fontStyle: 'italic' }}>No subtasks yet</div>
        )}
      </div>

      <button onClick={del} style={{ padding: '6px', background: 'rgba(244,67,54,0.1)', border: '1px solid rgba(244,67,54,0.3)', borderRadius: 6, color: '#f44336', cursor: 'pointer', fontSize: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5 }}>
        <Trash2 size={12} /> Delete Task
      </button>
      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Created {new Date(task.created_at).toLocaleDateString()}</div>
    </div>
  )
}
