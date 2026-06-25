'use client'

import { useState, useEffect } from 'react'
import { useParams, usePathname, useRouter } from 'next/navigation'
import Link from 'next/link'

export default function PricingProjectLayout({ children }: { children: React.ReactNode }) {
  const params = useParams()
  const pricingId = params.pricingId as string
  const pathname = usePathname()
  const router = useRouter()

  const [name, setName] = useState('')
  const [editing, setEditing] = useState(false)
  const [editValue, setEditValue] = useState('')

  useEffect(() => {
    fetch(`/api/pricing-projects/${pricingId}`)
      .then(r => r.json())
      .then(d => { if (d.project) setName(d.project.name) })
  }, [pricingId])

  async function saveName() {
    if (!editValue.trim()) return
    await fetch(`/api/pricing-projects/${pricingId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: editValue.trim() }),
    })
    setName(editValue.trim())
    setEditing(false)
  }

  async function deleteProject() {
    if (!confirm('Delete this pricing project? This cannot be undone.')) return
    await fetch(`/api/pricing-projects/${pricingId}`, { method: 'DELETE' })
    router.push('/dashboard/pricing')
  }

  const base = `/dashboard/pricing/${pricingId}`
  const navItems = [
    { label: 'Pricing', href: base },
    { label: 'Settings', href: `${base}/settings` },
    { label: 'Alerts', href: `${base}/alerts` },
  ]

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="max-w-[1200px] mx-auto">
          <div className="flex items-center gap-2 mb-1">
            <Link href="/dashboard/pricing" className="text-xs text-gray-400 hover:text-gray-600">
              Pricing Projects
            </Link>
            <span className="text-xs text-gray-300">/</span>
            {editing ? (
              <div className="flex items-center gap-2">
                <input
                  autoFocus
                  value={editValue}
                  onChange={e => setEditValue(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') saveName(); if (e.key === 'Escape') setEditing(false) }}
                  className="text-lg font-bold text-gray-900 border-b-2 border-blue-500 outline-none bg-transparent"
                />
                <button onClick={saveName} className="text-xs text-blue-600 hover:underline">Save</button>
                <button onClick={() => setEditing(false)} className="text-xs text-gray-400 hover:underline">Cancel</button>
              </div>
            ) : (
              <button
                onClick={() => { setEditValue(name); setEditing(true) }}
                className="text-lg font-bold text-gray-900 hover:text-blue-600 transition-colors"
              >
                {name || '…'}
              </button>
            )}
            <button onClick={deleteProject} className="ml-auto text-xs text-red-400 hover:text-red-600">
              Delete project
            </button>
          </div>

          <nav className="flex gap-1 mt-3">
            {navItems.map(item => {
              const active = item.href === base
                ? pathname === base
                : pathname.startsWith(item.href)
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`px-4 py-1.5 text-sm rounded-md transition-colors ${
                    active
                      ? 'bg-blue-100 text-blue-700 font-medium'
                      : 'text-gray-600 hover:bg-gray-100'
                  }`}
                >
                  {item.label}
                </Link>
              )
            })}
          </nav>
        </div>
      </div>
      <div className="max-w-[1200px] mx-auto">
        {children}
      </div>
    </div>
  )
}
