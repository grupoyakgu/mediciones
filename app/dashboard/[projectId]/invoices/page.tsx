'use client'

import { useEffect, useState, useMemo } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { createSupabaseBrowserClient } from '@/lib/supabase-client'

interface Invoice {
  id: string
  invoice_number: string
  invoice_date: string
  supplier: string | null
  total_amount: number | null
  status: string
}

interface InvoiceItem {
  id: string
  boq_item_id: string | null
  match_status: string
  description: string
  unit: string
  quantity: number | null
  unit_price: number | null
  total_amount: number | null
  boq_unit_price: number | null
  boq_qty: number | null
  item_code: string
}

function fmt(n: number | null | undefined) {
  if (n == null) return '—'
  return n.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

type SortKey = 'invoice_date' | 'total_amount' | 'invoice_number'

export default function InvoicesPage() {
  const params = useParams()
  const projectId = params.projectId as string
  const supabase = useMemo(() => {
    if (typeof window === 'undefined') return null
    return createSupabaseBrowserClient()
  }, [])

  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detailItems, setDetailItems] = useState<InvoiceItem[]>([])
  const [detailLoading, setDetailLoading] = useState(false)
  const [, setApprovedInvoiceIds] = useState<Set<string>>(new Set())

  const [uploading, setUploading] = useState(false)
  const [uploadMsg, setUploadMsg] = useState('')

  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('invoice_date')
  const [sortAsc, setSortAsc] = useState(false)

  const [projectName, setProjectName] = useState('')

  useEffect(() => {
    if (!supabase) return
    loadInvoices()
    supabase.from('projects').select('name').eq('id', projectId).single().then(({ data }) => {
      if (data) setProjectName(data.name)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, supabase])

  async function loadInvoices() {
    if (!supabase) return
    setLoading(true)
    const { data } = await supabase
      .from('invoices')
      .select('id,invoice_number,invoice_date,supplier,total_amount,status')
      .eq('project_id', projectId)
      .order('invoice_date', { ascending: false })
    const list = data ?? []
    setInvoices(list)
    setApprovedInvoiceIds(new Set(list.filter((i) => i.status === 'approved').map((i) => i.id)))
    setLoading(false)
  }

  async function toggleApproval(inv: Invoice) {
    if (!supabase) return
    const newStatus = inv.status === 'approved' ? 'processed' : 'approved'
    await supabase.from('invoices').update({ status: newStatus }).eq('id', inv.id)
    setInvoices((prev) => prev.map((i) => i.id === inv.id ? { ...i, status: newStatus } : i))
    setApprovedInvoiceIds((prev) => {
      const next = new Set(prev)
      if (newStatus === 'approved') next.add(inv.id)
      else next.delete(inv.id)
      return next
    })
  }

  async function deleteInvoice(id: string) {
    if (!supabase || !confirm('Delete this invoice?')) return
    await supabase.from('invoice_items').delete().eq('invoice_id', id)
    await supabase.from('invoices').delete().eq('id', id)
    setInvoices((prev) => prev.filter((i) => i.id !== id))
    if (selectedId === id) { setSelectedId(null); setDetailItems([]) }
  }

  async function loadDetail(invoiceId: string) {
    if (selectedId === invoiceId) { setSelectedId(null); setDetailItems([]); return }
    if (!supabase) return
    setSelectedId(invoiceId)
    setDetailLoading(true)
    const { data } = await supabase
      .from('invoice_items')
      .select('*')
      .eq('invoice_id', invoiceId)
    setDetailItems(data ?? [])
    setDetailLoading(false)
  }

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files
    if (!files || files.length === 0) return
    setUploading(true)
    setUploadMsg('')

    for (const file of Array.from(files)) {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('projectId', projectId)
      const res = await fetch('/api/invoices/upload', { method: 'POST', body: fd })
      const json = await res.json()
      if (!res.ok) {
        setUploadMsg(`Error uploading ${file.name}: ${json.error}`)
        setUploading(false)
        return
      }
    }

    setUploadMsg(`✓ ${files.length} invoice(s) uploaded successfully`)
    setUploading(false)
    e.target.value = ''
    loadInvoices()
  }

  const filtered = useMemo(() => {
    let list = invoices
    if (search) {
      const q = search.toLowerCase()
      list = list.filter((i) =>
        i.invoice_number?.toLowerCase().includes(q) || i.supplier?.toLowerCase().includes(q)
      )
    }
    if (statusFilter) list = list.filter((i) => i.status === statusFilter)
    return [...list].sort((a, b) => {
      let av: string | number, bv: string | number
      if (sortKey === 'invoice_date') { av = a.invoice_date ?? ''; bv = b.invoice_date ?? '' }
      else if (sortKey === 'invoice_number') { av = a.invoice_number ?? ''; bv = b.invoice_number ?? '' }
      else { av = a.total_amount ?? 0; bv = b.total_amount ?? 0 }
      if (typeof av === 'string') {
        const c = av.localeCompare(bv as string)
        return sortAsc ? c : -c
      }
      return sortAsc ? (av as number) - (bv as number) : (bv as number) - (av as number)
    })
  }, [invoices, search, statusFilter, sortKey, sortAsc])

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortAsc(!sortAsc)
    else { setSortKey(key); setSortAsc(false) }
  }

  const approvedTotal = invoices
    .filter((i) => i.status === 'approved')
    .reduce((s, i) => s + (i.total_amount ?? 0), 0)

  function getRowBg(item: InvoiceItem): string {
    if (item.match_status === 'not_in_boq') return '#fff1f2'
    const priceAlert = item.unit_price != null && item.boq_unit_price != null && item.unit_price > item.boq_unit_price
    const qtyAlert = item.boq_qty != null && item.quantity != null && item.quantity > item.boq_qty
    if (priceAlert || qtyAlert) return '#fefce8'
    return ''
  }

  const selectedInvoice = invoices.find((i) => i.id === selectedId) ?? null

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', padding: '2rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '0.5rem' }}>
        <Link href={`/dashboard/${projectId}`} style={{ color: '#2563eb', textDecoration: 'none', fontSize: '0.875rem' }}>
          ← {projectName || 'Project'}
        </Link>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.5rem' }}>
        <div>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 700, margin: 0 }}>Invoices</h1>
          <p style={{ color: '#6b7280', fontSize: '0.875rem', margin: '0.25rem 0 0' }}>
            Approved total: <strong>€{fmt(approvedTotal)}</strong>
          </p>
        </div>
        <label style={{
          display: 'inline-block',
          padding: '0.5rem 1.25rem',
          background: uploading ? '#9ca3af' : '#2563eb',
          color: '#fff',
          borderRadius: 6,
          cursor: uploading ? 'default' : 'pointer',
          fontSize: '0.875rem',
          fontWeight: 500,
        }}>
          {uploading ? 'Uploading…' : '+ Upload Invoice(s)'}
          <input
            type="file"
            accept=".pdf,.xlsx,.xls,.csv"
            multiple
            style={{ display: 'none' }}
            onChange={handleUpload}
            disabled={uploading}
          />
        </label>
      </div>

      {uploadMsg && (
        <div style={{
          padding: '0.75rem 1rem',
          background: uploadMsg.startsWith('✓') ? '#f0fdf4' : '#fef2f2',
          color: uploadMsg.startsWith('✓') ? '#166534' : '#991b1b',
          borderRadius: 6,
          marginBottom: '1rem',
          fontSize: '0.875rem',
        }}>
          {uploadMsg}
        </div>
      )}

      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
        <input
          placeholder="Search number / supplier…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={inputStyle}
        />
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} style={inputStyle}>
          <option value="">All statuses</option>
          <option value="approved">Approved</option>
          <option value="processed">Pending</option>
        </select>
      </div>

      {loading ? (
        <p style={{ color: '#9ca3af' }}>Loading…</p>
      ) : filtered.length === 0 ? (
        <p style={{ color: '#9ca3af' }}>No invoices found. Upload your first invoice above.</p>
      ) : (
        <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, overflow: 'hidden', marginBottom: '1.5rem' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
            <thead>
              <tr style={{ background: '#f3f4f6' }}>
                <th style={{ ...th, cursor: 'pointer' }} onClick={() => toggleSort('invoice_number')}>
                  # {sortKey === 'invoice_number' ? (sortAsc ? '↑' : '↓') : '⇅'}
                </th>
                <th style={{ ...th, cursor: 'pointer' }} onClick={() => toggleSort('invoice_date')}>
                  Date {sortKey === 'invoice_date' ? (sortAsc ? '↑' : '↓') : '⇅'}
                </th>
                <th style={th}>Supplier</th>
                <th style={{ ...th, textAlign: 'right', cursor: 'pointer' }} onClick={() => toggleSort('total_amount')}>
                  Amount {sortKey === 'total_amount' ? (sortAsc ? '↑' : '↓') : '⇅'}
                </th>
                <th style={{ ...th, textAlign: 'center' }}>Status</th>
                <th style={{ ...th, textAlign: 'center' }}>Approved</th>
                <th style={{ ...th, textAlign: 'center' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((inv) => (
                <tr
                  key={inv.id}
                  onClick={() => loadDetail(inv.id)}
                  style={{
                    borderTop: '1px solid #f3f4f6',
                    cursor: 'pointer',
                    background: selectedId === inv.id ? '#eff6ff' : undefined,
                  }}
                >
                  <td style={td}>{inv.invoice_number}</td>
                  <td style={td}>{inv.invoice_date}</td>
                  <td style={td}>{inv.supplier ?? '—'}</td>
                  <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>€{fmt(inv.total_amount)}</td>
                  <td style={{ ...td, textAlign: 'center' }}>
                    <span style={{
                      padding: '0.15rem 0.5rem',
                      borderRadius: 9999,
                      fontSize: '0.75rem',
                      background: inv.status === 'approved' ? '#dcfce7' : '#fef3c7',
                      color: inv.status === 'approved' ? '#166534' : '#92400e',
                    }}>
                      {inv.status === 'approved' ? 'Approved' : 'Pending'}
                    </span>
                  </td>
                  <td style={{ ...td, textAlign: 'center' }} onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={inv.status === 'approved'}
                      onChange={() => toggleApproval(inv)}
                    />
                  </td>
                  <td style={{ ...td, textAlign: 'center' }} onClick={(e) => e.stopPropagation()}>
                    <button
                      onClick={() => deleteInvoice(inv.id)}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#ef4444', fontSize: '0.8rem' }}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {selectedId && (
        <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, overflow: 'hidden' }}>
          <div style={{ background: '#f9fafb', padding: '0.75rem 1rem', borderBottom: '1px solid #e5e7eb', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3 style={{ margin: 0, fontWeight: 600, fontSize: '0.95rem' }}>
              Invoice #{selectedInvoice?.invoice_number} — {selectedInvoice?.invoice_date}
            </h3>
            <button onClick={() => { setSelectedId(null); setDetailItems([]) }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6b7280', fontSize: '1rem' }}>✕</button>
          </div>

          <div style={{ padding: '0.5rem 1rem', display: 'flex', gap: '1rem', fontSize: '0.75rem', background: '#fff', borderBottom: '1px solid #f3f4f6' }}>
            <span style={{ background: '#fff1f2', padding: '0.2rem 0.5rem', borderRadius: 4, color: '#991b1b' }}>Red — not in BOQ</span>
            <span style={{ background: '#fefce8', padding: '0.2rem 0.5rem', borderRadius: 4, color: '#854d0e' }}>Yellow — price above BOQ or quantity overrun</span>
          </div>

          {detailLoading ? (
            <p style={{ padding: '1rem', color: '#9ca3af' }}>Loading items…</p>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
                <thead>
                  <tr style={{ background: '#f3f4f6' }}>
                    <th style={th}>Code</th>
                    <th style={th}>Description</th>
                    <th style={th}>Unit</th>
                    <th style={{ ...th, textAlign: 'right' }}>Qty</th>
                    <th style={{ ...th, textAlign: 'right' }}>Unit Price</th>
                    <th style={{ ...th, textAlign: 'right' }}>BOQ Price</th>
                    <th style={{ ...th, textAlign: 'right' }}>BOQ Qty</th>
                    <th style={{ ...th, textAlign: 'right' }}>Total</th>
                    <th style={{ ...th, textAlign: 'center' }}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {detailItems.map((item) => {
                    const bg = getRowBg(item)
                    const priceAlert = item.unit_price != null && item.boq_unit_price != null && item.unit_price > item.boq_unit_price
                    const qtyAlert = item.boq_qty != null && item.quantity != null && item.quantity > item.boq_qty
                    return (
                      <tr key={item.id} style={{ borderTop: '1px solid #f3f4f6', background: bg || undefined }}>
                        <td style={td}>{item.item_code || '—'}</td>
                        <td style={{ ...td, maxWidth: 280 }}>{item.description}</td>
                        <td style={td}>{item.unit}</td>
                        <td style={{ ...td, textAlign: 'right', color: qtyAlert ? '#92400e' : undefined }}>{fmt(item.quantity)}</td>
                        <td style={{ ...td, textAlign: 'right', color: priceAlert ? '#92400e' : undefined }}>{fmt(item.unit_price)}</td>
                        <td style={{ ...td, textAlign: 'right' }}>{fmt(item.boq_unit_price)}</td>
                        <td style={{ ...td, textAlign: 'right' }}>{fmt(item.boq_qty)}</td>
                        <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmt(item.total_amount)}</td>
                        <td style={{ ...td, textAlign: 'center' }}>
                          {item.match_status === 'not_in_boq' ? (
                            <span style={{ color: '#dc2626', fontWeight: 600, fontSize: '0.75rem' }}>Not in BOQ</span>
                          ) : (
                            <span style={{ color: '#16a34a', fontSize: '0.75rem' }}>✓ Matched</span>
                          )}
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

const inputStyle: React.CSSProperties = {
  padding: '0.4rem 0.6rem',
  border: '1px solid #d1d5db',
  borderRadius: 6,
  fontSize: '0.875rem',
}

const th: React.CSSProperties = {
  padding: '0.5rem 0.75rem',
  fontWeight: 600,
  textAlign: 'left',
  fontSize: '0.8rem',
  color: '#374151',
  whiteSpace: 'nowrap',
}

const td: React.CSSProperties = {
  padding: '0.4rem 0.75rem',
  color: '#374151',
  verticalAlign: 'top',
}
