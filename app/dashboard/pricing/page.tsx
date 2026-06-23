'use client'

import { useState, useRef, useCallback } from 'react'
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

type MatchLabel = 'Good Match' | 'Moderate Match' | 'Low Match'

interface MatchedItem extends RawItem {
  refCode: string
  refDescription: string
  matchScore: number
  matchLabel: MatchLabel
  matchedUnitPrice: number | null
  manualUnitPrice: string   // editable string
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

type Step = 'upload' | 'source' | 'matching' | 'results'
type SourceType = 'project' | 'file'

// ─── BOQ Parser (client-side) ────────────────────────────────────────────────

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
        item_code: code,
        chapter_id: topChapter,
        chapter_name: chapterNames.get(topChapter) ?? '',
        description: desc,
        unit,
        quantity: toNum(row[4]),
        unit_price: toNum(row[5]),
        total_amount: toNum(row[6]),
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
  // Exact code match → 100
  if (normalize(a.item_code) === normalize(b.item_code)) return 100

  const descScore = jaccardSimilarity(a.description, b.description)
  const codeScore = jaccardSimilarity(a.item_code, b.item_code)
  // Weight description heavily, code as tiebreaker
  const raw = descScore * 0.8 + codeScore * 0.2
  return Math.round(raw * 100)
}

function matchLabel(score: number): MatchLabel {
  if (score >= 80) return 'Good Match'
  if (score >= 51) return 'Moderate Match'
  return 'Low Match'
}

function matchItems(newItems: RawItem[], refItems: RawItem[]): MatchedItem[] {
  return newItems.map(item => {
    let bestScore = 0
    let bestRef: RawItem | null = null

    for (const ref of refItems) {
      const s = scoreItems(item, ref)
      if (s > bestScore) { bestScore = s; bestRef = ref }
    }

    const matchedPrice = bestScore > 0 ? (bestRef?.unit_price ?? null) : null
    const effectiveUnitPrice = matchedPrice
    const effectiveTotal =
      effectiveUnitPrice != null && item.quantity != null
        ? effectiveUnitPrice * item.quantity
        : null

    return {
      ...item,
      refCode: bestRef?.item_code ?? '',
      refDescription: bestRef?.description ?? '',
      matchScore: bestScore,
      matchLabel: matchLabel(bestScore),
      matchedUnitPrice: matchedPrice,
      manualUnitPrice: '',
      effectiveUnitPrice,
      effectiveTotal,
    }
  })
}

function groupByChapter(items: MatchedItem[]): Chapter[] {
  const map = new Map<string, MatchedItem[]>()
  for (const item of items) {
    const key = item.chapter_id
    if (!map.has(key)) map.set(key, [])
    map.get(key)!.push(item)
  }
  return Array.from(map.entries())
    .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))
    .map(([id, chItems]) => {
      const subtotal = chItems.reduce((s, i) => s + (i.effectiveTotal ?? 0), 0)
      const avgMatchScore = chItems.length
        ? Math.round(chItems.reduce((s, i) => s + i.matchScore, 0) / chItems.length)
        : 0
      return {
        id,
        name: chItems[0].chapter_name || id,
        items: chItems,
        subtotal,
        avgMatchScore,
      }
    })
}

// ─── Colours ──────────────────────────────────────────────────────────────────

const MATCH_COLORS = {
  'Good Match': '#16a34a',
  'Moderate Match': '#ca8a04',
  'Low Match': '#dc2626',
}

const CHART_PALETTE = [
  '#2563eb','#7c3aed','#0891b2','#059669','#d97706',
  '#dc2626','#db2777','#65a30d','#0284c7','#9333ea',
  '#16a34a','#b45309','#0e7490','#6d28d9','#be123c',
]

// ─── Excel Export ─────────────────────────────────────────────────────────────

