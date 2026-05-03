import { useEffect, useState, useRef, useCallback } from 'react'
import { Plus, X, List, LayoutGrid, RefreshCw } from 'lucide-react'
import { HelpButton } from '../components/HelpDrawer'
import api from '../api'
import { useStore } from '../store'

const API_BASE = import.meta.env.DEV ? 'http://localhost:8200' : '/akela-api'
import { iStyle, type Epic, type Sprint, type Story, type HuntTask, type SelItem } from './HuntTypes'
import { Dropdown, EpicGroup } from './HuntComponents'
import { DetailPanel } from './HuntSidebar'
import { HuntBoard } from './HuntBoard'

export function Hunt() {
  const { agents, activeProject, lastTaskUpdate } = useStore()
  const [projectAgentIds, setProjectAgentIds] = useState<Set<string>>(new Set())
  const slug = activeProject?.slug || null
  const [huntProject, setHuntProject] = useState<{ id: string; name: string } | null>(null)
  const [epics, setEpics] = useState<Epic[]>([])
  const [sprints, setSprints] = useState<Sprint[]>([])
  const [stories, setStories] = useState<Story[]>([])
  const [tasks, setTasks] = useState<HuntTask[]>([])
  const [selectedSprint, setSelectedSprint] = useState<string | null>(null)
  const [selectedItem, setSelectedItem] = useState<SelItem | null>(null)
  const [view, setView] = useState<'list' | 'board'>(() => (localStorage.getItem('hunt_view') as 'list' | 'board') || 'list')
  const [showNewEpic, setShowNewEpic] = useState(false)
  const [newEpicTitle, setNewEpicTitle] = useState('')
  const [flashedTasks, setFlashedTasks] = useState<Set<string>>(new Set())
  const prevTaskStatuses = useRef<Record<string, string>>({})

  const loadHuntProject = async () => {
    if (!activeProject) { setHuntProject(null); setEpics([]); setSprints([]); setStories([]); setTasks([]); return }
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

  const loadData = useCallback(async (projectId: string) => {
    try {
      const [epicR, sprintR, storyR, taskR] = await Promise.all([
        api.get(`/hunt/projects/${projectId}/epics`),
        api.get(`/hunt/projects/${projectId}/sprints`),
        api.get(`/hunt/projects/${projectId}/stories`),
        api.get(`/hunt/tasks?project_id=${projectId}${selectedSprint ? `&sprint_id=${selectedSprint}` : ''}`),
      ])
      setEpics(epicR.data)
      setSprints(sprintR.data)
      setStories(storyR.data)
      const newTasks: HuntTask[] = taskR.data
      const changed = newTasks
        .filter(t => prevTaskStatuses.current[t.id] && prevTaskStatuses.current[t.id] !== t.status)
        .map(t => t.id)
      if (changed.length > 0) {
        setFlashedTasks(new Set(changed))
        setTimeout(() => setFlashedTasks(new Set()), 1500)
      }
      prevTaskStatuses.current = Object.fromEntries(newTasks.map(t => [t.id, t.status]))
      setTasks(newTasks)
    } catch (e) { console.error(e) }
  }, [selectedSprint])

  useEffect(() => { loadHuntProject() }, [activeProject?.id])
  useEffect(() => { if (huntProject) loadData(huntProject.id) }, [huntProject?.id, selectedSprint])
  useEffect(() => { if (lastTaskUpdate > 0 && huntProject) loadData(huntProject.id) }, [lastTaskUpdate])

  // Poll every 15s as guaranteed fallback
  useEffect(() => {
    if (!huntProject) return
    const id = setInterval(() => loadData(huntProject.id), 15000)
    return () => clearInterval(id)
  }, [huntProject?.id, loadData])

  // SSE subscription — reload whenever an agent finishes or a task status changes
  useEffect(() => {
    if (!huntProject) return
    const token = localStorage.getItem('akela_token') || ''
    const room = activeProject ? `proj-${activeProject.id}` : 'general'
    const url = `${API_BASE}/chat/subscribe/alpha?room=${room}&token=${encodeURIComponent(token)}`
    const es = new EventSource(url)
    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data)
        if (data.type === 'task_status') {
          loadData(huntProject.id)
        }
      } catch { /* ignore parse errors */ }
    }
    return () => es.close()
  }, [huntProject?.id, activeProject?.id])

  useEffect(() => {
    if (!activeProject) { setProjectAgentIds(new Set()); return }
    api.get(`/projects/${activeProject.id}/agents`)
      .then(r => setProjectAgentIds(new Set(r.data.map((a: { agent_id: string }) => a.agent_id))))
      .catch(() => setProjectAgentIds(new Set()))
  }, [activeProject?.id])

  const projectAgents = projectAgentIds.size > 0 ? agents.filter(a => projectAgentIds.has(a.id)) : agents
  const refresh = () => { if (huntProject) loadData(huntProject.id) }
  const refreshAndClose = () => { refresh(); setSelectedItem(null) }

  const createEpic = async () => {
    if (!newEpicTitle.trim() || !huntProject) return
    await api.post(`/hunt/projects/${huntProject.id}/epics`, { title: newEpicTitle.trim() })
    setNewEpicTitle(''); setShowNewEpic(false); refresh()
  }

  const addTask = async (epicId: string, title: string, storyId?: string) => {
    await api.post(`/hunt/epics/${epicId}/tasks`, { title, priority: 'P2', story_id: storyId || null })
    refresh()
  }

  const addStory = async (epicId: string, title: string) => {
    await api.post(`/hunt/epics/${epicId}/stories`, { title, priority: 'P2' })
    refresh()
  }

  const changeStatus = async (taskId: string, status: string) => {
    await api.put(`/hunt/tasks/${taskId}/status`, { status })
    refresh()
    if (selectedItem?.type === 'task' && selectedItem.data.id === taskId)
      setSelectedItem({ type: 'task', data: { ...selectedItem.data, status } })
  }

  const deleteTask = async (taskId: string) => {
    if (!confirm('Delete this task?')) return
    await api.delete(`/hunt/tasks/${taskId}`)
    if (selectedItem?.type === 'task' && selectedItem.data.id === taskId) setSelectedItem(null)
    refresh()
  }

  const doneTasks = tasks.filter(t => t.status === 'done').length

  return (
    <div style={{ display: 'flex', height: '100%', flexDirection: 'column', overflow: 'hidden' }}>
      {/* ── Header ── */}
      <div style={{
        padding: '12px 20px', borderBottom: '1px solid var(--border)',
        background: 'var(--bg-surface)', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0,
      }}>
        <span style={{ fontWeight: 700, fontSize: 15, marginRight: 4 }}>The Hunt</span>
        <HelpButton pageId="hunt" />
        {activeProject && <span style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 500 }}>{activeProject.name}</span>}

        {huntProject && (
          <>
            <Dropdown
              placeholder="All Sprints"
              options={sprints.map(s => ({ id: s.id, name: s.name }))}
              value={selectedSprint}
              onChange={setSelectedSprint}
            />
            <button onClick={() => setSelectedItem({ type: 'new-sprint' })} style={{
              display: 'flex', alignItems: 'center', gap: 4, padding: '5px 9px',
              background: 'none', border: '1px solid var(--border)', borderRadius: 6,
              color: 'var(--text-muted)', cursor: 'pointer', fontSize: 12,
            }}
              onMouseEnter={e => (e.currentTarget.style.color = 'var(--text-base)')}
              onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-muted)')}
            ><Plus size={11} /> Sprint</button>
          </>
        )}

        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
          {huntProject && <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{tasks.length} tasks · {doneTasks} done</span>}
          {huntProject && (
            <button onClick={refresh} title="Refresh" style={{
              display: 'flex', alignItems: 'center', padding: '5px 7px',
              background: 'none', border: '1px solid var(--border)', borderRadius: 6,
              color: 'var(--text-muted)', cursor: 'pointer',
            }}
              onMouseEnter={e => (e.currentTarget.style.color = 'var(--text-base)')}
              onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-muted)')}
            ><RefreshCw size={13} /></button>
          )}
          <div style={{ display: 'flex', border: '1px solid var(--border)', borderRadius: 6, overflow: 'hidden' }}>
            {(['list', 'board'] as const).map(v => (
              <button key={v} onClick={() => { setView(v); localStorage.setItem('hunt_view', v) }} style={{
                display: 'flex', alignItems: 'center', gap: 4, padding: '5px 10px',
                background: view === v ? 'var(--accent)' : 'transparent',
                border: 'none', cursor: 'pointer', fontSize: 12,
                color: view === v ? 'white' : 'var(--text-muted)',
              }}>
                {v === 'list' ? <List size={13} /> : <LayoutGrid size={13} />}
                {v === 'list' ? 'List' : 'Board'}
              </button>
            ))}
          </div>
          {huntProject && (
            <button onClick={() => setShowNewEpic(e => !e)} style={{
              display: 'flex', alignItems: 'center', gap: 5, padding: '6px 12px',
              background: 'none', border: '1px solid var(--border)', borderRadius: 6,
              color: 'var(--text-muted)', cursor: 'pointer', fontSize: 12,
            }}>
              <Plus size={12} /> Epic
            </button>
          )}
        </div>
      </div>

      {showNewEpic && (
        <div style={{ padding: '10px 20px', borderBottom: '1px solid var(--border)', background: 'var(--bg-elevated)', display: 'flex', gap: 8, alignItems: 'center' }}>
          <input autoFocus placeholder="Epic title…" value={newEpicTitle} onChange={e => setNewEpicTitle(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') createEpic(); if (e.key === 'Escape') setShowNewEpic(false) }}
            style={{ ...iStyle, maxWidth: 320 }}
          />
          <button onClick={createEpic} style={{ padding: '7px 14px', background: 'var(--accent)', border: 'none', borderRadius: 6, color: 'white', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>Create</button>
          <button onClick={() => setShowNewEpic(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}><X size={16} /></button>
        </div>
      )}

      {/* ── Body ── */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {view === 'list' ? (
          <>
            <div style={{ flex: 1, overflowY: 'auto', padding: '14px 18px' }}>
              {!huntProject ? (
                <div style={{ textAlign: 'center', color: 'var(--text-muted)', marginTop: 80 }}>
                  <div style={{ fontSize: 40, marginBottom: 12 }}>🎯</div>
                  <div style={{ fontSize: 15 }}>Select a project in the sidebar to start the hunt.</div>
                </div>
              ) : projectAgentIds.size === 0 ? (
                <div style={{ textAlign: 'center', color: 'var(--text-muted)', marginTop: 80 }}>
                  <div style={{ fontSize: 40, marginBottom: 12 }}>🐺</div>
                  <div style={{ fontSize: 15, marginBottom: 6 }}>No agents in <strong style={{ color: 'var(--text-primary)' }}>{activeProject?.name}</strong> yet.</div>
                  <div style={{ fontSize: 13 }}>Go to <strong style={{ color: 'var(--accent)' }}>Dashboard</strong> to assign agents to this project.</div>
                </div>
              ) : epics.length === 0 ? (
                <div style={{ textAlign: 'center', color: 'var(--text-muted)', marginTop: 60 }}>
                  <div style={{ fontSize: 14 }}>No epics yet.</div>
                  <div style={{ fontSize: 12, marginTop: 4 }}>Click + Epic to create one.</div>
                </div>
              ) : epics.map(epic => (
                <EpicGroup key={epic.id} epic={epic} slug={slug}
                  stories={stories.filter(s => s.epic_id === epic.id)}
                  tasks={tasks}
                  selectedItem={selectedItem}
                  onSelectEpic={e => setSelectedItem({ type: 'epic', data: e })}
                  onSelectStory={s => setSelectedItem({ type: 'story', data: s })}
                  onSelectTask={t => setSelectedItem(prev => prev?.type === 'task' && prev.data.id === t.id ? null : { type: 'task', data: t })}
                  onStatusChange={changeStatus}
                  onDeleteTask={deleteTask}
                  onAddTask={addTask}
                  onAddStory={addStory}
                />
              ))}
            </div>
            {selectedItem && huntProject && (
              <DetailPanel
                item={selectedItem} slug={slug}
                agents={projectAgents} sprints={sprints} epics={epics}
                huntProjectId={huntProject.id}
                onClose={() => setSelectedItem(null)}
                onSaved={() => { refresh(); if (selectedItem.type !== 'task') setSelectedItem(null) }}
                onDeleted={refreshAndClose}
              />
            )}
          </>
        ) : huntProject ? (
          <HuntBoard
            tasks={tasks} flashedTasks={flashedTasks} slug={slug}
            selectedItem={selectedItem} onSelectItem={setSelectedItem}
            sprints={sprints} epics={epics} agents={projectAgents}
            huntProjectId={huntProject.id}
            onSaved={refresh} onDeleted={refreshAndClose}
          />
        ) : (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)' }}>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 40, marginBottom: 12 }}>🎯</div>
              <div>Select a project in the sidebar to see the board.</div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
