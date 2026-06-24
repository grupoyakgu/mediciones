'use client'
import { useState, useEffect, useMemo, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useParams, useRouter, useSearchParams } from 'next/navigation'

interface Invoice {
  id: string
  invoice_number: string | null
  supplier: string | null
  invoice_date: string | null
  total_amount: number | null
  approved_amount: number | null
  currency: string | null
  file_name: string | null
  status: string
  created_at: string
  total_ejecucion_material: number | null
  a_deducir: number | null
  total_certificacion: number | null
}

interface SubItem {
  description: string
  unit: string | null
  quantity: number | null
  unit_price: number | null
  total_amount: number | null
  manually_approved?: boolean
}

interface BoqItem {
  id: string
  description: string | null
  chapter_name: string | null
  item_code: string | null
}

type MatchTier = 'strong' | 'partial' | 'weak' | 'none'

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
  sub_items: SubItem[] | null
  boq_qty?: number | null
  boq_unit_price?: number | null
  accumulated_qty?: number
}

type SortField = 'date' | 'amount' | 'number'
type SortDir = 'asc' | 'desc'

function normalizeStr(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim()
}
function tokenSet(s: string): Set<string> {
  return new Set(normalizeStr(s).split(' ').filter(Boolean))
}
function jaccardSim(a: string, b: string): number {
  const ta = tokenSet(a), tb = tokenSet(b)
  if (ta.size === 0 && tb.size === 0) return 0
  let inter = 0
  ta.forEach(t => { if (tb.has(t)) inter++ })
  const union = ta.size + tb.size - inter
  return union === 0 ? 0 : inter / union
}
function matchSubItem(sub: SubItem, boqItems: BoqItem[]): { score: number; tier: MatchTier } {
  if (!boqItems.length) return { score: 0, tier: 'none' }
  let best = 0
  for (const b of boqItems) {
    const s = Math.round(jaccardSim(sub.description, b.description ?? '') * 100)
    if (s > best) best = s
  }
  const tier: MatchTier = best >= 80 ? 'strong' : best >= 51 ? 'partial' : best > 0 ? 'weak' : 'none'
  return { score: best, tier }
}
function chapterCoverage(subItems: SubItem[], chapterTotal: number | null, boqItems: BoqItem[]): number | null {
  if (!subItems.length || !chapterTotal) return null
  let matchedAmt = 0
  for (const sub of subItems) {
    const { score } = matchSubItem(sub, boqItems)
    if (score >= 51 || sub.manually_approved) matchedAmt += sub.total_amount ?? 0
  }
  return chapterTotal > 0 ? (matchedAmt / chapterTotal) * 100 : 0
}
function calcApprovedAmount(items: InvoiceItem[], boqItems: BoqItem[]): number {
  let total = 0
  for (const item of items) {
    for (const sub of item.sub_items ?? []) {
      const { score } = matchSubItem(sub, boqItems)
      if (score >= 51 || sub.manually_approved) total += sub.total_amount ?? 0
    }
  }
  return total
}

const fmt = (n: number | null, currency = 'EUR') =>
  n == null ? '—' : new Intl.NumberFormat('es-ES', { style: 'currency', currency }).format(n)

