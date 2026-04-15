import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// ── PWA service worker registration ─────────────────────────────────────
//
// Registered only in production. Scope is /pack/ — same as the app's
// BrowserRouter basename — so the worker only controls pages under /pack/
// and never interferes with any other service on the origin.
//
// Dev mode skips registration to avoid the "cached stale bundle" pain
// during hot reloads.
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/pack/sw.js', { scope: '/pack/' })
      .catch((err) => {
        // Don't crash the app if the SW fails to register — log and move on.
        console.warn('[akela] service worker registration failed:', err)
      })
  })
}
