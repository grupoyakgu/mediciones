'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'

interface Project {
  id: string
  name: string
  description?: string
  currency: string
  boq_file_name?: string
  boq_uploaded_at?: string
  created_at: string
}

export default function ProjectsPage() {
  const router = useRouter()
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)
  const [showNew, setShowNew] = useState(false)
  const [newName, setNewName] = useState('')
  const [newDesc, setNewDesc] = useState('')
  const [newCurrency, setNewCurrency] = useState('EUR')
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    const res = await fetch('/api/projects')
    const data = await res.json()
    setProjects(data.projects ?? [])
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  async function createProject() {
    if (!newName.trim()) return
    setCreating(true)
    setError('')
    const res = await fetch('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newName, description: newDesc, currency: newCurrency }),
    })
    const data = await res.json()
    setCreating(false)
    if (data.error) { setError(data.error); return }
    setShowNew(false)
    setNewName('')
    setNewDesc('')
    router.push(`/dashboard/${data.id}`)
  }

  async function deleteProject(id: string, name: string) {
    if (!confirm(`Delete "${name}" and all its data?`)) return
    await fetch(`/api/projects?id=${id}`, { method: 'DELETE' })
    load()
  }

  return (
    <div>
      {/* Page header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Projects</h1>
          <p className="text-sm text-gray-500 mt-0.5">{projects.length} project{projects.length !== 1 ? 's' : ''}</p>
        </div>
        <button
          onClick={() => setShowNew(true)}
          className="bg-black text-white px-4 py-2 rounded-lg hover:bg-gray-800 text-sm font-medium transition-colors"
        >
          + New Project
        </button>
      </div>

      {/* New project modal */}
      {showNew && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-2xl p-6 w-full max-w-md border border-gray-200">
            <h2 className="text-base font-semibold mb-4">New Project</h2>
            {error && <p className="text-red-500 text-sm mb-3">{error}</p>}
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1.5">Name *</label>
                <input
                  value={newName}
                  onChange={e => setNewName(e.target.value)}
                  placeholder="e.g. Edificio Calle Mayor"
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black"
                  autoFocus
                  onKeyDown={e => e.key === 'Enter' && createProject()}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1.5">Description</label>
                <textarea
                  value={newDesc}
                  onChange={e => setNewDesc(e.target.value)}
                  rows={2}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black resize-none"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1.5">Currency</label>
                <select
                  value={newCurrency}
                  onChange={e => setNewCurrency(e.target.value)}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black"
                >
                  <option>EUR</option><option>USD</option><option>GBP</option>
                </select>
              </div>
            </div>
            <div className="flex gap-3 mt-6">
              <button
                onClick={createProject}
                disabled={creating || !newName.trim()}
                className="flex-1 bg-black text-white py-2 rounded-lg text-sm font-medium disabled:opacity-40 hover:bg-gray-800 transition-colors"
              >
                {creating ? 'Creating…' : 'Create'}
              </button>
              <button
                onClick={() => { setShowNew(false); setError('') }}
                className="flex-1 border border-gray-200 py-2 rounded-lg text-sm hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Project grid */}
      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1,2,3].map(i => (
            <div key={i} className="h-32 bg-gray-100 rounded-xl animate-pulse" />
          ))}
        </div>
      ) : projects.length === 0 ? (
        <div className="text-center py-24 border-2 border-dashed border-gray-200 rounded-xl">
          <p className="text-3xl mb-3">📁</p>
          <p className="text-gray-600 font-medium">No projects yet</p>
          <p className="text-gray-400 text-sm mt-1">Create your first project to get started</p>
          <button
            onClick={() => setShowNew(true)}
            className="mt-4 bg-black text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-gray-800 transition-colors"
          >
            + New Project
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {projects.map(p => (
            <div
              key={p.id}
              onClick={() => router.push(`/dashboard/${p.id}`)}
              className="group bg-white border border-gray-200 rounded-xl p-5 hover:border-gray-400 hover:shadow-sm transition-all cursor-pointer"
            >
              <div className="flex items-start justify-between mb-3">
                <div className="w-8 h-8 rounded-lg bg-gray-900 flex items-center justify-center text-white text-sm font-bold">
                  {p.name.charAt(0).toUpperCase()}
                </div>
                <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full font-medium">{p.currency}</span>
              </div>
              <h2 className="font-semibold text-gray-900 truncate">{p.name}</h2>
              {p.description && (
                <p className="text-sm text-gray-400 mt-0.5 line-clamp-1">{p.description}</p>
              )}
              <div className="mt-4 pt-3 border-t border-gray-100 flex items-center justify-between">
                <span className="text-xs text-gray-400">
                  {p.boq_file_name
                    ? <span className="text-green-600">✓ BOQ uploaded</span>
                    : <span className="text-amber-500">⚠ No BOQ</span>
                  }
                </span>
                <button
                  onClick={e => { e.stopPropagation(); deleteProject(p.id, p.name) }}
                  className="text-xs text-gray-300 hover:text-red-500 transition-colors opacity-0 group-hover:opacity-100"
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
