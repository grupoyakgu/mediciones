'use client'

import { useState, useEffect } from 'react'
import { useParams } from 'next/navigation'

interface Alert {
  id: string
  item_code: string | null
  description: string | null
  type: string
  priority: string
  created_at: string
}

export default function PricingAlertsPage() {
  const params = useParams()
  const pricingId = params.pricingId as string

  const [alerts, setAlerts] = useState<Alert[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch(`/api/pricing-projects/${pricingId}/alerts`)
      .then(r => r.json())
      .then(d => setAlerts(d.alerts ?? []))
      .finally(() => setLoading(false))
  }, [pricingId])

  return (
    <div className="max-w-3xl mx-auto py-10 px-4">
      <h2 className="text-lg font-semibold text-gray-900 mb-6">Alerts</h2>

      {loading ? (
        <div className="flex items-center justify-center h-32">
          <div className="w-7 h-7 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : alerts.length === 0 ? (
        <div className="text-center py-16 bg-white rounded-xl border border-gray-200">
          <p className="text-gray-500 text-sm">No alerts for this pricing project.</p>
          <p className="text-gray-400 text-xs mt-1">Alerts appear when excluded items are found during a pricing run.</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="grid grid-cols-[1fr_2fr_auto] bg-gray-50 px-5 py-2.5 text-xs font-medium text-gray-500 border-b border-gray-200">
            <span>Item Code</span>
            <span>Description</span>
            <span>Date</span>
          </div>
          <div className="divide-y divide-gray-100">
            {alerts.map(alert => (
              <div key={alert.id} className="grid grid-cols-[1fr_2fr_auto] px-5 py-3 items-start gap-2">
                <span className="text-xs font-mono text-gray-700">{alert.item_code ?? '—'}</span>
                <span className="text-xs text-gray-700 break-words">{alert.description ?? '—'}</span>
                <span className="text-xs text-gray-400 whitespace-nowrap">
                  {new Date(alert.created_at).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' })}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
