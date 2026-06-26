'use client'

import { useState, useEffect, useRef } from 'react'
import { useParams } from 'next/navigation'

interface ExcludeEntry {
  id: string
  item_code: string | null
  description: string | null
  created_at: string
}

interface ChapterSummary {
  id: string
  name: string
  lowCount: number
}

interface ProgressLine {
  type: 'progress' | 'item_done' | 'done' | 'error'
  item_code?: string
  description?: string
  unit_price?: number | null
  notes?: string
  chapter_id?: string
  total_updated?: number
  message?: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  results?: any[]
}

export default function PricingSettingsPage() {
  const params = useParams()
  const pricingId = params.pricingId as string

  const [name, setName] = useState('')
  const [nameSaving, setNameSaving] = useState(false)
  const [nameSaved, setNameSaved] = useState(false)

  const [excludes, setExcludes] = useState<ExcludeEntry[]>([])
  const [newCode, setNewCode] = useState('')
  const [newDesc, setNewDesc] = useState('')
  const [adding, setAdding] = useState(false)

  // Auto-price state
  const [chapters, setChapters] = useState<ChapterSummary[]>([])
  const [selectedChapter, setSelectedChapter] = useState('all')
  const [autoRunning, setAutoRunning] = useState(false)
  const [log, setLog] = useState<ProgressLine[]>([])
  const [progressDone, setProgressDone] = useState(0)
  const [progressTotal, setProgressTotal] = useState(0)
  const logRef = useRef<HTMLDivElement>(null)
  const [includeAutoPriced, setIncludeAutoPriced] = useState(true)

  useEffect(() => {
    const stored = localStorage.getItem(`autoPrice:${pricingId}`)
    if (stored !== null) setIncludeAutoPriced(stored !== 'false')
  }, [pricingId])

  function toggleIncludeAutoPriced(val: boolean) {
    setIncludeAutoPriced(val)
    localStorage.setItem(`autoPrice:${pricingId}`, String(val))
    window.dispatchEvent(new CustomEvent('autoPriceToggled', { detail: val }))
  }

  useEffect(() => {
    fetch(`/api/pricing-projects/${pricingId}`)
      .then(r => r.json())
      .then(d => {
        if (d.project) {
          setName(d.project.name)
          // Build chapter summaries with low-confidence item counts
          if (Array.isArray(d.project.results)) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const summaries: ChapterSummary[] = d.project.results.map((ch: any) => ({
              id: ch.id,
              name: ch.name,
              lowCount: ch.items.filter(
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                (i: any) => !i.excluded && (i.matchScore ?? 100) <= 50 && (!i.manualUnitPrice || i.manualUnitPrice === '')
              ).length,
            }))
            setChapters(summaries)
          }
        }
      })
    fetch(`/api/pricing-projects/${pricingId}/excludes`)
      .then(r => r.json())
      .then(d => setExcludes(d.excludes ?? []))
  }, [pricingId])

  // Auto-scroll log
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight
  }, [log])

  async function saveName() {
    if (!name.trim()) return
    setNameSaving(true)
    await fetch(`/api/pricing-projects/${pricingId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name.trim() }),
    })
    setNameSaving(false)
    setNameSaved(true)
    setTimeout(() => setNameSaved(false), 2000)
  }

  async function addExclude() {
    if (!newCode.trim() && !newDesc.trim()) return
    setAdding(true)
    const res = await fetch(`/api/pricing-projects/${pricingId}/excludes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ item_code: newCode.trim() || null, description: newDesc.trim() || null }),
    })
    const data = await res.json()
    if (data.exclude) setExcludes(prev => [...prev, data.exclude])
    setNewCode('')
    setNewDesc('')
    setAdding(false)
    window.dispatchEvent(new Event('excludesChanged'))
  }

  async function removeExclude(id: string) {
    await fetch(`/api/pricing-projects/${pricingId}/excludes?id=${id}`, { method: 'DELETE' })
    setExcludes(prev => prev.filter(e => e.id !== id))
    window.dispatchEvent(new Event('excludesChanged'))
  }

  async function runAutoPrice() {
    setAutoRunning(true)
    setLog([])
    setProgressDone(0)
    setProgressTotal(totalLow)

    const res = await fetch(`/api/pricing-projects/${pricingId}/auto-price`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chapter_id: selectedChapter }),
    })

    if (!res.body) { setAutoRunning(false); return }

    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buf = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buf += decoder.decode(value, { stream: true })
      const parts = buf.split('\n\n')
      buf = parts.pop() ?? ''
      for (const part of parts) {
        const line = part.replace(/^data: /, '').trim()
        if (!line) continue
        try {
          const ev: ProgressLine = JSON.parse(line)
          setLog(prev => [...prev, ev])
          if (ev.type === 'item_done') {
            setProgressDone(prev => prev + 1)
          }
          if (ev.type === 'done') {
            // Signal pricing page to reload
            window.dispatchEvent(new CustomEvent('autoPriceUpdated', { detail: ev.results }))
            // Re-fetch project to get accurate remaining qualifying counts per chapter
            fetch(`/api/pricing-projects/${pricingId}`)
              .then(r => r.json())
              .then(d => {
                if (Array.isArray(d.project?.results)) {
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  setChapters(d.project.results.map((ch: any) => ({
                    id: ch.id,
                    name: ch.name,
                    lowCount: ch.items.filter(
                      // eslint-disable-next-line @typescript-eslint/no-explicit-any
                      (i: any) => !i.excluded && (i.matchScore ?? 100) <= 50 && (!i.manualUnitPrice || i.manualUnitPrice === '')
                    ).length,
                  })))
                }
              })
              .catch(() => { /* non-critical */ })
          }
        } catch { /* ignore malformed */ }
      }
    }

    setAutoRunning(false)
  }

  const totalLow = chapters.reduce((s, c) => {
    if (selectedChapter === 'all') return s + c.lowCount
    return c.id === selectedChapter ? c.lowCount : s
  }, 0)

  return (
    <div className="max-w-2xl mx-auto py-10 px-4 space-y-8">
      {/* Project Name */}
      <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
        <h2 className="text-base font-semibold text-gray-900">Project Name</h2>
        <div className="flex gap-3">
          <input
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && saveName()}
            className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button
            onClick={saveName}
            disabled={nameSaving || !name.trim()}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors disabled:opacity-50"
          >
            {nameSaved ? 'Saved!' : nameSaving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>

      {/* Auto-Price */}
      <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
        <div>
          <h2 className="text-base font-semibold text-gray-900">Auto-Price Low-Confidence Items</h2>
          <p className="text-xs text-gray-500 mt-0.5">
            Uses AI (experienced construction professional, Sevilla 2024–2025 market) to estimate
            unit prices for items with a match score of 50 or below that have no price yet.
          </p>
        </div>

        {/* Toggle: include auto-priced in total */}
        <label className="flex items-center gap-3 cursor-pointer select-none w-fit">
          <div className="relative">
            <input
              type="checkbox"
              className="sr-only"
              checked={includeAutoPriced}
              onChange={e => toggleIncludeAutoPriced(e.target.checked)}
            />
            <div className={`w-10 h-6 rounded-full transition-colors ${includeAutoPriced ? 'bg-indigo-600' : 'bg-gray-300'}`} />
            <div className={`absolute top-1 left-1 w-4 h-4 rounded-full bg-white shadow transition-transform ${includeAutoPriced ? 'translate-x-4' : 'translate-x-0'}`} />
          </div>
          <span className="text-sm text-gray-700 font-medium">
            Show Auto-Priced Items in <span className="text-gray-900 font-semibold">Total Estimated Project Cost</span>
          </span>
        </label>

        <div className="flex gap-3 items-end">
          <div className="flex-1">
            <label className="block text-xs font-medium text-gray-600 mb-1">Target chapter</label>
            <select
              value={selectedChapter}
              onChange={e => setSelectedChapter(e.target.value)}
              disabled={autoRunning}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
            >
              <option value="all">All chapters ({chapters.reduce((s, c) => s + c.lowCount, 0)} qualifying items)</option>
              {chapters.map(ch => (
                <option key={ch.id} value={ch.id}>
                  {ch.id} – {ch.name} ({ch.lowCount} qualifying)
                </option>
              ))}
            </select>
          </div>
          <button
            onClick={runAutoPrice}
            disabled={autoRunning || totalLow === 0}
            className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-semibold hover:bg-indigo-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap"
          >
            {autoRunning ? (
              <span className="flex items-center gap-2">
                <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                Running…
              </span>
            ) : (
              `✨ Auto-Price ${totalLow} item${totalLow !== 1 ? 's' : ''}`
            )}
          </button>
        </div>

        {totalLow === 0 && !autoRunning && chapters.length > 0 && (
          <p className="text-xs text-green-600">✓ No qualifying items — all low-confidence items already have prices.</p>
        )}

        {(autoRunning || (progressTotal > 0 && progressDone === progressTotal)) && (
          <div className="space-y-1.5">
            <div className="flex justify-between text-xs text-gray-500">
              <span>{autoRunning ? 'Pricing items…' : 'Complete'}</span>
              <span>{progressDone} / {progressTotal}</span>
            </div>
            <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-300 ${progressDone === progressTotal && !autoRunning ? 'bg-green-500' : 'bg-indigo-500'}`}
                style={{ width: `${progressTotal > 0 ? Math.round((progressDone / progressTotal) * 100) : 0}%` }}
              />
            </div>
            <p className="text-[10px] text-gray-400 text-right">
              {progressTotal > 0 ? Math.round((progressDone / progressTotal) * 100) : 0}%
            </p>
          </div>
        )}

        {log.length > 0 && (
          <div
            ref={logRef}
            className="bg-gray-950 rounded-lg p-3 max-h-64 overflow-y-auto font-mono text-xs space-y-1"
          >
            {log.map((ev, i) => {
              if (ev.type === 'progress') return (
                <div key={i} className="text-yellow-400">
                  ⟳ {ev.item_code} — {ev.description}
                </div>
              )
              if (ev.type === 'item_done') return (
                <div key={i} className={ev.unit_price != null ? 'text-green-400' : 'text-red-400'}>
                  {ev.unit_price != null ? '✓' : '✗'} {ev.item_code}
                  {ev.unit_price != null ? ` → €${ev.unit_price.toFixed(2)}` : ' → no price'}
                  {ev.notes ? <span className="text-gray-400"> — {ev.notes}</span> : null}
                </div>
              )
              if (ev.type === 'done') return (
                <div key={i} className="text-blue-400 font-bold pt-1 border-t border-gray-800">
                  ✅ Done — {ev.total_updated} item{ev.total_updated !== 1 ? 's' : ''} priced. Pricing tab updated.
                </div>
              )
              if (ev.type === 'error') return (
                <div key={i} className="text-red-500">⚠ Error: {ev.message}</div>
              )
              return null
            })}
          </div>
        )}
      </div>

      {/* Exclude List */}
      <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
        <div>
          <h2 className="text-base font-semibold text-gray-900">Exclude List</h2>
          <p className="text-xs text-gray-500 mt-0.5">
            Items matching these codes or descriptions will be skipped during pricing and generate alerts.
          </p>
        </div>

        <div className="flex gap-2 items-end">
          <div className="flex-1 space-y-1.5">
            <label className="text-xs font-medium text-gray-600">Item Code</label>
            <input
              type="text"
              placeholder="e.g. 1.2.3"
              value={newCode}
              onChange={e => setNewCode(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div className="flex-[2] space-y-1.5">
            <label className="text-xs font-medium text-gray-600">Description (partial match)</label>
            <input
              type="text"
              placeholder="e.g. demolicion"
              value={newDesc}
              onChange={e => setNewDesc(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && addExclude()}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <button
            onClick={addExclude}
            disabled={adding || (!newCode.trim() && !newDesc.trim())}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors disabled:opacity-50 whitespace-nowrap"
          >
            {adding ? 'Adding…' : '+ Add'}
          </button>
        </div>

        {excludes.length === 0 ? (
          <p className="text-sm text-gray-400 italic text-center py-4">No exclusions configured.</p>
        ) : (
          <div className="divide-y divide-gray-100 border border-gray-200 rounded-lg overflow-hidden">
            <div className="grid grid-cols-[1fr_2fr_auto] bg-gray-50 px-4 py-2 text-xs font-medium text-gray-500">
              <span>Item Code</span>
              <span>Description</span>
              <span></span>
            </div>
            {excludes.map(ex => (
              <div key={ex.id} className="grid grid-cols-[1fr_2fr_auto] px-4 py-2.5 items-center text-sm">
                <span className="text-gray-700 font-mono text-xs">{ex.item_code ?? '—'}</span>
                <span className="text-gray-700 text-xs truncate">{ex.description ?? '—'}</span>
                <button
                  onClick={() => removeExclude(ex.id)}
                  className="text-red-400 hover:text-red-600 text-xs font-medium ml-4"
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
