import { useState, useRef, useEffect } from 'react'
import { Plus, ChevronDown, ChevronRight, Trash2, X, Check, Flag } from 'lucide-react'
import { PC, STATUS_ICON, STATUS_LABEL, iStyle, type Epic, type Story, type HuntTask, type SelItem } from './HuntTypes'

// ── Issue ID badge ────────────────────────────────────────────────────────────
export function IssueId({ slug, num }: { slug: string | null; num: number | null }) {
  if (!num) return null
  return (
    <span style={{
      fontSize: 10, fontWeight: 700, fontFamily: 'monospace',
      color: 'var(--text-muted)', background: 'var(--bg-elevated)',
      border: '1px solid var(--border)', borderRadius: 4,
      padding: '1px 5px', flexShrink: 0, letterSpacing: '0.03em',
    }}>
      {slug || '??'}-{num}
    </span>
  )
}

// ── Dropdown ─────────────────────────────────────────────────────────────────
export function Dropdown({ options, value, onChange, placeholder }: {
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
          <div onClick={() => { onChange(null); setOpen(false) }}
            style={{ padding: '8px 12px', cursor: 'pointer', fontSize: 13, color: value === null ? 'var(--alpha)' : 'var(--text-muted)' }}
            onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-hover)')}
            onMouseLeave={e => (e.currentTarget.style.background = '')}
          >All {placeholder}</div>
          {options.map(o => (
            <div key={o.id} onClick={() => { onChange(o.id); setOpen(false) }}
              style={{ padding: '8px 12px', cursor: 'pointer', fontSize: 13, color: value === o.id ? 'var(--alpha)' : 'var(--text-base)', fontWeight: value === o.id ? 600 : 400 }}
              onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-hover)')}
              onMouseLeave={e => (e.currentTarget.style.background = '')}
            >{o.name}</div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── TaskRow ───────────────────────────────────────────────────────────────────
export function TaskRow({ task, slug, onStatusChange, onDelete, onSelect, selected }: {
  task: HuntTask; slug: string | null; selected: boolean
  onStatusChange: (id: string, s: string) => void
  onDelete: (id: string) => void
  onSelect: (t: HuntTask) => void
}) {
  const [showStatusMenu, setShowStatusMenu] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const close = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setShowStatusMenu(false) }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [])

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px',
      borderRadius: 5, cursor: 'pointer', fontSize: 13,
      background: selected ? 'rgba(74,158,255,0.08)' : 'transparent',
      borderLeft: selected ? '2px solid var(--accent)' : '2px solid transparent',
    }}
      onClick={() => onSelect(task)}
      onMouseEnter={e => { if (!selected) e.currentTarget.style.background = 'var(--bg-elevated)' }}
      onMouseLeave={e => { if (!selected) e.currentTarget.style.background = 'transparent' }}
    >
      <div ref={ref} style={{ position: 'relative', flexShrink: 0 }}>
        <div onClick={e => { e.stopPropagation(); setShowStatusMenu(s => !s) }} style={{ cursor: 'pointer', lineHeight: 0 }}>
          {STATUS_ICON[task.status] || STATUS_ICON.todo}
        </div>
        {showStatusMenu && (
          <div style={{
            position: 'absolute', top: '100%', left: 0, marginTop: 4, zIndex: 200,
            background: 'var(--bg-elevated)', border: '1px solid var(--border)',
            borderRadius: 8, overflow: 'hidden', width: 130, boxShadow: '0 4px 16px rgba(0,0,0,0.3)',
          }}>
            {Object.keys(STATUS_LABEL).map(s => (
              <div key={s} onClick={e => { e.stopPropagation(); onStatusChange(task.id, s); setShowStatusMenu(false) }}
                style={{ padding: '7px 10px', cursor: 'pointer', fontSize: 12, display: 'flex', alignItems: 'center', gap: 7, color: s === task.status ? 'var(--alpha)' : 'var(--text-base)' }}
                onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-hover)')}
                onMouseLeave={e => (e.currentTarget.style.background = '')}
              >
                {STATUS_ICON[s]} {STATUS_LABEL[s]}
                {s === task.status && <Check size={11} style={{ marginLeft: 'auto' }} />}
              </div>
            ))}
          </div>
        )}
      </div>
      <span style={{
        flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        textDecoration: task.status === 'done' ? 'line-through' : 'none',
        color: task.status === 'done' ? 'var(--text-muted)' : 'var(--text-base)',
      }}>{task.title}</span>
      <IssueId slug={slug} num={task.issue_number} />
      <span style={{ fontSize: 11, color: 'var(--text-muted)', flexShrink: 0 }}>{task.assignee_name || '—'}</span>
      <span style={{
        fontSize: 10, fontWeight: 700, padding: '1px 5px', borderRadius: 4, flexShrink: 0,
        background: `${PC[task.priority] || '#888'}22`, color: PC[task.priority] || '#888',
      }}>{task.priority}</span>
      <button onClick={e => { e.stopPropagation(); onDelete(task.id) }}
        style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 0, opacity: 0, flexShrink: 0, lineHeight: 0 }}
        onMouseEnter={e => (e.currentTarget.style.opacity = '1')}
        onMouseLeave={e => (e.currentTarget.style.opacity = '0')}
      ><Trash2 size={12} /></button>
    </div>
  )
}