export default function InvoicesPage() {
  const params = useParams()
  const projectId = params.projectId as string
  const supabase = createClient()
  const router = useRouter()
  const searchParams = useSearchParams()
  const fileRef = useRef<HTMLInputElement>(null)
  const invoiceRowRefs = useRef<Record<string, HTMLTableRowElement | null>>({})

  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [uploadPhaseIdx, setUploadPhaseIdx] = useState(0)
  const [uploadPhaseProgress, setUploadPhaseProgress] = useState(0)
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null)

  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | 'approved' | 'pending'>('all')
  const [sortField, setSortField] = useState<SortField>('date')
  const [sortDir, setSortDir] = useState<SortDir>('desc')

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detailItems, setDetailItems] = useState<InvoiceItem[]>([])
  const [detailLoading, setDetailLoading] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<Invoice | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [retentionPct, setRetentionPct] = useState(10)
  const [expandedChapter, setExpandedChapter] = useState<string | null>(null)
  const [dupInvoiceIds, setDupInvoiceIds] = useState<Set<string>>(new Set())
  const [boqItems, setBoqItems] = useState<BoqItem[]>([])
  const [approvingSubItem, setApprovingSubItem] = useState<string | null>(null)

  useEffect(() => {
    loadInvoices()
    fetch('/api/projects').then(r => r.json()).then(d => {
      const p = (d.projects ?? []).find((x: { id: string; retention_pct?: number }) => x.id === projectId)
      if (p?.retention_pct != null) setRetentionPct(p.retention_pct)
    })
    fetch(`/api/projects/${projectId}/alerts`).then(r => r.json()).then(d => {
      const ids = new Set<string>((d.alerts ?? []).filter((a: { type: string; invoice_id: string | null }) => a.type === 'duplicate_invoice' && a.invoice_id).map((a: { invoice_id: string }) => a.invoice_id))
      setDupInvoiceIds(ids)
    })
  }, []) // eslint-disable-line

  async function loadInvoices() {
    const { data } = await supabase
      .from('invoices')
      .select('*')
      .eq('project_id', projectId)
      .order('invoice_date', { ascending: false })
    setInvoices(data ?? [])
    setLoading(false)
    const target = searchParams.get('invoice')
    if (target && (data ?? []).find(i => i.id === target)) {
      const inv = (data ?? []).find(i => i.id === target)!
      setSelectedId(target)
      await loadDetail(target, inv.status)
      setTimeout(() => {
        invoiceRowRefs.current[target]?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      }, 150)
    }
  }

  function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    setUploadPhaseIdx(0)
    setUploadPhaseProgress(0)
    setMsg(null)

    // Phases 1 is real XHR upload progress.
    // Phases 2-5 are server-side — simulated with realistic timings, snapped to 100% on response.
    // Phase durations (ms): [—, 600, 25000, 1500, 1200]
    const phaseDurations = [0, 600, 25000, 1500, 1200]
    let activePhase = 0
    let phaseTimer: ReturnType<typeof setInterval> | null = null

    function startPhase(idx: number) {
      if (phaseTimer) clearInterval(phaseTimer)
      activePhase = idx
      setUploadPhaseIdx(idx)
      setUploadPhaseProgress(0)
      if (idx === 0) return // phase 0 driven by XHR progress events
      const duration = phaseDurations[idx] ?? 1000
      const steps = 60
      const interval = duration / steps
      let step = 0
      phaseTimer = setInterval(() => {
        step++
        // Ease-out: progress slows near 95% to leave room for real completion
        const p = Math.min(Math.round((step / steps) * 95), 95)
        setUploadPhaseProgress(p)
        if (step >= steps) clearInterval(phaseTimer!)
      }, interval)
    }

    const fd = new FormData()
    fd.append('file', file)
    fd.append('projectId', projectId)

    const xhr = new XMLHttpRequest()
    xhr.open('POST', '/api/invoices/upload')

    xhr.upload.onprogress = (ev) => {
      if (ev.lengthComputable) {
        setUploadPhaseProgress(Math.round((ev.loaded / ev.total) * 100))
      }
    }

    xhr.upload.onload = () => {
      // File sent — move to phase 2 (PDF conversion), then 3 (Claude), etc.
      setUploadPhaseProgress(100)
      setTimeout(() => startPhase(1), 100)   // converting
      setTimeout(() => startPhase(2), 700)   // Claude AI
      setTimeout(() => startPhase(3), 700 + 25000) // DB write (only reached if Claude is slow)
      setTimeout(() => startPhase(4), 700 + 25000 + 1500) // alerts
    }

    xhr.onload = async () => {
      if (phaseTimer) clearInterval(phaseTimer)
      setUploadPhaseIdx(4)
      setUploadPhaseProgress(100)
      const data = JSON.parse(xhr.responseText)
      if (xhr.status >= 200 && xhr.status < 300) {
        setMsg({ type: 'ok', text: `✅ Invoice processed: ${data.itemCount} items, ${data.alertCount} alerts` })
        await loadInvoices()
        fetch(`/api/projects/${projectId}/alerts`).then(r => r.json()).then(d => {
          const ids = new Set<string>((d.alerts ?? []).filter((a: { type: string; invoice_id: string | null }) => a.type === 'duplicate_invoice' && a.invoice_id).map((a: { invoice_id: string }) => a.invoice_id))
          setDupInvoiceIds(ids)
        })
      } else {
        setMsg({ type: 'err', text: data.error ?? 'Upload failed' })
      }
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }

    xhr.onerror = () => {
      if (phaseTimer) clearInterval(phaseTimer)
      setMsg({ type: 'err', text: 'Network error during upload' })
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }

    startPhase(0)
    xhr.send(fd)
  }

  async function toggleApproval(inv: Invoice, e: React.MouseEvent) {
    e.stopPropagation()
    const newStatus = inv.status === 'approved' ? 'processed' : 'approved'
    await supabase.from('invoices').update({ status: newStatus }).eq('id', inv.id)
    setInvoices(prev => prev.map(i => i.id === inv.id ? { ...i, status: newStatus } : i))
    if (selectedId === inv.id) await loadDetail(inv.id, newStatus)
    router.refresh()
  }

  async function confirmAndDelete() {
    if (!confirmDelete) return
    setDeleting(true)
    await supabase.from('invoice_items').delete().eq('invoice_id', confirmDelete.id)
    await supabase.from('invoices').delete().eq('id', confirmDelete.id)
    setInvoices(prev => prev.filter(i => i.id !== confirmDelete.id))
    if (selectedId === confirmDelete.id) { setSelectedId(null); setDetailItems([]) }
    setConfirmDelete(null)
    setDeleting(false)
  }

  async function saveApprovedAmount(invoiceId: string, items: InvoiceItem[], boq: BoqItem[]) {
    const amount = calcApprovedAmount(items, boq)
    await supabase.from('invoices').update({ approved_amount: amount }).eq('id', invoiceId)
    setInvoices(prev => prev.map(i => i.id === invoiceId ? { ...i, approved_amount: amount } : i))
    return amount
  }

  async function loadDetail(invoiceId: string, invoiceStatus: string) {
    setDetailLoading(true)
    const [{ data: items }, { data: allBoq }] = await Promise.all([
      supabase.from('invoice_items').select('*').eq('invoice_id', invoiceId),
      supabase.from('boq_items').select('id,description,chapter_name,item_code').eq('project_id', projectId),
    ])
    const boq = allBoq ?? []
    setBoqItems(boq)

    if (!items?.length) { setDetailItems([]); setDetailLoading(false); return }

    const boqIds = Array.from(new Set(items.filter(i => i.boq_item_id).map(i => i.boq_item_id as string)))

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

    const built = items.map(item => ({
      ...item,
      boq_qty: item.boq_item_id ? (boqMap.get(item.boq_item_id)?.quantity ?? null) : null,
      boq_unit_price: item.boq_item_id ? (boqMap.get(item.boq_item_id)?.unit_price ?? null) : null,
      accumulated_qty: item.boq_item_id ? (accMap.get(item.boq_item_id) ?? 0) : 0,
    }))
    setDetailItems(built)
    await saveApprovedAmount(invoiceId, built, boq)
    setDetailLoading(false)
  }

  async function approveSubItem(item: InvoiceItem, subIdx: number) {
    const key = `${item.id}-${subIdx}`
    setApprovingSubItem(key)
    const newSubItems = (item.sub_items ?? []).map((s, i) =>
      i === subIdx ? { ...s, manually_approved: true } : s
    )
    await supabase.from('invoice_items').update({ sub_items: newSubItems }).eq('id', item.id)
    const updatedItems = detailItems.map(di =>
      di.id === item.id ? { ...di, sub_items: newSubItems } : di
    )
    setDetailItems(updatedItems)
    await saveApprovedAmount(selectedId!, updatedItems, boqItems)
    setApprovingSubItem(null)
  }

  async function approveChapterAll(item: InvoiceItem) {
    const key = `${item.id}-all`
    setApprovingSubItem(key)
    const newSubItems = (item.sub_items ?? []).map(s => {
      const { score } = matchSubItem(s, boqItems)
      return score < 51 ? { ...s, manually_approved: true } : s
    })
    await supabase.from('invoice_items').update({ sub_items: newSubItems }).eq('id', item.id)
    const updatedItems = detailItems.map(di =>
      di.id === item.id ? { ...di, sub_items: newSubItems } : di
    )
    setDetailItems(updatedItems)
    await saveApprovedAmount(selectedId!, updatedItems, boqItems)
    setApprovingSubItem(null)
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
      {/* Delete confirmation modal */}
      {confirmDelete && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: 'white', borderRadius: '14px', padding: '2rem', maxWidth: '420px', width: '90%', boxShadow: '0 20px 60px rgba(0,0,0,.2)' }}>
            <h2 style={{ margin: '0 0 .75rem', fontSize: '1.1rem', fontWeight: 700, color: '#0f172a' }}>Delete invoice?</h2>
            <p style={{ margin: '0 0 1.5rem', fontSize: '.9rem', color: '#475569' }}>
              Invoice <strong>#{confirmDelete.invoice_number ?? '—'}</strong>
              {confirmDelete.supplier ? ` from ${confirmDelete.supplier}` : ''} and all its line items will be permanently deleted. This cannot be undone.
            </p>
            <div style={{ display: 'flex', gap: '.75rem', justifyContent: 'flex-end' }}>
              <button onClick={() => setConfirmDelete(null)} disabled={deleting} style={{ padding: '.5rem 1rem', background: 'none', border: '1px solid #e2e8f0', borderRadius: '8px', fontSize: '.875rem', cursor: 'pointer', color: '#64748b' }}>Cancel</button>
              <button onClick={confirmAndDelete} disabled={deleting} style={{ padding: '.5rem 1.25rem', background: '#dc2626', color: 'white', border: 'none', borderRadius: '8px', fontSize: '.875rem', fontWeight: 600, cursor: deleting ? 'not-allowed' : 'pointer' }}>
                {deleting ? 'Deleting…' : 'Delete invoice'}
              </button>
            </div>
          </div>
        </div>
      )}

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
            {uploading ? ['⬆️ Uploading…', '🔄 Converting…', '🤖 AI Extracting…', '💾 Saving…', '🔔 Generating Alerts…'][uploadPhaseIdx] : '+ Upload Invoice'}
          </button>
        </div>
      </div>

      {uploading && (() => {
        const phases = [
          { label: 'File Uploading',     color: '#3b82f6', icon: '⬆️' },
          { label: 'Converting PDF',     color: '#8b5cf6', icon: '🔄' },
          { label: 'AI Extraction',      color: '#f59e0b', icon: '🤖' },
          { label: 'Saving to DB',       color: '#10b981', icon: '💾' },
          { label: 'Generating Alerts',  color: '#ef4444', icon: '🔔' },
        ]
        return (
          <div style={{ marginBottom: '1rem', background: 'white', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '1.1rem 1.25rem' }}>
            {/* Phase rows */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '.55rem' }}>
              {phases.map((ph, i) => {
                const isDone    = i < uploadPhaseIdx
                const isActive  = i === uploadPhaseIdx
                const isPending = i > uploadPhaseIdx
                const pct = isDone ? 100 : isActive ? uploadPhaseProgress : 0
                return (
                  <div key={i}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '.6rem', marginBottom: '.25rem' }}>
                      <span style={{ fontSize: '.8rem', width: '1.2rem', textAlign: 'center' }}>
                        {isDone ? '✅' : ph.icon}
                      </span>
                      <span style={{
                        fontSize: '.75rem', fontWeight: 600,
                        color: isDone ? '#15803d' : isActive ? ph.color : '#cbd5e1',
                        flex: 1,
                      }}>
                        {ph.label}
                      </span>
                      <span style={{ fontSize: '.7rem', color: isPending ? '#e2e8f0' : isDone ? '#15803d' : ph.color, fontVariantNumeric: 'tabular-nums' }}>
                        {isDone ? '100%' : isActive ? `${pct}%` : '—'}
                      </span>
                    </div>
                    <div style={{ height: '5px', background: '#f1f5f9', borderRadius: '999px', overflow: 'hidden' }}>
                      <div style={{
                        height: '100%',
                        width: `${pct}%`,
                        background: isDone ? '#22c55e' : ph.color,
                        borderRadius: '999px',
                        transition: isDone ? 'none' : 'width .25s ease',
                      }} />
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )
      })()}

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
                <th style={{ ...th(true), textAlign: 'right' }} onClick={() => toggleSort('amount')}>Total Requested{arrow('amount')}</th>
                <th style={{ ...th(), textAlign: 'right' }}>Total Approved</th>
                <th style={{ ...th(), textAlign: 'center' }}>Status</th>
                <th style={th()}></th>
              </tr></thead>
              <tbody>
                {displayed.map(inv => (
                  <tr
                    key={inv.id}
                    ref={el => { invoiceRowRefs.current[inv.id] = el }}
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
                    <td style={{ ...td(true), fontWeight: 500, color: inv.approved_amount != null ? '#15803d' : '#94a3b8' }}>
                      {fmt(inv.approved_amount, inv.currency ?? 'EUR')}
                    </td>
                    <td style={{ ...td(), textAlign: 'center' }}>
                      <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
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
                        {dupInvoiceIds.has(inv.id) && (
                          <span style={{ background: '#fee2e2', color: '#dc2626', fontSize: '.7rem', fontWeight: 700, padding: '.1rem .4rem', borderRadius: '4px', letterSpacing: '.04em' }} title="Duplicate invoice number">DUP</span>
                        )}
                      </div>
                    </td>
                    <td style={{ ...td(), textAlign: 'right' }}>
                      <button onClick={e => { e.stopPropagation(); setConfirmDelete(inv) }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8', fontSize: '.85rem', padding: '.25rem .5rem' }} title="Delete">✕</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Detail panel */}
      {selectedId && (() => {
        const inv = invoices.find(i => i.id === selectedId)!
        const retention = inv?.total_certificacion != null
          ? inv.total_certificacion
          : inv?.total_amount != null
            ? inv.total_amount * (1 - retentionPct / 100)
            : null
        return (
        <div style={card}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
            <div style={{ fontWeight: 600, fontSize: '.9rem', color: '#0f172a' }}>
              Invoice Line Items
            </div>
            <div style={{ fontSize: '.8rem', color: '#94a3b8' }}>{detailItems.length} chapters</div>
          </div>

          {/* Financial summary */}
          {inv && (inv.total_ejecucion_material != null || inv.a_deducir != null || inv.total_amount != null) && (
            <div style={{ background: '#f8fafc', borderRadius: '8px', padding: '1rem 1.25rem', marginBottom: '1.25rem', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '.75rem 1.5rem' }}>
              {inv.total_ejecucion_material != null && (
                <div>
                  <div style={{ fontSize: '.7rem', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: '.2rem' }}>Total Ejecución Material</div>
                  <div style={{ fontWeight: 600, fontSize: '.95rem', color: '#0f172a' }}>{fmt(inv.total_ejecucion_material, inv.currency ?? 'EUR')}</div>
                </div>
              )}
              {inv.a_deducir != null && (
                <div>
                  <div style={{ fontSize: '.7rem', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: '.2rem' }}>A Deducir Certificación Anterior</div>
                  <div style={{ fontWeight: 600, fontSize: '.95rem', color: '#dc2626' }}>− {fmt(inv.a_deducir, inv.currency ?? 'EUR')}</div>
                </div>
              )}
              {inv.total_amount != null && (
                <div>
                  <div style={{ fontSize: '.7rem', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: '.2rem' }}>Total Requested</div>
                  <div style={{ fontWeight: 600, fontSize: '.95rem', color: '#0f172a' }}>{fmt(inv.total_amount, inv.currency ?? 'EUR')}</div>
                </div>
              )}
              {inv.approved_amount != null && (
                <div style={{ borderLeft: '2px solid #15803d', paddingLeft: '.75rem' }}>
                  <div style={{ fontSize: '.7rem', color: '#15803d', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: '.2rem' }}>Total Approved</div>
                  <div style={{ fontWeight: 700, fontSize: '1rem', color: '#15803d' }}>{fmt(inv.approved_amount, inv.currency ?? 'EUR')}</div>
                </div>
              )}
              {retention != null && (
                <div style={{ borderLeft: '2px solid #2563eb', paddingLeft: '.75rem' }}>
                  <div style={{ fontSize: '.7rem', color: '#2563eb', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: '.2rem' }}>Total Certificación (−{retentionPct}% retención)</div>
                  <div style={{ fontWeight: 700, fontSize: '1rem', color: '#2563eb' }}>{fmt(retention, inv.currency ?? 'EUR')}</div>
                </div>
              )}
            </div>
          )}
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
                  <th style={{ ...th(), textAlign: 'center' }}>Coverage</th>
                  <th style={th()}>Status</th>
                </tr></thead>
                <tbody>
                  {detailItems.map(item => {
                    const alert = itemAlert(item)
                    const bg = alert === 'red' ? '#fff1f2' : alert === 'yellow' ? '#fefce8' : 'white'
                    const borderLeft = alert === 'red' ? '3px solid #fca5a5' : alert === 'yellow' ? '3px solid #fde68a' : undefined
                    const hasSubItems = item.sub_items && item.sub_items.length > 0
                    const isExpanded = expandedChapter === item.id
                    const coverage = hasSubItems ? chapterCoverage(item.sub_items!, item.total_amount, boqItems) : null
                    const covColor = coverage == null ? '#94a3b8' : coverage >= 90 ? '#15803d' : coverage >= 75 ? '#b45309' : '#dc2626'
                    const covBg = coverage == null ? '#f1f5f9' : coverage >= 90 ? '#dcfce7' : coverage >= 75 ? '#fef3c7' : '#fee2e2'

                    // Count unapproved low-score sub-items for this chapter
                    const lowUnnapproved = hasSubItems
                      ? item.sub_items!.filter(s => {
                          const { score } = matchSubItem(s, boqItems)
                          return score < 51 && !s.manually_approved
                        })
                      : []
                    const hasLowSubItems = hasSubItems && item.sub_items!.some(s => {
                      const { score } = matchSubItem(s, boqItems)
                      return score < 51
                    })
                    const allLowApproved = hasLowSubItems && lowUnnapproved.length === 0

                    return (
                      <>
                        <tr
                          key={item.id}
                          onClick={() => hasSubItems && setExpandedChapter(isExpanded ? null : item.id)}
                          style={{ background: isExpanded ? '#eff6ff' : bg, borderLeft, cursor: hasSubItems ? 'pointer' : 'default' }}
                          onMouseEnter={e => { if (hasSubItems && !isExpanded) e.currentTarget.style.background = '#f8fafc' }}
                          onMouseLeave={e => { e.currentTarget.style.background = isExpanded ? '#eff6ff' : bg }}
                        >
                          <td style={{ ...td(), fontWeight: 600 }}>
                            {hasSubItems && <span style={{ marginRight: '.4rem', fontSize: '.75rem', color: '#2563eb' }}>{isExpanded ? '▼' : '▶'}</span>}
                            {item.description}
                          </td>
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
                          <td style={{ ...td(), textAlign: 'center' }}>
                            {coverage != null ? (
                              <span style={{ background: covBg, color: covColor, padding: '.15rem .5rem', borderRadius: '4px', fontSize: '.75rem', fontWeight: 600, whiteSpace: 'nowrap' }}>
                                {coverage.toFixed(0)}%
                              </span>
                            ) : <span style={{ color: '#94a3b8', fontSize: '.75rem' }}>—</span>}
                          </td>
                          <td style={{ ...td() }}>
                            {alert === 'red' && <span style={{ background: '#fca5a5', color: '#991b1b', padding: '.15rem .5rem', borderRadius: '4px', fontSize: '.75rem', fontWeight: 600 }}>NOT IN BOQ</span>}
                            {alert === 'yellow' && (
                              <span style={{ background: '#fde68a', color: '#92400e', padding: '.15rem .5rem', borderRadius: '4px', fontSize: '.75rem', fontWeight: 600 }}>
                                {item.boq_unit_price != null && (item.unit_price ?? 0) > item.boq_unit_price ? 'PRICE ▲' : 'QTY OVERRUN'}
                              </span>
                            )}
                            {!alert && hasLowSubItems && !allLowApproved && (
                              <span style={{ background: '#fee2e2', color: '#dc2626', padding: '.15rem .5rem', borderRadius: '4px', fontSize: '.75rem', fontWeight: 600 }}>⚠</span>
                            )}
                            {!alert && (!hasLowSubItems || allLowApproved) && (
                              <span style={{ background: '#dcfce7', color: '#15803d', padding: '.15rem .5rem', borderRadius: '4px', fontSize: '.75rem', fontWeight: 600 }}>✓ OK</span>
                            )}
                          </td>
                        </tr>
                        {isExpanded && hasSubItems && (
                          <tr key={`${item.id}-sub`}>
                            <td colSpan={10} style={{ padding: 0, background: '#f0f7ff', borderBottom: '2px solid #bfdbfe' }}>
                              <div style={{ padding: '.75rem 1.5rem 1rem 2.5rem' }}>
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '.5rem' }}>
                                  <div style={{ fontSize: '.75rem', fontWeight: 600, color: '#2563eb', textTransform: 'uppercase', letterSpacing: '.05em' }}>
                                    Line items — {item.description}
                                  </div>
                                  {lowUnnapproved.length > 0 && (
                                    <button
                                      onClick={e => { e.stopPropagation(); approveChapterAll(item) }}
                                      disabled={approvingSubItem === `${item.id}-all`}
                                      style={{ fontSize: '.75rem', fontWeight: 600, padding: '.3rem .75rem', background: '#0f172a', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', whiteSpace: 'nowrap', opacity: approvingSubItem === `${item.id}-all` ? 0.6 : 1 }}
                                    >
                                      {approvingSubItem === `${item.id}-all` ? '…' : `Approve all low-score (${lowUnnapproved.length})`}
                                    </button>
                                  )}
                                </div>
                                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '.82rem' }}>
                                  <thead>
                                    <tr style={{ background: '#dbeafe' }}>
                                      <th style={{ padding: '.4rem .75rem', textAlign: 'left', fontWeight: 600, color: '#1e40af' }}>Description</th>
                                      <th style={{ padding: '.4rem .75rem', textAlign: 'left', fontWeight: 600, color: '#1e40af', whiteSpace: 'nowrap' }}>Unit</th>
                                      <th style={{ padding: '.4rem .75rem', textAlign: 'right', fontWeight: 600, color: '#1e40af', whiteSpace: 'nowrap' }}>Qty</th>
                                      <th style={{ padding: '.4rem .75rem', textAlign: 'right', fontWeight: 600, color: '#1e40af', whiteSpace: 'nowrap' }}>Unit Price</th>
                                      <th style={{ padding: '.4rem .75rem', textAlign: 'right', fontWeight: 600, color: '#1e40af', whiteSpace: 'nowrap' }}>Total</th>
                                      <th style={{ padding: '.4rem .75rem', textAlign: 'center', fontWeight: 600, color: '#1e40af', whiteSpace: 'nowrap' }}>BOQ Match</th>
                                      <th style={{ padding: '.4rem .75rem', textAlign: 'center', fontWeight: 600, color: '#1e40af', whiteSpace: 'nowrap' }}>Action</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {item.sub_items!.map((sub, idx) => {
                                      const { score, tier } = matchSubItem(sub, boqItems)
                                      const isLow = score < 51
                                      const isManuallyApproved = !!sub.manually_approved
                                      const badgeStyle = tier === 'strong'
                                        ? { background: '#dcfce7', color: '#15803d' }
                                        : tier === 'partial'
                                          ? { background: '#fef3c7', color: '#92400e' }
                                          : tier === 'weak'
                                            ? { background: '#f1f5f9', color: '#64748b' }
                                            : { background: '#fee2e2', color: '#dc2626' }
                                      const tierLabel = tier === 'strong' ? `Strong ${score}%` : tier === 'partial' ? `Partial ${score}%` : tier === 'weak' ? `Weak ${score}%` : 'No Match'
                                      const rowBg = isLow && !isManuallyApproved
                                        ? (idx % 2 === 0 ? '#fff7ed' : '#ffedd5')
                                        : (idx % 2 === 0 ? 'white' : '#f0f7ff')
                                      const approveKey = `${item.id}-${idx}`
                                      return (
                                        <tr key={idx} style={{ background: rowBg }}>
                                          <td style={{ padding: '.4rem .75rem', color: '#1e293b' }}>{sub.description}</td>
                                          <td style={{ padding: '.4rem .75rem', color: '#64748b', whiteSpace: 'nowrap' }}>{sub.unit ?? '—'}</td>
                                          <td style={{ padding: '.4rem .75rem', textAlign: 'right', color: '#64748b' }}>{sub.quantity?.toLocaleString('es-ES') ?? '—'}</td>
                                          <td style={{ padding: '.4rem .75rem', textAlign: 'right', color: '#64748b' }}>{sub.unit_price != null ? sub.unit_price.toLocaleString('es-ES', { minimumFractionDigits: 2 }) : '—'}</td>
                                          <td style={{ padding: '.4rem .75rem', textAlign: 'right', fontWeight: 500, color: '#1e293b' }}>{sub.total_amount != null ? sub.total_amount.toLocaleString('es-ES', { minimumFractionDigits: 2 }) : '—'}</td>
                                          <td style={{ padding: '.4rem .75rem', textAlign: 'center' }}>
                                            {boqItems.length > 0 ? (
                                              <span style={{ ...badgeStyle, padding: '.15rem .5rem', borderRadius: '4px', fontSize: '.72rem', fontWeight: 600, whiteSpace: 'nowrap' }}>{tierLabel}</span>
                                            ) : <span style={{ color: '#94a3b8', fontSize: '.72rem' }}>No BOQ</span>}
                                          </td>
                                          <td style={{ padding: '.4rem .75rem', textAlign: 'center' }}>
                                            {isLow ? (
                                              isManuallyApproved ? (
                                                <span style={{ background: '#dcfce7', color: '#15803d', padding: '.15rem .5rem', borderRadius: '4px', fontSize: '.72rem', fontWeight: 600, whiteSpace: 'nowrap' }}>✓ Approved</span>
                                              ) : (
                                                <button
                                                  onClick={e => { e.stopPropagation(); approveSubItem(item, idx) }}
                                                  disabled={approvingSubItem === approveKey}
                                                  style={{ fontSize: '.72rem', fontWeight: 600, padding: '.2rem .6rem', background: '#fef3c7', color: '#92400e', border: '1px solid #fde68a', borderRadius: '4px', cursor: 'pointer', whiteSpace: 'nowrap', opacity: approvingSubItem === approveKey ? 0.6 : 1 }}
                                                >
                                                  {approvingSubItem === approveKey ? '…' : 'Approve'}
                                                </button>
                                              )
                                            ) : (
                                              <span style={{ color: '#94a3b8', fontSize: '.72rem' }}>—</span>
                                            )}
                                          </td>
                                        </tr>
                                      )
                                    })}
                                  </tbody>
                                </table>
                              </div>
                            </td>
                          </tr>
                        )}
                      </>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
        )
      })()}
    </div>
  )
}
