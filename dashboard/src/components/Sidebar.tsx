import { useState, useRef, useEffect } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useStore } from '../store'
import type { Project } from '../store'
import { useDmNotifications } from '../hooks/useDmNotifications'
import {
  LayoutDashboard, MessageSquare, Crosshair, Users,
  Settings, LogOut, ChevronLeft, ChevronRight,
  ChevronDown, Plus, Menu, X,
} from 'lucide-react'
import api from '../api'

// ── Nav definitions ────────────────────────────────────────────────────────

const PROJECT_NAV = [
  { path: '/agents', icon: Users,         label: 'The Pack' },
  { path: '/den',    icon: MessageSquare, label: 'The Den' },
  { path: '/hunt',   icon: Crosshair,     label: 'The Hunt' },
]

const GENERAL_NAV = [
  { path: '/',         icon: LayoutDashboard, label: 'Dashboard' },
  { path: '/pack',     icon: Users,           label: 'The Pack' },
  { path: '/settings', icon: Settings,        label: 'Settings' },
]

const rankColors: Record<string, string> = {
  alpha: 'var(--alpha)', beta: 'var(--beta)', delta: 'var(--delta)', omega: 'var(--omega)',
}

const COLLAPSED_KEY = 'akela_sidebar_collapsed'

// ── Project Switcher ───────────────────────────────────────────────────────

