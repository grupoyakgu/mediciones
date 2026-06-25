'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
import { useParams } from 'next/navigation'
import * as XLSX from 'xlsx'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
  PieChart, Pie, Legend,
} from 'recharts'

// ─── Types ───────────────────────────────────────────────────────────────────

interface RawItem {
  item_code: string
  chapter_id: string
  chapter_name: string
  description: string
  unit: string
  quantity: number | null
  unit_price: number | null
  total_amount: number | null
}

type MatchLabel = 'High' | 'Medium' | 'Low'

interface MatchedItem extends RawItem {
  refCode: string
  refDescription: string
  matchScore: number
  matchLabel: MatchLabel
  matchedUnitPrice: number | null
  manualUnitPrice: string
  effectiveUnitPrice: number | null
  effectiveTotal: number | null
}

interface Chapter {
  id: string
  name: string
  items: MatchedItem[]
  subtotal: number
  avgMatchScore: number
}

interface Project { id: string; name: string }

interface ExcludeEntry { id: string; item_code?: string; description?: string }

type Step = 'upload' | 'source' | 'matching' | 'results'
type SourceType = 'project' | 'file'
type FilterMode = 'all' | 'high' | 'medium' | 'low' | 'priced' | 'unpriced' | 'price-range'

// ─── BOQ Parser ───────────────────────────────────────────────────────────────

function toNum(v: unknown): number | null {
  if (v == null || v === '') return null
  const n = Number(v)
  return isNaN(n) ? null : n
}

function parseBoqBuffer(buffer: ArrayBuffer): RawItem[] {
  const wb = XLSX.read(buffer, { type: 'array' })
  const sheet = wb.Sheets[wb.SheetNames[0]]
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true })
  const chapterNames = new Map<string, string>()
  const items: RawItem[] = []
  for (const row of rows) {
    if (!Array.isArray(row)) continue
    const code = String(row[0] ?? '').trim()
    const nat  = String(row[1] ?? '').trim()
    const unit = String(row[2] ?? '').trim()
    const desc = String(row[3] ?? '').trim()
    if (!code || !nat) continue
    if (nat === 'Capítulo' || nat === 'Capitulo') {
      chapterNames.set(code, desc)
    } else if (nat === 'Partida') {
      const topChapter = code.split('.')[0]
      items.push({
        item_code: code, chapter_id: topChapter,
        chapter_name: chapterNames.get(topChapter) ?? '',
        description: desc, unit,
        quantity: toNum(row[4]), unit_price: toNum(row[5]), total_amount: toNum(row[6]),
      })
    }
  }
  return items
}

// ─── Matching Logic ───────────────────────────────────────────────────────────

function normalize(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim()
}

function tokenSet(s: string): Set<string> {
  return new Set(normalize(s).split(' ').filter(Boolean))
}

function jaccardSimilarity(a: string, b: string): number {
  const ta = tokenSet(a)
  const tb = tokenSet(b)
  if (ta.size === 0 && tb.size === 0) return 0
  let inter = 0
  ta.forEach(t => { if (tb.has(t)) inter++ })
  const union = ta.size + tb.size - inter
  return union === 0 ? 0 : inter / union
}

function scoreItems(a: RawItem, b: RawItem): number {
  if (normalize(a.item_code) === normalize(b.item_code)) return 100
  const raw = jaccardSimilarity(a.description, b.description) * 0.8
           + jaccardSimilarity(a.item_code, b.item_code) * 0.2
  return Math.round(raw * 100)
}

function matchLabel(score: number): MatchLabel {
  if (score >= 81) return 'High'
  if (score >= 51) return 'Medium'
  return 'Low'
}

function isExcluded(item: RawItem, excludes: ExcludeEntry[]): boolean {
  for (const ex of excludes) {
    if (ex.item_code && normalize(item.item_code) === normalize(ex.item_code)) return true
    if (ex.description && normalize(item.description).includes(normalize(ex.description))) return true
  }
  return false
}

