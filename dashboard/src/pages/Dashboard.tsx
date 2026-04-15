import { useEffect, useState } from 'react'
import { useStore } from '../store'
import type { Project, Agent } from '../store'
import api from '../api'
import { CheckCircle, Clock, Plus } from 'lucide-react'

const rankColors: Record<string, string> = {
  alpha: 'var(--alpha)', beta: 'var(--beta)', delta: 'var(--delta)', omega: 'var(--omega)',
}

interface ProjectStat {
  huntProjectId: string | null
  sprintName: string | null
  total: number
  done: number
  inProgress: number
}

function ProjectRow({
  project, stat, agents, projectAgentIds, onToggleAgent,
}: {
  project: Project
  stat: ProjectStat | null
  agents: Agent[]
  projectAgentIds: Set<string>
  onToggleAgent: (agentId: string) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const donePct = stat && stat.total > 0 ? Math.round((stat.done / stat.total) * 100) : 0
  const assigned = agents.filter(a => projectAgentIds.has(a.id))

  return (
    <div style={{
      background: 'var(--bg-surface)', border: '1px solid var(--border)',
      borderRadius: 10, overflow: 'hidden', marginBottom: 10,
    }}>
      {/* Header row */}
      <div
        onClick={() => setExpanded(e => !e)}
        style={{
          display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px',
          cursor: 'pointer',
        }}
        onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-hover)')}
        onMouseLeave={e => (e.currentTarget.style.background = '')}
      >
        <div style={{ width: 10, height: 10, borderRadius: 3, background: project.color, flexShrink: 0 }} />
        <span style={{ fontWeight: 700, fontSize: 14, flex: 1 }}>{project.name}</span>
        {project.slug && (
          <span style={{ fontSize: 10, fontFamily: 'monospace', color: 'var(--text-muted)', fontWeight: 700 }}>
            {project.slug}
          </span>
        )}

        {stat ? (
          <>
            {stat.sprintName && (
              <span style={{ fontSize: 11, color: 'var(--accent)', display: 'flex', alignItems: 'center', gap: 4 }}>
                <Clock size={10} /> {stat.sprintName}
              </span>
            )}
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{stat.total} tasks</span>
            <div style={{ width: 60, height: 5, background: 'var(--border)', borderRadius: 3, overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${donePct}%`, background: 'var(--success)', borderRadius: 3 }} />
            </div>
            <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--success)', width: 32, textAlign: 'right' }}>
              {donePct}%
            </span>
          </>
        ) : (
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>No hunt data</span>
        )}

        {/* Assigned agents avatars */}
        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          {assigned.slice(0, 4).map(a => (
            <div key={a.id} title={a.display_name || a.name} style={{
              width: 22, height: 22, borderRadius: '50%', flexShrink: 0,
              background: rankColors[a.rank] || 'var(--border)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 10, fontWeight: 700, color: '#000',
              border: `2px solid ${a.status === 'online' ? 'var(--online)' : 'var(--border)'}`,
            }}>
              {(a.display_name || a.name)[0].toUpperCase()}
            </div>
          ))}
          {assigned.length > 4 && (
            <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>+{assigned.length - 4}</span>
          )}
          {assigned.length === 0 && (
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>no agents</span>
          )}
        </div>

        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{expanded ? '▲' : '▼'}</span>
      </div>

      {/* Expanded: agent assignment */}
      {expanded && (
        <div style={{ padding: '0 16px 14px', borderTop: '1px solid var(--border)' }}>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', margin: '10px 0 8px', fontWeight: 600 }}>
            ASSIGN AGENTS TO THIS PROJECT
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {agents.map(a => {
              const inProj = projectAgentIds.has(a.id)
              return (
                <button
                  key={a.id}
                  onClick={() => onToggleAgent(a.id)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 6,
                    padding: '5px 10px', borderRadius: 6, cursor: 'pointer', fontSize: 12,
                    border: `1px solid ${inProj ? 'rgba(76,175,80,0.5)' : 'var(--border)'}`,
                    background: inProj ? 'rgba(76,175,80,0.1)' : 'var(--bg-elevated)',
                    color: inProj ? 'var(--success)' : 'var(--text-secondary)',
                    fontWeight: inProj ? 700 : 400,
                  }}
                >
                  <div style={{
                    width: 6, height: 6, borderRadius: '50%',
                    background: a.status === 'online' ? 'var(--online)' : 'var(--offline)',
                  }} />
                  {a.display_name || a.name}
                  {inProj ? <CheckCircle size={11} /> : <Plus size={11} />}
                </button>
              )
            })}
            {agents.length === 0 && (
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>No agents registered yet.</span>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export function Dashboard() {
  const { agents, setAgents, projects } = useStore()
  const [stats, setStats] = useState<Record<string, ProjectStat>>({})
  // projectAgentIds keyed by project.id
  const [projectAgents, setProjectAgents] = useState<Record<string, Set<string>>>({})
  const online = agents.filter(a => a.status === 'online')

  useEffect(() => {
    api.get('/agents/').then(r => setAgents(r.data)).catch(console.error)
  }, [])

  // Load stats + agent assignments for all projects
  useEffect(() => {
    if (!projects.length) return
    const load = async () => {
      const statsMap: Record<string, ProjectStat> = {}
      const agentsMap: Record<string, Set<string>> = {}

      await Promise.all(projects.map(async (p) => {
        // Agent assignments
        try {
          const r = await api.get(`/projects/${p.id}/agents`)
          agentsMap[p.id] = new Set(r.data.map((a: { agent_id: string }) => a.agent_id))
        } catch { agentsMap[p.id] = new Set() }

        // Hunt stats
        try {
          const hpR = await api.get(`/hunt/projects?akela_project_id=${p.id}`)
          if (!hpR.data.length) { statsMap[p.id] = { huntProjectId: null, sprintName: null, total: 0, done: 0, inProgress: 0 }; return }
          const hp = hpR.data[0]
          const [sprintR, taskR] = await Promise.all([
            api.get(`/hunt/projects/${hp.id}/sprints`),
            api.get(`/hunt/tasks?project_id=${hp.id}`),
          ])
          const activeSprint = sprintR.data.find((s: any) => s.status === 'active') || null
          const tasks: any[] = taskR.data
          statsMap[p.id] = {
            huntProjectId: hp.id,
            sprintName: activeSprint?.name || null,
            total: tasks.length,
            done: tasks.filter(t => t.status === 'done').length,
            inProgress: tasks.filter(t => t.status === 'in_progress').length,
          }
        } catch { statsMap[p.id] = { huntProjectId: null, sprintName: null, total: 0, done: 0, inProgress: 0 } }
      }))

      setStats(statsMap)
      setProjectAgents(agentsMap)
    }
    load()
  }, [projects.length])

  const toggleAgent = async (project: Project, agentId: string) => {
    const current = projectAgents[project.id] || new Set<string>()
    if (current.has(agentId)) {
      await api.delete(`/projects/${project.id}/agents/${agentId}`)
      setProjectAgents(prev => {
        const s = new Set(prev[project.id])
        s.delete(agentId)
        return { ...prev, [project.id]: s }
      })
    } else {
      await api.post(`/projects/${project.id}/agents`, { agent_id: agentId, role: 'member' })
      setProjectAgents(prev => ({
        ...prev,
        [project.id]: new Set([...(prev[project.id] || []), agentId]),
      }))
    }
  }

  return (
    <div style={{ padding: 28, overflowY: 'auto', height: '100%' }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 6 }}>Dashboard</h1>
      <p style={{ color: 'var(--text-muted)', marginBottom: 24, fontSize: 14 }}>
        Pack overview · all projects
      </p>

      <div className="dashboard-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 24 }}>

        {/* Left: all projects */}
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.07em', marginBottom: 10 }}>
            PROJECTS — click to assign agents
          </div>
          {projects.length === 0 ? (
            <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>
              No projects yet. Create one from the sidebar.
            </div>
          ) : projects.map(p => (
            <ProjectRow
              key={p.id}
              project={p}
              stat={stats[p.id] || null}
              agents={agents}
              projectAgentIds={projectAgents[p.id] || new Set()}
              onToggleAgent={agentId => toggleAgent(p, agentId)}
            />
          ))}
        </div>

        {/* Right: Pack roster */}
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.07em', marginBottom: 10 }}>
            THE PACK · {online.length}/{agents.length} online
          </div>
          <div style={{
            background: 'var(--bg-surface)', border: '1px solid var(--border)',
            borderRadius: 10, overflow: 'hidden',
          }}>
            {agents.length === 0 ? (
              <div style={{ padding: 20, color: 'var(--text-muted)', fontSize: 13 }}>
                No agents yet. Go to The Pack to register one.
              </div>
            ) : agents.map((a, i) => (
              <div key={a.id} style={{
                display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px',
                borderBottom: i < agents.length - 1 ? '1px solid var(--border)' : 'none',
              }}>
                <div style={{
                  width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
                  background: a.status === 'online' ? 'var(--online)' : a.status === 'busy' ? 'var(--busy)' : 'var(--offline)',
                }} className={a.status === 'online' ? 'pulse-online' : ''} />
                <span style={{ flex: 1, fontSize: 13, fontWeight: 500 }}>{a.display_name || a.name}</span>
                <span style={{
                  fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 12,
                  background: `${rankColors[a.rank]}22`, color: rankColors[a.rank],
                }}>
                  {a.rank.toUpperCase()}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
