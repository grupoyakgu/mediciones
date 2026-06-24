'use client'

import { useState, useEffect, useCallback } from 'react'
import { useParams } from 'next/navigation'

interface Alert {
  id: string
  type: string
  description: string
  status: 'unread' | 'read'
  priority: 'high' | 'low'
  created_at: string
  invoice_id: string | null
  invoices: { invoice_number: string | null; supplier: string | null } | null
}

const HIGH: Record<string, string> = {
  border: '#ef4444',
  bg: '#fff1f2',
  dot: '#ef4444',
  badge: '#fee2e2',
  badgeText: '#dc2626',
  ackBg: '#fee2e2',
  ackText: '#dc2626',
  ackHover: '#fecaca',
  label: 'High priority',
}

const LOW: Record<string, string> = {
  border: '#f59e0b',
  bg: '#fffbeb',
  dot: '#f59e0b',
  badge: '#fef3c7',
  badgeText: '#92400e',
  ackBg: '#fef3c7',
  ackText: '#92400e',
  ackHover: '#fde68a',
  label: 'Low priority',
}

function colors(priority: string) { return priority === 'high' ? HIGH : LOW }

export default function AlertsPage() {
  const { projectId } = useParams<{ projectId: string }>()
  const [alerts, setAlerts] = useState<Alert[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [acknowledging, setAcknowledging] = useState<string | null>(null)

  const load = useCallback(async () => {
    const res = await fetch(`/api/projects/${projectId}/alerts`)
    const data = await res.json()
    if (!res.ok) { setError(data.error ?? 'Failed to load alerts'); setLoading(false); return }
    setAlerts(data.alerts ?? [])
    setLoading(false)
  }, [projectId])

  useEffect(() => { load() }, [load])

  async function acknowledge(id: string) {
    setAcknowledging(id)
    await fetch(`/api/projects/${projectId}/alerts`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    })
    setAlerts(prev => prev.map(a => a.id === id ? { ...a, status: 'read' } : a))
    setAcknowledging(null)
  }

  async function acknowledgeAll() {
    const unread = alerts.filter(a => a.status === 'unread')
    for (const a of unread) {
      await fetch(`/api/projects/${projectId}/alerts`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: a.id }),
      })
    }
    setAlerts(prev => prev.map(a => ({ ...a, status: 'read' })))
  }

  const unreadCount = alerts.filter(a => a.status === 'unread').length

  if (loading) return <div className="text-center py-20 text-gray-400">Loading alerts…</div>
  if (error) return <div className="text-center py-20 text-red-500">Error: {error}</div>

  if (alerts.length === 0) {
    return (
      <div className="text-center py-20">
        <p className="text-4xl mb-3">✅</p>
        <p className="text-gray-500">No alerts — all quantities are within budget.</p>
      </div>
    )
  }

  const unread = alerts.filter(a => a.status === 'unread')
  const read = alerts.filter(a => a.status === 'read')
  const unreadHigh = unread.filter(a => a.priority === 'high')
  const unreadLow = unread.filter(a => a.priority !== 'high')

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Alerts</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {unreadCount} unread · {alerts.length} total
            {unreadHigh.length > 0 && <span className="ml-2 text-red-600 font-medium">· {unreadHigh.length} high priority</span>}
          </p>
        </div>
        {unreadCount > 0 && (
          <button onClick={acknowledgeAll} className="text-sm text-blue-600 hover:text-blue-800 font-medium">
            Acknowledge all
          </button>
        )}
      </div>

      {/* Unread — high priority */}
      {unreadHigh.length > 0 && (
        <AlertSection title="High Priority" titleColor="#dc2626" alerts={unreadHigh} acknowledging={acknowledging} onAck={acknowledge} />
      )}

      {/* Unread — low priority */}
      {unreadLow.length > 0 && (
        <AlertSection title="Low Priority" titleColor="#92400e" alerts={unreadLow} acknowledging={acknowledging} onAck={acknowledge} />
      )}

      {/* Read */}
      {read.length > 0 && (
        <div>
          <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
            Read ({read.length})
          </h2>
          <div className="space-y-2">
            {read.map(alert => (
              <div key={alert.id} className="bg-gray-50 border border-gray-200 rounded-lg px-4 py-3 flex items-start justify-between gap-4 opacity-60">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-xs font-semibold px-1.5 py-0.5 rounded" style={{ background: colors(alert.priority).badge, color: colors(alert.priority).badgeText }}>
                      {alert.priority === 'high' ? '● High' : '● Low'}
                    </span>
                    <p className="text-sm text-gray-600">{alert.description}</p>
                  </div>
                  {alert.invoices && (
                    <p className="text-xs text-gray-400 mt-0.5 ml-1">
                      Invoice {alert.invoices.invoice_number ?? '—'}
                      {alert.invoices.supplier ? ` · ${alert.invoices.supplier}` : ''}
                      · {new Date(alert.created_at).toLocaleDateString()}
                    </p>
                  )}
                </div>
                <span className="shrink-0 text-xs text-gray-400">✓ Read</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function AlertSection({ title, titleColor, alerts, acknowledging, onAck }: {
  title: string
  titleColor: string
  alerts: Alert[]
  acknowledging: string | null
  onAck: (id: string) => void
}) {
  return (
    <div>
      <h2 className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: titleColor }}>
        {title} ({alerts.length})
      </h2>
      <div className="space-y-2">
        {alerts.map(alert => {
          const c = colors(alert.priority)
          return (
            <div
              key={alert.id}
              className="bg-white rounded-lg px-4 py-3 flex items-start justify-between gap-4 border"
              style={{ borderLeftWidth: 4, borderLeftColor: c.border, borderColor: c.border + '40', background: c.bg }}
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: c.dot }} />
                  <p className="text-sm font-medium text-gray-900">{alert.description}</p>
                </div>
                {alert.invoices && (
                  <p className="text-xs text-gray-400 ml-4">
                    Invoice {alert.invoices.invoice_number ?? '—'}
                    {alert.invoices.supplier ? ` · ${alert.invoices.supplier}` : ''}
                    · {new Date(alert.created_at).toLocaleDateString()}
                  </p>
                )}
              </div>
              <button
                onClick={() => onAck(alert.id)}
                disabled={acknowledging === alert.id}
                className="shrink-0 text-xs font-medium px-3 py-1.5 rounded-lg disabled:opacity-50 transition-colors"
                style={{ background: c.ackBg, color: c.ackText }}
                onMouseEnter={e => (e.currentTarget.style.background = c.ackHover)}
                onMouseLeave={e => (e.currentTarget.style.background = c.ackBg)}
              >
                {acknowledging === alert.id ? '…' : 'Acknowledge'}
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}
