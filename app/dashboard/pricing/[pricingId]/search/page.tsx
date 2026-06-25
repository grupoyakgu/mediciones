'use client'

import { useState, useEffect, useRef } from 'react'
import { useParams } from 'next/navigation'

interface RawItem {
  item_code: string
  description: string
  unit?: string
  unit_price?: number | null
}

// ─── Matching Logic (mirror of page.tsx) ─────────────────────────────────────

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

function scoreQuery(query: { item_code: string; description: string }, ref: RawItem, idf: Map<string, number>): number {
  const normCodeA = normalize(query.item_code), normCodeB = normalize(ref.item_code)
  if (normCodeA && normCodeA === normCodeB && isStructuredCode(query.item_code) && isStructuredCode(ref.item_code)) return 100
  const normDescA = normalize(query.description), normDescB = normalize(ref.description)
  if (normDescA && normDescA === normDescB) return 99
  const tokA = tokens(query.description), tokB = tokens(ref.description)
  if (!tokA.length && !tokB.length) return 0
  const f1Score = idfWeightedF1(tokA, tokB, idf)
  const lcs = lcsLength(tokA, tokB)
  const lcsScore = tokA.length && tokB.length ? lcs / Math.max(tokA.length, tokB.length) : 0
  const descScore = f1Score * 0.65 + lcsScore * 0.35
  const codeTokA = tokens(query.item_code), codeTokB = tokens(ref.item_code)
  const codeScore = codeTokA.length && codeTokB.length ? idfWeightedF1(codeTokA, codeTokB, idf) : 0
  return Math.round((descScore * 0.92 + codeScore * 0.08) * 100)
}

// ─── Component ────────────────────────────────────────────────────────────────

interface Result {
  item: RawItem
  score: number
}

export default function SearchPage() {
  const { pricingId } = useParams<{ pricingId: string }>()
  const [refItems, setRefItems] = useState<RawItem[]>([])
  const [loading, setLoading] = useState(true)
  const [queryDesc, setQueryDesc] = useState('')
  const [queryCode, setQueryCode] = useState('')
  const [results, setResults] = useState<Result[]>([])
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    fetch(`/api/pricing-projects/${pricingId}`)
      .then(r => r.json())
      .then(d => {
        setRefItems((d.project?.ref_items as RawItem[]) ?? [])
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [pricingId])

  function runSearch() {
    if (!queryDesc.trim() || !refItems.length) { setResults([]); return }
    const idf = buildIdf(refItems)
    const queryItem = { item_code: queryCode.trim(), description: queryDesc.trim() }
    const scored = refItems
      .map(item => ({ item, score: scoreQuery(queryItem, item, idf) }))
      .sort((a, b) => b.score - a.score)
    setResults(scored)
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') runSearch()
  }

  const maxScore = results[0]?.score ?? 0

  return (
    <div className="max-w-3xl">
      <p className="text-sm text-gray-500 mb-4">
        Type an item description to see how it scores against all reference items. The best match is highlighted in green.
      </p>

      {loading ? (
        <p className="text-sm text-gray-400">Loading reference items…</p>
      ) : refItems.length === 0 ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          No reference items saved yet. Run a pricing match first — the reference BOQ will be saved automatically.
        </div>
      ) : (
        <>
          <div className="flex gap-2 mb-6">
            <input
              type="text"
              value={queryCode}
              onChange={e => setQueryCode(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Item code (optional)"
              className="w-40 border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-gray-900 focus:border-transparent"
            />
            <input
              ref={inputRef}
              autoFocus
              type="text"
              value={queryDesc}
              onChange={e => setQueryDesc(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Description, e.g. A01 Pintura interior"
              className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 focus:border-transparent"
            />
            <button
              onClick={runSearch}
              disabled={!queryDesc.trim()}
              className="px-4 py-2 bg-gray-900 text-white text-sm rounded-lg hover:bg-gray-700 disabled:opacity-40 transition-colors"
            >
              Search
            </button>
          </div>

          {results.length > 0 && (
            <div>
              <p className="text-xs text-gray-400 mb-2">{results.length} reference items scored — showing all</p>
              <div className="border border-gray-200 rounded-lg overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-200">
                      <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-500 w-24">Score</th>
                      <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-500 w-32">Code</th>
                      <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-500">Description</th>
                      <th className="text-right px-4 py-2.5 text-xs font-medium text-gray-500 w-24">Unit price</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {results.map(({ item, score }, idx) => {
                      const isTop = score === maxScore && score > 0
                      return (
                        <tr
                          key={idx}
                          className={isTop ? 'bg-green-50' : score === 0 ? 'opacity-40' : ''}
                        >
                          <td className="px-4 py-2.5">
                            <span className={`inline-flex items-center justify-center w-10 h-6 rounded text-xs font-semibold ${
                              isTop
                                ? 'bg-green-600 text-white'
                                : score >= 51
                                  ? 'bg-gray-200 text-gray-700'
                                  : 'text-gray-400'
                            }`}>
                              {score}
                            </span>
                          </td>
                          <td className="px-4 py-2.5 font-mono text-xs text-gray-500">{item.item_code}</td>
                          <td className={`px-4 py-2.5 ${isTop ? 'font-medium text-green-800' : 'text-gray-700'}`}>
                            {item.description}
                          </td>
                          <td className="px-4 py-2.5 text-right text-gray-500">
                            {item.unit_price != null ? item.unit_price.toLocaleString('es-ES', { minimumFractionDigits: 2 }) : '—'}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
