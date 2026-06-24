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
  const [emailsRaw, setEmailsRaw] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveMsg, setSaveMsg] = useState('')

  const [boqFileName, setBoqFileName] = useState<string | null>(null)
  const [projectName, setProjectName] = useState('')
  const [nameSaving, setNameSaving] = useState(false)
  const [nameMsg, setNameMsg] = useState('')

  const load = useCallback(async () => {
    const res = await fetch('/api/projects')
    const data = await res.json()
    const project = (data.projects ?? []).find((p: { id: string; name?: string; alert_threshold_pct?: number; retention_pct?: number; email_recipients?: string[]; boq_file_name?: string }) => p.id === projectId)
    if (project) {
      setProjectName(project.name ?? '')
      setThreshold(project.alert_threshold_pct ?? 90)
      setRetentionPct(project.retention_pct ?? 10)
      setEmailsRaw((project.email_recipients ?? []).join(', '))
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

  async function saveSettings() {
    setSaving(true)
    setSaveMsg('')
    const emails = emailsRaw.split(',').map(e => e.trim()).filter(Boolean)
    const res = await fetch(`/api/projects/${projectId}/settings`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ alert_threshold_pct: threshold, retention_pct: retentionPct, email_recipients: emails }),
    })
    const data = await res.json()
    setSaving(false)
    setSaveMsg(data.error ? `❌ ${data.error}` : '✅ Settings saved')
  }

  async function renameProject() {
    const name = projectName.trim()
    if (!name) return
    setNameSaving(true)
    setNameMsg('')
    const res = await fetch(`/api/projects/${projectId}/settings`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    })
    const data = await res.json()
    setNameSaving(false)
    setNameMsg(data.error ? `❌ ${data.error}` : '✅ Project renamed')
    setTimeout(() => setNameMsg(''), 3000)
  }

  return (
    <div className="max-w-2xl space-y-8">
      {/* Project name */}
      <div className="bg-white border border-gray-200 rounded-xl p-6">
        <h2 className="text-base font-semibold text-gray-900 mb-4">Project Name</h2>
        <div className="flex gap-3">
          <input
            type="text"
            value={projectName}
            onChange={e => setProjectName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') renameProject() }}
            placeholder="Project name…"
            className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button
            onClick={renameProject}
            disabled={nameSaving || !projectName.trim()}
            className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50 hover:bg-blue-700"
          >
            {nameSaving ? 'Saving…' : 'Rename'}
          </button>
        </div>
        {nameMsg && <p className="mt-2 text-sm">{nameMsg}</p>}
      </div>

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
        <div className="space-y-5">
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
