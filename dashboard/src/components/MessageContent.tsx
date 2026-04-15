import { useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

/**
 * Parse a message that may contain <think>...</think> tags.
 * Returns { thinking, content } where thinking is the thought text
 * (or null if none), and content is the rest of the message.
 */
export function parseThinkTags(raw: string): { thinking: string | null; content: string } {
  const thinkMatch = raw.match(/<think>([\s\S]*?)<\/think>/i)
  if (!thinkMatch) return { thinking: null, content: raw }

  const thinking = thinkMatch[1].trim()
  const content = raw.replace(/<think>[\s\S]*?<\/think>/gi, '').trim()
  return { thinking: thinking || null, content }
}

/**
 * Renders message content with collapsible <think> blocks.
 * Think content is hidden by default in a styled collapsible.
 */
export function MessageContent({ content, isStreaming }: { content: string; isStreaming?: boolean }) {
  const [expanded, setExpanded] = useState(false)
  const { thinking, content: visibleContent } = parseThinkTags(content)

  return (
    <>
      {thinking && (
        <div style={{
          marginBottom: 8,
          borderRadius: 6,
          border: '1px solid rgba(139, 92, 246, 0.25)',
          background: 'rgba(139, 92, 246, 0.06)',
          overflow: 'hidden',
        }}>
          <button
            onClick={() => setExpanded(!expanded)}
            style={{
              width: '100%',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '6px 10px',
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: 'rgba(139, 92, 246, 0.8)',
              fontSize: 12,
              fontWeight: 600,
              textAlign: 'left',
            }}
          >
            <span style={{
              display: 'inline-block',
              transition: 'transform 0.2s',
              transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)',
              fontSize: 10,
            }}>▶</span>
            💭 Thinking{expanded ? '' : '...'}
          </button>
          {expanded && (
            <div style={{
              padding: '4px 10px 8px',
              fontSize: 12,
              color: 'var(--text-muted)',
              lineHeight: 1.5,
              borderTop: '1px solid rgba(139, 92, 246, 0.15)',
            }} className="chat-markdown">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{thinking}</ReactMarkdown>
            </div>
          )}
        </div>
      )}
      {visibleContent && (
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{visibleContent}</ReactMarkdown>
      )}
      {isStreaming && (
        <span style={{
          display: 'inline-block', width: 2, height: 16,
          background: 'var(--text-primary)', marginLeft: 2,
          animation: 'blink 0.8s step-end infinite', verticalAlign: 'text-bottom',
        }} />
      )}
    </>
  )
}
