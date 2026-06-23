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
    if (!confirm(`Delete project "${name}" and all its data? This cannot be undone.`)) return
    await fetch(`/api/projects?id=${id}`, { method: 'DELETE' })
    load()
  }

  if (loading) {
    return <div className="text-center py-20 text-gray-500">Loading projects…</div>
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Projects</h1>
        <button
          onClick={() => setShowNew(true)}
          className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 text-sm font-medium"
        >
          + New Project
        </button>
      </div>

      {showNew && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-md">
            <h2 className="text-lg font-semibold mb-4">New Project</h2>
            {error && <p className="text-red-500 text-sm mb-3">{error}</p>}
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Name *</label>
                <input
                  value={newName}
                  onChange={e => setNewName(e.target.value)}
                  placeholder="e.g. Edificio Calle Mayor"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
                <textarea
                  value={newDesc}
                  onChange={e => setNewDesc(e.target.value)}
                  rows={2}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Currency</label>
                <select
                  value={newCurrency}
                  onChange={e => setNewCurrency(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option>EUR</option><option>USD</option><option>GBP</option>
                </select>
              </div>
            </div>
            <div className="flex gap-3 mt-6">
              <button
                onClick={createProject}
                disabled={creating || !newName.trim()}
                className="flex-1 bg-blue-600 text-white py-2 rounded-lg text-sm font-medium disabled:opacity-50 hover:bg-blue-700"
              >
                {creating ? 'Creating…' : 'Create Project'}
              </button>
              <button
                onClick={() => { setShowNew(false); setError('') }}
                className="flex-1 border border-gray-300 py-2 rounded-lg text-sm hover:bg-gray-50"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {projects.length === 0 ? (
        <div className="text-center py-20">
          <p className="text-5xl mb-4">📁</p>
          <p className="text-gray-500 text-lg">No projects yet.</p>
          <p className="text-gray-400 text-sm mt-1">Create your first project to get started.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {projects.map(p => (
            <div
              key={p.id}
              className="bg-white border border-gray-200 rounded-xl p-5 hover:shadow-md transition-shadow cursor-pointer"
              onClick={() => router.push(`/dashboard/${p.id}`)}
            >
              <div className="flex items-start justify-between">
                <div className="flex-1 min-w-0">
                  <h2 className="font-semibold text-gray-900 truncate">{p.name}</h2>
                  {p.description && <p className="text-sm text-gray-500 mt-1 line-clamp-2">{p.description}</p>}
                </div>
                <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded ml-2 shrink-0">{p.currency}</span>
              </div>
              <div className="mt-3 pt-3 border-t border-gray-100 flex items-center justify-between">
                <span className="text-xs text-gray-400">
                  {p.boq_file_name ? `📄 ${p.boq_file_name}` : '⚠️ No BOQ uploaded'}
                </span>
                <button
                  onClick={e => { e.stopPropagation(); deleteProject(p.id, p.name) }}
                  className="text-xs text-red-400 hover:text-red-600"
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
