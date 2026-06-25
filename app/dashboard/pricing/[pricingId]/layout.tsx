'use client'

import { useState, useEffect, useRef } from 'react'
import { useParams, usePathname, useRouter } from 'next/navigation'
import Link from 'next/link'

export default function PricingProjectLayout({ children }: { children: React.ReactNode }) {
  const params = useParams()
  const pricingId = params.pricingId as string
  const pathname = usePathname()
  const router = useRouter()
  const inputRef = useRef<HTMLInputElement>(null)

  const [name, setName] = useState('')
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    fetch(`/api/pricing-projects/${pricingId}`)
      .then(r => r.json())
      .then(d => { if (d.project) setName(d.project.name) })
  }, [pricingId])

  function startEdit() {
    setDraft(name)
    setEditing(true)
    setTimeout(() => inputRef.current?.select(), 0)
  }

  async function saveName() {
    const trimmed = draft.trim()
    if (!trimmed || trimmed === name) { setEditing(false); return }
    setSaving(true)
    await fetch(`/api/pricing-projects/${pricingId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: trimmed }),
    })
    setName(trimmed)
    setEditing(false)
    setSaving(false)
    window.dispatchEvent(new Event('projectsChanged'))
    router.refresh()
  }

  async function deleteProject() {
    if (!confirm(`Delete "${name}"? This cannot be undone.`)) return
    await fetch(`/api/pricing-projects/${pricingId}`, { method: 'DELETE' })
    window.dispatchEvent(new Event('projectsChanged'))
    router.push('/dashboard/pricing')
  }

  const base = `/dashboard/pricing/${pricingId}`
  const navItems = [
    { label: 'Pricing', href: base },
    { label: 'Settings', href: `${base}/settings` },
    { label: 'Alerts', href: `${base}/alerts` },
  ]

  return (
    <div>
      <div className="border-b border-gray-200 pb-4 mb-6">
        {editing ? (
          <div className="flex items-center gap-2 mb-1">
            <input
              ref={inputRef}
              autoFocus
              value={draft}
              onChange={e => setDraft(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') saveName(); if (e.key === 'Escape') setEditing(false) }}
              className="text-xl font-semibold text-gray-900 border border-blue-400 rounded-lg px-2 py-0.5 focus:outline-none focus:ring-2 focus:ring-blue-500 min-w-0 flex-1 max-w-md"
            />
            <button
              onClick={saveName}
              disabled={saving || !draft.trim()}
              className="text-sm px-3 py-1 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
            <button onClick={() => setEditing(false)} className="text-sm px-3 py-1 border border-gray-300 rounded-lg text-gray-600 hover:bg-gray-50">
              Cancel
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-2 group mb-1">
            <h1 className="text-xl font-semibold text-gray-900">{name || '…'}</h1>
            <button
              onClick={startEdit}
              title="Rename project"
              className="opacity-0 group-hover:opacity-100 transition-opacity text-gray-400 hover:text-gray-600 text-sm px-1.5 py-0.5 rounded hover:bg-gray-100"
            >✎</button>
            <button
              onClick={deleteProject}
              title="Delete project"
              className="opacity-0 group-hover:opacity-100 transition-opacity text-gray-400 hover:text-red-500 text-xs px-2 py-0.5 rounded hover:bg-red-50 ml-auto"
            >Delete</button>
          </div>
        )}
        <p className="text-sm text-gray-500">Pricing Project</p>

        <nav className="flex gap-1 mt-4">
          {navItems.map(item => {
            const active = item.href === base ? pathname === base : pathname.startsWith(item.href)
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`px-4 py-1.5 text-sm rounded-md transition-colors ${
                  active ? 'bg-gray-900 text-white font-medium' : 'text-gray-600 hover:bg-gray-100'
                }`}
              >
                {item.label}
              </Link>
            )
          })}
        </nav>
      </div>

      {children}
    </div>
  )
}
