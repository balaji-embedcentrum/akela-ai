import { create } from 'zustand'

export interface Project {
  id: string
  owner_id: string
  name: string
  description: string
  color: string
  slug: string | null
  orchestrator_type: 'human' | 'agent'
  orchestrator_id: string | null
  sort_order: number
  created_at: string
}

export interface Agent {
  id: string
  name: string
  display_name?: string
  endpoint_url?: string
  skills: string[]
  status: 'online' | 'offline' | 'busy'
  rank: 'omega' | 'delta' | 'beta' | 'alpha'
  soul: Record<string, unknown>
  last_seen_at: string | null
  created_at: string
  api_key?: string
}

export interface Task {
  id: string
  title: string
  description?: string
  skill_required?: string
  status: 'pending' | 'assigned' | 'in_progress' | 'done' | 'failed'
  priority: number
  created_by?: string
  assigned_to?: string
  created_at: string
  updated_at: string
}

export interface Message {
  id: string
  agent_id?: string
  sender_name: string
  sender_role: string
  room: string
  content: string
  mentions: string[]
  mention_type: 'broadcast' | 'direct' | 'system' | 'normal'
  slash_command?: string
  attachments?: { name: string; type: string }[]
  msg_metadata?: { tool_calls?: { name: string; preview: string }[]; [key: string]: unknown }
  created_at: string
}

export interface Meeting {
  id: string
  type: 'standup' | 'retro' | 'weekly'
  status: 'scheduled' | 'active' | 'complete'
  transcript: Record<string, unknown>
  scheduled_at: string
  completed_at?: string
}

export interface Workspace {
  id: string
  name: string
  color: string
  sort_order: number
  created_at: string
}

export interface Conversation {
  id: string
  orchestrator_id: string
  workspace_id: string | null
  title: string
  room: string
  created_at: string
  updated_at: string
  last_message: string | null
}

interface User {
  id: string
  name: string
  username: string
  role: 'alpha'
  admin_api_key: string
}

interface Stats {
  total_agents: number
  online_agents: number
  active_tasks: number
  done_tasks: number
}

interface Store {
  user: User | null
  token: string | null
  agents: Agent[]
  tasks: Task[]
  messages: Message[]
  stats: Stats
  activeRoom: string
  conversations: Conversation[]
  workspaces: Workspace[]
  activeConversation: Conversation | null
  projects: Project[]
  activeProject: Project | null
  setUser: (u: User | null) => void
  setToken: (t: string | null) => void
  setAgents: (a: Agent[]) => void
  setTasks: (t: Task[]) => void
  setMessages: (m: Message[]) => void
  addMessage: (m: Message) => void
  setStats: (s: Stats) => void
  setActiveRoom: (r: string) => void
  setConversations: (c: Conversation[]) => void
  setWorkspaces: (w: Workspace[]) => void
  setActiveConversation: (c: Conversation | null) => void
  setProjects: (p: Project[]) => void
  setActiveProject: (p: Project | null) => void
  unreadDMs: Record<string, number>
  incrementUnread: (agentName: string) => void
  clearUnread: (agentName: string) => void
  lastTaskUpdate: number
  notifyTaskUpdate: () => void
}

export const useStore = create<Store>((set) => ({
  user: JSON.parse(localStorage.getItem('akela_user') || 'null'),
  token: localStorage.getItem('akela_token'),
  agents: [],
  tasks: [],
  messages: [],
  stats: { total_agents: 0, online_agents: 0, active_tasks: 0, done_tasks: 0 },
  activeRoom: 'general',
  conversations: [],
  workspaces: [],
  activeConversation: null,
  projects: [],
  activeProject: null,
  setUser: (user) => {
    set({ user })
    if (user) localStorage.setItem('akela_user', JSON.stringify(user))
    else localStorage.removeItem('akela_user')
  },
  setToken: (token) => {
    set({ token })
    if (token) localStorage.setItem('akela_token', token)
    else localStorage.removeItem('akela_token')
  },
  setAgents: (agents) => set({ agents }),
  setTasks: (tasks) => set({ tasks }),
  setMessages: (messages) => set({ messages }),
  addMessage: (msg) => set((s) => {
    if (s.messages.some(m => m.id === msg.id)) return s
    return { messages: [...s.messages, msg] }
  }),
  setStats: (stats) => set({ stats }),
  setActiveRoom: (activeRoom) => set({ activeRoom }),
  setConversations: (conversations) => set({ conversations }),
  setWorkspaces: (workspaces) => set({ workspaces }),
  setActiveConversation: (activeConversation) => set({ activeConversation }),
  setProjects: (projects) => set({ projects }),
  setActiveProject: (activeProject) => set({ activeProject }),
  unreadDMs: {},
  incrementUnread: (agentName) => set((s) => ({
    unreadDMs: { ...s.unreadDMs, [agentName]: (s.unreadDMs[agentName] || 0) + 1 }
  })),
  clearUnread: (agentName) => set((s) => {
    const u = { ...s.unreadDMs }
    delete u[agentName]
    return { unreadDMs: u }
  }),
  lastTaskUpdate: 0,
  notifyTaskUpdate: () => set({ lastTaskUpdate: Date.now() }),
}))

