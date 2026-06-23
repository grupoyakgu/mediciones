'use client'

import { useState, useEffect, useCallback } from 'react'
import { useParams } from 'next/navigation'

interface InvoiceItem {
  id: string
  description: string
  unit: string | null
  quantity: number | null
  unit_price: number | null
  total_amount: number | null
  match_status: string
  match_notes: string | null
}

interface Invoice {
  id: string
  invoice_number: string | null
  supplier: string | null
  invoice_date: string | null
  total_amount: number | null
  file_name: string | null
  created_at: string
  invoice_items: InvoiceItem[]
}

export default function InvoicesPage() {
  const { projectId } = useParams<{ projectId: string }>()
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [file, setFile] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadMsg, setUploadMsg] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    const res = await fetch(`/api/projects/${projectId}/invoices`)
    const data = await res.json()
    setInvoices(data.invoices ?? [])
    setLoading(false)
  }, [projectId])

  useEffect(() => { load() }, [load])

  async function uploadInvoice() {
    if (!file) return
    setUploading(true)
    setUploadMsg('')
    const fd = new FormData()
    fd.append('file', file)
    fd.append('projectId', projectId)
    const res = await fetch('/api/invoices/upload', { method: 'POST', body: fd })
    const data = await res.json()
    setUploading(false)
    if (data.error) { setUploadMsg(`❌ ${data.error}`); return }
    setUploadMsg(`✅ Processed ${data.itemCount} items (${data.alertCount} alerts)`)
    setFile(null)
    load()
  }

  const statusColor = (s: string) => ({
    ok: 'text-green-600 bg-green-50',
    not_in_boq: 'text-red-600 bg-red-50',
    warning_quantity: 'text-orange-600 bg-orange-50',
    warning_price: 'text-orange-600 bg-orange-50',
  }[s] ?? 'text-gray-600 bg-gray-50')

  if (loading) return <div className="text-center py-20 text-gray-500">Loading…</div>

  return (
    <div className="space-y-6">
      {/* Upload */}
      <div className="bg-white border border-gray-200 rounded-xl p-5">
        <h2 className="text-sm font-semibold text-gray-700 mb-3">Upload Invoice</h2>
        <div className="flex items-center gap-3">
          <input
            type="file"
            accept=".pdf,.csv,.xlsx,.xls"
            onChange={e => setFile(e.target.files?.[0] ?? null)}
            className="text-sm text-gray-600 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:bg-blue-50 file:text-blue-700 file:text-sm file:font-medium hover:file:bg-blue-100"
          />
          <button
            onClick={uploadInvoice}
            disabled={!file || uploading}
            className="bg-blue-600 text-white px-4 py-1.5 rounded-lg text-sm disabled:opacity-50 hover:bg-blue-700"
          >
            {uploading ? 'Processing…' : 'Upload'}
          </button>
        </div>
        {uploadMsg && <p className="mt-2 text-sm">{uploadMsg}</p>}
      </div>

      {/* Invoice list */}
      {invoices.length === 0 ? (
        <p className="text-center text-gray-400 py-10">No invoices yet.</p>
      ) : (
        <div className="space-y-3">
          {invoices.map(inv => (
            <div key={inv.id} className="bg-white border border-gray-200 rounded-xl overflow-hidden">
              <button
                onClick={() => setExpanded(expanded === inv.id ? null : inv.id)}
                className="w-full px-5 py-4 flex items-center justify-between hover:bg-gray-50 text-left"
              >
                <div>
                  <span className="font-medium text-gray-900">
                    {inv.invoice_number ? `#${inv.invoice_number}` : inv.file_name ?? 'Invoice'}
                  </span>
                  {inv.supplier && <span className="ml-2 text-sm text-gray-500">— {inv.supplier}</span>}
                  {inv.invoice_date && <span className="ml-2 text-xs text-gray-400">{inv.invoice_date}</span>}
                </div>
                <div className="flex items-center gap-3">
                  {inv.total_amount != null && (
                    <span className="font-semibold text-gray-800">
                      {new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(inv.total_amount)}
                    </span>
                  )}
                  <span className="text-gray-400">{expanded === inv.id ? '▲' : '▼'}</span>
                </div>
              </button>
              {expanded === inv.id && (
                <div className="border-t border-gray-100 overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-gray-50">
                      <tr>
                        {['Description', 'Unit', 'Qty', 'Unit Price', 'Total', 'Status', 'Notes'].map(h => (
                          <th key={h} className="px-3 py-2 text-left font-medium text-gray-500">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {inv.invoice_items.map(item => (
                        <tr key={item.id} className="border-t border-gray-100">
                          <td className="px-3 py-2 text-gray-800">{item.description}</td>
                          <td className="px-3 py-2 text-gray-500">{item.unit ?? '—'}</td>
                          <td className="px-3 py-2 text-gray-500">{item.quantity ?? '—'}</td>
                          <td className="px-3 py-2 text-gray-500">{item.unit_price ?? '—'}</td>
                          <td className="px-3 py-2 text-gray-700 font-medium">{item.total_amount ?? '—'}</td>
                          <td className="px-3 py-2">
                            <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${statusColor(item.match_status)}`}>
                              {item.match_status.replace(/_/g, ' ')}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-gray-400">{item.match_notes ?? ''}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
