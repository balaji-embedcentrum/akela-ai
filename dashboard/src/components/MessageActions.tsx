import { useState } from 'react'
import { Copy, Check, RotateCcw, ThumbsUp, ThumbsDown } from 'lucide-react'
import api from '../api'

interface UsageStats {
  prompt_tokens?: number
  completion_tokens?: number
  total_tokens?: number
  model?: string
}

interface MessageActionsProps {
  messageId?: string
  content: string
  isAgent: boolean
  usage?: UsageStats
  durationMs?: number
  tokensPerSec?: number
  onRegenerate?: () => void
}

export function MessageActions({
  messageId,
  content,
  isAgent,
  usage,
  durationMs,
  tokensPerSec,
  onRegenerate,
}: MessageActionsProps) {
  const [copied, setCopied] = useState(false)
  const [feedback, setFeedback] = useState<'up' | 'down' | null>(null)

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(content)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Fallback for non-HTTPS
      const ta = document.createElement('textarea')
      ta.value = content
      document.body.appendChild(ta)
      ta.select()
      document.execCommand('copy')
      document.body.removeChild(ta)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  const handleFeedback = async (rating: 'up' | 'down') => {
    if (!messageId) return
    const newRating = feedback === rating ? null : rating
    setFeedback(newRating)
    if (newRating) {
      try {
        await api.post('/chat/feedback', { message_id: messageId, rating: newRating })
      } catch {}
    }
  }

  const formatDuration = (ms: number) => {
    if (ms < 1000) return `${ms}ms`
    return `${(ms / 1000).toFixed(1)}s`
  }

  const hasStats = isAgent && usage && (usage.completion_tokens || durationMs)

  return (
    <div style={{ marginTop: 4 }}>
      {/* Stats bar — only for agent responses with usage data */}
      {hasStats && (
        <div style={{
          display: 'flex',
          gap: 12,
          fontSize: 11,
          color: 'var(--text-muted)',
          padding: '4px 0',
          flexWrap: 'wrap',
          alignItems: 'center',
          opacity: 0.7,
        }}>
          {usage?.completion_tokens ? (
            <span title="Completion tokens">
              🔢 {usage.completion_tokens} tokens
            </span>
          ) : null}
          {tokensPerSec ? (
            <span title="Generation speed">
              ⚡ {tokensPerSec} t/s
            </span>
          ) : null}
          {durationMs ? (
            <span title="Response time">
              ⏱️ {formatDuration(durationMs)}
            </span>
          ) : null}
          {usage?.model ? (
            <span title="Model" style={{
              background: 'var(--bg-secondary)',
              padding: '1px 6px',
              borderRadius: 4,
              fontSize: 10,
            }}>
              {usage.model}
            </span>
          ) : null}
        </div>
      )}

      {/* Action toolbar */}
      <div style={{
        display: 'flex',
        gap: 2,
        marginTop: 2,
        opacity: 0.5,
        transition: 'opacity 0.15s',
      }}
        onMouseEnter={e => (e.currentTarget.style.opacity = '1')}
        onMouseLeave={e => (e.currentTarget.style.opacity = '0.5')}
      >
        {/* Copy */}
        <button
          onClick={handleCopy}
          title="Copy message"
          style={{
            border: 'none',
            background: 'none',
            color: copied ? 'var(--online)' : 'var(--text-muted)',
            cursor: 'pointer',
            padding: '2px 6px',
            borderRadius: 4,
            display: 'flex',
            alignItems: 'center',
            gap: 3,
            fontSize: 11,
            transition: 'all 0.15s',
          }}
        >
          {copied ? <Check size={12} /> : <Copy size={12} />}
          {copied ? 'Copied' : 'Copy'}
        </button>

        {/* Regenerate — only for agent responses */}
        {isAgent && onRegenerate && (
          <button
            onClick={onRegenerate}
            title="Regenerate response"
            style={{
              border: 'none',
              background: 'none',
              color: 'var(--text-muted)',
              cursor: 'pointer',
              padding: '2px 6px',
              borderRadius: 4,
              display: 'flex',
              alignItems: 'center',
              gap: 3,
              fontSize: 11,
              transition: 'all 0.15s',
            }}
          >
            <RotateCcw size={12} />
            Redo
          </button>
        )}

        {/* Feedback — only for agent responses */}
        {isAgent && messageId && (
          <>
            <button
              onClick={() => handleFeedback('up')}
              title="Good response"
              style={{
                border: 'none',
                background: 'none',
                color: feedback === 'up' ? 'var(--online)' : 'var(--text-muted)',
                cursor: 'pointer',
                padding: '2px 6px',
                borderRadius: 4,
                display: 'flex',
                alignItems: 'center',
                fontSize: 11,
                transition: 'all 0.15s',
              }}
            >
              <ThumbsUp size={12} fill={feedback === 'up' ? 'currentColor' : 'none'} />
            </button>
            <button
              onClick={() => handleFeedback('down')}
              title="Bad response"
              style={{
                border: 'none',
                background: 'none',
                color: feedback === 'down' ? 'var(--danger)' : 'var(--text-muted)',
                cursor: 'pointer',
                padding: '2px 6px',
                borderRadius: 4,
                display: 'flex',
                alignItems: 'center',
                fontSize: 11,
                transition: 'all 0.15s',
              }}
            >
              <ThumbsDown size={12} fill={feedback === 'down' ? 'currentColor' : 'none'} />
            </button>
          </>
        )}
      </div>
    </div>
  )
}
