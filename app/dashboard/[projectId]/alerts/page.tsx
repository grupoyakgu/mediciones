'use client'

import { useState, useEffect, useCallback } from 'react'
import { useParams } from 'next/navigation'

interface Alert {
  id: string
  type: string
  description: string
  status: 'unread' | 'read'
  created_at: string
  invoice_id: string | null
  invoices: { invoice_number: string | null; supplier: string | null } | null
}

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

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Alerts</h1>
          <p className="text-sm text-gray-500 mt-0.5">{unreadCount} unread · {alerts.length} total</p>
        </div>
        {unreadCount > 0 && (
          <button
            onClick={acknowledgeAll}
            className="text-sm text-blue-600 hover:text-blue-800 font-medium"
          >
            Acknowledge all
          </button>
        )}
      </div>

      {unread.length > 0 && (
        <div>
          <h2 className="text-xs font-semibold text-orange-600 uppercase tracking-wider mb-3">
            Unread ({unread.length})
          </h2>
          <div className="space-y-2">
            {unread.map(alert => (
              <div key={alert.id} className="bg-white border-l-4 border-orange-400 border border-orange-100 rounded-lg px-4 py-3 flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="w-2 h-2 rounded-full bg-orange-400 flex-shrink-0" />
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
                  onClick={() => acknowledge(alert.id)}
                  disabled={acknowledging === alert.id}
                  className="shrink-0 text-xs font-medium px-3 py-1.5 rounded-lg bg-orange-50 text-orange-700 hover:bg-orange-100 disabled:opacity-50 transition-colors"
                >
                  {acknowledging === alert.id ? '…' : 'Acknowledge'}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {read.length > 0 && (
        <div>
          <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
            Read ({read.length})
          </h2>
          <div className="space-y-2">
            {read.map(alert => (
              <div key={alert.id} className="bg-gray-50 border border-gray-200 rounded-lg px-4 py-3 flex items-start justify-between gap-4 opacity-60">
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-gray-600">{alert.description}</p>
                  {alert.invoices && (
                    <p className="text-xs text-gray-400 mt-0.5">
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
