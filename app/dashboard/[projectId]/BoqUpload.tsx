'use client'

import { useRef, useState } from 'react'

interface Props {
  projectId: string
  boqUploaded: boolean
  onSuccess: () => void
}

type Phase = 'idle' | 'uploading'

const PHASE_LABEL: Record<Phase, string> = {
  idle: '',
  uploading: 'Uploading and importing…',
}

export default function BoqUpload({ projectId, boqUploaded, onSuccess }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [pendingFile, setPendingFile] = useState<File | null>(null)
  const [showConfirm, setShowConfirm] = useState(false)
  const [phase, setPhase] = useState<Phase>('idle')
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null)
  const [localUploaded, setLocalUploaded] = useState(boqUploaded)

  const uploading = phase !== 'idle'
  const hasBoq = localUploaded

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setResult(null)
    if (hasBoq) {
      setPendingFile(file)
      setShowConfirm(true)
    } else {
      startUpload(file)
    }
    e.target.value = ''
  }

  function confirmReplace() {
    setShowConfirm(false)
    if (pendingFile) startUpload(pendingFile)
    setPendingFile(null)
  }

  function cancelReplace() {
    setShowConfirm(false)
    setPendingFile(null)
  }

  async function startUpload(file: File) {
    setPhase('uploading')
    setResult(null)

    const formData = new FormData()
    formData.append('file', file)
    formData.append('projectId', projectId)

    try {
      const res = await fetch('/api/boq/upload', { method: 'POST', body: formData })
      const data = await res.json()

      if (data.error) {
        setResult({ ok: false, msg: String(data.error) })
        setPhase('idle')
        return
      }

      const debugSuffix = data.boq_update_error ? ` ⚠️ DB flag error: ${data.boq_update_error}` : ''
      setResult({ ok: true, msg: `✅ ${data.count} rows imported successfully.${debugSuffix}` })
      setLocalUploaded(true)
      setPhase('idle')
      onSuccess()
    } catch (err) {
      setResult({ ok: false, msg: String(err) })
      setPhase('idle')
    }
  }

  return (
    <div style={{ marginBottom: '1.5rem' }}>
      <input
        ref={inputRef}
        type="file"
        accept=".xlsx,.xls,.csv,.txt"
        onChange={handleFileChange}
        style={{ display: 'none' }}
      />

      <button
        onClick={() => !uploading && inputRef.current?.click()}
        disabled={uploading}
        style={{
          padding: '0.5rem 1.25rem',
          background: uploading ? '#93c5fd' : '#2563eb',
          color: '#fff',
          border: 'none',
          borderRadius: 6,
          cursor: uploading ? 'not-allowed' : 'pointer',
          fontSize: '0.875rem',
          fontWeight: 500,
        }}
      >
        {uploading ? 'Uploading…' : hasBoq ? 'Replace BOQ File' : 'Upload BOQ File'}
      </button>

      {uploading && (
        <div style={{ marginTop: '0.75rem', maxWidth: 440 }}>
          <div style={{ fontSize: '0.8rem', color: '#6b7280', marginBottom: '0.3rem' }}>
            {PHASE_LABEL[phase]}
          </div>
          <div style={{ height: 7, background: '#e5e7eb', borderRadius: 999, overflow: 'hidden' }}>
            <div style={{
              height: '100%',
              width: '35%',
              background: '#93c5fd',
              borderRadius: 999,
              animation: 'boq-slide 1.1s ease-in-out infinite',
            }} />
          </div>
          <style>{`
            @keyframes boq-slide {
              0%   { margin-left: -35%; }
              100% { margin-left: 100%; }
            }
          `}</style>
        </div>
      )}

      {result && (
        <p style={{
          marginTop: '0.6rem',
          fontSize: '0.875rem',
          color: result.ok ? '#166534' : '#991b1b',
          background: result.ok ? '#dcfce7' : '#fee2e2',
          padding: '0.4rem 0.75rem',
          borderRadius: 6,
          display: 'inline-block',
        }}>
          {result.msg}
        </p>
      )}

      {/* Confirmation modal — shown when a BOQ already exists */}
      {showConfirm && (
        <div style={{
          position: 'fixed', inset: 0,
          background: 'rgba(0,0,0,0.45)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          zIndex: 50,
        }}>
          <div style={{
            background: '#fff',
            borderRadius: 12,
            padding: '2rem',
            maxWidth: 440,
            width: '90%',
            boxShadow: '0 20px 60px rgba(0,0,0,0.25)',
          }}>
            <h3 style={{ fontSize: '1.1rem', fontWeight: 700, marginBottom: '0.75rem', color: '#111827' }}>
              Replace existing BOQ?
            </h3>

            <div style={{
              background: '#fef3c7',
              border: '1px solid #fcd34d',
              borderRadius: 8,
              padding: '0.75rem 1rem',
              marginBottom: '1.25rem',
              fontSize: '0.875rem',
              color: '#92400e',
              lineHeight: 1.6,
            }}>
              <strong>Warning:</strong> All existing BOQ items for this project will be
              permanently deleted before the new file is imported. This cannot be undone.
            </div>

            <p style={{ fontSize: '0.875rem', color: '#374151', marginBottom: '1.5rem', lineHeight: 1.6 }}>
              Do you want to continue and replace the current BOQ with{' '}
              <strong>{pendingFile?.name}</strong>?
            </p>

            <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' }}>
              <button
                onClick={cancelReplace}
                style={{
                  padding: '0.5rem 1.1rem',
                  border: '1px solid #d1d5db',
                  borderRadius: 6,
                  background: '#fff',
                  cursor: 'pointer',
                  fontSize: '0.875rem',
                  color: '#374151',
                }}
              >
                Cancel
              </button>
              <button
                onClick={confirmReplace}
                style={{
                  padding: '0.5rem 1.1rem',
                  background: '#dc2626',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 6,
                  cursor: 'pointer',
                  fontSize: '0.875rem',
                  fontWeight: 600,
                }}
              >
                Yes, delete and replace
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
