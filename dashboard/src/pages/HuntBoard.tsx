import { type Agent } from '../store'
import { PC, BOARD_COLUMNS, type HuntTask, type Sprint, type Epic, type SelItem } from './HuntTypes'
import { IssueId } from './HuntComponents'
import { DetailPanel } from './HuntSidebar'

export function HuntBoard({ tasks, flashedTasks, slug, selectedItem, onSelectItem, sprints, epics, agents, huntProjectId, onSaved, onDeleted }: {
  tasks: HuntTask[]
  flashedTasks: Set<string>
  slug: string | null
  selectedItem: SelItem | null
  onSelectItem: (item: SelItem | null) => void
  sprints: Sprint[]
  epics: Epic[]
  agents: Agent[]
  huntProjectId: string
  onSaved: () => void
  onDeleted: () => void
}) {
  return (
    <div style={{ flex: 1, display: 'flex', gap: 0, overflow: 'hidden' }}>
      {BOARD_COLUMNS.map((col, i) => {
        const colTasks = tasks.filter(t => t.status === col.status)
        return (
          <div key={col.status} style={{
            flex: 1, display: 'flex', flexDirection: 'column',
            borderRight: i < BOARD_COLUMNS.length - 1 ? '1px solid var(--border)' : 'none',
            overflow: 'hidden',
          }}>
            <div style={{ padding: '12px 14px 10px', borderBottom: `2px solid ${col.color}`, flexShrink: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 11, fontWeight: 800, color: col.color, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{col.label}</span>
                <span style={{ fontSize: 11, fontWeight: 700, padding: '1px 7px', borderRadius: 10, background: `${col.color}22`, color: col.color }}>{colTasks.length}</span>
              </div>
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: '8px 10px' }}>
              {colTasks.map(t => (
                <div key={t.id} style={{
                  background: flashedTasks.has(t.id) ? `${col.color}18` : 'var(--bg-surface)',
                  border: `1px solid ${flashedTasks.has(t.id) ? col.color : 'var(--border)'}`,
                  borderRadius: 7, padding: '10px 12px', marginBottom: 6,
                  borderLeft: `3px solid ${PC[t.priority] || '#888'}`,
                  cursor: 'pointer',
                  transition: 'background 0.4s ease, border-color 0.4s ease, transform 0.15s ease',
                }}
                  onClick={() => onSelectItem(
                    selectedItem?.type === 'task' && selectedItem.data.id === t.id ? null : { type: 'task', data: t }
                  )}
                  onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-1px)' }}
                  onMouseLeave={e => { e.currentTarget.style.transform = 'translateY(0)' }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                    <IssueId slug={slug} num={t.issue_number} />
                    <span style={{ fontWeight: 600, fontSize: 13 }}>{t.title}</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 11, color: 'var(--text-muted)' }}>
                    <span>{t.assignee_name || 'Unassigned'}</span>
                    <span style={{ fontWeight: 700, color: PC[t.priority] || '#888' }}>{t.priority}</span>
                  </div>
                </div>
              ))}
              {colTasks.length === 0 && (
                <div style={{ fontSize: 12, color: 'var(--text-muted)', textAlign: 'center', padding: '16px 0', fontStyle: 'italic' }}>—</div>
              )}
            </div>
          </div>
        )
      })}

      {/* Task / sprint / epic / story detail overlay */}
      {selectedItem && (selectedItem.type === 'task' || selectedItem.type === 'new-sprint' || selectedItem.type === 'sprint' || selectedItem.type === 'epic' || selectedItem.type === 'story') && (
        <div className="hunt-detail-wrapper" style={{ position: 'fixed', right: 0, top: 0, bottom: 0, zIndex: 300, background: 'var(--bg-surface)' }}>
          <DetailPanel
            item={selectedItem} slug={slug}
            agents={agents} sprints={sprints} epics={epics}
            huntProjectId={huntProjectId}
            onClose={() => onSelectItem(null)}
            onSaved={onSaved}
            onDeleted={onDeleted}
          />
        </div>
      )}
    </div>
  )
}
