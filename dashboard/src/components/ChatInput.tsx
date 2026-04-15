import { useRef, useState, useEffect } from 'react'
import { Send, Paperclip, X, FileText, Square } from 'lucide-react'

interface Attachment {
  file: File
  name: string
  type: string
  preview?: string  // data URL for images
  base64?: string   // base64 data
}

interface ChatInputProps {
  placeholder?: string
  disabled?: boolean
  onSend: (text: string, attachments: { name: string; type: string; base64: string }[]) => void
  /** For Den's slash hint handling */
  onInputChange?: (value: string) => void
  /** For Den's key handling (slash hints, mention hints) */
  onKeyDown?: (e: React.KeyboardEvent) => void
  /** Controlled value (for Den's slash/mention selection) */
  value?: string
  /** Controlled setter (for Den) */
  setValue?: (v: string) => void
  /** Ref forwarding for focus (for Den) */
  inputRef?: React.RefObject<HTMLTextAreaElement | null>
  /** When true, replaces Send with a red Stop button */
  isActive?: boolean
  onStop?: () => void
}

export function ChatInput({
  placeholder = 'Type a message...',
  disabled = false,
  onSend,
  onInputChange,
  onKeyDown,
  value: controlledValue,
  setValue: controlledSetValue,
  inputRef: externalRef,
  isActive = false,
  onStop,
}: ChatInputProps) {
  const [internalValue, setInternalValue] = useState('')
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const fileInputRef = useRef<HTMLInputElement>(null)
  const internalTextRef = useRef<HTMLTextAreaElement>(null)
  const textareaRef = externalRef || internalTextRef

  // Use controlled or internal value
  const value = controlledValue !== undefined ? controlledValue : internalValue
  const setValue = controlledSetValue || setInternalValue

  // Auto-grow textarea
  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`
  }, [value])

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || [])
    if (!files.length) return

    const newAttachments: Attachment[] = await Promise.all(
      files.map(async (file) => {
        const base64 = await fileToBase64(file)
        const isImage = file.type.startsWith('image/')
        return {
          file,
          name: file.name,
          type: file.type,
          base64,
          preview: isImage ? URL.createObjectURL(file) : undefined,
        }
      })
    )

    setAttachments(prev => [...prev, ...newAttachments])
    // Reset file input so same file can be re-selected
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const removeAttachment = (index: number) => {
    setAttachments(prev => {
      const next = [...prev]
      if (next[index].preview) URL.revokeObjectURL(next[index].preview!)
      next.splice(index, 1)
      return next
    })
  }

  const handleSend = () => {
    if (!value.trim() && attachments.length === 0) return
    const attachmentData = attachments.map(a => ({
      name: a.name,
      type: a.type,
      base64: a.base64!,
    }))
    onSend(value.trim(), attachmentData)
    setValue('')
    setAttachments([])
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // Shift+Enter: newline, Enter: send
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
      return
    }
    // Forward to parent handler (for slash hints, etc.)
    onKeyDown?.(e)
  }

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setValue(e.target.value)
    onInputChange?.(e.target.value)
  }

  const hasContent = value.trim() || attachments.length > 0

  return (
    <div style={{
      padding: '8px 16px 12px',
      borderTop: '1px solid var(--border)',
      background: 'var(--bg-surface)',
    }}>
      {/* Attachment previews */}
      {attachments.length > 0 && (
        <div style={{
          display: 'flex',
          gap: 8,
          padding: '8px 0',
          overflowX: 'auto',
          flexWrap: 'wrap',
        }}>
          {attachments.map((att, i) => (
            <div key={i} style={{
              position: 'relative',
              borderRadius: 8,
              border: '1px solid var(--border)',
              background: 'var(--bg-elevated)',
              overflow: 'hidden',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: att.preview ? 0 : '6px 10px',
              maxWidth: 200,
            }}>
              {att.preview ? (
                <img
                  src={att.preview}
                  alt={att.name}
                  style={{
                    width: 80, height: 60,
                    objectFit: 'cover',
                    borderRadius: 6,
                  }}
                />
              ) : (
                <>
                  <FileText size={14} style={{ color: 'var(--accent)', flexShrink: 0 }} />
                  <span style={{
                    fontSize: 11,
                    color: 'var(--text-secondary)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}>
                    {att.name}
                  </span>
                </>
              )}
              <button
                onClick={() => removeAttachment(i)}
                style={{
                  position: att.preview ? 'absolute' : 'relative',
                  top: att.preview ? 2 : undefined,
                  right: att.preview ? 2 : undefined,
                  background: 'rgba(0,0,0,0.6)',
                  border: 'none',
                  borderRadius: '50%',
                  width: 18, height: 18,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                  color: '#fff',
                  padding: 0,
                  flexShrink: 0,
                }}
              >
                <X size={10} />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Input row */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
        {/* Attachment button */}
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={disabled}
          title="Attach files"
          style={{
            border: 'none',
            background: 'none',
            color: 'var(--text-muted)',
            cursor: disabled ? 'default' : 'pointer',
            padding: '8px 4px',
            display: 'flex',
            alignItems: 'center',
            transition: 'color 0.15s',
            flexShrink: 0,
          }}
          onMouseEnter={e => (e.currentTarget.style.color = 'var(--accent)')}
          onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-muted)')}
        >
          <Paperclip size={18} />
        </button>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept="image/*,.pdf,.txt,.md,.py,.js,.ts,.json,.csv,.xml,.yaml,.yml,.log,.sh,.bat,.html,.css"
          onChange={handleFileSelect}
          style={{ display: 'none' }}
        />

        {/* Textarea */}
        <textarea
          ref={textareaRef as React.RefObject<HTMLTextAreaElement>}
          value={value}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          disabled={disabled}
          rows={1}
          style={{
            flex: 1,
            padding: '10px 14px',
            borderRadius: 12,
            border: '1px solid var(--border)',
            background: 'var(--bg-elevated)',
            color: 'var(--text-primary)',
            fontSize: 14,
            outline: 'none',
            resize: 'none',
            lineHeight: 1.5,
            maxHeight: 200,
            fontFamily: 'inherit',
          }}
        />

        {/* Send / Stop button */}
        {isActive && onStop ? (
          <button
            onClick={onStop}
            title="Stop"
            style={{
              padding: '10px 14px', borderRadius: 12, border: 'none',
              background: '#ef4444', color: '#fff',
              cursor: 'pointer', display: 'flex', alignItems: 'center',
              transition: 'all 0.15s', flexShrink: 0,
            }}
          >
            <Square size={16} fill="#fff" />
          </button>
        ) : (
          <button
            onClick={handleSend}
            disabled={!hasContent || disabled}
            style={{
              padding: '10px 14px', borderRadius: 12, border: 'none',
              background: hasContent ? 'var(--accent)' : 'var(--bg-elevated)',
              color: hasContent ? '#fff' : 'var(--text-muted)',
              cursor: hasContent ? 'pointer' : 'default',
              display: 'flex', alignItems: 'center',
              transition: 'all 0.15s', flexShrink: 0,
            }}
          >
            <Send size={16} />
          </button>
        )}
      </div>

      {/* Hint text */}
      <div style={{
        fontSize: 10,
        color: 'var(--text-muted)',
        padding: '4px 36px 0',
        opacity: 0.6,
      }}>
        Enter to send · Shift+Enter for new line
      </div>
    </div>
  )
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result as string
      // Strip data:...;base64, prefix
      const base64 = result.split(',')[1] || result
      resolve(base64)
    }
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}
