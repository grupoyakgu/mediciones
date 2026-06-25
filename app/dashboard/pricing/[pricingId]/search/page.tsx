'use client'

import { useState, useEffect, useRef } from 'react'
import { useParams } from 'next/navigation'
import * as XLSX from 'xlsx'

interface RawItem {
  item_code: string
  description: string
  unit?: string
  unit_price?: number | null
  quantity?: number | null
  chapter_id?: string
  chapter_name?: string
}

// ─── BOQ Parser (mirrors page.tsx) ───────────────────────────────────────────

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
    } else {
      // Accept any nat value that isn't a chapter header — covers 'Partida' and
      // any other line-item label used by non-standard BOQ exports.
      if (!desc) continue
      const topChapter = code.split('.')[0]
      items.push({
        item_code: code,
        chapter_id: topChapter,
        chapter_name: chapterNames.get(topChapter) ?? '',
        description: desc,
        unit,
        quantity: toNum(row[4]),
        unit_price: toNum(row[5]),
      })
    }
  }
  return items
}

// ─── Matching Logic (mirrors page.tsx) ───────────────────────────────────────

const STOP_WORDS = new Set([
  'de','del','de la','la','el','los','las','en','y','a','para','con','por','se',
  'un','una','o','al','e','su','sus','que','es','son','si','lo','le','les','no',
  'i','ii','iii','iv','v','tipo','n','nd',
])

function normalize(s: string) {
  return s.toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim()
}

function tokens(s: string): string[] {
  return normalize(s).split(' ').filter(t => t.length > 1 && !STOP_WORDS.has(t))
}

function charTrigramSim(a: string, b: string): number {
  if (a === b) return 1
  const minLen = Math.min(a.length, b.length)
  if (minLen < 3) return (a.startsWith(b) || b.startsWith(a)) ? 0.8 : 0
  const ngA = new Set<string>(), ngB = new Set<string>()
  for (let i = 0; i <= a.length - 3; i++) ngA.add(a.slice(i, i + 3))
  for (let i = 0; i <= b.length - 3; i++) ngB.add(b.slice(i, i + 3))
  let inter = 0
  ngA.forEach(g => { if (ngB.has(g)) inter++ })
  const union = ngA.size + ngB.size - inter
  return union === 0 ? 0 : inter / union
}

function bestFuzzyMatch(tok: string, candidates: string[]): number {
  let best = 0
  for (const c of candidates) {
    if (tok === c) return 1
    if (tok.length >= 4 && c.length >= 4) {
      const sim = charTrigramSim(tok, c)
      if (sim > 0.5 && sim > best) best = sim
    }
  }
  return best
}

function buildIdf(refItems: RawItem[]): Map<string, number> {
  const N = Math.max(refItems.length, 1)
  const df = new Map<string, number>()
  for (const item of refItems) {
    const seen = new Set(tokens(item.description))
    seen.forEach(t => df.set(t, (df.get(t) ?? 0) + 1))
  }
  const idf = new Map<string, number>()
  df.forEach((count, t) => {
    idf.set(t, Math.log((N + 1) / (count + 1)) + 1)
  })
  return idf
}

function idfWeightedF1(tokA: string[], tokB: string[], idf: Map<string, number>): number {
  if (!tokA.length || !tokB.length) return 0
  const DEFAULT_IDF = Math.log(2)
  let wScoreAB = 0, wTotalA = 0
  for (let i = 0; i < tokA.length; i++) {
    const w = (idf.get(tokA[i]) ?? DEFAULT_IDF) * (1 / (1 + i))
    wTotalA += w
    wScoreAB += w * bestFuzzyMatch(tokA[i], tokB)
  }
  let wScoreBA = 0, wTotalB = 0
  for (let j = 0; j < tokB.length; j++) {
    const w = (idf.get(tokB[j]) ?? DEFAULT_IDF) * (1 / (1 + j))
    wTotalB += w
    wScoreBA += w * bestFuzzyMatch(tokB[j], tokA)
  }
  const precision = wTotalA > 0 ? wScoreAB / wTotalA : 0
  const recall    = wTotalB > 0 ? wScoreBA / wTotalB : 0
  if (precision + recall === 0) return 0
  return (2 * precision * recall) / (precision + recall)
}

