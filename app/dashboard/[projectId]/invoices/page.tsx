'use client'
import { useState, useEffect, useMemo, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useParams } from 'next/navigation'

interface Invoice {
  id: string
  invoice_number: string | null
  supplier: string | null
  invoice_date: string | null
  total_amount: number | null
  currency: string | null
  file_name: string | null
  status: string
  created_at: string
}

interface InvoiceItem {
  id: string
  invoice_id: string
  boq_item_id: string | null
  description: string
  unit: string | null
  quantity: number | null
  unit_price: number | null
  total_amount: number | null
  match_status: string
  match_notes: string | null
  boq_qty?: number | null
  boq_unit_price?: number | null
  accumulated_qty?: number
}

type SortField = 'date' | 'amount' | 'number'
type SortDir = 'asc' | 'desc'

const fmt = (n: number | null, currency = 'EUR') =>
  n == null ? '—' : new Intl.NumberFormat('es-ES', { style: 'currency', currency }).format(n)

export default function InvoicesPage() {
  const params = useParams()
  const projectId = params.projectId as string
  const supabase = createClient()
  const fileRef = useRef<HTMLInputElement>(null)

  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null)

  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | 'approved' | 'pending'>('all')
  const [sortField, setSortField] = useState<SortField>('date')
  const [sortDir, setSortDir] = useState<SortDir>('desc')

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detailItems, setDetailItems] = useState<InvoiceItem[]>([])
  const [detailLoading, setDetailLoading] = useState(false)

  useEffect(() => { loadInvoices() }, []) // eslint-disable-line

  async function loadInvoices() {
    const { data } = await supabase
      .from('invoices')
      .select('*')
      .eq('project_id', projectId)
      .order('invoice_date', { ascending: false })
    setInvoices(data ?? [])
    setLoading(false)
  }

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    setMsg(null)
    const fd = new FormData()
    fd.append('file', file)
    fd.append('projectId', projectId)
    const res = await fetch('/api/invoices/upload', { method: 'POST', body: fd })
    const data = await res.json()
    if (res.ok) {
      setMsg({ type: 'ok', text: `✅ Invoice processed: ${data.itemCount} items, ${data.alertCount} alerts` })
      await loadInvoices()
    } else {
      setMsg({ type: 'err', text: data.error ?? 'Upload failed' })
    }
    setUploading(false)
    if (fileRef.current) fileRef.current.value = ''
  }

  async function toggleApproval(inv: Invoice, e: React.MouseEvent) {
    e.stopPropagation()
    const newStatus = inv.status === 'approved' ? 'processed' : 'approved'
    await supabase.from('invoices').update({ status: newStatus }).eq('id', inv.id)
    setInvoices(prev => prev.map(i => i.id === inv.id ? { ...i, status: newStatus } : i))
    // refresh detail if this invoice is selected
    if (selectedId === inv.id) {
      await loadDetail(inv.id, newStatus)
    }
  }

  async function deleteInvoice(id: string, e: React.MouseEvent) {
    e.stopPropagation()
    if (!confirm('Delete this invoice and all its line items?')) return
    await supabase.from('invoice_items').delete().eq('invoice_id', id)
    await supabase.from('invoices').delete().eq('id', id)
    setInvoices(prev => prev.filter(i => i.id !== id))
    if (selectedId === id) { setSelectedId(null); setDetailItems([]) }
  }

  async function loadDetail(invoiceId: string, invoiceStatus: string) {
    setDetailLoading(true)
    const { data: items } = await supabase
      .from('invoice_items')
      .select('*')
      .eq('invoice_id', invoiceId)

    if (!items?.length) { setDetailItems([]); setDetailLoading(false); return }

    const boqIds = [...new Set(items.filter(i => i.boq_item_id).map(i => i.boq_item_id as string))]

    const boqMap = new Map<string, { quantity: number | null; unit_price: number | null }>()
    if (boqIds.length) {
      const { data: boqData } = await supabase
        .from('boq_items')
        .select('id,quantity,unit_price')
        .in('id', boqIds)
      for (const b of boqData ?? []) boqMap.set(b.id, b)
    }

    const accMap = new Map<string, number>()
    if (boqIds.length) {
      const { data: approvedInvs } = await supabase
        .from('invoices')
        .select('id')
        .eq('project_id', projectId)
        .eq('status', 'approved')
      const approvedIds = (approvedInvs ?? []).map(i => i.id)
      // Include current invoice qty in accumulation if it is not yet approved
      const idsToCheck = invoiceStatus !== 'approved'
        ? [...approvedIds, invoiceId]
        : approvedIds
      if (idsToCheck.length) {
        const { data: accData } = await supabase
          .from('invoice_items')
          .select('boq_item_id,quantity')
          .in('invoice_id', idsToCheck)
          .in('boq_item_id', boqIds)
        for (const row of accData ?? []) {
          if (row.boq_item_id)
            accMap.set(row.boq_item_id, (accMap.get(row.boq_item_id) ?? 0) + (row.quantity ?? 0))
        }
      }
    }

    setDetailItems(items.map(item => ({
      ...item,
      boq_qty: item.boq_item_id ? (boqMap.get(item.boq_item_id)?.quantity ?? null) : null,
      boq_unit_price: item.boq_item_id ? (boqMap.get(item.boq_item_id)?.unit_price ?? null) : null,
      accumulated_qty: item.boq_item_id ? (accMap.get(item.boq_item_id) ?? 0) : 0,
    })))
    setDetailLoading(false)
  }

  async function selectInvoice(inv: Invoice) {
    if (selectedId === inv.id) { setSelectedId(null); setDetailItems([]); return }
    setSelectedId(inv.id)
    await loadDetail(inv.id, inv.status)
  }

  function itemAlert(item: InvoiceItem): 'red' | 'yellow' | null {
    if (item.match_status === 'not_in_boq') return 'red'
    const priceHigh = item.boq_unit_price != null && item.unit_price != null && item.unit_price > item.boq_unit_price
    const qtyOver = item.boq_qty != null && item.accumulated_qty != null && item.accumulated_qty > item.boq_qty
    if (priceHigh || qtyOver) return 'yellow'
    return null
  }

  const displayed = useMemo(() => {
    let rows = invoices
    if (search.trim()) {
      const q = search.toLowerCase()
      rows = rows.filter(i =>
        (i.invoice_number ?? '').toLowerCase().includes(q) ||
        (i.supplier ?? '').toLowerCase().includes(q)
      )
    }
    if (statusFilter === 'approved') rows = rows.filter(i => i.status === 'approved')
    if (statusFilter === 'pending') rows = rows.filter(i => i.status !== 'approved')
    return rows.slice().sort((a, b) => {
      let cmp = 0
      if (sortField === 'date') cmp = (a.invoice_date ?? a.created_at).localeCompare(b.invoice_date ?? b.created_at)
      else if (sortField === 'amount') cmp = (a.total_amount ?? 0) - (b.total_amount ?? 0)
      else cmp = (a.invoice_number ?? '').localeCompare(b.invoice_number ?? '')
      return sortDir === 'asc' ? cmp : -cmp
    })
  }, [invoices, search, statusFilter, sortField, sortDir])

  function toggleSort(f: SortField) {
    if (sortField === f) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortField(f); setSortDir('desc') }
  }
  const arrow = (f: SortField) => sortField === f ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ''

  const card: React.CSSProperties = { background: 'white', borderRadius: '12px', border: '1px solid #e2e8f0', padding: '1.5rem', marginBottom: '1.5rem' }
  const inp: React.CSSProperties = { padding: '.45rem .75rem', border: '1px solid #e2e8f0', borderRadius: '6px', fontSize: '.85rem', outline: 'none', background: 'white' }
  const th = (clickable = false): React.CSSProperties => ({ padding: '.625rem 1rem', textAlign: 'left', fontSize: '.75rem', fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: '.05em', background: '#f8fafc', borderBottom: '1px solid #e2e8f0', whiteSpace: 'nowrap', cursor: clickable ? 'pointer' : 'default', userSelect: 'none' })
  const td = (right = false, muted = false): React.CSSProperties => ({ padding: '.55rem 1rem', fontSize: '.85rem', borderBottom: '1px solid #f1f5f9', textAlign: right ? 'right' : 'left', color: muted ? '#94a3b8' : '#1e293b', whiteSpace: right ? 'nowrap' : 'normal' })

  const approvedTotal = invoices.filter(i => i.status === 'approved').reduce((s, i) => s + (i.total_amount ?? 0), 0)

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.5rem' }}>
        <div>
          <h1 style={{ margin: '0 0 .25rem', fontSize: '1.5rem', fontWeight: 700, color: '#0f172a' }}>Invoices</h1>
          <p style={{ margin: 0, fontSize: '.875rem', color: '#64748b' }}>
            {invoices.length} invoice{invoices.length !== 1 ? 's' : ''} · Approved total: <strong>{fmt(approvedTotal)}</strong>
          </p>
        </div>
        <div>
          <input ref={fileRef} type="file" accept=".pdf,.xlsx,.xls,.csv" style={{ display: 'none' }} onChange={handleUpload} />
          <button
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            style={{ padding: '.5rem 1.25rem', background: uploading ? '#94a3b8' : '#0f172a', color: 'white', border: 'none', borderRadius: '8px', fontSize: '.875rem', fontWeight: 500, cursor: uploading ? 'not-allowed' : 'pointer' }}
          >
            {uploading ? '⏳ Processing…' : '+ Upload Invoice'}
          </button>
        </div>
      </div>

      {msg && (
        <div style={{ padding: '.875rem 1rem', borderRadius: '8px', marginBottom: '1.25rem', fontSize: '.875rem', background: msg.type === 'ok' ? '#f0fdf4' : '#fef2f2', border: `1px solid ${msg.type === 'ok' ? '#bbf7d0' : '#fecaca'}`, color: msg.type === 'ok' ? '#15803d' : '#dc2626' }}>
          {msg.text}
        </div>
      )}

      {/* Legend */}
      <div style={{ display: 'flex', gap: '1.25rem', marginBottom: '1rem', fontSize: '.8rem' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: '.4rem' }}><span style={{ width: 12, height: 12, borderRadius: 2, background: '#fca5a5', display: 'inline-block' }} /> Not found in BOQ</span>
        <span style={{ display: 'flex', alignItems: 'center', gap: '.4rem' }}><span style={{ width: 12, height: 12, borderRadius: 2, background: '#fde68a', display: 'inline-block' }} /> Price above BOQ or quantity overrun</span>
      </div>

      {/* Filters */}
      <div style={{ ...card, padding: '1rem 1.5rem' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.75rem', alignItems: 'center' }}>
          <input style={{ ...inp, minWidth: '200px', flex: 1 }} placeholder="🔍 Search by number or supplier…" value={search} onChange={e => setSearch(e.target.value)} />
          <select style={inp} value={statusFilter} onChange={e => setStatusFilter(e.target.value as 'all'|'approved'|'pending')}>
            <option value="all">All statuses</option>
            <option value="approved">Approved only</option>
            <option value="pending">Pending only</option>
          </select>
        </div>
      </div>

      {/* Invoice list */}
      <div style={card}>
        {loading ? (
          <div style={{ textAlign: 'center', padding: '2rem', color: '#94a3b8' }}>Loading invoices…</div>
        ) : displayed.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '3rem 2rem', color: '#94a3b8' }}>
            <div style={{ fontSize: '2rem', marginBottom: '.75rem' }}>🧾</div>
            <p style={{ margin: 0 }}>No invoices yet. Click <strong>+ Upload Invoice</strong> to add one.</p>
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr>
                <th style={th(true)} onClick={() => toggleSort('number')}>Invoice #{arrow('number')}</th>
                <th style={th()}>Supplier</th>
                <th style={th(true)} onClick={() => toggleSort('date')}>Date{arrow('date')}</th>
                <th style={{ ...th(true), textAlign: 'right' }} onClick={() => toggleSort('amount')}>Total{arrow('amount')}</th>
                <th style={{ ...th(), textAlign: 'center' }}>Approved</th>
                <th style={th()}></th>
              </tr></thead>
              <tbody>
                {displayed.map(inv => (
                  <tr
                    key={inv.id}
                    onClick={() => selectInvoice(inv)}
                    style={{ cursor: 'pointer', background: selectedId === inv.id ? '#eff6ff' : 'white', transition: 'background .1s' }}
                    onMouseEnter={e => { if (selectedId !== inv.id) e.currentTarget.style.background = '#f8fafc' }}
                    onMouseLeave={e => { e.currentTarget.style.background = selectedId === inv.id ? '#eff6ff' : 'white' }}
                  >
                    <td style={td()}>
                      <span style={{ fontWeight: 600 }}>{inv.invoice_number ?? '—'}</span>
                      {selectedId === inv.id && <span style={{ marginLeft: '.5rem', fontSize: '.75rem', color: '#2563eb' }}>▼ details</span>}
                    </td>
                    <td style={td(false, true)}>{inv.supplier ?? '—'}</td>
                    <td style={td(false, true)}>{inv.invoice_date ?? inv.created_at.slice(0, 10)}</td>
                    <td style={{ ...td(true), fontWeight: 500 }}>{fmt(inv.total_amount, inv.currency ?? 'EUR')}</td>
                    <td style={{ ...td(), textAlign: 'center' }}>
                      <button
                        onClick={e => toggleApproval(inv, e)}
                        style={{
                          padding: '.25rem .75rem', border: 'none', borderRadius: '999px', fontSize: '.78rem', fontWeight: 600, cursor: 'pointer',
                          background: inv.status === 'approved' ? '#dcfce7' : '#f1f5f9',
                          color: inv.status === 'approved' ? '#15803d' : '#64748b'
                        }}
                      >
                        {inv.status === 'approved' ? '✓ Approved' : 'Pending'}
                      </button>
                    </td>
                    <td style={{ ...td(), textAlign: 'right' }}>
                      <button onClick={e => deleteInvoice(inv.id, e)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8', fontSize: '.85rem', padding: '.25rem .5rem' }} title="Delete">✕</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Detail panel */}
      {selectedId && (
        <div style={card}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
            <div style={{ fontWeight: 600, fontSize: '.9rem', color: '#0f172a' }}>
              Invoice Line Items
            </div>
            <div style={{ fontSize: '.8rem', color: '#94a3b8' }}>{detailItems.length} items</div>
          </div>
          {detailLoading ? (
            <div style={{ textAlign: 'center', padding: '2rem', color: '#94a3b8' }}>Loading…</div>
          ) : detailItems.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '2rem', color: '#94a3b8' }}>No line items found for this invoice.</div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '800px' }}>
                <thead><tr>
                  <th style={th()}>Description</th>
                  <th style={th()}>Unit</th>
                  <th style={{ ...th(), textAlign: 'right' }}>Qty</th>
                  <th style={{ ...th(), textAlign: 'right' }}>Unit Price</th>
                  <th style={{ ...th(), textAlign: 'right' }}>BOQ Price</th>
                  <th style={{ ...th(), textAlign: 'right' }}>Accum. Qty</th>
                  <th style={{ ...th(), textAlign: 'right' }}>BOQ Qty</th>
                  <th style={{ ...th(), textAlign: 'right' }}>Total</th>
                  <th style={th()}>Status</th>
                </tr></thead>
                <tbody>
                  {detailItems.map(item => {
                    const alert = itemAlert(item)
                    const bg = alert === 'red' ? '#fff1f2' : alert === 'yellow' ? '#fefce8' : 'white'
                    const borderLeft = alert === 'red' ? '3px solid #fca5a5' : alert === 'yellow' ? '3px solid #fde68a' : undefined
                    return (
                      <tr key={item.id} style={{ background: bg, borderLeft }}>
                        <td style={{ ...td(), fontWeight: alert ? 500 : 400 }}>{item.description}</td>
                        <td style={td(false, true)}>{item.unit ?? '—'}</td>
                        <td style={td(true, true)}>{item.quantity?.toLocaleString('es-ES') ?? '—'}</td>
                        <td style={{ ...td(true), color: alert === 'yellow' && item.boq_unit_price != null && (item.unit_price ?? 0) > item.boq_unit_price ? '#b45309' : '#1e293b' }}>
                          {item.unit_price != null ? item.unit_price.toLocaleString('es-ES', { minimumFractionDigits: 2 }) : '—'}
                        </td>
                        <td style={td(true, true)}>{item.boq_unit_price != null ? item.boq_unit_price.toLocaleString('es-ES', { minimumFractionDigits: 2 }) : '—'}</td>
                        <td style={{ ...td(true), color: item.boq_qty != null && (item.accumulated_qty ?? 0) > item.boq_qty ? '#b45309' : '#1e293b' }}>
                          {item.accumulated_qty != null ? item.accumulated_qty.toLocaleString('es-ES') : '—'}
                        </td>
                        <td style={td(true, true)}>{item.boq_qty?.toLocaleString('es-ES') ?? '—'}</td>
                        <td style={{ ...td(true), fontWeight: 500 }}>{item.total_amount != null ? item.total_amount.toLocaleString('es-ES', { minimumFractionDigits: 2 }) : '—'}</td>
                        <td style={{ ...td() }}>
                          {alert === 'red' && <span style={{ background: '#fca5a5', color: '#991b1b', padding: '.15rem .5rem', borderRadius: '4px', fontSize: '.75rem', fontWeight: 600 }}>NOT IN BOQ</span>}
                          {alert === 'yellow' && (
                            <span style={{ background: '#fde68a', color: '#92400e', padding: '.15rem .5rem', borderRadius: '4px', fontSize: '.75rem', fontWeight: 600 }}>
                              {item.boq_unit_price != null && (item.unit_price ?? 0) > item.boq_unit_price ? 'PRICE ▲' : 'QTY OVERRUN'}
                            </span>
                          )}
                          {!alert && <span style={{ color: '#94a3b8', fontSize: '.75rem' }}>✓ OK</span>}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
