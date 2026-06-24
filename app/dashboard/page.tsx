'use client'
import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'

interface Project {
  id: string
  name: string
  boq_file_name: string | null
  boq_uploaded_at: string | null
  created_at: string
}

export default function AllProjectsPage() {
  const supabase = createClient()
  const router = useRouter()
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [showNew, setShowNew] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<Project | null>(null)
  const [deleting, setDeleting] = useState(false)

  useEffect(() => { load() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function load() {
    const { data } = await supabase.from('projects').select('id, name, boq_file_name, boq_uploaded_at, created_at').order('created_at', { ascending: false })
    setProjects(data ?? [])
    setLoading(false)
  }

  async function createProject() {
    const name = newName.trim()
    if (!name) return
    setCreating(true)
    const { data, error } = await supabase.from('projects').insert({ name }).select('id').single()
    setCreating(false)
    if (!error && data) {
      setNewName('')
      setShowNew(false)
      window.dispatchEvent(new Event('projectsChanged'))
      router.refresh()
      router.push(`/dashboard/${data.id}`)
    }
  }

  async function deleteProject() {
    if (!confirmDelete) return
    setDeleting(true)
    // CASCADE on DB handles boq_items, invoices, invoice_items
    await supabase.from('projects').delete().eq('id', confirmDelete.id)
    setProjects(prev => prev.filter(p => p.id !== confirmDelete.id))
    setConfirmDelete(null)
    setDeleting(false)
    window.dispatchEvent(new Event('projectsChanged'))
    router.refresh()
  }

  const card: React.CSSProperties = { background: 'white', borderRadius: '12px', border: '1px solid #e2e8f0', padding: '1.5rem', cursor: 'pointer', transition: 'box-shadow .15s' }

  if (loading) {
    return (
      <div>
        <h1 style={{ margin: '0 0 1.5rem', fontSize: '1.5rem', fontWeight: 700, color: '#0f172a' }}>All Projects</h1>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '1rem' }}>
          {[1,2,3].map(i => (
            <div key={i} style={{ ...card, cursor: 'default', background: '#f8fafc', animation: 'pulse 1.5s infinite' }}>
              <div style={{ height: '1rem', background: '#e2e8f0', borderRadius: '4px', marginBottom: '.75rem', width: '60%' }} />
              <div style={{ height: '.75rem', background: '#e2e8f0', borderRadius: '4px', width: '40%' }} />
            </div>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div>
      {/* Delete confirmation modal */}
      {confirmDelete && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: 'white', borderRadius: '14px', padding: '2rem', maxWidth: '420px', width: '90%', boxShadow: '0 20px 60px rgba(0,0,0,.2)' }}>
            <h2 style={{ margin: '0 0 .75rem', fontSize: '1.1rem', fontWeight: 700, color: '#0f172a' }}>Delete project?</h2>
            <p style={{ margin: '0 0 1.5rem', fontSize: '.9rem', color: '#475569' }}>
              <strong>{confirmDelete.name}</strong> and all its BOQ items, invoices, and line items will be permanently deleted. This cannot be undone.
            </p>
            <div style={{ display: 'flex', gap: '.75rem', justifyContent: 'flex-end' }}>
              <button onClick={() => setConfirmDelete(null)} disabled={deleting} style={{ padding: '.5rem 1rem', background: 'none', border: '1px solid #e2e8f0', borderRadius: '8px', fontSize: '.875rem', cursor: 'pointer', color: '#64748b' }}>Cancel</button>
              <button onClick={deleteProject} disabled={deleting} style={{ padding: '.5rem 1.25rem', background: '#dc2626', color: 'white', border: 'none', borderRadius: '8px', fontSize: '.875rem', fontWeight: 600, cursor: deleting ? 'not-allowed' : 'pointer' }}>
                {deleting ? 'Deleting…' : 'Delete project'}
              </button>
            </div>
          </div>
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: '1.5rem', fontWeight: 700, color: '#0f172a' }}>All Projects</h1>
          <p style={{ margin: '.25rem 0 0', color: '#64748b', fontSize: '.875rem' }}>{projects.length} project{projects.length !== 1 ? 's' : ''}</p>
        </div>
        <button
          onClick={() => setShowNew(s => !s)}
          style={{ padding: '.5rem 1.25rem', background: '#0f172a', color: 'white', border: 'none', borderRadius: '8px', fontSize: '.875rem', fontWeight: 500, cursor: 'pointer' }}
        >
          + New Project
        </button>
      </div>

      {showNew && (
        <div style={{ background: 'white', borderRadius: '12px', border: '1px solid #e2e8f0', padding: '1.25rem', marginBottom: '1.25rem', display: 'flex', gap: '.75rem' }}>
          <input
            autoFocus
            style={{ flex: 1, padding: '.5rem .75rem', border: '1px solid #e2e8f0', borderRadius: '6px', fontSize: '.9rem', outline: 'none' }}
            placeholder="Project name…"
            value={newName}
            onChange={e => setNewName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && createProject()}
          />
          <button
            onClick={createProject}
            disabled={creating || !newName.trim()}
            style={{ padding: '.5rem 1rem', background: creating ? '#94a3b8' : '#2563eb', color: 'white', border: 'none', borderRadius: '6px', fontSize: '.875rem', fontWeight: 500, cursor: creating ? 'not-allowed' : 'pointer' }}
          >
            {creating ? 'Creating…' : 'Create'}
          </button>
          <button onClick={() => setShowNew(false)} style={{ padding: '.5rem .75rem', background: 'none', border: '1px solid #e2e8f0', borderRadius: '6px', fontSize: '.875rem', cursor: 'pointer', color: '#64748b' }}>Cancel</button>
        </div>
      )}

      {projects.length === 0 ? (
        <div style={{ background: 'white', borderRadius: '12px', border: '2px dashed #e2e8f0', padding: '4rem 2rem', textAlign: 'center', color: '#94a3b8' }}>
          <div style={{ fontSize: '2.5rem', marginBottom: '1rem' }}>📂</div>
          <p style={{ margin: 0 }}>No projects yet. Click <strong>+ New Project</strong> to get started.</p>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '1rem' }}>
          {projects.map(p => (
            <div
              key={p.id}
              style={{ ...card, position: 'relative' }}
              onClick={() => router.push(`/dashboard/${p.id}`)}
              onMouseEnter={e => (e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,.08)')}
              onMouseLeave={e => (e.currentTarget.style.boxShadow = 'none')}
            >
              <button
                onClick={e => { e.stopPropagation(); setConfirmDelete(p) }}
                style={{ position: 'absolute', top: '.75rem', right: '.75rem', background: 'none', border: 'none', cursor: 'pointer', color: '#cbd5e1', fontSize: '1rem', lineHeight: 1, padding: '.25rem', borderRadius: '4px' }}
                onMouseEnter={e => (e.currentTarget.style.color = '#ef4444')}
                onMouseLeave={e => (e.currentTarget.style.color = '#cbd5e1')}
                title="Delete project"
              >✕</button>
              <div style={{ display: 'flex', alignItems: 'center', gap: '.75rem', marginBottom: '.75rem' }}>
                <div style={{ width: '40px', height: '40px', borderRadius: '10px', background: '#eff6ff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.1rem', fontWeight: 700, color: '#2563eb', flexShrink: 0 }}>
                  {p.name.charAt(0).toUpperCase()}
                </div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 600, color: '#0f172a', fontSize: '.95rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</div>
                  <div style={{ fontSize: '.75rem', color: '#94a3b8', marginTop: '.1rem' }}>
                    Created {new Date(p.created_at).toLocaleDateString()}
                  </div>
                </div>
              </div>
              <div style={{ fontSize: '.8rem', color: p.boq_file_name ? '#15803d' : '#94a3b8' }}>
                {p.boq_file_name
                  ? `✅ BOQ: ${p.boq_file_name}`
                  : '⬜ No BOQ uploaded yet'}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
