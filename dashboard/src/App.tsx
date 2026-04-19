import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { useEffect } from 'react'
import { useStore } from './store'
import type { Project } from './store'
import { Sidebar } from './components/Sidebar'
import { Dashboard } from './pages/Dashboard'
import { Den } from './pages/Den'
import { AgentChat } from './pages/AgentChat'
import { Pack } from './pages/Pack'
import { Settings } from './pages/Settings'
import { Hunt } from './pages/Hunt'
import { Login } from './pages/Login'
import { LocalTaskWorker } from './workers/LocalTaskWorker'
import api from './api'

function ProtectedLayout() {
  const { token, setUser, setToken, setAgents, setProjects, setActiveProject } = useStore()

  // Bootstrap: fetch user
  useEffect(() => {
    if (!token) return
    api.get('/auth/me').then(r => {
      setUser({
        id: r.data.id || '',
        name: r.data.name || r.data.username || 'User',
        username: r.data.username || '',
        role: 'alpha',
        admin_api_key: r.data.admin_api_key || '',
      })
    }).catch(() => {
      setToken(null)
      window.location.replace('/login')
    })
  }, [])

  // Load projects from DB — default to first project
  useEffect(() => {
    if (!token) return
    api.get('/projects/').then(r => {
      const list: Project[] = r.data
      setProjects(list)
      if (list.length > 0) {
        setActiveProject(list[0])
      }
    }).catch(console.error)
  }, [token])

  // Global: poll agents every 5s
  useEffect(() => {
    api.get('/agents/').then(r => setAgents(r.data)).catch(console.error)
    const interval = setInterval(() => {
      api.get('/agents/').then(r => setAgents(r.data)).catch(console.error)
    }, 5000)
    return () => clearInterval(interval)
  }, [])

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
      {/* Renderless — dispatches Hunt tasks assigned to local agents by
          calling the user's local endpoint (localStorage) directly. Mounts
          once per authenticated session and survives route changes. */}
      <LocalTaskWorker />
      <Sidebar />
      <main style={{ flex: 1, overflowY: 'auto', background: 'var(--bg-base)' }}>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/den" element={<Den />} />
          <Route path="/chat/:agentName" element={<AgentChat />} />
          <Route path="/agents" element={<Pack />} />
          <Route path="/pack" element={<Pack globalMode />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/hunt" element={<Hunt />} />
        </Routes>
      </main>
    </div>
  )
}

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { token } = useStore()
  if (!token) return <Login />
  return <>{children}</>
}

export default function App() {
  return (
    <BrowserRouter basename="/pack">
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/*" element={
          <RequireAuth>
            <ProtectedLayout />
          </RequireAuth>
        } />
      </Routes>
    </BrowserRouter>
  )
}
