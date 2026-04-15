import { useEffect, useRef } from 'react'
import { useStore } from '../store'

const API_BASE = import.meta.env.DEV ? 'http://localhost:8200' : '/akela-api'

/**
 * Global hook that listens for DM notifications via SSE.
 * Should be mounted once at the app level (e.g., in Sidebar or App).
 * Increments unread counts for agents that respond in DM rooms
 * the user is not currently viewing.
 */
export function useDmNotifications() {
  const token = useStore(s => s.token)
  const incrementUnread = useStore(s => s.incrementUnread)
  const esRef = useRef<EventSource | null>(null)
  // Track current path to know which DM room is active
  const pathRef = useRef(window.location.pathname)

  // Keep pathRef updated
  useEffect(() => {
    const update = () => { pathRef.current = window.location.pathname }
    window.addEventListener('popstate', update)
    // Also poll since React Router doesn't fire popstate on pushState
    const interval = setInterval(update, 500)
    return () => {
      window.removeEventListener('popstate', update)
      clearInterval(interval)
    }
  }, [])

  useEffect(() => {
    if (!token) return

    const url = `${API_BASE}/chat/subscribe/dm-notifications?token=${token}`
    const es = new EventSource(url)
    esRef.current = es

    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data)
        if (data.type === 'dm_message' && data.agent_name) {
          // Only increment if user is NOT currently viewing this agent's DM
          const currentPath = pathRef.current
          const viewingAgent = currentPath.startsWith('/chat/') ? currentPath.split('/chat/')[1] : null
          if (viewingAgent !== data.agent_name) {
            incrementUnread(data.agent_name)
          }
        }
      } catch {
        // ignore parse errors
      }
    }

    es.onerror = () => {
      // Auto-reconnect is handled by EventSource
    }

    return () => {
      es.close()
      esRef.current = null
    }
  }, [token, incrementUnread])
}