function ProjectSwitcher({ collapsed }: { collapsed: boolean }) {
  const { projects, activeProject, setActiveProject, setProjects } = useStore()
  const [open, setOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [])

  const select = (p: Project) => {
    setActiveProject(p)
    setOpen(false)
  }

  const createProject = async () => {
    if (!newName.trim()) return
    try {
      const r = await api.post('/projects/', { name: newName.trim() })
      const updated = await api.get('/projects/')
      setProjects(updated.data)
      setActiveProject(r.data)
      setNewName('')
      setCreating(false)
      setOpen(false)
    } catch (e) { console.error(e) }
  }

  if (collapsed) {
    return (
      <div style={{
        padding: '8px 0', borderBottom: '1px solid var(--border)',
        display: 'flex', justifyContent: 'center',
      }}>
        <div
          title={activeProject?.name || 'No project'}
          style={{
            width: 28, height: 28, borderRadius: 6,
            background: activeProject?.color || 'var(--bg-elevated)',
            border: '1px solid var(--border)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer', fontSize: 12, fontWeight: 700, color: '#fff',
          }}
        >
          {activeProject ? activeProject.name[0].toUpperCase() : '?'}
        </div>
      </div>
    )
  }

  return (
    <div ref={ref} style={{ padding: '8px 12px 6px', borderBottom: '1px solid var(--border)', position: 'relative' }}>
      <div style={{ fontSize: 10, color: 'var(--text-muted)', letterSpacing: '0.06em', marginBottom: 4, fontWeight: 600 }}>
        PROJECT
      </div>

      {/* Trigger */}
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', gap: 7,
          padding: '6px 8px', background: 'var(--bg-elevated)',
          border: '1px solid var(--border)', borderRadius: 7,
          cursor: 'pointer', textAlign: 'left',
        }}
      >
        <div style={{
          width: 18, height: 18, borderRadius: 4, flexShrink: 0,
          background: activeProject?.color || 'var(--border)',
        }} />
        <span style={{
          flex: 1, fontSize: 13, fontWeight: 600,
          color: activeProject ? 'var(--text-primary)' : 'var(--text-muted)',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {activeProject?.name || 'Select project…'}
        </span>
        <ChevronDown size={12} color="var(--text-muted)" />
      </button>

      {/* Dropdown */}
      {open && (
        <div style={{
          position: 'absolute', top: '100%', left: 12, right: 12, zIndex: 200,
          background: 'var(--bg-elevated)', border: '1px solid var(--border)',
          borderRadius: 8, overflow: 'hidden', boxShadow: '0 4px 20px rgba(0,0,0,0.3)',
          marginTop: 2,
        }}>
          {projects.length === 0 && !creating && (
            <div style={{ padding: '10px 12px', fontSize: 12, color: 'var(--text-muted)' }}>
              No projects yet
            </div>
          )}
          {projects.map(p => (
            <div
              key={p.id}
              onClick={() => select(p)}
              style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '8px 12px', cursor: 'pointer', fontSize: 13,
                background: activeProject?.id === p.id ? 'var(--bg-hover)' : 'transparent',
                color: activeProject?.id === p.id ? 'var(--text-primary)' : 'var(--text-secondary)',
                fontWeight: activeProject?.id === p.id ? 600 : 400,
              }}
              onMouseEnter={e => { if (activeProject?.id !== p.id) e.currentTarget.style.background = 'var(--bg-hover)' }}
              onMouseLeave={e => { if (activeProject?.id !== p.id) e.currentTarget.style.background = 'transparent' }}
            >
              <div style={{ width: 10, height: 10, borderRadius: 3, background: p.color, flexShrink: 0 }} />
              {p.name}
            </div>
          ))}

          {/* New project form */}
          {creating ? (
            <div style={{ padding: '8px 10px', borderTop: '1px solid var(--border)', display: 'flex', gap: 6 }}>
              <input
                autoFocus
                value={newName}
                onChange={e => setNewName(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') createProject(); if (e.key === 'Escape') setCreating(false) }}
                placeholder="Project name…"
                style={{
                  flex: 1, padding: '5px 8px', background: 'var(--bg-surface)',
                  border: '1px solid var(--border)', borderRadius: 5,
                  color: 'var(--text-base)', fontSize: 12, outline: 'none',
                }}
              />
              <button onClick={createProject} style={{
                padding: '5px 8px', background: 'var(--alpha)', border: 'none',
                borderRadius: 5, color: '#000', fontWeight: 700, cursor: 'pointer', fontSize: 12,
              }}>Add</button>
              <button onClick={() => setCreating(false)} style={{
                background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 16,
              }}>×</button>
            </div>
          ) : (
            <div
              onClick={() => setCreating(true)}
              style={{
                display: 'flex', alignItems: 'center', gap: 7,
                padding: '8px 12px', cursor: 'pointer', fontSize: 12, fontWeight: 600,
                color: 'var(--text-primary)', borderTop: '1px solid var(--border)',
                transition: 'background 0.15s',
              }}
              onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-hover)' }}
              onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
              onMouseDown={e => { e.currentTarget.style.background = 'var(--bg-elevated)' }}
              onMouseUp={e => { e.currentTarget.style.background = 'var(--bg-hover)' }}
            >
              <Plus size={12} /> New Project
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Nav Item ───────────────────────────────────────────────────────────────

function NavItem({
  path, icon: Icon, label, collapsed, disabled, badge,
  onClick,
}: {
  path: string; icon: typeof LayoutDashboard; label: string
  collapsed: boolean; disabled?: boolean; badge?: number
  onClick?: () => void
}) {
  const navigate = useNavigate()
  const location = useLocation()
  const active = location.pathname === path

  const go = () => {
    if (disabled) return
    navigate(path)
    onClick?.()
  }

  return (
    <button
      onClick={go}
      title={collapsed ? label : undefined}
      disabled={disabled}
      style={{
        width: '100%', display: 'flex', alignItems: 'center',
        gap: collapsed ? 0 : 10,
        justifyContent: collapsed ? 'center' : 'flex-start',
        padding: collapsed ? '11px 0' : '9px 16px',
        border: 'none', cursor: disabled ? 'default' : 'pointer',
        background: active ? 'var(--bg-hover)' : 'transparent',
        color: disabled ? 'var(--text-muted)' : active ? 'var(--text-primary)' : 'var(--text-secondary)',
        fontSize: 13, fontWeight: active ? 600 : 400,
        opacity: disabled ? 0.4 : 1,
        borderLeft: collapsed ? 'none' : (active ? '3px solid var(--accent)' : '3px solid transparent'),
        borderRight: collapsed ? (active ? '3px solid var(--accent)' : '3px solid transparent') : 'none',
        transition: 'all 0.15s', position: 'relative',
      }}
    >
      <Icon size={15} />
      {!collapsed && label}
      {badge != null && badge > 0 && (
        <span style={{
          marginLeft: 'auto', minWidth: 15, height: 15, borderRadius: 8,
          background: 'var(--accent)', color: '#fff',
          fontSize: 10, fontWeight: 700,
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 3px',
        }}>
          {badge > 9 ? '9+' : badge}
        </span>
      )}
    </button>
  )
}

// ── Section Label ──────────────────────────────────────────────────────────

function SectionLabel({ label, collapsed }: { label: string; collapsed: boolean }) {
  if (collapsed) return <div style={{ height: 1, background: 'var(--border)', margin: '6px 8px' }} />
  return (
    <div style={{
      padding: '8px 16px 3px',
      fontSize: 10, fontWeight: 700, letterSpacing: '0.07em',
      color: 'var(--text-muted)', userSelect: 'none',
    }}>
      {label}
    </div>
  )
}

// ── Main Sidebar ───────────────────────────────────────────────────────────

export function Sidebar() {
  const navigate = useNavigate()
  const { agents, setUser, setToken, unreadDMs, clearUnread, activeProject } = useStore()
  const [open, setOpen] = useState(false)
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem(COLLAPSED_KEY) === '1' } catch { return false }
  })

  useDmNotifications()

  const onlineCount = agents.filter(a => a.status === 'online').length
  const noProject = !activeProject
  const totalUnread = Object.values(unreadDMs).reduce((s, n) => s + n, 0)

  const toggleCollapse = () => {
    setCollapsed(c => {
      const next = !c
      try { localStorage.setItem(COLLAPSED_KEY, next ? '1' : '0') } catch {}
      return next
    })
  }

  const logout = () => {
    setUser(null)
    setToken(null)
    navigate('/login')
  }

  const w = collapsed ? 48 : 220

  return (
    <>
      {/* Mobile hamburger — hidden on desktop via CSS */}
      <button
        className="sidebar-toggle"
        onClick={() => setOpen(true)}
        aria-label="Open navigation"
      >
        <Menu size={22} />
      </button>

      {/* Mobile backdrop — only rendered when drawer is open */}
      {open && (
        <div
          className="sidebar-backdrop"
          onClick={() => setOpen(false)}
        />
      )}

      <aside
        className={`sidebar ${open ? 'sidebar-open' : ''}`}
        style={{
          width: w, background: 'var(--bg-surface)',
          borderRight: '1px solid var(--border)',
          display: 'flex', flexDirection: 'column', height: '100vh',
          flexShrink: 0, overflow: 'hidden',
        }}
      >
        {/* Logo row */}
        <div style={{
          padding: collapsed ? '16px 0' : '16px 16px 12px',
          borderBottom: '1px solid var(--border)',
          display: 'flex', alignItems: 'center',
          justifyContent: collapsed ? 'center' : 'space-between',
          minHeight: 52, flexShrink: 0,
        }}>
          {collapsed
            ? <span style={{ fontSize: 20 }}>🐺</span>
            : (
              <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                <span style={{ fontSize: 22 }}>🐺</span>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 16, color: 'var(--alpha)' }}>Akela</div>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)', letterSpacing: 1 }}>RUN AS ONE.</div>
                </div>
              </div>
            )
          }
          {/* Mobile close — hidden on desktop via CSS */}
          <button
            className="sidebar-close"
            onClick={() => setOpen(false)}
            aria-label="Close navigation"
          >
            <X size={20} />
          </button>
        </div>

        {/* Project Switcher */}
        <ProjectSwitcher collapsed={collapsed} />

        {/* Scrollable nav area */}
        <nav style={{ flex: 1, overflowY: 'auto', paddingBottom: 4 }}>

          {/* PROJECT section */}
          <SectionLabel label="PROJECT" collapsed={collapsed} />
          {noProject && !collapsed && (
            <div style={{
              margin: '4px 12px 6px', padding: '8px 10px',
              background: 'var(--bg-elevated)', border: '1px solid var(--border)',
              borderRadius: 6, fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.5,
            }}>
              Select or create a project above to get started.
            </div>
          )}
          {PROJECT_NAV.map(({ path, icon, label }) => (
            <NavItem
              key={path} path={path} icon={icon} label={label}
              collapsed={collapsed} disabled={noProject}
              badge={path === '/den' ? totalUnread : undefined}
              onClick={() => setOpen(false)}
            />
          ))}

          {/* GENERAL section */}
          <SectionLabel label="GENERAL" collapsed={collapsed} />
          {GENERAL_NAV.map(({ path, icon, label }) => (
            <NavItem
              key={path} path={path} icon={icon} label={label}
              collapsed={collapsed}
              onClick={() => setOpen(false)}
            />
          ))}

          {/* Agent DMs — under General */}
          {!collapsed && agents.length > 0 && (
            <div style={{ padding: '4px 12px 0' }}>
              <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 3, fontWeight: 600, letterSpacing: '0.05em' }}>
                PACK · {onlineCount} online
              </div>
              {agents.map(a => {
                const unread = unreadDMs[a.name] || 0
                const location = window.location
                const active = location.pathname === `/chat/${a.name}`
                return (
                  <div
                    key={a.id}
                    onClick={() => { clearUnread(a.name); navigate(`/chat/${a.name}`); setOpen(false) }}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 6, marginBottom: 1,
                      padding: '3px 4px', borderRadius: 5, cursor: 'pointer',
                      background: active ? 'var(--bg-hover)' : 'transparent',
                    }}
                    onMouseEnter={e => { if (!active) e.currentTarget.style.background = 'var(--bg-elevated)' }}
                    onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'transparent' }}
                  >
                    <div style={{
                      width: 6, height: 6, borderRadius: '50%', flexShrink: 0,
                      background: a.status === 'online' ? 'var(--online)' : a.status === 'busy' ? 'var(--busy)' : 'var(--offline)',
                    }} />
                    <span style={{
                      fontSize: 12, color: rankColors[a.rank] || 'var(--text-secondary)',
                      flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>
                      {a.display_name || a.name}
                    </span>
                    {unread > 0 && (
                      <span style={{
                        minWidth: 15, height: 15, borderRadius: 8,
                        background: 'var(--accent)', color: '#fff',
                        fontSize: 10, fontWeight: 700,
                        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 3px',
                      }}>
                        {unread > 9 ? '9+' : unread}
                      </span>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </nav>

        {/* Bottom actions */}
        <button
          onClick={logout}
          title={collapsed ? 'Sign Out' : undefined}
          style={{
            display: 'flex', alignItems: 'center', gap: collapsed ? 0 : 8,
            justifyContent: collapsed ? 'center' : 'flex-start',
            padding: collapsed ? '11px 0' : '9px 16px',
            border: 'none', background: 'transparent', color: 'var(--text-muted)',
            cursor: 'pointer', fontSize: 13, width: '100%',
            borderTop: '1px solid var(--border)',
          }}
        >
          <LogOut size={14} />
          {!collapsed && 'Sign Out'}
        </button>

        <button
          onClick={toggleCollapse}
          title={collapsed ? 'Expand' : 'Collapse'}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: '9px 0', border: 'none', borderTop: '1px solid var(--border)',
            background: 'transparent', color: 'var(--text-muted)',
            cursor: 'pointer', width: '100%',
          }}
          onMouseEnter={e => (e.currentTarget.style.color = 'var(--text-primary)')}
          onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-muted)')}
        >
          {collapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
        </button>
      </aside>
    </>
  )
}
