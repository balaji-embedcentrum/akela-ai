import { Circle, CheckCircle2, Clock, AlertCircle, X } from 'lucide-react'
import React from 'react'

export interface Sprint {
  id: string; project_id: string; name: string; goal: string; status: string
  start_date: string | null; end_date: string | null; issue_number: number | null
}
export interface Epic {
  id: string; project_id: string; title: string; description: string
  status: string; priority: string; due_date: string | null; issue_number: number | null
}
export interface Story {
  id: string; epic_id: string; sprint_id: string | null; title: string
  description: string; status: string; priority: string; story_points: number | null
  due_date: string | null; issue_number: number | null
}
export interface HuntTask {
  id: string; epic_id: string; story_id: string | null; sprint_id: string | null
  assignee_id: string | null; assignee_name: string | null; title: string
  description: string; status: string; priority: string
  labels: string[]; estimate: string | null; due_date: string | null
  issue_number: number | null; created_at: string
}
export interface Subtask {
  id: string; task_id: string; title: string; description: string
  status: string; assignee_id: string | null; assignee_name: string | null
  issue_number: number | null
}

export type SelItem =
  | { type: 'new-sprint' }
  | { type: 'sprint'; data: Sprint }
  | { type: 'epic'; data: Epic }
  | { type: 'story'; data: Story }
  | { type: 'task'; data: HuntTask }

export const PC: Record<string, string> = { P0: 'var(--danger)', P1: '#ff9800', P2: 'var(--accent)', P3: '#888' }

export const STATUS_ICON: Record<string, React.ReactNode> = {
  todo: <Circle size={13} color="#888" />,
  in_progress: <Clock size={13} color="var(--accent)" />,
  review: <AlertCircle size={13} color="#f5a623" />,
  done: <CheckCircle2 size={13} color="var(--success)" />,
  blocked: <X size={13} color="var(--danger)" />,
}

export const STATUS_LABEL: Record<string, string> = {
  todo: 'Spotted', in_progress: 'Chasing', review: 'Circling', done: 'Caught', blocked: 'Cornered',
}

export const BOARD_COLUMNS = [
  { status: 'todo', label: 'Spotted', color: '#888' },
  { status: 'in_progress', label: 'Chasing', color: 'var(--accent)' },
  { status: 'review', label: 'Circling', color: '#f5a623' },
  { status: 'done', label: 'Caught', color: 'var(--success)' },
  { status: 'blocked', label: 'Cornered', color: 'var(--danger)' },
]

export const iStyle: React.CSSProperties = {
  padding: '7px 10px', background: 'var(--bg-elevated)', border: '1px solid var(--border)',
  borderRadius: 6, color: 'var(--text-base)', fontSize: 13, outline: 'none',
  width: '100%', boxSizing: 'border-box',
}

export const labelSt: React.CSSProperties = {
  fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', display: 'block',
  marginBottom: 4, textTransform: 'uppercase',
}
