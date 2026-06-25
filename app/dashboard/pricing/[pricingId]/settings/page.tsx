'use client'

import { useState, useEffect } from 'react'
import { useParams } from 'next/navigation'

interface ExcludeEntry {
  id: string
  item_code: string | null
  description: string | null
  created_at: string
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

  useEffect(() => {
    fetch(`/api/pricing-projects/${pricingId}`)
      .then(r => r.json())
      .then(d => { if (d.project) setName(d.project.name) })
    fetch(`/api/pricing-projects/${pricingId}/excludes`)
      .then(r => r.json())
      .then(d => setExcludes(d.excludes ?? []))
  }, [pricingId])

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

  return (
    <div className="max-w-2xl mx-auto py-10 px-4 space-y-8">
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
