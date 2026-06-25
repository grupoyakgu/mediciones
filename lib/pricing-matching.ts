import * as XLSX from 'xlsx'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface RawItem {
  item_code: string
  chapter_id: string
  chapter_name: string
  description: string
  unit: string
  quantity: number | null
  unit_price: number | null
  total_amount: number | null
}

export type MatchLabel = 'High' | 'Medium' | 'Low'

export interface MatchedItem extends RawItem {
  refCode: string
  refDescription: string
  matchScore: number
  matchLabel: MatchLabel
  matchedUnitPrice: number | null
  manualUnitPrice: string
  effectiveUnitPrice: number | null
  effectiveTotal: number | null
  excluded: boolean
}

export interface Chapter {
  id: string
  name: string
  items: MatchedItem[]
  subtotal: number
  avgMatchScore: number
}

export interface ExcludeEntry { id: string; item_code?: string; description?: string }

// ─── BOQ Parser ───────────────────────────────────────────────────────────────

function toNum(v: unknown): number | null {
  if (v == null || v === '') return null
  const n = Number(v)
  return isNaN(n) ? null : n
}

export function parseBoqBuffer(buffer: ArrayBuffer): RawItem[] {
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

const STOP_WORDS = new Set([
  'de','del','de la','la','el','los','las','en','y','a','para','con','por','se',
  'un','una','o','al','e','su','sus','que','es','son','si','lo','le','les','no',
  'i','ii','iii','iv','v','tipo','n','nd',
])

export function normalize(s: string) {
  return s
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function tokens(s: string): string[] {
  return normalize(s).split(' ').filter(t => t.length > 1 && !STOP_WORDS.has(t))
}

function charTrigramSim(a: string, b: string): number {
  if (a === b) return 1
  const minLen = Math.min(a.length, b.length)
  if (minLen < 3) return a.startsWith(b) || b.startsWith(a) ? 0.8 : 0
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

export function buildIdf(refItems: RawItem[]): Map<string, number> {
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

export function scoreItems(a: RawItem, b: RawItem, idf: Map<string, number>): number {
  const normDescA = normalize(a.description)
  const normDescB = normalize(b.description)
  if (normDescA && normDescA === normDescB) return 100
  const tokA = tokens(a.description)
  const tokB = tokens(b.description)
  if (!tokA.length && !tokB.length) return 0
  const f1Score = idfWeightedF1(tokA, tokB, idf)
  const lcs = lcsLength(tokA, tokB)
  const lcsScore = tokA.length && tokB.length ? lcs / Math.max(tokA.length, tokB.length) : 0
  const descScore = f1Score * 0.65 + lcsScore * 0.35
  const codeTokA = tokens(a.item_code)
  const codeTokB = tokens(b.item_code)
  const codeScore = codeTokA.length && codeTokB.length ? idfWeightedF1(codeTokA, codeTokB, idf) : 0
  return Math.round((descScore * 0.92 + codeScore * 0.08) * 100)
}

export function matchLabel(score: number): MatchLabel {
  if (score >= 81) return 'High'
  if (score >= 51) return 'Medium'
  return 'Low'
}

export function isExcluded(item: RawItem, excludes: ExcludeEntry[]): boolean {
  for (const ex of excludes) {
    if (ex.item_code && normalize(item.item_code) === normalize(ex.item_code)) return true
    if (ex.description && normalize(item.description).includes(normalize(ex.description))) return true
  }
  return false
}

export function matchItems(
  newItems: RawItem[],
  refItems: RawItem[],
  excludes: ExcludeEntry[],
): { matched: MatchedItem[]; excludedItems: RawItem[] } {
  const idf = buildIdf(refItems)
  const matched: MatchedItem[] = []
  const excludedItems: RawItem[] = []

  for (const item of newItems) {
    const excl = isExcluded(item, excludes)
    if (excl) excludedItems.push(item)

    let bestScore = 0
    let bestRef: RawItem | null = null
    if (!excl) {
      for (const ref of refItems) {
        const s = scoreItems(item, ref, idf)
        if (s > bestScore) { bestScore = s; bestRef = ref }
      }
    }
    const matchedPrice = !excl && bestScore > 50 ? (bestRef?.unit_price ?? null) : null
    const effectiveUnitPrice = matchedPrice
    const effectiveTotal =
      effectiveUnitPrice != null && item.quantity != null
        ? effectiveUnitPrice * item.quantity : null
    matched.push({
      ...item,
      refCode: bestRef?.item_code ?? '',
      refDescription: bestRef?.description ?? '',
      matchScore: excl ? 0 : bestScore,
      matchLabel: excl ? 'Low' : matchLabel(bestScore),
      matchedUnitPrice: matchedPrice,
      manualUnitPrice: '',
      effectiveUnitPrice,
      effectiveTotal,
      excluded: excl,
    })
  }
  return { matched, excludedItems }
}

export function groupByChapter(items: MatchedItem[]): Chapter[] {
  const map = new Map<string, MatchedItem[]>()
  for (const item of items) {
    if (!map.has(item.chapter_id)) map.set(item.chapter_id, [])
    map.get(item.chapter_id)!.push(item)
  }
  return Array.from(map.entries())
    .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))
    .map(([id, chItems]) => {
      const active = chItems.filter(i => !i.excluded)
      return {
        id,
        name: chItems[0].chapter_name || id,
        items: chItems,
        subtotal: active.reduce((s, i) => s + (i.effectiveTotal ?? 0), 0),
        avgMatchScore: active.length
          ? Math.round(active.reduce((s, i) => s + i.matchScore, 0) / active.length) : 0,
      }
    })
}