// ── InlineAdd ─────────────────────────────────────────────────────────────────
export function InlineAdd({ placeholder, onAdd, onCancel }: {
  placeholder: string; onAdd: (title: string) => void; onCancel: () => void
}) {
  const [val, setVal] = useState('')
  return (
    <div style={{ display: 'flex', gap: 6, padding: '4px 0', alignItems: 'center' }}>
      <input autoFocus value={val} onChange={e => setVal(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter' && val.trim()) { onAdd(val.trim()); } if (e.key === 'Escape') onCancel() }}
        placeholder={placeholder}
        style={{ ...iStyle, fontSize: 12, padding: '5px 8px' }}
      />
      <button onClick={() => { if (val.trim()) onAdd(val.trim()) }}
        style={{ background: 'var(--accent)', border: 'none', borderRadius: 4, padding: '5px 10px', color: 'white', cursor: 'pointer', fontSize: 12, flexShrink: 0 }}>
        Add
      </button>
      <button onClick={onCancel} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', flexShrink: 0 }}>
        <X size={14} />
      </button>
    </div>
  )
}

// ── StoryGroup ─────────────────────────────────────────────────────────────────
export function StoryGroup({ story, tasks, slug, onSelectStory, onSelectTask, selectedItem, onStatusChange, onDeleteTask, onAddTask }: {
  story: Story; tasks: HuntTask[]; slug: string | null
  selectedItem: SelItem | null
  onSelectStory: (s: Story) => void; onSelectTask: (t: HuntTask) => void
  onStatusChange: (id: string, s: string) => void; onDeleteTask: (id: string) => void
  onAddTask: (epicId: string, title: string, storyId: string) => void
}) {
  const [expanded, setExpanded] = useState(true)
  const [adding, setAdding] = useState(false)
  const isSelected = selectedItem?.type === 'story' && selectedItem.data.id === story.id

  return (
    <div style={{ marginBottom: 2 }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 5, padding: '5px 8px', borderRadius: 5, cursor: 'pointer',
        background: isSelected ? 'rgba(74,158,255,0.08)' : 'transparent',
        borderLeft: isSelected ? '2px solid var(--accent)' : '2px solid transparent',
      }}
        onMouseEnter={e => { if (!isSelected) e.currentTarget.style.background = 'var(--bg-elevated)' }}
        onMouseLeave={e => { if (!isSelected) e.currentTarget.style.background = 'transparent' }}
      >
        <div onClick={() => setExpanded(e => !e)} style={{ lineHeight: 0 }}>
          {expanded ? <ChevronDown size={12} color="var(--text-muted)" /> : <ChevronRight size={12} color="var(--text-muted)" />}
        </div>
        <IssueId slug={slug} num={story.issue_number} />
        <span onClick={() => onSelectStory(story)} style={{ fontSize: 12, flex: 1, color: isSelected ? 'var(--accent)' : 'var(--text-muted)', fontWeight: 600 }}>
          {story.title}
        </span>
        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{tasks.length} tasks</span>
        <button onClick={e => { e.stopPropagation(); setAdding(true); setExpanded(true) }}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 2, fontSize: 11, padding: '2px 5px', borderRadius: 4 }}
          onMouseEnter={e => (e.currentTarget.style.color = 'var(--text-base)')}
          onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-muted)')}
        ><Plus size={11} /> Task</button>
      </div>
      {expanded && (
        <div style={{ paddingLeft: 20 }}>
          {tasks.map(t => (
            <TaskRow key={t.id} task={t} slug={slug} selected={selectedItem?.type === 'task' && selectedItem.data.id === t.id}
              onStatusChange={onStatusChange} onDelete={onDeleteTask} onSelect={onSelectTask}
            />
          ))}
          {adding && (
            <InlineAdd placeholder="Task title…"
              onAdd={title => { onAddTask(story.epic_id, title, story.id); setAdding(false) }}
              onCancel={() => setAdding(false)}
            />
          )}
        </div>
      )}
    </div>
  )
}