function lcsLength(a: string[], b: string[]): number {
  if (!a.length || !b.length) return 0
  let prev = new Array(b.length + 1).fill(0)
  for (let i = 0; i < a.length; i++) {
    const curr = new Array(b.length + 1).fill(0)
    for (let j = 0; j < b.length; j++)
      curr[j + 1] = a[i] === b[j] ? prev[j] + 1 : Math.max(prev[j + 1], curr[j])
    prev = curr
  }
  return prev[b.length]
}

function isStructuredCode(code: string): boolean {
  return code.includes('.')
}

function scoreItems(a: { item_code: string; description: string }, b: RawItem, idf: Map<string, number>): number {
  const normCodeA = normalize(a.item_code), normCodeB = normalize(b.item_code)
  if (normCodeA && normCodeA === normCodeB && isStructuredCode(a.item_code) && isStructuredCode(b.item_code)) return 100
  const normDescA = normalize(a.description), normDescB = normalize(b.description)
  if (normDescA && normDescA === normDescB) return 99
  const tokA = tokens(a.description), tokB = tokens(b.description)
  if (!tokA.length && !tokB.length) return 0
  const f1Score = idfWeightedF1(tokA, tokB, idf)
  const lcs = lcsLength(tokA, tokB)
  const lcsScore = tokA.length && tokB.length ? lcs / Math.max(tokA.length, tokB.length) : 0
  const descScore = f1Score * 0.65 + lcsScore * 0.35
  const codeTokA = tokens(a.item_code), codeTokB = tokens(b.item_code)
  const codeScore = codeTokA.length && codeTokB.length ? idfWeightedF1(codeTokA, codeTokB, idf) : 0
  return Math.round((descScore * 0.92 + codeScore * 0.08) * 100)
}

function findBestMatch(query: { item_code: string; description: string }, refItems: RawItem[], idf: Map<string, number>): { item: RawItem; score: number; top5: Candidate[] } | null {
  if (!refItems.length) return null
  const all: Candidate[] = refItems.map(ref => ({ item: ref, score: scoreItems(query, ref, idf) }))
  all.sort((a, b) => b.score - a.score)
  return { item: all[0].item, score: all[0].score, top5: all.slice(0, 5) }
}

// ─── Component ────────────────────────────────────────────────────────────────

type Mode = 'single' | 'boq'

interface SingleResult { item: RawItem; score: number }
interface Candidate { item: RawItem; score: number }
interface BoqResult {
  unpriced: RawItem
  best: RawItem | null
  score: number
  top5: Candidate[]
}

interface ProjectOption { id: string; name: string }

