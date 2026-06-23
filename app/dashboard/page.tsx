'use client'

export const dynamic = 'force-dynamic'

import { useEffect, useState, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { createSupabaseBrowserClient } from '@/lib/supabase-client'

interface Project {
  id: string
  name: string
  created_at: string
  boq_uploaded: boolean
}

export default function DashboardPage() {
  const router = useRouter()
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)
  const [newName, setNewName] = useState('')
  const [creating, setCreating] = useState(false)
  const supabase = useMemo(() => {
    if (typeof window === 'undefined') return null
    return createSupabaseBrowserClient()
  }, [])

  useEffect(() => {
    loadProjects()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function loadProjects() {
    if (!supabase) return
    setLoading(true)
    const { data } = await supabase
      .from('projects')
      .select('id, name, created_at, boq_uploaded')
      .order('created_at', { ascending: false })
    setProjects(data ?? [])
    setLoading(false)
  }

  async function createProject(e: React.FormEvent) {
    e.preventDefault()
    if (!newName.trim() || !supabase) return
    setCreating(true)
    const { data, error } = await supabase
      .from('projects')
      .insert({ name: newName.trim() })
      .select('id')
      .single()
    setCreating(false)
    if (!error && data) {
      setNewName('')
      router.push(`/dashboard/${data.id}`)
    }
  }

  return (
    <div style={{ maxWidth: 900, margin: '0 auto', padding: '2rem' }}>
      <h1 style={{ fontSize: '1.75rem', fontWeight: 700, marginBottom: '0.5rem' }}>Projects</h1>
      <p style={{ color: '#6b7280', marginBottom: '2rem' }}>Select a project to view its overview, BOQ, and invoices.</p>

      <form onSubmit={createProject} style={{ display: 'flex', gap: '0.5rem', marginBottom: '2rem' }}>
        <input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="New project name…"
          style={{ flex: 1, padding: '0.5rem 0.75rem', border: '1px solid #d1d5db', borderRadius: 6, fontSize: '0.875rem' }}
        />
        <button
          type="submit"
          disabled={creating}
          style={{ padding: '0.5rem 1rem', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: '0.875rem' }}
        >
          {creating ? 'Creating…' : '+ New Project'}
        </button>
      </form>

      {loading ? (
        <p style={{ color: '#9ca3af' }}>Loading…</p>
      ) : projects.length === 0 ? (
        <p style={{ color: '#9ca3af' }}>No projects yet. Create one above.</p>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '1rem' }}>
          {projects.map((p) => (
            <div
              key={p.id}
              onClick={() => router.push(`/dashboard/${p.id}`)}
              style={{
                border: '1px solid #e5e7eb',
                borderRadius: 10,
                padding: '1.25rem',
                cursor: 'pointer',
                background: '#fff',
                transition: 'box-shadow 0.15s',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.1)')}
              onMouseLeave={(e) => (e.currentTarget.style.boxShadow = 'none')}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.75rem' }}>
                <div style={{
                  width: 40, height: 40, borderRadius: 8,
                  background: '#2563eb', color: '#fff',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontWeight: 700, fontSize: '1.1rem',
                }}>
                  {p.name.charAt(0).toUpperCase()}
                </div>
                <div>
                  <div style={{ fontWeight: 600, fontSize: '0.95rem' }}>{p.name}</div>
                  <div style={{ fontSize: '0.75rem', color: '#9ca3af' }}>
                    {new Date(p.created_at).toLocaleDateString()}
                  </div>
                </div>
              </div>
              <div style={{
                display: 'inline-block',
                padding: '0.2rem 0.6rem',
                borderRadius: 9999,
                fontSize: '0.75rem',
                background: p.boq_uploaded ? '#dcfce7' : '#fef3c7',
                color: p.boq_uploaded ? '#166534' : '#92400e',
              }}>
                {p.boq_uploaded ? 'BOQ loaded' : 'No BOQ'}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
