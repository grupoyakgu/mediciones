'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'

interface PricingProject {
  id: string
  name: string
  created_at: string
}

export default function PricingListPage() {
  const router = useRouter()
  const [projects, setProjects] = useState<PricingProject[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    fetch('/api/pricing-projects')
      .then(r => r.json())
      .then(d => setProjects(d.projects ?? []))
      .finally(() => setLoading(false))
  }, [])

  async function createProject() {
    setCreating(true)
    const name = `Pricing Project ${new Date().toLocaleDateString('es-ES')}`
    const res = await fetch('/api/pricing-projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    })
    const data = await res.json()
    setCreating(false)
    if (data.project) router.push(`/dashboard/pricing/${data.project.id}`)
  }

  return (
    <div className="max-w-3xl mx-auto py-10 px-4">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Pricing Projects</h1>
          <p className="text-sm text-gray-500 mt-1">Manage BOQ pricing workflows</p>
        </div>
        <button
          onClick={createProject}
          disabled={creating}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors disabled:opacity-50"
        >
          {creating ? 'Creating…' : '+ New Pricing Project'}
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-40">
          <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : projects.length === 0 ? (
        <div className="text-center py-16 bg-white rounded-xl border border-gray-200">
          <p className="text-gray-500 text-sm">No pricing projects yet.</p>
          <button
            onClick={createProject}
            disabled={creating}
            className="mt-4 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors disabled:opacity-50"
          >
            Create your first project
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {projects.map(p => (
            <button
              key={p.id}
              onClick={() => router.push(`/dashboard/pricing/${p.id}`)}
              className="w-full text-left bg-white rounded-xl border border-gray-200 px-6 py-4 hover:border-blue-300 hover:bg-blue-50/30 transition-colors"
            >
              <p className="text-sm font-semibold text-gray-900">{p.name}</p>
              <p className="text-xs text-gray-400 mt-0.5">
                Created {new Date(p.created_at).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' })}
              </p>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
