import { useEffect, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { HelpCircle, X } from 'lucide-react'
import { HELP_CONTENT, HELP_TITLES, type HelpPageId } from '../help'

export function HelpButton({ pageId }: { pageId: HelpPageId }) {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        title={`Help — ${HELP_TITLES[pageId]}`}
        aria-label={`Help for ${HELP_TITLES[pageId]}`}
        style={{
          background: 'transparent',
          border: '1px solid var(--border)',
          borderRadius: 6,
          color: 'var(--text-muted)',
          cursor: 'pointer',
          padding: '5px 7px',
          display: 'inline-flex',
          alignItems: 'center',
          gap: 4,
          fontSize: 12,
        }}
        onMouseEnter={e => (e.currentTarget.style.color = 'var(--text-primary)')}
        onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-muted)')}
      >
        <HelpCircle size={14} />
      </button>

      {open && (
        <>
          {/* Backdrop */}
          <div
            onClick={() => setOpen(false)}
            style={{
              position: 'fixed', inset: 0,
              background: 'rgba(0,0,0,0.45)', zIndex: 1000,
            }}
          />

          {/* Drawer */}
          <aside
            role="dialog"
            aria-label={`Help — ${HELP_TITLES[pageId]}`}
            style={{
              position: 'fixed', top: 0, right: 0, bottom: 0,
              width: 'min(520px, 100vw)',
              background: 'var(--bg-surface)',
              borderLeft: '1px solid var(--border)',
              boxShadow: '-8px 0 32px rgba(0,0,0,0.35)',
              zIndex: 1001,
              display: 'flex', flexDirection: 'column',
            }}
          >
            {/* Header */}
            <div style={{
              padding: '14px 18px',
              borderBottom: '1px solid var(--border)',
              display: 'flex', alignItems: 'center', gap: 10,
              flexShrink: 0,
            }}>
              <HelpCircle size={16} color="var(--accent)" />
              <div style={{ fontSize: 14, fontWeight: 700, flex: 1 }}>
                Help · {HELP_TITLES[pageId]}
              </div>
              <button
                onClick={() => setOpen(false)}
                aria-label="Close help"
                style={{
                  background: 'transparent', border: 'none',
                  color: 'var(--text-muted)', cursor: 'pointer',
                  padding: 4, display: 'flex',
                }}
                onMouseEnter={e => (e.currentTarget.style.color = 'var(--text-primary)')}
                onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-muted)')}
              >
                <X size={18} />
              </button>
            </div>

            {/* Body */}
            <div
              className="chat-markdown"
              style={{
                flex: 1, overflowY: 'auto',
                padding: '18px 22px',
                fontSize: 14, lineHeight: 1.6,
                color: 'var(--text-secondary)',
              }}
            >
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {HELP_CONTENT[pageId]}
              </ReactMarkdown>
            </div>
          </aside>
        </>
      )}
    </>
  )
}