function matchItems(newItems: RawItem[], refItems: RawItem[], excludes: ExcludeEntry[]): {
  matched: MatchedItem[]
  excluded: RawItem[]
} {
  const matched: MatchedItem[] = []
  const excluded: RawItem[] = []

  for (const item of newItems) {
    if (isExcluded(item, excludes)) {
      excluded.push(item)
      continue
    }
    let bestScore = 0
    let bestRef: RawItem | null = null
    for (const ref of refItems) {
      const s = scoreItems(item, ref)
      if (s > bestScore) { bestScore = s; bestRef = ref }
    }
    const matchedPrice = bestScore > 50 ? (bestRef?.unit_price ?? null) : null
    const effectiveUnitPrice = matchedPrice
    const effectiveTotal =
      effectiveUnitPrice != null && item.quantity != null
        ? effectiveUnitPrice * item.quantity : null
    matched.push({
      ...item,
      refCode: bestRef?.item_code ?? '',
      refDescription: bestRef?.description ?? '',
      matchScore: bestScore,
      matchLabel: matchLabel(bestScore),
      matchedUnitPrice: matchedPrice,
      manualUnitPrice: '',
      effectiveUnitPrice,
      effectiveTotal,
    })
  }
  return { matched, excluded }
}

function groupByChapter(items: MatchedItem[]): Chapter[] {
  const map = new Map<string, MatchedItem[]>()
  for (const item of items) {
    if (!map.has(item.chapter_id)) map.set(item.chapter_id, [])
    map.get(item.chapter_id)!.push(item)
  }
  return Array.from(map.entries())
    .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))
    .map(([id, chItems]) => ({
      id,
      name: chItems[0].chapter_name || id,
      items: chItems,
      subtotal: chItems.reduce((s, i) => s + (i.effectiveTotal ?? 0), 0),
      avgMatchScore: chItems.length
        ? Math.round(chItems.reduce((s, i) => s + i.matchScore, 0) / chItems.length)
        : 0,
    }))
}

// ─── Colours ──────────────────────────────────────────────────────────────────

const MATCH_COLORS: Record<MatchLabel, string> = {
  'High':   '#16a34a',
  'Medium': '#ca8a04',
  'Low':    '#dc2626',
}

const MATCH_EMOJI: Record<MatchLabel, string> = {
  'High': '✅', 'Medium': '🟡', 'Low': '🔴',
}

const CHART_PALETTE = [
  '#2563eb','#7c3aed','#0891b2','#059669','#d97706',
  '#dc2626','#db2777','#65a30d','#0284c7','#9333ea',
  '#16a34a','#b45309','#0e7490','#6d28d9','#be123c',
]

// ─── Excel Export ─────────────────────────────────────────────────────────────

