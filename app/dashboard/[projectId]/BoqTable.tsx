'use client'
import { useState, useEffect, useMemo } from 'react'

interface BoqItem {
  id: string
  chapter_id: string | null
  chapter_name: string | null
  item_code: string | null
  description: string
  unit: string | null
  quantity: number | null
  unit_price: number | null
  total_amount: number | null
}

type SortField = 'description' | 'unit_price' | 'effective_total' | 'chapter'
type SortDir = 'asc' | 'desc'

const fmt = (n: number | null) =>
  n == null ? '—' : n.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

function effectiveTotal(item: BoqItem): number {
  if (item.total_amount != null && item.total_amount !== 0) return item.total_amount
  return (item.quantity ?? 0) * (item.unit_price ?? 0)
}

function topLevel(chapterId: string | null): string {
  if (!chapterId) return ''
  return chapterId.split('.')[0]
}

export default function BoqTable({ projectId }: { projectId: string }) {
  const [items, setItems] = useState<BoqItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [search, setSearch] = useState('')
  const [chapterFilter, setChapterFilter] = useState('all')
  const [minPrice, setMinPrice] = useState('')
  const [maxPrice, setMaxPrice] = useState('')
  const [sortField, setSortField] = useState<SortField>('chapter')
  const [sortDir, setSortDir] = useState<SortDir>('asc')
  const [showSummary, setShowSummary] = useState(true)

  useEffect(() => {
    let cancelled = false
    fetch(`/api/projects/${projectId}/boq`)
      .then(r => r.json())
      .then(({ items: data, error: err }) => {
        if (cancelled) return
        if (err) { setError(err); setLoading(false); return }
        setItems(data ?? [])
        setLoading(false)
      })
      .catch(e => { if (!cancelled) { setError(String(e)); setLoading(false) } })
    return () => { cancelled = true }
  }, [projectId])

  const topLevelNames = useMemo(() => {
    const map = new Map<string, string>()
    for (const item of items) {
      const id = item.chapter_id ?? ''
      if (id && !id.includes('.') && item.chapter_name) map.set(id, item.chapter_name)
    }
    return map
  }, [items])

  const topLevelChapters = useMemo(() => {
    const seen = new Map<string, string>()
    for (const item of items) {
      const tl = topLevel(item.chapter_id)
      if (tl && !seen.has(tl)) seen.set(tl, topLevelNames.get(tl) ?? tl)
    }
    return Array.from(seen.entries()).sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true }))
  }, [items, topLevelNames])

  const filtered = useMemo(() => {
    let rows = items
    if (search.trim()) {
      const q = search.toLowerCase()
      rows = rows.filter(r =>
        r.description.toLowerCase().includes(q) ||
        (r.chapter_name ?? '').toLowerCase().includes(q) ||
        (r.item_code ?? '').toLowerCase().includes(q)
      )
    }
    if (chapterFilter !== 'all') rows = rows.filter(r => topLevel(r.chapter_id) === chapterFilter)
    const min = parseFloat(minPrice), max = parseFloat(maxPrice)
    if (!isNaN(min)) rows = rows.filter(r => effectiveTotal(r) >= min)
    if (!isNaN(max)) rows = rows.filter(r => effectiveTotal(r) <= max)
    return rows.slice().sort((a, b) => {
      let cmp = 0
      if (sortField === 'description') cmp = a.description.localeCompare(b.description)
      else if (sortField === 'unit_price') cmp = (a.unit_price ?? 0) - (b.unit_price ?? 0)
      else if (sortField === 'effective_total') cmp = effectiveTotal(a) - effectiveTotal(b)
      else cmp = (a.chapter_id ?? '').localeCompare(b.chapter_id ?? '', undefined, { numeric: true })
      return sortDir === 'asc' ? cmp : -cmp
    })
  }, [items, search, chapterFilter, minPrice, maxPrice, sortField, sortDir])

  const chapterSummary = useMemo(() => {
    const map = new Map<string, { name: string; count: number; total: number }>()
    for (const item of filtered) {
      const tl = topLevel(item.chapter_id) || '__none__'
      const name = topLevelNames.get(tl) ?? item.chapter_name ?? tl
      const entry = map.get(tl) ?? { name, count: 0, total: 0 }
      entry.count++
      entry.total += effectiveTotal(item)
      map.set(tl, entry)
    }
    return Array.from(map.entries())
      .map(([id, v]) => ({ id, ...v }))
      .sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }))
  }, [filtered, topLevelNames])

  const grandTotal = chapterSummary.reduce((s, c) => s + c.total, 0)

  function toggleSort(field: SortField) {
    if (sortField === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortField(field); setSortDir('asc') }
  }
  const arrow = (f: SortField) => sortField === f ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ''

  const card: React.CSSProperties = { background: 'white', borderRadius: '12px', border: '1px solid #e2e8f0', padding: '1.5rem', marginBottom: '1.5rem' }
  const inp: React.CSSProperties = { padding: '.45rem .75rem', border: '1px solid #e2e8f0', borderRadius: '6px', fontSize: '.85rem', outline: 'none', background: 'white' }
  const th = (clickable = false): React.CSSProperties => ({ padding: '.625rem 1rem', textAlign: 'left', fontSize: '.75rem', fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: '.05em', background: '#f8fafc', borderBottom: '1px solid #e2e8f0', whiteSpace: 'nowrap', cursor: clickable ? 'pointer' : 'default', userSelect: 'none' })
  const td = (right = false, muted = false): React.CSSProperties => ({ padding: '.55rem 1rem', fontSize: '.85rem', borderBottom: '1px solid #f1f5f9', textAlign: right ? 'right' : 'left', color: muted ? '#94a3b8' : '#1e293b', whiteSpace: right ? 'nowrap' : 'normal' })

  if (loading) return <div style={{ padding: '2rem', textAlign: 'center', color: '#94a3b8', background: 'white', borderRadius: '12px', border: '1px solid #e2e8f0' }}>Loading BOQ…</div>
  if (error) return <div style={{ padding: '1.5rem', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '12px', color: '#dc2626' }}>Error loading BOQ: {error}</div>
  if (items.length === 0) return (
    <div style={{ ...card, textAlign: 'center', padding: '3rem 2rem', color: '#94a3b8', border: '2px dashed #e2e8f0' }}>
      <div style={{ fontSize: '2rem', marginBottom: '.75rem' }}>📂</div>
      <p style={{ margin: 0 }}>No BOQ loaded. Go to <a href="settings" style={{ color: '#2563eb', fontWeight: 500 }}>Settings</a> to upload a BOQ file.</p>
    </div>
  )

  return (
    <div>
      <div style={{ marginBottom: '1rem' }}>
        <h2 style={{ margin: '0 0 .25rem', fontSize: '1.1rem', fontWeight: 600, color: '#0f172a' }}>Bill of Quantities</h2>
        <p style={{ margin: 0, fontSize: '.85rem', color: '#64748b' }}>{items.length} line items · {topLevelChapters.length} chapters</p>
      </div>

      <div style={{ ...card, padding: '1rem 1.5rem' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.75rem', alignItems: 'center' }}>
          <input style={{ ...inp, minWidth: '220px', flex: 1 }} placeholder="🔍  Search description, chapter or code…" value={search} onChange={e => setSearch(e.target.value)} />
          <select style={inp} value={chapterFilter} onChange={e => setChapterFilter(e.target.value)}>
            <option value="all">All chapters</option>
            {topLevelChapters.map(([id, name]) => <option key={id} value={id}>{id} – {name}</option>)}
          </select>
          <input style={{ ...inp, width: '110px' }} placeholder="Min (€)" value={minPrice} onChange={e => setMinPrice(e.target.value)} type="number" />
          <input style={{ ...inp, width: '110px' }} placeholder="Max (€)" value={maxPrice} onChange={e => setMaxPrice(e.target.value)} type="number" />
          <label style={{ display: 'flex', alignItems: 'center', gap: '.4rem', fontSize: '.875rem', color: '#475569', cursor: 'pointer', whiteSpace: 'nowrap' }}>
            <input type="checkbox" checked={showSummary} onChange={e => setShowSummary(e.target.checked)} style={{ width: '15px', height: '15px' }} />
            Chapter summary
          </label>
        </div>
      </div>

      {showSummary && (
        <div style={card}>
          <div style={{ fontWeight: 600, fontSize: '.8rem', color: '#64748b', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: '1rem' }}>Chapter Summary</div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr>
                <th style={th()}>Chapter</th>
                <th style={{ ...th(), textAlign: 'right' }}>Items</th>
                <th style={{ ...th(), textAlign: 'right' }}>Total Budget (€)</th>
                <th style={{ ...th(), textAlign: 'right' }}>% of Total</th>
              </tr></thead>
              <tbody>
                {chapterSummary.map(ch => (
                  <tr key={ch.id} style={{ cursor: 'pointer' }} onClick={() => setChapterFilter(chapterFilter === ch.id ? 'all' : ch.id)}>
                    <td style={{ ...td(), fontWeight: 500 }}>{chapterFilter === ch.id && <span style={{ color: '#2563eb', marginRight: '.4rem' }}>▶</span>}{ch.id !== '__none__' ? `${ch.id} – ` : ''}{ch.name}</td>
                    <td style={td(true, true)}>{ch.count}</td>
                    <td style={{ ...td(true), fontWeight: 500 }}>{fmt(ch.total)}</td>
                    <td style={td(true, true)}>{grandTotal > 0 ? `${((ch.total / grandTotal) * 100).toFixed(1)}%` : '—'}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot><tr style={{ background: '#f8fafc' }}>
                <td style={{ ...td(), fontWeight: 700, borderTop: '2px solid #e2e8f0' }}>TOTAL</td>
                <td style={{ ...td(true, true), borderTop: '2px solid #e2e8f0' }}>{chapterSummary.reduce((s, c) => s + c.count, 0)}</td>
                <td style={{ ...td(true), fontWeight: 700, color: '#0f172a', borderTop: '2px solid #e2e8f0' }}>{fmt(grandTotal)}</td>
                <td style={{ ...td(true, true), borderTop: '2px solid #e2e8f0' }}>100%</td>
              </tr></tfoot>
            </table>
          </div>
          <p style={{ margin: '.75rem 0 0', fontSize: '.78rem', color: '#94a3b8' }}>Click a chapter row to filter below (includes all sub-chapters).</p>
        </div>
      )}

      <div style={card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
          <div style={{ fontWeight: 600, fontSize: '.8rem', color: '#64748b', textTransform: 'uppercase', letterSpacing: '.05em' }}>BOQ Line Items</div>
          <div style={{ fontSize: '.8rem', color: '#94a3b8' }}>{filtered.length} of {items.length} items</div>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '760px' }}>
            <thead><tr>
              <th style={th(true)} onClick={() => toggleSort('chapter')}>Chapter{arrow('chapter')}</th>
              <th style={th()}>Code</th>
              <th style={th(true)} onClick={() => toggleSort('description')}>Description{arrow('description')}</th>
              <th style={th()}>Unit</th>
              <th style={{ ...th(), textAlign: 'right' }}>Qty</th>
              <th style={{ ...th(true), textAlign: 'right' }} onClick={() => toggleSort('unit_price')}>Unit Price{arrow('unit_price')}</th>
              <th style={{ ...th(true), textAlign: 'right' }} onClick={() => toggleSort('effective_total')}>Total (€){arrow('effective_total')}</th>
            </tr></thead>
            <tbody>
              {filtered.length === 0
                ? <tr><td colSpan={7} style={{ padding: '3rem', textAlign: 'center', color: '#94a3b8' }}>No items match the current filters.</td></tr>
                : filtered.map(item => {
                    const total = effectiveTotal(item)
                    return (
                      <tr key={item.id} onMouseEnter={e => (e.currentTarget.style.background = '#f8fafc')} onMouseLeave={e => (e.currentTarget.style.background = 'white')}>
                        <td style={{ ...td(), color: '#64748b', fontSize: '.78rem', whiteSpace: 'nowrap' }}>
                          {item.chapter_id && <span style={{ background: '#eff6ff', color: '#1d4ed8', padding: '.15rem .45rem', borderRadius: '4px', fontWeight: 600 }}>{item.chapter_id}</span>}
                        </td>
                        <td style={{ ...td(), color: '#64748b', fontSize: '.78rem', whiteSpace: 'nowrap' }}>{item.item_code ?? '—'}</td>
                        <td style={td()}>{item.description}</td>
                        <td style={td(false, true)}>{item.unit ?? '—'}</td>
                        <td style={td(true, true)}>{item.quantity != null ? item.quantity.toLocaleString('es-ES') : '—'}</td>
                        <td style={td(true)}>{fmt(item.unit_price)}</td>
                        <td style={{ ...td(true), fontWeight: total ? 500 : 400 }}>{fmt(total || null)}</td>
                      </tr>
                    )
                  })
              }
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
