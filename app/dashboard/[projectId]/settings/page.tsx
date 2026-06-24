'use client'

import { useState, useEffect, useCallback } from 'react'
import { useParams } from 'next/navigation'

export default function SettingsPage() {
  const { projectId } = useParams<{ projectId: string }>()

  const [boqFile, setBoqFile] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)
  const [boqMsg, setBoqMsg] = useState('')

  const [threshold, setThreshold] = useState(90)
  const [retentionPct, setRetentionPct] = useState(10)
  const [emails, setEmails] = useState<string[]>([])
  const [emailInput, setEmailInput] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveMsg, setSaveMsg] = useState('')

  const [boqFileName, setBoqFileName] = useState<string | null>(null)

  const load = useCallback(async () => {
    const res = await fetch('/api/projects')
    const data = await res.json()
    const project = (data.projects ?? []).find((p: { id: string; alert_threshold_pct?: number; retention_pct?: number; email_recipients?: string[]; boq_file_name?: string }) => p.id === projectId)
    if (project) {
      setThreshold(project.alert_threshold_pct ?? 90)
      setRetentionPct(project.retention_pct ?? 10)
      setEmails(project.email_recipients ?? [])
      setBoqFileName(project.boq_file_name ?? null)
    }
  }, [projectId])

  useEffect(() => { load() }, [load])

  async function uploadBoq() {
    if (!boqFile) return
    setUploading(true)
    setBoqMsg('')
    const fd = new FormData()
    fd.append('file', boqFile)
    fd.append('projectId', projectId)
    const res = await fetch('/api/boq/upload', { method: 'POST', body: fd })
    const data = await res.json()
    setUploading(false)
    if (data.error) { setBoqMsg(`❌ ${data.error}`); return }
    setBoqMsg(`✅ Uploaded ${data.itemCount} BOQ items`)
    setBoqFileName(boqFile.name)
  }

  function addEmail() {
    const e = emailInput.trim().toLowerCase()
    if (!e || emails.includes(e)) { setEmailInput(''); return }
    setEmails(prev => [...prev, e])
    setEmailInput('')
  }

  function removeEmail(email: string) {
    setEmails(prev => prev.filter(e => e !== email))
  }

  async function saveSettings() {
    setSaving(true)
    setSaveMsg('')
    const res = await fetch(`/api/projects/${projectId}/settings`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ alert_threshold_pct: threshold, retention_pct: retentionPct, email_recipients: emails }),
    })
    const data = await res.json()
    setSaving(false)
    setSaveMsg(data.error ? `❌ ${data.error}` : '✅ Settings saved')
    setTimeout(() => setSaveMsg(''), 3000)
  }

  return (
    <div className="max-w-2xl space-y-8">
      {/* BOQ Upload */}
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
            onClick={uploadBoq}
            disabled={!boqFile || uploading}
            className="bg-blue-600 text-white px-4 py-1.5 rounded-lg text-sm disabled:opacity-50 hover:bg-blue-700"
          >
            {uploading ? 'Uploading…' : 'Upload'}
          </button>
        </div>
        {boqMsg && <p className="mt-3 text-sm">{boqMsg}</p>}
      </div>

      {/* Alert settings */}
      <div className="bg-white border border-gray-200 rounded-xl p-6">
        <h2 className="text-base font-semibold text-gray-900 mb-4">Alert Settings</h2>
        <div className="space-y-6">
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
            <label className="block text-sm font-medium text-gray-700 mb-2">Email recipients</label>
            {/* Active email chips */}
            {emails.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-3">
                {emails.map(email => (
                  <span key={email} className="inline-flex items-center gap-1.5 bg-blue-50 text-blue-700 border border-blue-200 text-sm px-3 py-1 rounded-full">
                    {email}
                    <button
                      onClick={() => removeEmail(email)}
                      className="text-blue-400 hover:text-blue-700 leading-none font-medium"
                      title="Remove"
                    >×</button>
                  </span>
                ))}
              </div>
            )}
            {/* Add email input */}
            <div className="flex gap-2">
              <input
                type="email"
                value={emailInput}
                onChange={e => setEmailInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addEmail() } }}
                placeholder="Add email address…"
                className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <button
                onClick={addEmail}
                disabled={!emailInput.trim()}
                className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 text-sm font-medium rounded-lg disabled:opacity-40"
              >
                Add
              </button>
            </div>
            <p className="text-xs text-gray-400 mt-1">Press Enter or click Add. Click × on a chip to remove.</p>
          </div>
        </div>
        <div className="mt-6 flex items-center gap-4">
          <button
            onClick={saveSettings}
            disabled={saving}
            className="bg-blue-600 text-white px-5 py-2 rounded-lg text-sm font-medium disabled:opacity-50 hover:bg-blue-700"
          >
            {saving ? 'Saving…' : 'Save Settings'}
          </button>
          {saveMsg && <span className="text-sm">{saveMsg}</span>}
        </div>
      </div>

      {/* General settings */}
      <div className="bg-white border border-gray-200 rounded-xl p-6">
        <h2 className="text-base font-semibold text-gray-900 mb-4">General Settings</h2>
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
        <div className="mt-6 flex items-center gap-4">
          <button
            onClick={saveSettings}
            disabled={saving}
            className="bg-blue-600 text-white px-5 py-2 rounded-lg text-sm font-medium disabled:opacity-50 hover:bg-blue-700"
          >
            {saving ? 'Saving…' : 'Save Settings'}
          </button>
          {saveMsg && <span className="text-sm">{saveMsg}</span>}
        </div>
      </div>
    </div>
  )
}
