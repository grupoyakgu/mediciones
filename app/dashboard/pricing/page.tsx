'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { parseBoqBuffer, matchItems, groupByChapter } from '@/lib/pricing-matching'

interface PricingProject {
  id: string
  name: string
  unpriced_file_name: string | null
  created_at: string
}

interface BillingProject { id: string; name: string }

type SourceType = 'project' | 'file'
type WizardStep = 'name' | 'files' | 'running'

export default function PricingListPage() {
  const router = useRouter()
  const [projects, setProjects] = useState<PricingProject[]>([])
  const [loading, setLoading] = useState(true)
  const [showWizard, setShowWizard] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<PricingProject | null>(null)
  const [deleting, setDeleting] = useState(false)

  // Wizard state
  const [wizardStep, setWizardStep] = useState<WizardStep>('name')
  const [newName, setNewName] = useState('')

  const [unpricedFile, setUnpricedFile] = useState<File | null>(null)
  const [unpricedItems, setUnpricedItems] = useState<{ count: number; buffer: ArrayBuffer } | null>(null)
  const [unpricedParsing, setUnpricedParsing] = useState(false)

  const [sourceType, setSourceType] = useState<SourceType>('project')
  const [billingProjects, setBillingProjects] = useState<BillingProject[]>([])
  const [billingProjectsLoaded, setBillingProjectsLoaded] = useState(false)
  const [selectedProjectId, setSelectedProjectId] = useState('')
  const [refFile, setRefFile] = useState<File | null>(null)
  const [refBuffer, setRefBuffer] = useState<ArrayBuffer | null>(null)

  const [statusMsg, setStatusMsg] = useState('')

  const unpricedInputRef = useRef<HTMLInputElement>(null)
  const refInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { load() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function load() {
    const res = await fetch('/api/pricing-projects')
    const data = await res.json()
    setProjects(data.projects ?? [])
    setLoading(false)
  }

  function openWizard() {
    setWizardStep('name')
    setNewName('')
    setUnpricedFile(null)
    setUnpricedItems(null)
    setRefFile(null)
    setRefBuffer(null)
    setSelectedProjectId('')
    setStatusMsg('')
    setShowWizard(true)
  }

  async function handleUnpricedFile(file: File) {
    setUnpricedFile(file)
    setUnpricedParsing(true)
    const buf = await file.arrayBuffer()
    const items = parseBoqBuffer(buf)
    setUnpricedItems({ count: items.length, buffer: buf })
    setUnpricedParsing(false)
    // Pre-load billing projects for the source selector
    if (!billingProjectsLoaded) {
      const res = await fetch('/api/projects')
      const data = await res.json()
      setBillingProjects(data.projects ?? [])
      setBillingProjectsLoaded(true)
    }
  }

  async function handleRefFile(file: File) {
    setRefFile(file)
    const buf = await file.arrayBuffer()
    setRefBuffer(buf)
  }

  const canRunMatching =
    !!unpricedItems &&
    ((sourceType === 'project' && !!selectedProjectId) ||
     (sourceType === 'file' && !!refBuffer))

  async function createAndMatch() {
    if (!newName.trim() || !unpricedItems) return
    setWizardStep('running')

    // 1. Create the project
    setStatusMsg('Creating project…')
    const createRes = await fetch('/api/pricing-projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newName.trim() }),
    })
    const createData = await createRes.json()
    if (!createData.project) {
      alert('Failed to create project')
      setWizardStep('files')
      return
    }
    const projectId: string = createData.project.id

    // 2. Load reference items
    setStatusMsg('Loading reference BOQ…')
    let refItems
    if (sourceType === 'project' && selectedProjectId) {
      const res = await fetch(`/api/projects/${selectedProjectId}/boq`)
      const data = await res.json()
      refItems = data.items ?? []
    } else if (sourceType === 'file' && refBuffer) {
      refItems = parseBoqBuffer(refBuffer)
    } else {
      refItems = []
    }

    if (refItems.length === 0) {
      alert('No reference items found.')
      setWizardStep('files')
      return
    }

    // 3. Run matching
    setStatusMsg(`Matching ${unpricedItems.count} items…`)
    const unpricedRaw = parseBoqBuffer(unpricedItems.buffer)
    const { matched } = matchItems(unpricedRaw, refItems, [])
    const grouped = groupByChapter(matched)

    // 4. Save results to DB
    setStatusMsg('Saving results…')
    await fetch(`/api/pricing-projects/${projectId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        results: grouped,
        unpriced_file_name: unpricedFile?.name ?? null,
        ref_items: refItems,
      }),
    })

    window.dispatchEvent(new Event('projectsChanged'))
    router.push(`/dashboard/pricing/${projectId}`)
  }

  async function deleteProject() {
    if (!confirmDelete) return
    setDeleting(true)
    await fetch(`/api/pricing-projects/${confirmDelete.id}`, { method: 'DELETE' })
    setDeleting(false)
    setProjects(prev => prev.filter(p => p.id !== confirmDelete.id))
    setConfirmDelete(null)
    window.dispatchEvent(new Event('projectsChanged'))
  }

  const card: React.CSSProperties = {
    background: 'white', borderRadius: '12px', border: '1px solid #e2e8f0',
    padding: '1.5rem', cursor: 'pointer', transition: 'box-shadow .15s',
  }

  return (
    <div>
      {/* Delete confirm modal */}
      {confirmDelete && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: 'white', borderRadius: '14px', padding: '2rem', maxWidth: '420px', width: '90%', boxShadow: '0 20px 60px rgba(0,0,0,.2)' }}>
            <h2 style={{ margin: '0 0 .75rem', fontSize: '1.1rem', fontWeight: 700, color: '#0f172a' }}>Delete pricing project?</h2>
            <p style={{ margin: '0 0 1.5rem', fontSize: '.9rem', color: '#475569' }}>
              <strong>{confirmDelete.name}</strong> and all its results and alerts will be permanently deleted.
            </p>
            <div style={{ display: 'flex', gap: '.75rem', justifyContent: 'flex-end' }}>
              <button onClick={() => setConfirmDelete(null)} disabled={deleting} style={{ padding: '.5rem 1rem', background: 'none', border: '1px solid #e2e8f0', borderRadius: '8px', fontSize: '.875rem', cursor: 'pointer', color: '#64748b' }}>Cancel</button>
              <button onClick={deleteProject} disabled={deleting} style={{ padding: '.5rem 1.25rem', background: '#dc2626', color: 'white', border: 'none', borderRadius: '8px', fontSize: '.875rem', fontWeight: 600, cursor: deleting ? 'not-allowed' : 'pointer' }}>
                {deleting ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* New project wizard modal */}
      {showWizard && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
          <div style={{ background: 'white', borderRadius: '16px', padding: '2rem', maxWidth: '580px', width: '100%', boxShadow: '0 24px 80px rgba(0,0,0,.25)', maxHeight: '90vh', overflowY: 'auto' }}>

            {wizardStep === 'running' ? (
              <div style={{ textAlign: 'center', padding: '3rem 1rem' }}>
                <div style={{ width: '48px', height: '48px', border: '4px solid #2563eb', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 1s linear infinite', margin: '0 auto 1.5rem' }} />
                <p style={{ color: '#475569', fontSize: '.95rem', margin: 0 }}>{statusMsg}</p>
                <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
              </div>
            ) : (
              <>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.5rem' }}>
                  <h2 style={{ margin: 0, fontSize: '1.2rem', fontWeight: 700, color: '#0f172a' }}>New Pricing Project</h2>
                  <button onClick={() => setShowWizard(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8', fontSize: '1.25rem', lineHeight: 1 }}>✕</button>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                  {/* Project name */}
                  <div>
                    <label style={{ display: 'block', fontSize: '.8rem', fontWeight: 600, color: '#374151', marginBottom: '.4rem', textTransform: 'uppercase', letterSpacing: '.04em' }}>Project Name</label>
                    <input
                      autoFocus
                      value={newName}
                      onChange={e => setNewName(e.target.value)}
                      placeholder="e.g. Edificio Yakgu – Phase 2"
                      style={{ width: '100%', padding: '.6rem .75rem', border: '1px solid #d1d5db', borderRadius: '8px', fontSize: '.9rem', outline: 'none', boxSizing: 'border-box' }}
                      onFocus={e => (e.target.style.borderColor = '#2563eb')}
                      onBlur={e => (e.target.style.borderColor = '#d1d5db')}
                    />
                  </div>

                  {/* Unpriced BOQ */}
                  <div>
                    <label style={{ display: 'block', fontSize: '.8rem', fontWeight: 600, color: '#374151', marginBottom: '.4rem', textTransform: 'uppercase', letterSpacing: '.04em' }}>Unpriced BOQ File</label>
                    <input ref={unpricedInputRef} type="file" accept=".xlsx,.xls,.pdf" style={{ display: 'none' }}
                      onChange={e => { const f = e.target.files?.[0]; if (f) handleUnpricedFile(f); e.target.value = '' }} />
                    {unpricedFile ? (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '.75rem', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '8px', padding: '.75rem 1rem' }}>
                        <span style={{ color: '#16a34a', fontSize: '1.1rem' }}>✓</span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontWeight: 600, color: '#15803d', fontSize: '.875rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{unpricedFile.name}</div>
                          <div style={{ fontSize: '.75rem', color: '#16a34a', marginTop: '.1rem' }}>
                            {unpricedParsing ? 'Parsing…' : `${unpricedItems?.count ?? 0} items parsed`}
                          </div>
                        </div>
                        <button onClick={() => unpricedInputRef.current?.click()} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#2563eb', fontSize: '.8rem', whiteSpace: 'nowrap' }}>Replace</button>
                      </div>
                    ) : (
                      <button onClick={() => unpricedInputRef.current?.click()}
                        style={{ width: '100%', border: '2px dashed #d1d5db', borderRadius: '8px', padding: '1.5rem', background: 'none', cursor: 'pointer', textAlign: 'center', transition: 'border-color .15s' }}
                        onMouseEnter={e => (e.currentTarget.style.borderColor = '#2563eb')}
                        onMouseLeave={e => (e.currentTarget.style.borderColor = '#d1d5db')}>
                        <div style={{ fontSize: '1.5rem', marginBottom: '.4rem' }}>📄</div>
                        <div style={{ color: '#6b7280', fontSize: '.875rem' }}>Click to select unpriced BOQ (.xlsx, .xls, .pdf)</div>
                      </button>
                    )}
                  </div>

                  {/* Reference source — only show once unpriced file is loaded */}
                  {unpricedItems && (
                    <div>
                      <label style={{ display: 'block', fontSize: '.8rem', fontWeight: 600, color: '#374151', marginBottom: '.4rem', textTransform: 'uppercase', letterSpacing: '.04em' }}>Reference Pricing Source</label>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '.5rem', marginBottom: '.75rem' }}>
                        {(['project', 'file'] as SourceType[]).map(type => (
                          <button key={type} onClick={() => setSourceType(type)}
                            style={{
                              padding: '.75rem', borderRadius: '8px', textAlign: 'left', cursor: 'pointer', transition: 'all .15s',
                              border: sourceType === type ? '2px solid #2563eb' : '2px solid #e5e7eb',
                              background: sourceType === type ? '#eff6ff' : 'white',
                            }}>
                            <div style={{ fontWeight: 600, color: '#0f172a', fontSize: '.85rem', marginBottom: '.2rem' }}>
                              {type === 'project' ? '📁 Existing Project' : '📄 Upload File'}
                            </div>
                            <div style={{ fontSize: '.75rem', color: '#6b7280' }}>
                              {type === 'project' ? 'Use a priced BOQ from your projects' : 'Upload a priced BOQ Excel file'}
                            </div>
                          </button>
                        ))}
                      </div>

                      {sourceType === 'project' && (
                        billingProjects.length === 0
                          ? <p style={{ fontSize: '.875rem', color: '#9ca3af', fontStyle: 'italic', margin: 0 }}>No projects found.</p>
                          : <select value={selectedProjectId} onChange={e => setSelectedProjectId(e.target.value)}
                              style={{ width: '100%', padding: '.6rem .75rem', border: '1px solid #d1d5db', borderRadius: '8px', fontSize: '.875rem', outline: 'none', background: 'white' }}>
                              <option value="">— Choose a project —</option>
                              {billingProjects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                            </select>
                      )}

                      {sourceType === 'file' && (
                        <>
                          <input ref={refInputRef} type="file" accept=".xlsx,.xls" style={{ display: 'none' }}
                            onChange={e => { const f = e.target.files?.[0]; if (f) handleRefFile(f); e.target.value = '' }} />
                          {refFile ? (
                            <div style={{ display: 'flex', alignItems: 'center', gap: '.75rem', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '8px', padding: '.75rem 1rem' }}>
                              <span style={{ color: '#16a34a' }}>✓</span>
                              <span style={{ flex: 1, fontWeight: 600, color: '#15803d', fontSize: '.875rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{refFile.name}</span>
                              <button onClick={() => { setRefFile(null); setRefBuffer(null) }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9ca3af', fontSize: '1rem' }}>✕</button>
                            </div>
                          ) : (
                            <button onClick={() => refInputRef.current?.click()}
                              style={{ width: '100%', border: '2px dashed #d1d5db', borderRadius: '8px', padding: '1.25rem', background: 'none', cursor: 'pointer', textAlign: 'center' }}
                              onMouseEnter={e => (e.currentTarget.style.borderColor = '#2563eb')}
                              onMouseLeave={e => (e.currentTarget.style.borderColor = '#d1d5db')}>
                              <div style={{ color: '#6b7280', fontSize: '.875rem' }}>Click to select reference BOQ (.xlsx / .xls)</div>
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  )}

                  <button
                    onClick={createAndMatch}
                    disabled={!newName.trim() || !canRunMatching}
                    style={{
                      width: '100%', padding: '.75rem', background: (!newName.trim() || !canRunMatching) ? '#94a3b8' : '#0f172a',
                      color: 'white', border: 'none', borderRadius: '8px', fontSize: '.95rem', fontWeight: 600,
                      cursor: (!newName.trim() || !canRunMatching) ? 'not-allowed' : 'pointer', marginTop: '.25rem',
                    }}>
                    Create &amp; Run Matching →
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: '1.5rem', fontWeight: 700, color: '#0f172a' }}>Pricing Projects</h1>
          <p style={{ margin: '.25rem 0 0', color: '#64748b', fontSize: '.875rem' }}>{projects.length} project{projects.length !== 1 ? 's' : ''}</p>
        </div>
        <button onClick={openWizard}
          style={{ padding: '.5rem 1.25rem', background: '#0f172a', color: 'white', border: 'none', borderRadius: '8px', fontSize: '.875rem', fontWeight: 500, cursor: 'pointer' }}>
          + New Pricing Project
        </button>
      </div>

      {/* Project list */}
      {loading ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '1rem' }}>
          {[1, 2, 3].map(i => (
            <div key={i} style={{ ...card, cursor: 'default', background: '#f8fafc' }}>
              <div style={{ height: '1rem', background: '#e2e8f0', borderRadius: '4px', marginBottom: '.75rem', width: '60%' }} />
              <div style={{ height: '.75rem', background: '#e2e8f0', borderRadius: '4px', width: '40%' }} />
            </div>
          ))}
        </div>
      ) : projects.length === 0 ? (
        <div style={{ background: 'white', borderRadius: '12px', border: '2px dashed #e2e8f0', padding: '4rem 2rem', textAlign: 'center', color: '#94a3b8' }}>
          <div style={{ fontSize: '2.5rem', marginBottom: '1rem' }}>$</div>
          <p style={{ margin: 0 }}>No pricing projects yet. Click <strong>+ New Pricing Project</strong> to get started.</p>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '1rem' }}>
          {projects.map(p => (
            <div key={p.id} style={{ ...card, position: 'relative' }}
              onClick={() => router.push(`/dashboard/pricing/${p.id}`)}
              onMouseEnter={e => (e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,.08)')}
              onMouseLeave={e => (e.currentTarget.style.boxShadow = 'none')}>
              <button
                onClick={e => { e.stopPropagation(); setConfirmDelete(p) }}
                style={{ position: 'absolute', top: '.75rem', right: '.75rem', background: 'none', border: 'none', cursor: 'pointer', color: '#cbd5e1', fontSize: '1rem', lineHeight: 1, padding: '.25rem', borderRadius: '4px' }}
                onMouseEnter={e => (e.currentTarget.style.color = '#ef4444')}
                onMouseLeave={e => (e.currentTarget.style.color = '#cbd5e1')}
                title="Delete pricing project">✕</button>
              <div style={{ display: 'flex', alignItems: 'center', gap: '.75rem', marginBottom: '.75rem' }}>
                <div style={{ width: '40px', height: '40px', borderRadius: '10px', background: '#f0fdf4', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.1rem', fontWeight: 700, color: '#16a34a', flexShrink: 0 }}>$</div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 600, color: '#0f172a', fontSize: '.95rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</div>
                  <div style={{ fontSize: '.75rem', color: '#94a3b8', marginTop: '.1rem' }}>Created {new Date(p.created_at).toLocaleDateString()}</div>
                </div>
              </div>
              <div style={{ fontSize: '.8rem', color: p.unpriced_file_name ? '#15803d' : '#94a3b8' }}>
                {p.unpriced_file_name ? `✅ ${p.unpriced_file_name}` : '⬜ No file uploaded yet'}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
