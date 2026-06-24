'use client'

import { useState, useEffect, useCallback } from 'react'
import { useParams } from 'next/navigation'

export default function SettingsPage() {
  const { projectId } = useParams<{ projectId: string }>()

  const [boqFile, setBoqFile] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)
  const [boqMsg, setBoqMsg] = useState('')
  const [boqFileName, setBoqFileName] = useState<string | null>(null)
  const [confirmReplace, setConfirmReplace] = useState(false)

  const [projectName, setProjectName] = useState('')
  const [description, setDescription] = useState('')
  const [currency, setCurrency] = useState('EUR')
  const [threshold, setThreshold] = useState(90)
  const [retentionPct, setRetentionPct] = useState(10)
  const [emailsRaw, setEmailsRaw] = useState('')

  const [saving, setSaving] = useState(false)
  const [saveMsg, setSaveMsg] = useState('')
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    const res = await fetch(`/api/projects/${projectId}/settings`)
    const data = await res.json()
    const p = data.project
    if (p) {
      setProjectName(p.name ?? '')
      setDescription(p.description ?? '')
      setCurrency(p.currency ?? 'EUR')
      setThreshold(p.alert_threshold_pct ?? 90)
      setRetentionPct(p.retention_pct ?? 10)
      setEmailsRaw((p.email_recipients ?? []).join(', '))
      setBoqFileName(p.boq_file_name ?? null)
    }
    setLoading(false)
  }, [projectId])

  useEffect(() => { load() }, [load])

  function handleBoqUploadClick() {
    if (!boqFile) return
    if (boqFileName) {
      setConfirmReplace(true)
    } else {
      doUploadBoq()
    }
  }

  async function doUploadBoq() {
    if (!boqFile) return
    setConfirmReplace(false)
    setUploading(true)
    setBoqMsg('')
    const fd = new FormData()
    fd.append('file', boqFile)
    fd.append('projectId', projectId)
    const res = await fetch('/api/boq/upload', { method: 'POST', body: fd })
    const data = await res.json()
    setUploading(false)
    if (data.error) { setBoqMsg(`❌ ${data.error}`); return }
    setBoqMsg(`✅ Uploaded ${data.count} BOQ items`)
    setBoqFileName(boqFile.name)
  }

  async function saveAll() {
    setSaving(true)
    setSaveMsg('')
    const emails = emailsRaw.split(',').map(e => e.trim()).filter(Boolean)
    const res = await fetch(`/api/projects/${projectId}/settings`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: projectName.trim(),
        description: description.trim() || null,
        currency,
        alert_threshold_pct: threshold,
        retention_pct: retentionPct,
        email_recipients: emails,
      }),
    })
    const data = await res.json()
    setSaving(false)
    setSaveMsg(data.error ? `❌ ${data.error}` : '✅ Settings saved')
    setTimeout(() => setSaveMsg(''), 3000)
  }

  if (loading) {
    return (
      <div className="max-w-2xl space-y-8">
        {[1, 2, 3, 4].map(i => (
          <div key={i} className="bg-white border border-gray-200 rounded-xl p-6 animate-pulse">
            <div className="h-4 bg-gray-200 rounded w-1/3 mb-4" />
            <div className="h-8 bg-gray-100 rounded" />
          </div>
        ))}
      </div>
    )
  }

  return (
    <div className="max-w-2xl space-y-8">

      {/* BOQ replace confirmation modal */}
      {confirmReplace && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: 'white', borderRadius: '14px', padding: '2rem', maxWidth: '440px', width: '90%', boxShadow: '0 20px 60px rgba(0,0,0,.2)' }}>
            <h2 style={{ margin: '0 0 .75rem', fontSize: '1.1rem', fontWeight: 700, color: '#0f172a' }}>Replace existing BOQ?</h2>
            <p style={{ margin: '0 0 .5rem', fontSize: '.9rem', color: '#475569' }}>
              Current file: <strong>{boqFileName}</strong>
            </p>
            <p style={{ margin: '0 0 1.5rem', fontSize: '.9rem', color: '#475569' }}>
              All existing BOQ items and their invoice line-item matches will be permanently deleted before the new file is imported. This cannot be undone.
            </p>
            <div style={{ display: 'flex', gap: '.75rem', justifyContent: 'flex-end' }}>
              <button
                onClick={() => setConfirmReplace(false)}
                style={{ padding: '.5rem 1rem', background: 'none', border: '1px solid #e2e8f0', borderRadius: '8px', fontSize: '.875rem', cursor: 'pointer', color: '#64748b' }}
              >Cancel</button>
              <button
                onClick={doUploadBoq}
                style={{ padding: '.5rem 1.25rem', background: '#dc2626', color: 'white', border: 'none', borderRadius: '8px', fontSize: '.875rem', fontWeight: 600, cursor: 'pointer' }}
              >Replace BOQ</button>
            </div>
          </div>
        </div>
      )}

      {/* General Settings */}
      <div className="bg-white border border-gray-200 rounded-xl p-6">
        <h2 className="text-base font-semibold text-gray-900 mb-4">General Settings</h2>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Project name</label>
            <input
              type="text"
              value={projectName}
              onChange={e => setProjectName(e.target.value)}
              placeholder="Project name…"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
            <input
              type="text"
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="Optional description…"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Currency</label>
            <select
              value={currency}
              onChange={e => setCurrency(e.target.value)}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="EUR">EUR €</option>
              <option value="USD">USD $</option>
              <option value="GBP">GBP £</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Retention (garantía): <span className="text-blue-600 font-bold">{retentionPct}%</span>
            </label>
            <input
              type="range" min={0} max={20} step={0.5} value={retentionPct}
              onChange={e => setRetentionPct(Number(e.target.value))}
              className="w-full"
            />
            <p className="text-xs text-gray-400 mt-1">Deducted from each certificación total to calculate the net payable amount</p>
          </div>
        </div>
      </div>

      {/* BOQ File */}
      <div className="bg-white border border-gray-200 rounded-xl p-6">
        <h2 className="text-base font-semibold text-gray-900 mb-4">BOQ File</h2>
        {boqFileName && (
          <p className="text-sm text-gray-500 mb-3">📄 Current: <span className="font-medium">{boqFileName}</span></p>
        )}
        <div className="flex items-center gap-3">
          <input
            type="file"
            accept=".pdf,.csv,.xlsx,.xls"
            onChange={e => setBoqFile(e.target.files?.[0] ?? null)}
            className="text-sm text-gray-600 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:bg-blue-50 file:text-blue-700 file:text-sm file:font-medium hover:file:bg-blue-100"
          />
          <button
            onClick={handleBoqUploadClick}
            disabled={!boqFile || uploading}
            className="bg-blue-600 text-white px-4 py-1.5 rounded-lg text-sm disabled:opacity-50 hover:bg-blue-700"
          >
            {uploading ? 'Uploading…' : 'Upload'}
          </button>
        </div>
        {boqMsg && <p className="mt-3 text-sm">{boqMsg}</p>}
      </div>

      {/* Alert Settings */}
      <div className="bg-white border border-gray-200 rounded-xl p-6">
        <h2 className="text-base font-semibold text-gray-900 mb-4">Alert Settings</h2>
        <div className="space-y-5">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Alert threshold: <span className="text-blue-600 font-bold">{threshold}%</span>
            </label>
            <input
              type="range" min={50} max={100} value={threshold}
              onChange={e => setThreshold(Number(e.target.value))}
              className="w-full"
            />
            <p className="text-xs text-gray-400 mt-1">Send alert when a chapter reaches {threshold}% of its budget</p>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Email recipients</label>
            <input
              value={emailsRaw}
              onChange={e => setEmailsRaw(e.target.value)}
              placeholder="email1@example.com, email2@example.com"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <p className="text-xs text-gray-400 mt-1">Comma-separated email addresses</p>
          </div>
        </div>
      </div>

      {/* Save button */}
      <div className="flex items-center gap-4 pb-8">
        <button
          onClick={saveAll}
          disabled={saving || !projectName.trim()}
          className="bg-blue-600 text-white px-6 py-2.5 rounded-lg text-sm font-medium disabled:opacity-50 hover:bg-blue-700"
        >
          {saving ? 'Saving…' : 'Save all settings'}
        </button>
        {saveMsg && <span className="text-sm">{saveMsg}</span>}
      </div>

    </div>
  )
}