// ── EpicGroup ─────────────────────────────────────────────────────────────────
export function EpicGroup({ epic, stories, tasks, slug, selectedItem, onSelectEpic, onSelectStory, onSelectTask, onStatusChange, onDeleteTask, onAddTask, onAddStory }: {
  epic: Epic; stories: Story[]; tasks: HuntTask[]; slug: string | null
  selectedItem: SelItem | null
  onSelectEpic: (e: Epic) => void; onSelectStory: (s: Story) => void; onSelectTask: (t: HuntTask) => void
  onStatusChange: (id: string, s: string) => void; onDeleteTask: (id: string) => void
  onAddTask: (epicId: string, title: string, storyId?: string) => void
  onAddStory: (epicId: string, title: string) => void
}) {
  const [expanded, setExpanded] = useState(true)
  const [addingStory, setAddingStory] = useState(false)
  const [addingTask, setAddingTask] = useState(false)
  const isSelected = selectedItem?.type === 'epic' && selectedItem.data.id === epic.id
  const orphanTasks = tasks.filter(t => t.epic_id === epic.id && !t.story_id)

  return (
    <div style={{ marginBottom: 6 }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 6, padding: '7px 8px', borderRadius: 6, cursor: 'pointer',
        background: isSelected ? 'rgba(74,158,255,0.08)' : 'transparent',
        borderLeft: isSelected ? '2px solid var(--accent)' : '2px solid transparent',
      }}
        onMouseEnter={e => { if (!isSelected) e.currentTarget.style.background = 'var(--bg-elevated)' }}
        onMouseLeave={e => { if (!isSelected) e.currentTarget.style.background = 'transparent' }}
      >
        <div onClick={() => setExpanded(e => !e)} style={{ lineHeight: 0, flexShrink: 0 }}>
          {expanded ? <ChevronDown size={14} color="var(--text-muted)" /> : <ChevronRight size={14} color="var(--text-muted)" />}
        </div>
        <Flag size={12} color={PC[epic.priority] || '#888'} style={{ flexShrink: 0 }} />
        <IssueId slug={slug} num={epic.issue_number} />
        <span onClick={() => onSelectEpic(epic)} style={{ fontWeight: 700, fontSize: 13, flex: 1, color: isSelected ? 'var(--accent)' : 'var(--text-base)' }}>
          {epic.title}
        </span>
        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
          {tasks.filter(t => t.epic_id === epic.id).length} tasks
        </span>
        <span style={{
          fontSize: 10, fontWeight: 700, padding: '1px 5px', borderRadius: 4,
          background: `${PC[epic.priority] || '#888'}22`, color: PC[epic.priority] || '#888',
        }}>{epic.priority}</span>
        <button onClick={e => { e.stopPropagation(); setAddingStory(true); setExpanded(true) }}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 2, fontSize: 11, padding: '2px 5px', borderRadius: 4 }}
          onMouseEnter={e => (e.currentTarget.style.color = 'var(--text-base)')}
          onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-muted)')}
        ><Plus size={11} /> Story</button>
        <button onClick={e => { e.stopPropagation(); setAddingTask(true); setExpanded(true) }}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 2, fontSize: 11, padding: '2px 5px', borderRadius: 4 }}
          onMouseEnter={e => (e.currentTarget.style.color = 'var(--text-base)')}
          onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-muted)')}
        ><Plus size={11} /> Task</button>
      </div>

      {expanded && (
        <div style={{ paddingLeft: 20 }}>
          {addingStory && (
            <InlineAdd placeholder="Story title…"
              onAdd={title => { onAddStory(epic.id, title); setAddingStory(false) }}
              onCancel={() => setAddingStory(false)}
            />
          )}
          {stories.map(s => (
            <StoryGroup key={s.id} story={s} slug={slug}
              tasks={tasks.filter(t => t.story_id === s.id)}
              selectedItem={selectedItem}
              onSelectStory={onSelectStory} onSelectTask={onSelectTask}
              onStatusChange={onStatusChange} onDeleteTask={onDeleteTask}
              onAddTask={onAddTask}
            />
          ))}
          {orphanTasks.map(t => (
            <TaskRow key={t.id} task={t} slug={slug} selected={selectedItem?.type === 'task' && selectedItem.data.id === t.id}
              onStatusChange={onStatusChange} onDelete={onDeleteTask} onSelect={onSelectTask}
            />
          ))}
          {addingTask && (
            <InlineAdd placeholder="Task title (no story)…"
              onAdd={title => { onAddTask(epic.id, title); setAddingTask(false) }}
              onCancel={() => setAddingTask(false)}
            />
          )}
          {stories.length === 0 && orphanTasks.length === 0 && !addingStory && !addingTask && (
            <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: '4px 10px', fontStyle: 'italic' }}>
              No stories or tasks yet
            </div>
          )}
        </div>
      )}
    </div>
  )
}
