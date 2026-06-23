'use client'
import { useState, useEffect, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'

const SETTINGS_ID = 'aaaaaaaa-0000-0000-0000-000000000001'

export default function SettingsPage() {
  const [boqStatus, setBoqStatus] = useState<{ file_name: string | null; uploaded_at: string | null; item_count: number } | null>(null)
  const [uploading, setUploading] = useState(false)
  const [message, setMessage] = useState<{ type: 'ok' | 'err'; text: string } | null>(null)
  const [recipients, setRecipients] = useState<string[]>([])
  const [newEmail, setNewEmail] = useState('')
  const [threshold, setThreshold] = useState(90)
  const [saving, setSaving] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const supabase = createClient()

  useEffect(() => { loadSettings() }, [])

  async function loadSettings() {
    const { data: s } = await supabase.from('settings').select('*').eq('id', SETTINGS_ID).single()
    const { count } = await supabase.from('boq_items').select('*', { count: 'exact', head: true })
    if (s) {
      setBoqStatus({ file_name: s.boq_file_name, uploaded_at: s.boq_uploaded_at, item_count: count ?? 0 })
      setRecipients(s.email_recipients ?? [])
      setThreshold(s.alert_threshold_pct ?? 90)
    }
  }

  async function handleBoqUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    setMessage(null)
    const formData = new FormData()
    formData.append('file', file)
    try {
      const res = await fetch('/api/boq/upload', { method: 'POST', body: formData })
      const data = await res.json()
      if (data.ok) {
        setMessage({ type: 'ok', text: `BOQ loaded: ${data.count} line items extracted from "${file.name}"` })
        await loadSettings()
      } else {
        setMessage({ type: 'err', text: data.error ?? 'Upload failed' })
      }
    } catch (e) {
      setMessage({ type: 'err', text: `Upload failed: ${String(e)}` })
    }
    setUploading(false)
    if (fileRef.current) fileRef.current.value = ''
  }

  function addEmail() {
    const e = newEmail.trim().toLowerCase()
    if (e && /^[^@]+@[^@]+\.[^@]+$/.test(e) && !recipients.includes(e)) {
      setRecipients(r => [...r, e])
      setNewEmail('')
    }
  }

  async function saveSettings() {
    setSaving(true)
    const { error } = await supabase.from('settings')
      .update({ email_recipients: recipients, alert_threshold_pct: threshold, updated_at: new Date().toISOString() })
      .eq('id', SETTINGS_ID)
    setMessage(error ? { type: 'err', text: error.message } : { type: 'ok', text: 'Settings saved' })
    setSaving(false)
  }

  const card: React.CSSProperties = { background: 'white', borderRadius: '12px', border: '1px solid #e2e8f0', padding: '1.5rem', marginBottom: '1.5rem' }
  const labelStyle: React.CSSProperties = { display: 'block', fontSize: '.8rem', fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: '.75rem' }
  const inputStyle: React.CSSProperties = { padding: '.5rem .75rem', border: '1px solid #e2e8f0', borderRadius: '6px', fontSize: '.9rem', outline: 'none', width: '100%', boxSizing: 'border-box' }
  const btnStyle = (color = '#2563eb', disabled = false): React.CSSProperties => ({ padding: '.5rem 1rem', background: disabled ? '#94a3b8' : color, color: 'white', border: 'none', borderRadius: '6px', fontSize: '.875rem', fontWeight: 500, cursor: disabled ? 'not-allowed' : 'pointer' })

  return (
    <div style={{ maxWidth: '680px' }}>
      <h1 style={{ margin: '0 0 1.5rem', fontSize: '1.5rem', fontWeight: 700, color: '#0f172a' }}>Settings</h1>

      {message && (
        <div style={{
          padding: '.875rem 1rem', borderRadius: '8px', marginBottom: '1.5rem', fontSize: '.875rem',
          background: message.type === 'ok' ? '#f0fdf4' : '#fef2f2',
          border: `1px solid ${message.type === 'ok' ? '#bbf7d0' : '#fecaca'}`,
          color: message.type === 'ok' ? '#15803d' : '#dc2626',
          whiteSpace: 'pre-wrap', wordBreak: 'break-word'
        }}>
          {message.type === 'ok' ? '✅ ' : '❌ '}{message.text}
        </div>
      )}

      <div style={card}>
        <span style={labelStyle}>Master BOQ File</span>
        {boqStatus?.file_name ? (
          <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '8px', padding: '1rem', marginBottom: '1rem' }}>
            <div style={{ fontWeight: 600, color: '#15803d', fontSize: '.9rem' }}>✅ {boqStatus.file_name}</div>
            <div style={{ fontSize: '.8rem', color: '#64748b', marginTop: '.25rem' }}>
              {boqStatus.item_count} line items · Uploaded {boqStatus.uploaded_at ? new Date(boqStatus.uploaded_at).toLocaleDateString() : '—'}
            </div>
          </div>
        ) : (
          <div style={{ background: '#fafafa', border: '2px dashed #e2e8f0', borderRadius: '8px', padding: '1rem', marginBottom: '1rem', color: '#94a3b8', fontSize: '.875rem' }}>
            No BOQ file loaded yet.
          </div>
        )}
        <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv,.pdf" style={{ display: 'none' }} onChange={handleBoqUpload} />
        <button style={btnStyle('#2563eb', uploading)} disabled={uploading} onClick={() => fileRef.current?.click()}>
          {uploading ? '⏳ Processing… (may take up to 30s)' : boqStatus?.file_name ? '🔄 Replace BOQ File' : '📂 Upload BOQ File'}
        </button>
        <p style={{ margin: '.75rem 0 0', fontSize: '.78rem', color: '#94a3b8' }}>
          Accepted: Excel (.xlsx, .xls), CSV, or PDF (text-based). Claude extracts chapters, items, units, quantities and prices automatically.
        </p>
      </div>

      <div style={card}>
        <span style={labelStyle}>Email Alert Recipients</span>
        <div style={{ display: 'flex', gap: '.5rem', marginBottom: '.75rem' }}>
          <input
            style={{ ...inputStyle, flex: 1 }}
            type="email"
            placeholder="name@company.com"
            value={newEmail}
            onChange={e => setNewEmail(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && addEmail()}
          />
          <button style={btnStyle()} onClick={addEmail}>Add</button>
        </div>
        {recipients.length === 0 ? (
          <p style={{ fontSize: '.875rem', color: '#94a3b8', margin: 0 }}>No recipients added yet.</p>
        ) : (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.5rem' }}>
            {recipients.map(r => (
              <span key={r} style={{ display: 'flex', alignItems: 'center', gap: '.4rem', background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: '999px', padding: '.25rem .75rem', fontSize: '.8rem', color: '#1d4ed8' }}>
                {r}
                <button onClick={() => setRecipients(rs => rs.filter(x => x !== r))} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#93c5fd', fontWeight: 700, padding: 0, lineHeight: 1 }}>×</button>
              </span>
            ))}
          </div>
        )}
      </div>

      <div style={card}>
        <span style={labelStyle}>Budget Alert Threshold</span>
        <p style={{ margin: '0 0 .75rem', fontSize: '.875rem', color: '#64748b' }}>Send an alert when a chapter reaches <strong>{threshold}%</strong> of its budget.</p>
        <input type="range" min={50} max={100} value={threshold} onChange={e => setThreshold(Number(e.target.value))} style={{ width: '100%' }} />
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '.75rem', color: '#94a3b8' }}>
          <span>50%</span><span>75%</span><span>100%</span>
        </div>
      </div>

      <button style={{ ...btnStyle('#2563eb', saving), padding: '.625rem 1.5rem' }} disabled={saving} onClick={saveSettings}>
        {saving ? 'Saving…' : 'Save Settings'}
      </button>
    </div>
  )
}