function exportToExcel(chapters: Chapter[]) {
  const rows: unknown[][] = [
    ['Code', 'Chapter', 'Description', 'Unit', 'Quantity',
     'Unit Price', 'Total', 'Match Score', 'Match Label', 'Ref Code', 'Ref Description'],
  ]

  for (const ch of chapters) {
    for (const item of ch.items) {
      rows.push([
        item.item_code,
        `${item.chapter_id} – ${item.chapter_name}`,
        item.description,
        item.unit,
        item.quantity,
        item.effectiveUnitPrice,
        item.effectiveTotal,
        item.matchScore,
        item.matchLabel,
        item.refCode,
        item.refDescription,
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
  const [step, setStep] = useState<Step>('upload')
  const [sourceType, setSourceType] = useState<SourceType>('project')

  // Unpriced BOQ
  const [unpricedFile, setUnpricedFile] = useState<File | null>(null)
  const [unpricedItems, setUnpricedItems] = useState<RawItem[]>([])

  // Source: existing project
  const [projects, setProjects] = useState<Project[]>([])
  const [selectedProjectId, setSelectedProjectId] = useState<string>('')
  const [projectsLoaded, setProjectsLoaded] = useState(false)

  // Source: uploaded reference BOQ
  const [refFile, setRefFile] = useState<File | null>(null)

  // Results
  const [chapters, setChapters] = useState<Chapter[]>([])
  const [expandedChapters, setExpandedChapters] = useState<Set<string>>(new Set())

  const unpricedInputRef = useRef<HTMLInputElement>(null)
  const refInputRef = useRef<HTMLInputElement>(null)

  // ── Step 1: Upload unpriced BOQ ───────────────────────────────────────────

  async function handleUnpricedFile(file: File) {
    setUnpricedFile(file)
    const buf = await file.arrayBuffer()
    setUnpricedItems(parseBoqBuffer(buf))
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

  // ── Step 2→3: Run matching ────────────────────────────────────────────────

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

    const matched = matchItems(unpricedItems, refItems)
    const grouped = groupByChapter(matched)
    setChapters(grouped)
    setExpandedChapters(new Set(grouped.map(c => c.id)))
    setStep('results')
  }

  // ── Price edit ────────────────────────────────────────────────────────────

  const updateManualPrice = useCallback((chIdx: number, itemIdx: number, val: string) => {
    setChapters(prev => {
      const next = prev.map((ch, ci) => {
        if (ci !== chIdx) return ch
        const items = ch.items.map((item, ii) => {
          if (ii !== itemIdx) return item
          const parsed = parseFloat(val)
          const effectiveUnitPrice = !isNaN(parsed) && val.trim() !== '' ? parsed
            : item.matchedUnitPrice
          const effectiveTotal =
            effectiveUnitPrice != null && item.quantity != null
              ? effectiveUnitPrice * item.quantity : null
          return { ...item, manualUnitPrice: val, effectiveUnitPrice, effectiveTotal }
        })
        const subtotal = items.reduce((s, i) => s + (i.effectiveTotal ?? 0), 0)
        return { ...ch, items, subtotal }
      })
      return next
    })
  }, [])

  const toggleChapter = (id: string) => {
    setExpandedChapters(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  // ─── Render ───────────────────────────────────────────────────────────────

  const totalCost = chapters.reduce((s, c) => s + c.subtotal, 0)
  const allItems = chapters.flatMap(c => c.items)
  const pricedCount = allItems.filter(i => i.effectiveUnitPrice != null).length
  const unpricedCount = allItems.length - pricedCount
  const overallScore = allItems.length
    ? Math.round(allItems.reduce((s, i) => s + i.matchScore, 0) / allItems.length)
    : 0

  const matchDist = [
    { name: 'Good Match', value: allItems.filter(i => i.matchLabel === 'Good Match').length, color: MATCH_COLORS['Good Match'] },
    { name: 'Moderate Match', value: allItems.filter(i => i.matchLabel === 'Moderate Match').length, color: MATCH_COLORS['Moderate Match'] },
    { name: 'Low Match', value: allItems.filter(i => i.matchLabel === 'Low Match').length, color: MATCH_COLORS['Low Match'] },
  ]

  const chapterBarData = chapters.map((c, i) => ({
    name: `${c.id}`,
    fullName: c.name,
    cost: Math.round(c.subtotal),
    color: CHART_PALETTE[i % CHART_PALETTE.length],
  }))

  const fmt = (n: number) =>
    new Intl.NumberFormat('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)

  // ─────────────────────────────────────────────────────────────────────────
  // STEP: Upload
  // ─────────────────────────────────────────────────────────────────────────
  if (step === 'upload') {
    return (
      <div className="max-w-2xl mx-auto py-10 px-4">
        <h1 className="text-2xl font-bold text-gray-900 mb-1">Project Pricing</h1>
        <p className="text-sm text-gray-500 mb-8">
          Upload an unpriced BOQ and get unit prices matched from a reference source.
        </p>

        <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-5">
          <div>
            <p className="text-sm font-medium text-gray-700 mb-2">Step 1 — Upload unpriced BOQ file</p>
            <input
              ref={unpricedInputRef}
              type="file"
              accept=".xlsx,.xls"
              className="hidden"
              onChange={e => { const f = e.target.files?.[0]; if (f) handleUnpricedFile(f); e.target.value = '' }}
            />
            {unpricedFile ? (
              <div className="flex items-center gap-3 bg-green-50 border border-green-200 rounded-lg px-4 py-3">
                <span className="text-green-600 text-lg">✓</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-green-800 truncate">{unpricedFile.name}</p>
                  <p className="text-xs text-green-600">{unpricedItems.length} line items parsed</p>
                </div>
                <button
                  onClick={() => { setUnpricedFile(null); setUnpricedItems([]) }}
                  className="text-green-400 hover:text-green-700 text-sm"
                >✕</button>
              </div>
            ) : (
              <button
                onClick={() => unpricedInputRef.current?.click()}
                className="w-full border-2 border-dashed border-gray-300 rounded-lg p-8 text-center hover:border-blue-400 hover:bg-blue-50 transition-colors"
              >
                <p className="text-gray-500 text-sm">Click to select an Excel BOQ file (.xlsx / .xls)</p>
                <p className="text-gray-400 text-xs mt-1">Must follow the standard format (Column B = Capítulo / Partida)</p>
              </button>
            )}
          </div>

          <button
            disabled={!unpricedFile || unpricedItems.length === 0}
            onClick={proceedToSource}
            className="w-full py-2.5 bg-blue-600 text-white rounded-lg text-sm font-medium
              disabled:opacity-40 disabled:cursor-not-allowed hover:bg-blue-700 transition-colors"
          >
            Continue →
          </button>
        </div>
      </div>
    )
  }

  // ─────────────────────────────────────────────────────────────────────────
  // STEP: Source
  // ─────────────────────────────────────────────────────────────────────────
  if (step === 'source') {
    return (
      <div className="max-w-2xl mx-auto py-10 px-4">
        <button onClick={() => setStep('upload')} className="text-sm text-blue-600 hover:underline mb-6 block">
          ← Back
        </button>
        <h1 className="text-2xl font-bold text-gray-900 mb-1">Project Pricing</h1>
        <p className="text-sm text-gray-500 mb-8">
          <strong>{unpricedItems.length} items</strong> from <em>{unpricedFile?.name}</em>.
          Now choose a pricing reference source.
        </p>

        <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-6">
          {/* Source type toggle */}
          <div className="grid grid-cols-2 gap-3">
            {(['project', 'file'] as SourceType[]).map(type => (
              <button
                key={type}
                onClick={() => setSourceType(type)}
                className={`p-4 rounded-lg border-2 text-left transition-colors ${
                  sourceType === type
                    ? 'border-blue-500 bg-blue-50'
                    : 'border-gray-200 hover:border-gray-300'
                }`}
              >
                <p className="text-sm font-semibold text-gray-800 mb-0.5">
                  {type === 'project' ? '📁 Existing Project BOQ' : '📄 Upload Reference File'}
                </p>
                <p className="text-xs text-gray-500">
                  {type === 'project'
                    ? 'Use prices from a priced BOQ already in the system'
                    : 'Upload a priced BOQ Excel file as reference'}
                </p>
              </button>
            ))}
          </div>

          {/* Source config */}
          {sourceType === 'project' && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Select project
              </label>
              {projects.length === 0 ? (
                <p className="text-sm text-gray-400 italic">No projects found.</p>
              ) : (
                <select
                  value={selectedProjectId}
                  onChange={e => setSelectedProjectId(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">— Choose a project —</option>
                  {projects.map(p => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              )}
            </div>
          )}

          {sourceType === 'file' && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Reference BOQ file (priced)
              </label>
              <input
                ref={refInputRef}
                type="file"
                accept=".xlsx,.xls"
                className="hidden"
                onChange={e => { const f = e.target.files?.[0]; if (f) setRefFile(f); e.target.value = '' }}
              />
              {refFile ? (
                <div className="flex items-center gap-3 bg-green-50 border border-green-200 rounded-lg px-4 py-3">
                  <span className="text-green-600">✓</span>
                  <span className="text-sm font-medium text-green-800 truncate flex-1">{refFile.name}</span>
                  <button onClick={() => setRefFile(null)} className="text-green-400 hover:text-green-700 text-sm">✕</button>
                </div>
              ) : (
                <button
                  onClick={() => refInputRef.current?.click()}
                  className="w-full border-2 border-dashed border-gray-300 rounded-lg p-6 text-center hover:border-blue-400 hover:bg-blue-50 transition-colors"
                >
                  <p className="text-gray-500 text-sm">Click to select reference BOQ (.xlsx / .xls)</p>
                </button>
              )}
            </div>
          )}

          <button
            disabled={
              (sourceType === 'project' && !selectedProjectId) ||
              (sourceType === 'file' && !refFile)
            }
            onClick={runMatching}
            className="w-full py-2.5 bg-blue-600 text-white rounded-lg text-sm font-medium
              disabled:opacity-40 disabled:cursor-not-allowed hover:bg-blue-700 transition-colors"
          >
            Run Pricing Match →
          </button>
        </div>
      </div>
    )
  }

  // ─────────────────────────────────────────────────────────────────────────
  // STEP: Matching (loading)
  // ─────────────────────────────────────────────────────────────────────────
  if (step === 'matching') {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <div className="w-10 h-10 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-sm text-gray-600">Matching {unpricedItems.length} items…</p>
        </div>
      </div>
    )
  }

  // ─────────────────────────────────────────────────────────────────────────
  // STEP: Results
  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div className="max-w-[1200px] mx-auto py-8 px-4 space-y-8">

      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Pricing Results</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {unpricedFile?.name} · {allItems.length} items · review and fill missing prices
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setStep('source')}
            className="px-4 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
          >
            ← Change Source
          </button>
          <button
            onClick={() => exportToExcel(chapters)}
            className="px-4 py-2 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors font-medium"
          >
            ⬇ Export Excel
          </button>
        </div>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard label="Total Items" value={allItems.length.toString()} />
        <KpiCard
          label="Priced Items"
          value={`${pricedCount} (${allItems.length ? Math.round(pricedCount / allItems.length * 100) : 0}%)`}
          color="green"
        />
        <KpiCard
          label="Unpriced Items"
          value={`${unpricedCount} (${allItems.length ? Math.round(unpricedCount / allItems.length * 100) : 0}%)`}
          color={unpricedCount > 0 ? 'red' : 'green'}
        />
        <KpiCard label="Overall Match Score" value={`${overallScore}%`} color={overallScore >= 80 ? 'green' : overallScore >= 51 ? 'yellow' : 'red'} />
      </div>

      {/* Total cost card */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <p className="text-xs text-gray-400 uppercase tracking-wider mb-1">Total Estimated Project Cost</p>
        <p className="text-3xl font-bold text-gray-900">€{fmt(totalCost)}</p>
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Match quality donut */}
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <p className="text-sm font-semibold text-gray-700 mb-4">Match Quality Distribution</p>
          <ResponsiveContainer width="100%" height={220}>
            <PieChart>
              <Pie
                data={matchDist}
                cx="50%"
                cy="50%"
                innerRadius={55}
                outerRadius={85}
                paddingAngle={3}
                dataKey="value"
              >
                {matchDist.map((entry, i) => (
                  <Cell key={i} fill={entry.color} />
                ))}
              </Pie>
              <Tooltip formatter={(v: number) => [`${v} items`]} />
              <Legend
                formatter={(value, entry) => (
                  <span style={{ color: '#374151', fontSize: 12 }}>
                    {value}: {(entry.payload as { value: number }).value}
                  </span>
                )}
              />
            </PieChart>
          </ResponsiveContainer>
        </div>

        {/* Cost per chapter bar */}
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <p className="text-sm font-semibold text-gray-700 mb-4">Cost per Chapter</p>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={chapterBarData} margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
              <XAxis dataKey="name" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} tickFormatter={v => `€${(v/1000).toFixed(0)}k`} />
              <Tooltip
                formatter={(v: number, _n, props) => [`€${fmt(v)}`, props.payload?.fullName || '']}
              />
              <Bar dataKey="cost" radius={[4, 4, 0, 0]}>
                {chapterBarData.map((entry, i) => (
                  <Cell key={i} fill={entry.color} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Editable BOQ table by chapter */}
      <div className="space-y-4">
        <h2 className="text-lg font-semibold text-gray-900">BOQ Detail</h2>

        {chapters.map((ch, chIdx) => {
          const isOpen = expandedChapters.has(ch.id)
          const pctOfTotal = totalCost > 0 ? (ch.subtotal / totalCost * 100) : 0
          const scoreColor = ch.avgMatchScore >= 80 ? '#16a34a' : ch.avgMatchScore >= 51 ? '#ca8a04' : '#dc2626'

          return (
            <div key={ch.id} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              {/* Chapter header */}
              <button
                className="w-full flex items-center justify-between px-5 py-4 hover:bg-gray-50 transition-colors text-left"
                onClick={() => toggleChapter(ch.id)}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <span className="text-gray-400 text-sm w-4">{isOpen ? '▾' : '▸'}</span>
                  <span className="font-semibold text-gray-900 text-sm">
                    {ch.id} – {ch.name}
                  </span>
                  <span
                    className="text-xs px-2 py-0.5 rounded-full font-medium"
                    style={{ background: `${scoreColor}20`, color: scoreColor }}
                  >
                    {ch.avgMatchScore}% match
                  </span>
                </div>
                <div className="flex items-center gap-6 flex-shrink-0 ml-4">
                  <span className="text-xs text-gray-400">{pctOfTotal.toFixed(1)}% of total</span>
                  <span className="font-semibold text-gray-900 text-sm">€{fmt(ch.subtotal)}</span>
                </div>
              </button>

              {/* Chapter items */}
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
                      {ch.items.map((item, itemIdx) => {
                        const labelColor = MATCH_COLORS[item.matchLabel]
                        const needsPrice = item.effectiveUnitPrice == null

                        return (
                          <tr key={item.item_code} className={needsPrice ? 'bg-red-50/40' : 'hover:bg-gray-50/60'}>
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
                              {/* Editable price input */}
                              <input
                                type="number"
                                min="0"
                                step="0.01"
                                placeholder={item.matchedUnitPrice != null
                                  ? fmt(item.matchedUnitPrice)
                                  : 'Enter price'}
                                value={item.manualUnitPrice}
                                onChange={e => updateManualPrice(chIdx, itemIdx, e.target.value)}
                                className={`w-full text-right border rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400
                                  ${needsPrice
                                    ? 'border-red-300 bg-red-50 placeholder-red-300'
                                    : 'border-gray-200 bg-white placeholder-gray-300'}`}
                              />
                            </td>
                            <td className="px-4 py-2 text-right text-gray-700 font-medium">
                              {item.effectiveTotal != null ? `€${fmt(item.effectiveTotal)}` : '—'}
                            </td>
                            <td className="px-4 py-2 text-center">
                              <div className="flex flex-col items-center gap-0.5">
                                <span
                                  className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full"
                                  style={{ background: `${labelColor}1a`, color: labelColor }}
                                >
                                  {item.matchScore}%
                                </span>
                                <span className="text-[9px] text-gray-400 leading-tight text-center">
                                  {item.matchLabel === 'Good Match' ? '✅' : item.matchLabel === 'Moderate Match' ? '🟡' : '🔴'}
                                </span>
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

      {/* Bottom export */}
      <div className="flex justify-end pb-8">
        <button
          onClick={() => exportToExcel(chapters)}
          className="px-6 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors font-medium text-sm"
        >
          ⬇ Export to Excel
        </button>
      </div>
    </div>
  )
}

function KpiCard({
  label, value, color = 'default',
}: { label: string; value: string; color?: 'green' | 'red' | 'yellow' | 'default' }) {
  const textColor = {
    green: 'text-green-700',
    red: 'text-red-600',
    yellow: 'text-yellow-600',
    default: 'text-gray-900',
  }[color]

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <p className="text-xs text-gray-400 font-medium uppercase tracking-wider mb-2">{label}</p>
      <p className={`text-xl font-bold ${textColor}`}>{value}</p>
    </div>
  )
}
