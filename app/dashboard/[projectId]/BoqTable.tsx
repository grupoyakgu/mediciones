'use client'
import { useState, useEffect, useMemo, useCallback } from 'react'

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

type SortField = 'description' | 'unit_price' | 'effective_total'
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
  const [minPrice, setMinPrice] = useState('')
  const [maxPrice, setMaxPrice] = useState('')
  const [sortField, setSortField] = useState<SortField | null>(null)
  const [sortDir, setSortDir] = useState<SortDir>('asc')
  const [expandedChapters, setExpandedChapters] = useState<Set<string>>(new Set())

  const loadBoq = useCallback(() => {
    let cancelled = false
    setLoading(true)
    fetch(`/api/projects/${projectId}/boq`)
      .then(r => r.json())
      .then(({ items: data, error: err }) => {
        if (cancelled) return
        if (err) { setError(err); setLoading(false); return }
        const loaded: BoqItem[] = data ?? []
        setItems(loaded)
        setLoading(false)
        const chapterIds = new Set(loaded.map(i => topLevel(i.chapter_id)).filter(Boolean))
        setExpandedChapters(chapterIds)
      })
      .catch(e => { if (!cancelled) { setError(String(e)); setLoading(false) } })
    return () => { cancelled = true }
  }, [projectId])

  useEffect(() => {
    const cleanup = loadBoq()
    window.addEventListener('boqUpdated', loadBoq)
    return () => {
      cleanup?.()
      window.removeEventListener('boqUpdated', loadBoq)
    }
  }, [loadBoq])

  const chapterMeta = useMemo(() => {
    const map = new Map<string, string>()
    for (const item of items) {
      const tl = topLevel(item.chapter_id)
      if (tl && !map.has(tl)) map.set(tl, item.chapter_name ?? tl)
    }
    return map
  }, [items])

  const chapters = useMemo(() => {
    const q = search.toLowerCase().trim()
    const min = parseFloat(minPrice)
    const max = parseFloat(maxPrice)

    let filtered = items
    if (q) filtered = filtered.filter(r =>
      r.description.toLowerCase().includes(q) ||
      (r.chapter_name ?? '').toLowerCase().includes(q) ||
      (r.item_code ?? '').toLowerCase().includes(q)
    )
    if (!isNaN(min)) filtered = filtered.filter(r => effectiveTotal(r) >= min)
    if (!isNaN(max)) filtered = filtered.filter(r => effectiveTotal(r) <= max)

    if (sortField) {
      filtered = filtered.slice().sort((a, b) => {
        let cmp = 0
        if (sortField === 'description') cmp = a.description.localeCompare(b.description)
        else if (sortField === 'unit_price') cmp = (a.unit_price ?? 0) - (b.unit_price ?? 0)
        else if (sortField === 'effective_total') cmp = effectiveTotal(a) - effectiveTotal(b)
        return sortDir === 'asc' ? cmp : -cmp
      })
    }

    const map = new Map<string, BoqItem[]>()
    for (const item of filtered) {
      const tl = topLevel(item.chapter_id) || '__none__'
      if (!map.has(tl)) map.set(tl, [])
      map.get(tl)!.push(item)
    }

    return Array.from(map.entries())
      .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))
      .map(([id, chItems]) => ({
        id,
        name: chapterMeta.get(id) ?? id,
        items: chItems,
        subtotal: chItems.reduce((s, i) => s + effectiveTotal(i), 0),
      }))
  }, [items, search, minPrice, maxPrice, sortField, sortDir, chapterMeta])

  const grandTotal = chapters.reduce((s, c) => s + c.subtotal, 0)
  const totalItems = chapters.reduce((s, c) => s + c.items.length, 0)

  function toggleChapter(id: string) {
    setExpandedChapters(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  function toggleSort(field: SortField) {
    if (sortField === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortField(field); setSortDir('asc') }
  }
  const arrow = (f: SortField) => sortField === f ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ''

  if (loading) return (
    <div className="bg-white rounded-xl border border-gray-200 p-8 text-center text-sm text-gray-400">
      Loading BOQ…
    </div>
  )
  if (error) return (
    <div className="bg-red-50 border border-red-200 rounded-xl p-6">
      <p className="font-semibold text-red-700 mb-2">Error loading BOQ</p>
      <p className="text-sm font-mono text-red-600 break-all mb-4">{error}</p>
      <button onClick={loadBoq} className="px-4 py-1.5 bg-red-600 text-white rounded-lg text-sm hover:bg-red-700">Retry</button>
    </div>
  )
  if (items.length === 0) return (
    <div className="bg-white rounded-xl border-2 border-dashed border-gray-200 p-12 text-center text-gray-400">
      <div className="text-3xl mb-3">📂</div>
      <p className="text-sm">No BOQ items found. Upload a BOQ file above or go to <a href="settings" className="text-blue-600 font-medium hover:underline">Settings</a>.</p>
    </div>
  )

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Bill of Quantities</h2>
          <p className="text-sm text-gray-500 mt-0.5">{items.length} line items · {chapterMeta.size} chapters</p>
        </div>
      </div>

      {/* Filter bar */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">🔍</span>
          <input
            type="text"
            placeholder="Search by description, item code, or chapter…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-9 pr-4 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          {search && (
            <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-sm">✕</button>
          )}
        </div>
        <div className="flex flex-wrap gap-2 items-center">
          <input
            type="number"
            placeholder="Min (€)"
            value={minPrice}
            onChange={e => setMinPrice(e.target.value)}
            className="w-28 text-sm border border-gray-300 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-400"
          />
          <input
            type="number"
            placeholder="Max (€)"
            value={maxPrice}
            onChange={e => setMaxPrice(e.target.value)}
            className="w-28 text-sm border border-gray-300 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-400"
          />
          <div className="flex gap-2 ml-auto">
            <button
              onClick={() => setExpandedChapters(new Set(chapters.map(c => c.id)))}
              className="px-3 py-1.5 text-xs border border-gray-300 rounded-lg text-blue-600 font-medium hover:bg-blue-50 transition-colors"
            >Expand all</button>
            <button
              onClick={() => setExpandedChapters(new Set())}
              className="px-3 py-1.5 text-xs border border-gray-300 rounded-lg text-gray-500 hover:bg-gray-50 transition-colors"
            >Collapse all</button>
          </div>
        </div>
      </div>

      {/* Chapter sections */}
      <div className="space-y-3">
        {chapters.length === 0 ? (
          <div className="bg-white rounded-xl border border-gray-200 p-8 text-center text-sm text-gray-400">
            No items match the current filters.
          </div>
        ) : chapters.map(ch => {
          const isOpen = expandedChapters.has(ch.id)
          const pctOfTotal = grandTotal > 0 ? (ch.subtotal / grandTotal * 100) : 0

          return (
            <div key={ch.id} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <button
                className="w-full flex items-center justify-between px-5 py-4 hover:bg-gray-50 transition-colors text-left"
                onClick={() => toggleChapter(ch.id)}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <span className="text-gray-400 text-sm w-4 flex-shrink-0">{isOpen ? '▾' : '▸'}</span>
                  <span className="font-semibold text-gray-900 text-sm">
                    {ch.id !== '__none__' ? `${ch.id} – ` : ''}{ch.name}
                  </span>
                  <span className="text-xs text-gray-400 flex-shrink-0">({ch.items.length} items)</span>
                </div>
                <div className="flex items-center gap-6 flex-shrink-0 ml-4">
                  <span className="text-xs text-gray-400">{pctOfTotal.toFixed(1)}% of total</span>
                  <span className="font-semibold text-gray-900 text-sm">€{fmt(ch.subtotal)}</span>
                </div>
              </button>

              {isOpen && (
                <div className="border-t border-gray-100 overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-4 py-2 text-left font-medium text-gray-500 w-24">Code</th>
                        <th
                          onClick={() => toggleSort('description')}
                          className="px-4 py-2 text-left font-medium text-gray-500 cursor-pointer select-none hover:text-gray-700"
                        >Description{arrow('description')}</th>
                        <th className="px-4 py-2 text-right font-medium text-gray-500 w-16">Unit</th>
                        <th className="px-4 py-2 text-right font-medium text-gray-500 w-20">Qty</th>
                        <th
                          onClick={() => toggleSort('unit_price')}
                          className="px-4 py-2 text-right font-medium text-gray-500 w-28 cursor-pointer select-none hover:text-gray-700"
                        >Unit Price{arrow('unit_price')}</th>
                        <th
                          onClick={() => toggleSort('effective_total')}
                          className="px-4 py-2 text-right font-medium text-gray-500 w-28 cursor-pointer select-none hover:text-gray-700"
                        >Total (€){arrow('effective_total')}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {ch.items.map(item => {
                        const total = effectiveTotal(item)
                        return (
                          <tr key={item.id} className="hover:bg-gray-50/60">
                            <td className="px-4 py-2 text-gray-500 font-mono">{item.item_code ?? '—'}</td>
                            <td className="px-4 py-2 text-gray-800 max-w-xs">
                              <div className="truncate" title={item.description}>{item.description}</div>
                            </td>
                            <td className="px-4 py-2 text-right text-gray-600">{item.unit ?? '—'}</td>
                            <td className="px-4 py-2 text-right text-gray-700">
                              {item.quantity != null ? item.quantity.toLocaleString('es-ES') : '—'}
                            </td>
                            <td className="px-4 py-2 text-right text-gray-700">{fmt(item.unit_price)}</td>
                            <td className="px-4 py-2 text-right text-gray-900 font-medium">
                              {total ? `€${fmt(total)}` : '—'}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                    <tfoot>
                      <tr className="bg-gray-50 border-t border-gray-200">
                        <td colSpan={5} className="px-4 py-2 text-right text-xs font-semibold text-gray-700">
                          Chapter Subtotal
                        </td>
                        <td className="px-4 py-2 text-right text-xs font-bold text-gray-900">
                          €{fmt(ch.subtotal)}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Grand total */}
      {chapters.length > 0 && (
        <div className="bg-gray-900 rounded-xl px-6 py-4 flex items-center justify-between">
          <span className="text-gray-400 text-sm">{totalItems} items across {chapters.length} chapters</span>
          <span className="text-white font-bold text-base">Total: €{fmt(grandTotal)}</span>
        </div>
      )}
    </div>
  )
}