function exportToExcel(chapters: Chapter[]) {
  const rows: unknown[][] = [
    ['Code','Chapter','Description','Unit','Quantity',
     'Unit Price','Total','Match Score','Match Label','Ref Code','Ref Description'],
  ]
  for (const ch of chapters) {
    for (const item of ch.items) {
      rows.push([
        item.item_code, `${item.chapter_id} – ${item.chapter_name}`,
        item.description, item.unit, item.quantity,
        item.effectiveUnitPrice, item.effectiveTotal,
        item.matchScore, item.matchLabel, item.refCode, item.refDescription,
      ])
    }
    rows.push(['', `SUBTOTAL – ${ch.name}`, '', '', '', '', ch.subtotal, '', '', '', ''])
    rows.push([])
  }
  const ws = XLSX.utils.aoa_to_sheet(rows)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Priced BOQ')
  XLSX.writeFile(wb, 'priced-boq.xlsx')
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function PricingPage() {
  const params = useParams()
  const pricingId = params.pricingId as string

  const [step, setStep] = useState<Step>('upload')
  const [sourceType, setSourceType] = useState<SourceType>('project')

  const [unpricedFile, setUnpricedFile] = useState<File | null>(null)
  const [unpricedItems, setUnpricedItems] = useState<RawItem[]>([])

  const [projects, setProjects] = useState<Project[]>([])
  const [selectedProjectId, setSelectedProjectId] = useState<string>('')
  const [projectsLoaded, setProjectsLoaded] = useState(false)

  const [refFile, setRefFile] = useState<File | null>(null)

  const [chapters, setChapters] = useState<Chapter[]>([])
  const [expandedChapters, setExpandedChapters] = useState<Set<string>>(new Set())
  const [excludedCount, setExcludedCount] = useState(0)

  const [searchQuery, setSearchQuery] = useState('')
  const [filterMode, setFilterMode] = useState<FilterMode>('all')
  const [priceMin, setPriceMin] = useState('')
  const [priceMax, setPriceMax] = useState('')

  const unpricedInputRef = useRef<HTMLInputElement>(null)
  const refInputRef = useRef<HTMLInputElement>(null)
  const chapterRefs = useRef<Record<string, HTMLDivElement | null>>({})

  // On mount, check if this pricing project already has saved results
  useEffect(() => {
    fetch(`/api/pricing-projects/${pricingId}`)
      .then(r => r.json())
      .then(d => {
        if (d.project?.results && Array.isArray(d.project.results) && d.project.results.length > 0) {
          setChapters(d.project.results as Chapter[])
          setExpandedChapters(new Set((d.project.results as Chapter[]).map((c: Chapter) => c.id)))
          if (d.project.unpriced_file_name) {
            // Create a minimal fake file reference for the header display
            setUnpricedFile(new File([], d.project.unpriced_file_name))
          }
          setStep('results')
        }
      })
      .catch(() => { /* ignore, stay on upload step */ })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pricingId])

  const scrollToChapter = useCallback((chapterId: string) => {
    const el = chapterRefs.current[chapterId]
    if (!el) return
    setExpandedChapters(prev => {
      if (prev.has(chapterId)) return prev
      const next = new Set(prev)
      next.add(chapterId)
      return next
    })
    setTimeout(() => {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }, 80)
  }, [])

  async function handleUnpricedFile(file: File) {
    setUnpricedFile(file)
    if (file.name.toLowerCase().endsWith('.pdf')) {
      const fd = new FormData()
      fd.append('file', file)
      const res = await fetch('/api/boq/parse', { method: 'POST', body: fd })
      const data = await res.json()
      setUnpricedItems(data.items ?? [])
    } else {
      const buf = await file.arrayBuffer()
      setUnpricedItems(parseBoqBuffer(buf))
    }
  }

  async function proceedToSource() {
    if (!projectsLoaded) {
      const res = await fetch('/api/projects')
      const data = await res.json()
      setProjects(data.projects ?? [])
      setProjectsLoaded(true)
    }
    setStep('source')
  }

  async function runMatching() {
    setStep('matching')
    let refItems: RawItem[] = []

    if (sourceType === 'project' && selectedProjectId) {
      const res = await fetch(`/api/projects/${selectedProjectId}/boq`)
      const data = await res.json()
      refItems = (data.items ?? []) as RawItem[]
    } else if (sourceType === 'file' && refFile) {
      const buf = await refFile.arrayBuffer()
      refItems = parseBoqBuffer(buf)
    }

    if (refItems.length === 0) {
      alert('No reference items found. Please check your selection.')
      setStep('source')
      return
    }

    const excludesRes = await fetch(`/api/pricing-projects/${pricingId}/excludes`)
    const excludesData = await excludesRes.json()
    const excludes: ExcludeEntry[] = excludesData.excludes ?? []

    const { matched, excluded } = matchItems(unpricedItems, refItems, excludes)

    if (excluded.length > 0) {
      await fetch(`/api/pricing-projects/${pricingId}/alerts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(excluded.map(e => ({ item_code: e.item_code, description: e.description }))),
      })
    }

    setExcludedCount(excluded.length)
    const grouped = groupByChapter(matched)
    setChapters(grouped)
    setExpandedChapters(new Set(grouped.map(c => c.id)))
    setStep('results')

    // Persist results to DB so they reload on next visit
    fetch(`/api/pricing-projects/${pricingId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ results: grouped, unpriced_file_name: unpricedFile?.name ?? null }),
    }).catch(() => { /* non-critical */ })
  }

  const updateManualPrice = useCallback((chIdx: number, itemIdx: number, val: string) => {
    setChapters(prev => prev.map((ch, ci) => {
      if (ci !== chIdx) return ch
      const items = ch.items.map((item, ii) => {
        if (ii !== itemIdx) return item
        const parsed = parseFloat(val)
        const effectiveUnitPrice = !isNaN(parsed) && val.trim() !== '' ? parsed : item.matchedUnitPrice
        const effectiveTotal =
          effectiveUnitPrice != null && item.quantity != null
            ? effectiveUnitPrice * item.quantity : null
        return { ...item, manualUnitPrice: val, effectiveUnitPrice, effectiveTotal }
      })
      return { ...ch, items, subtotal: items.reduce((s, i) => s + (i.effectiveTotal ?? 0), 0) }
    }))
  }, [])

  const toggleChapter = (id: string) =>
    setExpandedChapters(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })

  const totalCost = chapters.reduce((s, c) => s + c.subtotal, 0)
  const allItems = chapters.flatMap(c => c.items)
  const pricedCount = allItems.filter(i => i.effectiveUnitPrice != null).length
  const unpricedCount = allItems.length - pricedCount
  const overallScore = allItems.length
    ? Math.round(allItems.reduce((s, i) => s + i.matchScore, 0) / allItems.length) : 0

  const matchDist = (
    [['High', '#16a34a'], ['Medium', '#ca8a04'], ['Low', '#dc2626']] as [MatchLabel, string][]
  ).map(([label, color]) => ({
    name: label, color,
    value: allItems.filter(i => i.matchLabel === label).length,
  }))

  const chapterBarData = chapters.map((c, i) => ({
    name: c.id, fullName: c.name,
    cost: Math.round(c.subtotal),
    color: CHART_PALETTE[i % CHART_PALETTE.length],
  }))

  const fmt = (n: number) =>
    new Intl.NumberFormat('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)

  function itemMatchesFilter(item: MatchedItem): boolean {
    const q = searchQuery.toLowerCase()
    if (q) {
      const haystack = `${item.description} ${item.item_code} ${item.chapter_id} ${item.chapter_name}`.toLowerCase()
      if (!haystack.includes(q)) return false
    }
    switch (filterMode) {
      case 'high':    return item.matchScore >= 81
      case 'medium':  return item.matchScore >= 51 && item.matchScore <= 80
      case 'low':     return item.matchScore <= 50
      case 'priced':  return item.effectiveUnitPrice != null
      case 'unpriced':return item.effectiveUnitPrice == null
      case 'price-range': {
        const price = item.effectiveUnitPrice ?? 0
        const min = parseFloat(priceMin)
        const max = parseFloat(priceMax)
        if (!isNaN(min) && price < min) return false
        if (!isNaN(max) && price > max) return false
        return true
      }
      default: return true
    }
  }

  if (step === 'upload') return (
    <div className="max-w-2xl mx-auto py-10 px-4">
      <h1 className="text-2xl font-bold text-gray-900 mb-1">Project Pricing</h1>
      <p className="text-sm text-gray-500 mb-8">
        Upload an unpriced BOQ and get unit prices matched from a reference source.
      </p>
      <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-5">
        <div>
          <p className="text-sm font-medium text-gray-700 mb-2">Step 1 — Upload unpriced BOQ file</p>
          <input ref={unpricedInputRef} type="file" accept=".xlsx,.xls,.pdf" className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) handleUnpricedFile(f); e.target.value = '' }} />
          {unpricedFile ? (
            <div className="flex items-center gap-3 bg-green-50 border border-green-200 rounded-lg px-4 py-3">
              <span className="text-green-600 text-lg">✓</span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-green-800 truncate">{unpricedFile.name}</p>
                <p className="text-xs text-green-600">{unpricedItems.length} line items parsed</p>
              </div>
              <button onClick={() => { setUnpricedFile(null); setUnpricedItems([]) }}
                className="text-green-400 hover:text-green-700 text-sm">✕</button>
            </div>
          ) : (
            <button onClick={() => unpricedInputRef.current?.click()}
              className="w-full border-2 border-dashed border-gray-300 rounded-lg p-8 text-center hover:border-blue-400 hover:bg-blue-50 transition-colors">
              <p className="text-gray-500 text-sm">Click to select a BOQ file (.xlsx, .xls, or .pdf)</p>
              <p className="text-gray-400 text-xs mt-1">Must follow the standard format (Column B = Capítulo / Partida)</p>
            </button>
          )}
        </div>
        <button disabled={!unpricedFile || unpricedItems.length === 0} onClick={proceedToSource}
          className="w-full py-2.5 bg-blue-600 text-white rounded-lg text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed hover:bg-blue-700 transition-colors">
          Continue →
        </button>
      </div>
    </div>
  )

  if (step === 'source') return (
    <div className="max-w-2xl mx-auto py-10 px-4">
      <button onClick={() => setStep('upload')} className="text-sm text-blue-600 hover:underline mb-6 block">← Back</button>
      <h1 className="text-2xl font-bold text-gray-900 mb-1">Project Pricing</h1>
      <p className="text-sm text-gray-500 mb-8">
        <strong>{unpricedItems.length} items</strong> from <em>{unpricedFile?.name}</em>. Choose a pricing reference source.
      </p>
      <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-6">
        <div className="grid grid-cols-2 gap-3">
          {(['project', 'file'] as SourceType[]).map(type => (
            <button key={type} onClick={() => setSourceType(type)}
              className={`p-4 rounded-lg border-2 text-left transition-colors ${sourceType === type ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:border-gray-300'}`}>
              <p className="text-sm font-semibold text-gray-800 mb-0.5">
                {type === 'project' ? '📁 Existing Project BOQ' : '📄 Upload Reference File'}
              </p>
              <p className="text-xs text-gray-500">
                {type === 'project' ? 'Use prices from a priced BOQ already in the system' : 'Upload a priced BOQ Excel file as reference'}
              </p>
            </button>
          ))}
        </div>

        {sourceType === 'project' && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Select project</label>
            {projects.length === 0 ? (
              <p className="text-sm text-gray-400 italic">No projects found.</p>
            ) : (
              <select value={selectedProjectId} onChange={e => setSelectedProjectId(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                <option value="">— Choose a project —</option>
                {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            )}
          </div>
        )}

        {sourceType === 'file' && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Reference BOQ file (priced)</label>
            <input ref={refInputRef} type="file" accept=".xlsx,.xls" className="hidden"
              onChange={e => { const f = e.target.files?.[0]; if (f) setRefFile(f); e.target.value = '' }} />
            {refFile ? (
              <div className="flex items-center gap-3 bg-green-50 border border-green-200 rounded-lg px-4 py-3">
                <span className="text-green-600">✓</span>
                <span className="text-sm font-medium text-green-800 truncate flex-1">{refFile.name}</span>
                <button onClick={() => setRefFile(null)} className="text-green-400 hover:text-green-700 text-sm">✕</button>
              </div>
            ) : (
              <button onClick={() => refInputRef.current?.click()}
                className="w-full border-2 border-dashed border-gray-300 rounded-lg p-6 text-center hover:border-blue-400 hover:bg-blue-50 transition-colors">
                <p className="text-gray-500 text-sm">Click to select reference BOQ (.xlsx / .xls)</p>
              </button>
            )}
          </div>
        )}

        <button
          disabled={(sourceType === 'project' && !selectedProjectId) || (sourceType === 'file' && !refFile)}
          onClick={runMatching}
          className="w-full py-2.5 bg-blue-600 text-white rounded-lg text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed hover:bg-blue-700 transition-colors">
          Run Pricing Match →
        </button>
      </div>
    </div>
  )

  if (step === 'matching') return (
    <div className="flex items-center justify-center h-64">
      <div className="text-center">
        <div className="w-10 h-10 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
        <p className="text-sm text-gray-600">Matching {unpricedItems.length} items…</p>
      </div>
    </div>
  )

  return (
    <div className="max-w-[1200px] mx-auto py-8 px-4 space-y-8">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Pricing Results</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {unpricedFile?.name} · {allItems.length} items · review and fill missing prices
            {excludedCount > 0 && <span className="ml-2 text-orange-600">· {excludedCount} excluded</span>}
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setStep('source')}
            className="px-4 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors">
            ← Change Source
          </button>
          <button onClick={() => exportToExcel(chapters)}
            className="px-4 py-2 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors font-medium">
            ⬇ Export Excel
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard label="Total Items" value={allItems.length.toString()} />
        <KpiCard label="Priced Items"
          value={`${pricedCount} (${allItems.length ? Math.round(pricedCount / allItems.length * 100) : 0}%)`}
          color="green" />
        <KpiCard label="Unpriced Items"
          value={`${unpricedCount} (${allItems.length ? Math.round(unpricedCount / allItems.length * 100) : 0}%)`}
          color={unpricedCount > 0 ? 'red' : 'green'} />
        <KpiCard label="Overall Match Score" value={`${overallScore}%`}
          color={overallScore >= 81 ? 'green' : overallScore >= 51 ? 'yellow' : 'red'} />
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <p className="text-xs text-gray-400 uppercase tracking-wider mb-1">Total Estimated Project Cost</p>
        <p className="text-3xl font-bold text-gray-900">€{fmt(totalCost)}</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <p className="text-sm font-semibold text-gray-700 mb-4">Match Quality Distribution</p>
          <ResponsiveContainer width="100%" height={220}>
            <PieChart>
              <Pie data={matchDist} cx="50%" cy="50%" innerRadius={55} outerRadius={85} paddingAngle={3} dataKey="value">
                {matchDist.map((entry, i) => <Cell key={i} fill={entry.color} />)}
              </Pie>
              <Tooltip formatter={(v: number) => [`${v} items`]} />
              <Legend formatter={(value, entry) => (
                <span style={{ color: '#374151', fontSize: 12 }}>
                  {value}: {(entry.payload as { value: number }).value}
                </span>
              )} />
            </PieChart>
          </ResponsiveContainer>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <p className="text-sm font-semibold text-gray-700 mb-1">Cost per Chapter</p>
          <p className="text-xs text-gray-400 mb-3">Click a bar to jump to that chapter below</p>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart
              data={chapterBarData}
              margin={{ top: 0, right: 0, left: 0, bottom: 0 }}
              onClick={data => {
                if (data?.activePayload?.[0]) {
                  const chId = (data.activePayload[0].payload as { name: string }).name
                  scrollToChapter(chId)
                }
              }}
              style={{ cursor: 'pointer' }}
            >
              <XAxis dataKey="name" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} tickFormatter={v => `€${(v / 1000).toFixed(0)}k`} />
              <Tooltip formatter={(v: number, _n, props) => [`€${fmt(v)}`, props.payload?.fullName || '']} />
              <Bar dataKey="cost" radius={[4, 4, 0, 0]}>
                {chapterBarData.map((entry, i) => <Cell key={i} fill={entry.color} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <h2 className="text-lg font-semibold text-gray-900">BOQ Detail</h2>
          <button onClick={() => exportToExcel(chapters)}
            className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors font-medium text-sm">
            ⬇ Export to Excel
          </button>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">🔍</span>
            <input
              type="text"
              placeholder="Search by description, item code, or chapter…"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-4 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            {searchQuery && (
              <button onClick={() => setSearchQuery('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-sm">✕</button>
            )}
          </div>

          <div className="flex flex-wrap gap-2 items-center">
            <span className="text-xs text-gray-500 font-medium">Filter:</span>
            {(
              [
                ['all',        'Show All'],
                ['high',       '✅ High (81–100%)'],
                ['medium',     '🟡 Medium (51–80%)'],
                ['low',        '🔴 Low (0–50%)'],
                ['priced',     'Priced Only'],
                ['unpriced',   'Unpriced Only'],
                ['price-range','Price Range'],
              ] as [FilterMode, string][]
            ).map(([mode, label]) => (
              <button
                key={mode}
                onClick={() => setFilterMode(mode)}
                className={`px-3 py-1 text-xs rounded-full border transition-colors ${
                  filterMode === mode
                    ? 'bg-blue-600 text-white border-blue-600'
                    : 'bg-white text-gray-600 border-gray-300 hover:border-blue-400'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {filterMode === 'price-range' && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-500">Price:</span>
              <input type="number" placeholder="Min" value={priceMin} onChange={e => setPriceMin(e.target.value)}
                className="w-24 text-sm border border-gray-300 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-400" />
              <span className="text-xs text-gray-400">—</span>
              <input type="number" placeholder="Max" value={priceMax} onChange={e => setPriceMax(e.target.value)}
                className="w-24 text-sm border border-gray-300 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-400" />
            </div>
          )}
        </div>

        {chapters.map((ch, chIdx) => {
          const filteredItems = ch.items.filter(itemMatchesFilter)
          const isFiltering = searchQuery.trim() !== '' || filterMode !== 'all'
          if (isFiltering && filteredItems.length === 0) return null

          const isOpen = expandedChapters.has(ch.id)
          const pctOfTotal = totalCost > 0 ? (ch.subtotal / totalCost * 100) : 0
          const scoreColor = ch.avgMatchScore >= 81 ? '#16a34a' : ch.avgMatchScore >= 51 ? '#ca8a04' : '#dc2626'
          const displayItems = isFiltering ? filteredItems : ch.items

          return (
            <div
              key={ch.id}
              ref={el => { chapterRefs.current[ch.id] = el }}
              className="bg-white rounded-xl border border-gray-200 overflow-hidden scroll-mt-4"
            >
              <button
                className="w-full flex items-center justify-between px-5 py-4 hover:bg-gray-50 transition-colors text-left"
                onClick={() => toggleChapter(ch.id)}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <span className="text-gray-400 text-sm w-4">{isOpen ? '▾' : '▸'}</span>
                  <span className="font-semibold text-gray-900 text-sm">{ch.id} – {ch.name}</span>
                  <span className="text-xs px-2 py-0.5 rounded-full font-medium"
                    style={{ background: `${scoreColor}20`, color: scoreColor }}>
                    {ch.avgMatchScore}% match
                  </span>
                  {isFiltering && (
                    <span className="text-xs text-gray-400">({filteredItems.length} shown)</span>
                  )}
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
                        <th className="px-4 py-2 text-left font-medium text-gray-500">Description</th>
                        <th className="px-4 py-2 text-right font-medium text-gray-500 w-16">Unit</th>
                        <th className="px-4 py-2 text-right font-medium text-gray-500 w-20">Qty</th>
                        <th className="px-4 py-2 text-right font-medium text-gray-500 w-28">Unit Price</th>
                        <th className="px-4 py-2 text-right font-medium text-gray-500 w-28">Total</th>
                        <th className="px-4 py-2 text-center font-medium text-gray-500 w-28">Match</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {displayItems.map((item) => {
                        const realIdx = ch.items.indexOf(item)
                        const labelColor = MATCH_COLORS[item.matchLabel]
                        const needsPrice = item.effectiveUnitPrice == null

                        return (
                          <tr key={item.item_code}
                            className={needsPrice ? 'bg-red-50/40' : 'hover:bg-gray-50/60'}>
                            <td className="px-4 py-2 text-gray-500 font-mono">{item.item_code}</td>
                            <td className="px-4 py-2 text-gray-800 max-w-xs">
                              <div className="truncate" title={item.description}>{item.description}</div>
                              {item.refDescription && item.refDescription !== item.description && (
                                <div className="text-gray-400 truncate text-[10px] mt-0.5" title={item.refDescription}>
                                  ↳ {item.refDescription}
                                </div>
                              )}
                            </td>
                            <td className="px-4 py-2 text-right text-gray-600">{item.unit}</td>
                            <td className="px-4 py-2 text-right text-gray-700">
                              {item.quantity?.toLocaleString('es-ES') ?? '—'}
                            </td>
                            <td className="px-4 py-2 text-right">
                              <input
                                type="number" min="0" step="0.01"
                                placeholder={item.matchedUnitPrice != null ? fmt(item.matchedUnitPrice) : 'Enter price'}
                                value={item.manualUnitPrice}
                                onChange={e => updateManualPrice(chIdx, realIdx, e.target.value)}
                                className={`w-full text-right border rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400 ${
                                  needsPrice
                                    ? 'border-red-300 bg-red-50 placeholder-red-300'
                                    : 'border-gray-200 bg-white placeholder-gray-300'
                                }`}
                              />
                            </td>
                            <td className="px-4 py-2 text-right text-gray-700 font-medium">
                              {item.effectiveTotal != null ? `€${fmt(item.effectiveTotal)}` : '—'}
                            </td>
                            <td className="px-4 py-2 text-center">
                              <div className="flex flex-col items-center gap-0.5">
                                <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full"
                                  style={{ background: `${labelColor}1a`, color: labelColor }}>
                                  {item.matchScore}%
                                </span>
                                <span className="text-[9px] text-gray-400">{MATCH_EMOJI[item.matchLabel]}</span>
                              </div>
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
                        <td className="px-4 py-2 text-center text-xs text-gray-500">
                          {pctOfTotal.toFixed(1)}%
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
    </div>
  )
}

function KpiCard({ label, value, color = 'default' }: {
  label: string; value: string; color?: 'green' | 'red' | 'yellow' | 'default'
}) {
  const textColor = { green: 'text-green-700', red: 'text-red-600', yellow: 'text-yellow-600', default: 'text-gray-900' }[color]
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <p className="text-xs text-gray-400 font-medium uppercase tracking-wider mb-2">{label}</p>
      <p className={`text-xl font-bold ${textColor}`}>{value}</p>
    </div>
  )
}
