import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store'

export function Login() {
  const { setUser, setToken } = useStore()
  const navigate = useNavigate()

  // Handle GitHub / Google OAuth callback redirect:
  // /pack/login?token=xxx&orchestrator_id=xxx&name=xxx&admin_api_key=xxx
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const token = params.get('token')
    if (!token) return

    setToken(token)
    setUser({
      id: params.get('orchestrator_id') || '',
      name: params.get('name') || 'Alpha',
      username: params.get('username') || '',
      role: 'alpha',
      admin_api_key: params.get('admin_api_key') || '',
    })
    window.history.replaceState({}, '', '/pack/')
    navigate('/', { replace: true })
  }, [])

  return (
    <div style={{
      minHeight: '100vh', background: 'var(--bg-base)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 16,
    }}>
      <div style={{
        background: 'var(--bg-surface)', border: '1px solid var(--border)',
        borderRadius: 16, padding: 'clamp(24px, 6vw, 48px)',
        width: '100%', maxWidth: 380, boxSizing: 'border-box',
        textAlign: 'center',
      }}>
        <div style={{ fontSize: 64, marginBottom: 12 }}>🐺</div>
        <h1 style={{ fontSize: 28, fontWeight: 700, color: 'var(--alpha)', marginBottom: 4 }}>Akela</h1>
        <p style={{ color: 'var(--text-muted)', marginBottom: 36, letterSpacing: 2, fontSize: 12 }}>
          RUN AS ONE.
        </p>

        <a
          href="/akela-api/auth/github"
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
            width: '100%', padding: '13px 24px', boxSizing: 'border-box',
            background: '#24292e', border: '1px solid rgba(255,255,255,0.12)',
            borderRadius: 8, color: '#fff', fontSize: 14, fontWeight: 600,
            cursor: 'pointer', textDecoration: 'none', transition: 'background 0.2s',
          }}
          onMouseEnter={e => { (e.currentTarget as HTMLAnchorElement).style.background = '#2f3638' }}
          onMouseLeave={e => { (e.currentTarget as HTMLAnchorElement).style.background = '#24292e' }}
        >
          <svg height="20" width="20" viewBox="0 0 16 16" fill="currentColor">
            <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38
              0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13
              -.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66
              .07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15
              -.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27
              .68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12
              .51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48
              0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/>
          </svg>
          Continue with GitHub
        </a>

        <a
          href="/akela-api/auth/google"
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
            width: '100%', padding: '13px 24px', boxSizing: 'border-box',
            marginTop: 12,
            background: '#fff', border: '1px solid rgba(0,0,0,0.12)',
            borderRadius: 8, color: '#1f1f1f', fontSize: 14, fontWeight: 600,
            cursor: 'pointer', textDecoration: 'none', transition: 'background 0.2s',
          }}
          onMouseEnter={e => { (e.currentTarget as HTMLAnchorElement).style.background = '#f5f5f5' }}
          onMouseLeave={e => { (e.currentTarget as HTMLAnchorElement).style.background = '#fff' }}
        >
          <svg height="20" width="20" viewBox="0 0 48 48">
            <path fill="#FFC107" d="M43.611 20.083H42V20H24v8h11.303c-1.649 4.657-6.08 8-11.303 8-6.627 0-12-5.373-12-12s5.373-12 12-12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 12.955 4 4 12.955 4 24s8.955 20 20 20 20-8.955 20-20c0-1.341-.138-2.65-.389-3.917z"/>
            <path fill="#FF3D00" d="m6.306 14.691 6.571 4.819C14.655 15.108 18.961 12 24 12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 16.318 4 9.656 8.337 6.306 14.691z"/>
            <path fill="#4CAF50" d="M24 44c5.166 0 9.86-1.977 13.409-5.192l-6.19-5.238A11.91 11.91 0 0 1 24 36c-5.202 0-9.619-3.317-11.283-7.946l-6.522 5.025C9.505 39.556 16.227 44 24 44z"/>
            <path fill="#1976D2" d="M43.611 20.083H42V20H24v8h11.303a12.04 12.04 0 0 1-4.087 5.571l.003-.002 6.19 5.238C36.971 39.205 44 34 44 24c0-1.341-.138-2.65-.389-3.917z"/>
          </svg>
          Continue with Google
        </a>

        <p style={{ marginTop: 24, fontSize: 12, color: 'var(--text-muted)' }}>
          Sign in with GitHub or Google — each account gets its own isolated pack.
        </p>
      </div>
    </div>
  )
}
