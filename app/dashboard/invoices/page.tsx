'use client'
import { useState, useEffect, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'

interface Invoice {
  id: string
  invoice_number: string | null
  invoice_date: string | null
  file_name: string
  status: string
  total_amount: number | null
  alerts_count: number | null
  created_at: string
}

interface InvoiceItem {
  id: string
  description: string
  chapter_ref: string | null
  quantity: number | null
  unit_price: number | null
  total_amount: number | null
  match_status: string
  boq_quantity: number | null
  boq_unit_price: number | null
  quantity_delta: number | null
  price_delta_pct: number | null
}

const STATUS_COLORS: Record<string, string> = {
  ok: '#15803d',
  alerts: '#d97706',
  pending: '#6366f1',
}
const STATUS_BG: Record<string, string> = {
  ok: '#f0fdf4',
  alerts: '#fffbeb',
  pending: '#eef2ff',
}
const STATUS_BORDER: Record<string, string> = {
  ok: '#bbf7d0',
  alerts: '#fde68a',
  pending: '#c7d2fe',
}
const MATCH_LABEL: Record<string, string> = {
  ok: '✅ OK',
  warning_quantity: '⚠️ Qty',
  warning_price: '⚠️ Price',
  not_in_boq: '❓ Not in BOQ',
}
const MATCH_COLOR: Record<string, string> = {
  ok: '#15803d',
  warning_quantity: '#d97706',
  warning_price: '#dc2626',
  not_in_boq: '#6b7280',
}

function fmt(n: number | null, decimals = 2) {
  if (n == null) return '—'
  return n.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
}

export default function InvoicesPage() {
  const supabase = createClient()
  const fileRef = useRef<HTMLInputElement>(null)

  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [selected, setSelected] = useState<Invoice | null>(null)
  const [items, setItems] = useState<InvoiceItem[]>([])
  const [uploading, setUploading] = useState(false)
  const [message, setMessage] = useState<{ type: 'ok' | 'err'; text: string } | null>(null)
  const [loadingItems, setLoadingItems] = useState(false)

  useEffect(() => { loadInvoices() }, [])

  async function loadInvoices() {
    const { data } = await supabase
      .from('invoices')
      .select('*')
      .order('created_at', { ascending: false })
    setInvoices(data ?? [])
  }

  async function selectInvoice(inv: Invoice) {
    setSelected(inv)
    setLoadingItems(true)
    const { data } = await supabase
      .from('invoice_items')
      .select('*')
      .eq('invoice_id', inv.id)
      .order('id')
    setItems(data ?? [])
    setLoadingItems(false)
  }

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    setMessage(null)
    const formData = new FormData()
    formData.append('file', file)
    try {
      const res = await fetch('/api/invoices/upload', { method: 'POST', body: formData })
      const data = await res.json()
      if (data.ok) {
        setMessage({ type: 'ok', text: `Invoice uploaded: ${data.line_count} lines extracted, ${data.alerts_count} alert(s).` })
        await loadInvoices()
      } else {
        setMessage({ type: 'err', text: data.error ?? 'Upload failed' })
      }
    } catch (e) {
      setMessage({ type: 'err', text: `Upload failed: ${String(e)}` })
    }
    setUploading(false)
    if (fileRef.current) fileRef.current.value = ''
  }

  async function deleteInvoice(id: string) {
    await supabase.from('invoices').delete().eq('id', id)
    if (selected?.id === id) { setSelected(null); setItems([]) }
    await loadInvoices()
  }

  const card: React.CSSProperties = { background: 'white', borderRadius: '12px', border: '1px solid #e2e8f0', padding: '1.5rem', marginBottom: '1.5rem' }
  const btnStyle = (color = '#2563eb', disabled = false): React.CSSProperties => ({
    padding: '.5rem 1rem', background: disabled ? '#94a3b8' : color, color: 'white',
    border: 'none', borderRadius: '6px', fontSize: '.875rem', fontWeight: 500,
    cursor: disabled ? 'not-allowed' : 'pointer'
  })

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.5rem' }}>
        <h1 style={{ margin: 0, fontSize: '1.5rem', fontWeight: 700, color: '#0f172a' }}>Invoices</h1>
        <div>
          <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv,.pdf" style={{ display: 'none' }} onChange={handleUpload} />
          <button style={btnStyle('#2563eb', uploading)} disabled={uploading} onClick={() => fileRef.current?.click()}>
            {uploading ? '⏳ Processing…' : '+ Upload Invoice'}
          </button>
        </div>
      </div>

      {message && (
        <div style={{
          padding: '.875rem 1rem', borderRadius: '8px', marginBottom: '1.5rem', fontSize: '.875rem',
          background: message.type === 'ok' ? '#f0fdf4' : '#fef2f2',
          border: `1px solid ${message.type === 'ok' ? '#bbf7d0' : '#fecaca'}`,
          color: message.type === 'ok' ? '#15803d' : '#dc2626',
          whiteSpace: 'pre-wrap', wordBreak: 'break-word'
        }}>
          {message.type === 'ok' ? '✅ ' : '❌ '}{message.text}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: selected ? '1fr 2fr' : '1fr', gap: '1.5rem', alignItems: 'start' }}>
        {/* Invoice list */}
        <div style={card}>
          <div style={{ fontSize: '.8rem', fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: '1rem' }}>Uploaded Invoices</div>
          {invoices.length === 0 ? (
            <p style={{ color: '#94a3b8', fontSize: '.875rem', margin: 0 }}>No invoices yet. Upload your first invoice above.</p>
          ) : (
            invoices.map(inv => (
              <div
                key={inv.id}
                onClick={() => selectInvoice(inv)}
                style={{
                  padding: '.875rem', borderRadius: '8px', marginBottom: '.5rem', cursor: 'pointer',
                  border: `1px solid ${selected?.id === inv.id ? '#93c5fd' : '#e2e8f0'}`,
                  background: selected?.id === inv.id ? '#eff6ff' : 'white',
                  transition: 'all 0.15s',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div>
                    <div style={{ fontWeight: 600, color: '#0f172a', fontSize: '.875rem' }}>
                      {inv.invoice_number ?? inv.file_name}
                    </div>
                    <div style={{ fontSize: '.78rem', color: '#64748b', marginTop: '.2rem' }}>
                      {inv.invoice_date ?? new Date(inv.created_at).toLocaleDateString()} · €{fmt(inv.total_amount)}
                    </div>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '.3rem' }}>
                    <span style={{
                      fontSize: '.72rem', fontWeight: 600, padding: '.2rem .5rem', borderRadius: '999px',
                      background: STATUS_BG[inv.status] ?? '#f1f5f9',
                      border: `1px solid ${STATUS_BORDER[inv.status] ?? '#e2e8f0'}`,
                      color: STATUS_COLORS[inv.status] ?? '#64748b',
                    }}>
                      {inv.status === 'ok' ? '✅ OK' : inv.status === 'alerts' ? `⚠️ ${inv.alerts_count} alert(s)` : '⏳ Pending'}
                    </span>
                    <button
                      onClick={e => { e.stopPropagation(); deleteInvoice(inv.id) }}
                      style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: '.75rem', padding: 0 }}
                    >🗑 delete</button>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Line items detail */}
        {selected && (
          <div style={card}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <div>
                <div style={{ fontSize: '.8rem', fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: '.05em' }}>Line Items</div>
                <div style={{ fontSize: '.9rem', fontWeight: 600, color: '#0f172a', marginTop: '.2rem' }}>
                  {selected.invoice_number ?? selected.file_name}
                </div>
              </div>
              <button onClick={() => { setSelected(null); setItems([]) }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8', fontSize: '1.2rem' }}>✕</button>
            </div>

            {loadingItems ? (
              <p style={{ color: '#94a3b8', fontSize: '.875rem' }}>Loading…</p>
            ) : items.length === 0 ? (
              <p style={{ color: '#94a3b8', fontSize: '.875rem' }}>No line items found.</p>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '.8rem' }}>
                  <thead>
                    <tr style={{ background: '#f8fafc' }}>
                      {['Description', 'Qty', 'Unit Price', 'Total', 'BOQ Qty', 'BOQ Price', 'Δ Qty', 'Δ Price%', 'Status'].map(h => (
                        <th key={h} style={{ padding: '.5rem .75rem', textAlign: 'left', fontWeight: 600, color: '#64748b', borderBottom: '1px solid #e2e8f0', whiteSpace: 'nowrap' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {items.map(item => (
                      <tr key={item.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                        <td style={{ padding: '.5rem .75rem', color: '#0f172a', maxWidth: '220px' }}>{item.description}</td>
                        <td style={{ padding: '.5rem .75rem', color: '#475569', textAlign: 'right', whiteSpace: 'nowrap' }}>{fmt(item.quantity, 3)}</td>
                        <td style={{ padding: '.5rem .75rem', color: '#475569', textAlign: 'right', whiteSpace: 'nowrap' }}>{fmt(item.unit_price)}</td>
                        <td style={{ padding: '.5rem .75rem', color: '#475569', textAlign: 'right', whiteSpace: 'nowrap' }}>{fmt(item.total_amount)}</td>
                        <td style={{ padding: '.5rem .75rem', color: '#94a3b8', textAlign: 'right', whiteSpace: 'nowrap' }}>{fmt(item.boq_quantity, 3)}</td>
                        <td style={{ padding: '.5rem .75rem', color: '#94a3b8', textAlign: 'right', whiteSpace: 'nowrap' }}>{fmt(item.boq_unit_price)}</td>
                        <td style={{ padding: '.5rem .75rem', textAlign: 'right', whiteSpace: 'nowrap', color: (item.quantity_delta ?? 0) > 0 ? '#dc2626' : '#15803d' }}>
                          {item.quantity_delta != null ? (item.quantity_delta > 0 ? '+' : '') + fmt(item.quantity_delta, 3) : '—'}
                        </td>
                        <td style={{ padding: '.5rem .75rem', textAlign: 'right', whiteSpace: 'nowrap', color: (item.price_delta_pct ?? 0) > 0 ? '#dc2626' : '#15803d' }}>
                          {item.price_delta_pct != null ? (item.price_delta_pct > 0 ? '+' : '') + fmt(item.price_delta_pct) + '%' : '—'}
                        </td>
                        <td style={{ padding: '.5rem .75rem', whiteSpace: 'nowrap', fontWeight: 600, color: MATCH_COLOR[item.match_status] ?? '#64748b' }}>
                          {MATCH_LABEL[item.match_status] ?? item.match_status}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