export default function SearchPage() {
  const { pricingId } = useParams<{ pricingId: string }>()
  const [refItems, setRefItems] = useState<RawItem[]>([])
  const [loading, setLoading] = useState(true)
  const [mode, setMode] = useState<Mode>('single')

  // Single search
  const [queryDesc, setQueryDesc] = useState('')
  const [queryCode, setQueryCode] = useState('')
  const [singleResults, setSingleResults] = useState<SingleResult[]>([])

  // BOQ file match
  const [projects, setProjects] = useState<ProjectOption[]>([])
  // unpriced side
  const [unpricedFile, setUnpricedFile] = useState<File | null>(null)
  const [unpricedItems, setUnpricedItems] = useState<RawItem[]>([])
  // reference side
  const [refSourceType, setRefSourceType] = useState<'project' | 'file'>('project')
  const [selectedProjectId, setSelectedProjectId] = useState('')
  const [refFile, setRefFile] = useState<File | null>(null)
  // results
  const [boqResults, setBoqResults] = useState<BoqResult[]>([])
  const [running, setRunning] = useState(false)
  const [debugLog, setDebugLog] = useState<string[]>([])
  const [expandedRows, setExpandedRows] = useState<Set<number>>(new Set())
  const unpricedInputRef = useRef<HTMLInputElement>(null)
  const refFileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    fetch(`/api/pricing-projects/${pricingId}`)
      .then(r => r.json())
      .then(d => {
        setRefItems((d.project?.ref_items as RawItem[]) ?? [])
        setLoading(false)
      })
      .catch(() => setLoading(false))
    fetch('/api/projects')
      .then(r => r.json())
      .then(d => setProjects(d.projects ?? []))
      .catch(() => {})
  }, [pricingId])

  // Single item search
  function runSingleSearch() {
    if (!queryDesc.trim() || !refItems.length) { setSingleResults([]); return }
    const idf = buildIdf(refItems)
    const q = { item_code: queryCode.trim(), description: queryDesc.trim() }
    const scored = refItems
      .map(item => ({ item, score: scoreItems(q, item, idf) }))
      .sort((a, b) => b.score - a.score)
    setSingleResults(scored)
  }

  async function handleUnpricedFile(file: File) {
    setUnpricedFile(file)
    setUnpricedItems([])
    setBoqResults([])
    const buf = await file.arrayBuffer()
    setUnpricedItems(parseBoqBuffer(buf))
  }

  async function handleRefFile(file: File) {
    setRefFile(file)
    setBoqResults([])
  }

  async function runBoqMatch() {
    setRunning(true)
    setBoqResults([])
    setDebugLog([])
    setExpandedRows(new Set())

    // Build reference item list
    let referenceItems: RawItem[] = []
    if (refSourceType === 'project' && selectedProjectId) {
      const res = await fetch(`/api/projects/${selectedProjectId}/boq`)
      const data = await res.json()
      referenceItems = (data.items ?? []) as RawItem[]
    } else if (refSourceType === 'file' && refFile) {
      const buf = await refFile.arrayBuffer()
      referenceItems = parseBoqBuffer(buf)
    }

    const log: string[] = []
    log.push(`[DEBUG] Unpriced items: ${unpricedItems.length}`)
    log.push(`[DEBUG] Reference items (BOQ Match): ${referenceItems.length}`)
    log.push(`[DEBUG] Reference items (Single Search / DB ref_items): ${refItems.length}`)
    log.push(`[DEBUG] Reference source: ${refSourceType === 'project' ? `project id=${selectedProjectId}` : `file=${refFile?.name}`}`)

    if (!unpricedItems.length || !referenceItems.length) {
      log.push('[DEBUG] ERROR: missing unpriced or reference items — aborting')
      setDebugLog(log)
      setRunning(false)
      return
    }

    const idf = buildIdf(referenceItems)
    const results: BoqResult[] = unpricedItems.map(item => {
      const match = findBestMatch(item, referenceItems, idf)
      return {
        unpriced: item,
        best: match?.item ?? null,
        score: match?.score ?? 0,
        top5: match?.top5 ?? [],
      }
    })

    // Log top5 for every item so user can copy from console
    results.forEach(r => {
      console.log(`[BOQ MATCH] "${r.unpriced.item_code}" / "${r.unpriced.description}"`)
      console.log(`  winner → "${r.best?.item_code}" / "${r.best?.description}" score=${r.score}`)
      r.top5.forEach((c, i) => console.log(`  #${i + 1} score=${c.score}  "${c.item.item_code}" "${c.item.description}"`))
    })

    setBoqResults(results)
    setDebugLog(log)
    setRunning(false)
  }

  const maxSingle = singleResults[0]?.score ?? 0

  if (loading) return <p className="text-sm text-gray-400">Loading reference items…</p>

  if (refItems.length === 0) return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
      No reference items saved yet. Run a pricing match first — the reference BOQ will be saved automatically.
    </div>
  )

  return (
    <div className="max-w-5xl space-y-6">
      {/* Mode tabs */}
      <div className="flex gap-1 border-b border-gray-200">
        {(['single', 'boq'] as Mode[]).map(m => (
          <button key={m} onClick={() => setMode(m)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors -mb-px ${
              mode === m ? 'border-gray-900 text-gray-900' : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}>
            {m === 'single' ? 'Single Item Search' : 'Full BOQ Match'}
          </button>
        ))}
      </div>

      {/* ── Single Item Search ── */}
      {mode === 'single' && (
        <div>
          <p className="text-sm text-gray-500 mb-4">
            Type a description to see how it scores against all {refItems.length} reference items. Best match highlighted in green.
          </p>
          <div className="flex gap-2 mb-6">
            <input type="text" value={queryCode} onChange={e => setQueryCode(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') runSingleSearch() }}
              placeholder="Item code (optional)"
              className="w-40 border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-gray-900" />
            <input autoFocus type="text" value={queryDesc} onChange={e => setQueryDesc(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') runSingleSearch() }}
              placeholder="Description, e.g. A01 Pintura interior"
              className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900" />
            <button onClick={runSingleSearch} disabled={!queryDesc.trim()}
              className="px-4 py-2 bg-gray-900 text-white text-sm rounded-lg hover:bg-gray-700 disabled:opacity-40 transition-colors">
              Search
            </button>
          </div>

          {singleResults.length > 0 && (
            <div className="border border-gray-200 rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200">
                    <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-500 w-20">Score</th>
                    <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-500 w-32">Code</th>
                    <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-500">Description</th>
                    <th className="text-right px-4 py-2.5 text-xs font-medium text-gray-500 w-28">Unit price</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {singleResults.map(({ item, score }, idx) => {
                    const isTop = score === maxSingle && score > 0
                    return (
                      <tr key={idx} className={isTop ? 'bg-green-50' : ''}>
                        <td className="px-4 py-2.5">
                          <span className={`inline-flex items-center justify-center w-10 h-6 rounded text-xs font-semibold ${
                            isTop ? 'bg-green-600 text-white' : score >= 51 ? 'bg-gray-200 text-gray-700' : 'text-gray-400'
                          }`}>{score}</span>
                        </td>
                        <td className="px-4 py-2.5 font-mono text-xs text-gray-500">{item.item_code}</td>
                        <td className={`px-4 py-2.5 ${isTop ? 'font-medium text-green-800' : 'text-gray-700'}`}>{item.description}</td>
                        <td className="px-4 py-2.5 text-right text-gray-500">
                          {item.unit_price != null ? item.unit_price.toLocaleString('es-ES', { minimumFractionDigits: 2 }) : '—'}
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

      {/* ── Full BOQ Match ── */}
      {mode === 'boq' && (
        <div>
          <div className="grid grid-cols-2 gap-6 mb-6 max-w-3xl">
            {/* Left: unpriced BOQ upload */}
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Step 1 — Unpriced BOQ</p>
              <input ref={unpricedInputRef} type="file" accept=".xlsx,.xls" className="hidden"
                onChange={e => { const f = e.target.files?.[0]; if (f) handleUnpricedFile(f); e.target.value = '' }} />
              {unpricedFile ? (
                <div className="flex items-center gap-3 bg-green-50 border border-green-200 rounded-lg px-4 py-3">
                  <span className="text-green-600">✓</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-green-800 truncate">{unpricedFile.name}</p>
                    <p className="text-xs text-green-600">{unpricedItems.length} items parsed</p>
                  </div>
                  <button onClick={() => { setUnpricedFile(null); setUnpricedItems([]); setBoqResults([]) }}
                    className="text-green-400 hover:text-green-700 text-sm">✕</button>
                </div>
              ) : (
                <button onClick={() => unpricedInputRef.current?.click()}
                  className="w-full border-2 border-dashed border-gray-300 rounded-lg p-6 text-center hover:border-blue-400 hover:bg-blue-50 transition-colors">
                  <p className="text-gray-500 text-sm">Click to upload unpriced BOQ</p>
                  <p className="text-gray-400 text-xs mt-1">.xlsx / .xls</p>
                </button>
              )}
            </div>

            {/* Right: reference source */}
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Step 2 — Reference (priced BOQ)</p>
              <div className="flex gap-2 mb-3">
                {(['project', 'file'] as const).map(t => (
                  <button key={t} onClick={() => { setRefSourceType(t); setRefFile(null); setSelectedProjectId(''); setBoqResults([]) }}
                    className={`flex-1 py-1.5 text-xs rounded-md border transition-colors ${refSourceType === t ? 'border-blue-500 bg-blue-50 text-blue-700 font-medium' : 'border-gray-200 text-gray-500 hover:border-gray-300'}`}>
                    {t === 'project' ? '📁 Project' : '📄 Upload file'}
                  </button>
                ))}
              </div>
              {refSourceType === 'project' ? (
                <select value={selectedProjectId} onChange={e => { setSelectedProjectId(e.target.value); setBoqResults([]) }}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                  <option value="">— Choose a project —</option>
                  {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              ) : (
                <>
                  <input ref={refFileInputRef} type="file" accept=".xlsx,.xls" className="hidden"
                    onChange={e => { const f = e.target.files?.[0]; if (f) handleRefFile(f); e.target.value = '' }} />
                  {refFile ? (
                    <div className="flex items-center gap-2 bg-green-50 border border-green-200 rounded-lg px-3 py-2.5">
                      <span className="text-green-600 text-sm">✓</span>
                      <span className="text-sm font-medium text-green-800 truncate flex-1">{refFile.name}</span>
                      <button onClick={() => { setRefFile(null); setBoqResults([]) }} className="text-green-400 hover:text-green-700 text-sm">✕</button>
                    </div>
                  ) : (
                    <button onClick={() => refFileInputRef.current?.click()}
                      className="w-full border-2 border-dashed border-gray-300 rounded-lg p-4 text-center hover:border-blue-400 hover:bg-blue-50 transition-colors">
                      <p className="text-gray-500 text-sm">Click to upload priced BOQ</p>
                    </button>
                  )}
                </>
              )}
            </div>
          </div>

          <button
            onClick={runBoqMatch}
            disabled={running || unpricedItems.length === 0 || (refSourceType === 'project' ? !selectedProjectId : !refFile)}
            className="px-5 py-2 bg-gray-900 text-white text-sm rounded-lg hover:bg-gray-700 disabled:opacity-40 transition-colors mb-6">
            {running ? 'Matching…' : `Run Match → (${unpricedItems.length} items)`}
          </button>

          {/* Debug summary panel */}
          {debugLog.length > 0 && (
            <div className="mb-4 rounded-lg border border-orange-200 bg-orange-50 p-3 font-mono text-xs text-orange-800 whitespace-pre-wrap">
              {debugLog.join('\n')}
              {'\n'}[DEBUG] Full per-item scores logged to browser console (F12 → Console)
            </div>
          )}

          {boqResults.length > 0 && (
            <div className="border border-gray-200 rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200">
                    <th className="text-left px-3 py-2.5 text-xs font-medium text-gray-500 w-8"></th>
                    <th className="text-left px-3 py-2.5 text-xs font-medium text-gray-500 w-28">Code</th>
                    <th className="text-left px-3 py-2.5 text-xs font-medium text-gray-500">Unpriced item</th>
                    <th className="text-left px-3 py-2.5 text-xs font-medium text-gray-500 w-16">Score</th>
                    <th className="text-left px-3 py-2.5 text-xs font-medium text-gray-500">Best match</th>
                    <th className="text-right px-3 py-2.5 text-xs font-medium text-gray-500 w-28">Unit price</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {boqResults.map(({ unpriced, best, score, top5 }, idx) => {
                    const expanded = expandedRows.has(idx)
                    return (
                      <>
                        <tr key={idx} className={score >= 81 ? 'bg-green-50' : ''}>
                          <td className="px-3 py-2.5">
                            <button
                              onClick={() => setExpandedRows(prev => {
                                const next = new Set(prev)
                                if (expanded) { next.delete(idx) } else { next.add(idx) }
                                return next
                              })}
                              title="Show top 5 candidates"
                              className="text-gray-400 hover:text-gray-700 text-xs leading-none"
                            >{expanded ? '▾' : '▸'}</button>
                          </td>
                          <td className="px-3 py-2.5 font-mono text-xs text-gray-400">{unpriced.item_code}</td>
                          <td className="px-3 py-2.5 text-gray-800">{unpriced.description}</td>
                          <td className="px-3 py-2.5">
                            <span className={`inline-flex items-center justify-center w-10 h-6 rounded text-xs font-semibold ${
                              score >= 81 ? 'bg-green-600 text-white' : score >= 51 ? 'bg-yellow-100 text-yellow-800' : 'bg-gray-100 text-gray-500'
                            }`}>{score}</span>
                          </td>
                          <td className="px-3 py-2.5 text-gray-600">
                            {best ? (
                              <span>
                                <span className="font-mono text-xs text-gray-400 mr-2">{best.item_code}</span>
                                {best.description}
                              </span>
                            ) : '—'}
                          </td>
                          <td className="px-3 py-2.5 text-right text-gray-700 font-medium">
                            {best?.unit_price != null
                              ? best.unit_price.toLocaleString('es-ES', { minimumFractionDigits: 2 })
                              : '—'}
                          </td>
                        </tr>
                        {expanded && (
                          <tr key={`${idx}-debug`} className="bg-gray-50">
                            <td colSpan={6} className="px-6 py-3">
                              <p className="text-xs font-semibold text-gray-500 mb-1">Top 5 candidates for &quot;{unpriced.description}&quot; (code: {unpriced.item_code || '—'})</p>
                              <table className="w-full text-xs font-mono">
                                <tbody>
                                  {top5.map((c, ci) => (
                                    <tr key={ci} className={ci === 0 ? 'text-green-700 font-semibold' : 'text-gray-500'}>
                                      <td className="pr-4 w-12">#{ci + 1} [{c.score}]</td>
                                      <td className="pr-4 w-32">{c.item.item_code}</td>
                                      <td>{c.item.description}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
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
      )}
    </div>
  )
}
