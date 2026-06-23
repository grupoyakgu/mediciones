'use client'

import { useEffect, useState, useMemo } from 'react'

interface BoqItem {
  id: string
  chapter_id: string
  chapter_name: string
  item_code: string
  description: string
  unit: string
  quantity: number | null
  unit_price: number | null
  total_amount: number | null
}

function effectiveTotal(item: BoqItem): number {
  if (item.total_amount != null) return item.total_amount
  return (item.quantity ?? 0) * (item.unit_price ?? 0)
}

function topLevel(chapterId: string): string {
  return chapterId.split('.')[0]
}

function fmt(n: number) {
  return n.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

type SortKey = 'chapter_id' | 'description' | 'unit_price' | 'total'

export default function BoqTable({ projectId }: { projectId: string }) {
  const [items, setItems] = useState<BoqItem[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [chapterFilter, setChapterFilter] = useState('')
  const [minPrice, setMinPrice] = useState('')
  const [maxPrice, setMaxPrice] = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('chapter_id')
  const [sortAsc, setSortAsc] = useState(true)
  const [showSummary, setShowSummary] = useState(true)

  useEffect(() => {
    fetch(`/api/projects/${projectId}/boq`)
      .then((r) => r.json())
      .then((d) => {
        setItems(d.items ?? [])
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [projectId])

  const topLevelChapters = useMemo(() => {
    const seen = new Map<string, string>()
    for (const item of items) {
      const tl = topLevel(item.chapter_id)
      if (!seen.has(tl)) seen.set(tl, item.chapter_name)
    }
    return Array.from(seen.entries()).sort((a, b) =>
      a[0].localeCompare(b[0], undefined, { numeric: true })
    )
  }, [items])

  const topLevelNames = useMemo(() => {
    const m = new Map<string, string>()
    for (const item of items) {
      const tl = topLevel(item.chapter_id)
      if (!m.has(tl)) m.set(tl, item.chapter_name)
    }
    return m
  }, [items])

  const filtered = useMemo(() => {
    let list = items
    if (search) {
      const q = search.toLowerCase()
      list = list.filter(
        (i) => i.description?.toLowerCase().includes(q) || i.item_code?.toLowerCase().includes(q)
      )
    }
    if (chapterFilter) {
      list = list.filter((i) => topLevel(i.chapter_id) === chapterFilter)
    }
    if (minPrice) {
      const mn = parseFloat(minPrice)
      list = list.filter((i) => effectiveTotal(i) >= mn)
    }
    if (maxPrice) {
      const mx = parseFloat(maxPrice)
      list = list.filter((i) => effectiveTotal(i) <= mx)
    }
    return [...list].sort((a, b) => {
      let av: string | number, bv: string | number
      if (sortKey === 'chapter_id') { av = a.chapter_id; bv = b.chapter_id }
      else if (sortKey === 'description') { av = a.description ?? ''; bv = b.description ?? '' }
      else if (sortKey === 'unit_price') { av = a.unit_price ?? 0; bv = b.unit_price ?? 0 }
      else { av = effectiveTotal(a); bv = effectiveTotal(b) }

      if (typeof av === 'string') {
        const cmp = av.localeCompare(bv as string, undefined, { numeric: true })
        return sortAsc ? cmp : -cmp
      }
      return sortAsc ? (av as number) - (bv as number) : (bv as number) - (av as number)
    })
  }, [items, search, chapterFilter, minPrice, maxPrice, sortKey, sortAsc])

  const chapterSummary = useMemo(() => {
    const m = new Map<string, number>()
    for (const item of filtered) {
      const tl = topLevel(item.chapter_id)
      m.set(tl, (m.get(tl) ?? 0) + effectiveTotal(item))
    }
    return Array.from(m.entries()).sort((a, b) =>
      a[0].localeCompare(b[0], undefined, { numeric: true })
    )
  }, [filtered])

  const grandTotal = chapterSummary.reduce((s, [, v]) => s + v, 0)

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortAsc(!sortAsc)
    else { setSortKey(key); setSortAsc(true) }
  }

  function SortIcon({ k }: { k: SortKey }) {
    if (sortKey !== k) return <span style={{ color: '#d1d5db' }}>⇅</span>
    return <span>{sortAsc ? '↑' : '↓'}</span>
  }

  if (loading) return <p style={{ color: '#9ca3af', padding: '1rem 0' }}>Loading BOQ…</p>
  if (items.length === 0) return <p style={{ color: '#9ca3af', padding: '1rem 0' }}>No BOQ items found. Upload a BOQ file first.</p>

  return (
    <div style={{ marginTop: '2rem' }}>
      <h2 style={{ fontSize: '1.25rem', fontWeight: 700, marginBottom: '1rem' }}>Bill of Quantities</h2>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '1rem' }}>
        <input
          placeholder="Search description / code…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={inputStyle}
        />
        <select
          value={chapterFilter}
          onChange={(e) => setChapterFilter(e.target.value)}
          style={inputStyle}
        >
          <option value="">All chapters</option>
          {topLevelChapters.map(([id, name]) => (
            <option key={id} value={id}>{id} — {name}</option>
          ))}
        </select>
        <input
          placeholder="Min total (€)"
          value={minPrice}
          onChange={(e) => setMinPrice(e.target.value)}
          style={{ ...inputStyle, width: 130 }}
          type="number"
        />
        <input
          placeholder="Max total (€)"
          value={maxPrice}
          onChange={(e) => setMaxPrice(e.target.value)}
          style={{ ...inputStyle, width: 130 }}
          type="number"
        />
        <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.875rem', color: '#374151', cursor: 'pointer' }}>
          <input type="checkbox" checked={showSummary} onChange={(e) => setShowSummary(e.target.checked)} />
          Chapter summary
        </label>
      </div>

      {showSummary && (
        <div style={{ marginBottom: '1.5rem', border: '1px solid #e5e7eb', borderRadius: 8, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
            <thead>
              <tr style={{ background: '#f3f4f6' }}>
                <th style={th}>Chapter</th>
                <th style={th}>Name</th>
                <th style={{ ...th, textAlign: 'right' }}>Total (€)</th>
                <th style={{ ...th, textAlign: 'right' }}>% of budget</th>
              </tr>
            </thead>
            <tbody>
              {chapterSummary.map(([chId, total]) => (
                <tr key={chId} style={{ borderTop: '1px solid #f3f4f6' }}>
                  <td style={td}>{chId}</td>
                  <td style={td}>{topLevelNames.get(chId) ?? ''}</td>
                  <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmt(total)}</td>
                  <td style={{ ...td, textAlign: 'right' }}>{grandTotal > 0 ? ((total / grandTotal) * 100).toFixed(1) : '0.0'}%</td>
                </tr>
              ))}
              <tr style={{ borderTop: '2px solid #d1d5db', fontWeight: 700, background: '#f9fafb' }}>
                <td style={td} colSpan={2}>TOTAL</td>
                <td style={{ ...td, textAlign: 'right' }}>{fmt(grandTotal)}</td>
                <td style={{ ...td, textAlign: 'right' }}>100.0%</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      <p style={{ fontSize: '0.8rem', color: '#6b7280', marginBottom: '0.5rem' }}>{filtered.length} items</p>

      <div style={{ overflowX: 'auto', border: '1px solid #e5e7eb', borderRadius: 8 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
          <thead>
            <tr style={{ background: '#f3f4f6' }}>
              <th style={th} onClick={() => toggleSort('chapter_id')}>
                Chapter <SortIcon k="chapter_id" />
              </th>
              <th style={th}>Code</th>
              <th style={th} onClick={() => toggleSort('description')}>
                Description <SortIcon k="description" />
              </th>
              <th style={th}>Unit</th>
              <th style={{ ...th, textAlign: 'right' }}>Qty</th>
              <th style={{ ...th, textAlign: 'right' }} onClick={() => toggleSort('unit_price')}>
                Unit Price <SortIcon k="unit_price" />
              </th>
              <th style={{ ...th, textAlign: 'right' }} onClick={() => toggleSort('total')}>
                Total <SortIcon k="total" />
              </th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((item) => (
              <tr key={item.id} style={{ borderTop: '1px solid #f3f4f6' }}>
                <td style={td}>{item.chapter_id}</td>
                <td style={td}>{item.item_code}</td>
                <td style={{ ...td, maxWidth: 320 }}>{item.description}</td>
                <td style={td}>{item.unit}</td>
                <td style={{ ...td, textAlign: 'right' }}>{item.quantity != null ? fmt(item.quantity) : '—'}</td>
                <td style={{ ...td, textAlign: 'right' }}>{item.unit_price != null ? fmt(item.unit_price) : '—'}</td>
                <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmt(effectiveTotal(item))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

const inputStyle: React.CSSProperties = {
  padding: '0.4rem 0.6rem',
  border: '1px solid #d1d5db',
  borderRadius: 6,
  fontSize: '0.875rem',
  outline: 'none',
}

const th: React.CSSProperties = {
  padding: '0.5rem 0.75rem',
  fontWeight: 600,
  textAlign: 'left',
  fontSize: '0.8rem',
  color: '#374151',
  cursor: 'pointer',
  userSelect: 'none',
  whiteSpace: 'nowrap',
}

const td: React.CSSProperties = {
  padding: '0.4rem 0.75rem',
  color: '#374151',
  verticalAlign: 'top',
}
