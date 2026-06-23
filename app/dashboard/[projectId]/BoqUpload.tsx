'use client'

import { useRef, useState } from 'react'

interface Props {
  projectId: string
  boqUploaded: boolean
  onSuccess: () => void
}

export default function BoqUpload({ projectId, boqUploaded, onSuccess }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [pendingFile, setPendingFile] = useState<File | null>(null)
  const [showConfirm, setShowConfirm] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [progress, setProgress] = useState(0)
  const [phase, setPhase] = useState<'uploading' | 'processing'>('uploading')
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null)

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setResult(null)
    if (boqUploaded) {
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

  function startUpload(file: File) {
    setUploading(true)
    setProgress(0)
    setPhase('uploading')
    setResult(null)

    const formData = new FormData()
    formData.append('file', file)
    formData.append('projectId', projectId)

    const xhr = new XMLHttpRequest()
    let interval: ReturnType<typeof setInterval> | undefined

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) {
        setProgress(Math.round((e.loaded / e.total) * 30))
      }
    }

    xhr.upload.onload = () => {
      setPhase('processing')
      let pct = 30
      interval = setInterval(() => {
        pct = Math.min(95, pct + Math.random() * 3)
        setProgress(Math.round(pct))
      }, 600)
    }

    xhr.onload = () => {
      if (interval) clearInterval(interval)
      setProgress(100)
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const data = JSON.parse(xhr.responseText)
          setResult({ ok: true, msg: `BOQ loaded: ${data.count ?? '?'} items imported.` })
        } catch {
          setResult({ ok: true, msg: 'BOQ uploaded successfully.' })
        }
        onSuccess()
      } else {
        try {
          const data = JSON.parse(xhr.responseText)
          setResult({ ok: false, msg: data.error ?? 'Upload failed.' })
        } catch {
          setResult({ ok: false, msg: 'Upload failed.' })
        }
      }
      setUploading(false)
    }

    xhr.onerror = () => {
      if (interval) clearInterval(interval)
      setResult({ ok: false, msg: 'Network error during upload.' })
      setUploading(false)
    }

    xhr.open('POST', '/api/boq/upload')
    xhr.send(formData)
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
        {uploading ? 'Uploading…' : boqUploaded ? 'Replace BOQ File' : 'Upload BOQ File'}
      </button>

      {uploading && (
        <div style={{ marginTop: '0.75rem', maxWidth: 400 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', color: '#6b7280', marginBottom: '0.25rem' }}>
            <span>{phase === 'uploading' ? 'Uploading file…' : 'Processing with AI…'}</span>
            <span>{progress}%</span>
          </div>
          <div style={{ height: 6, background: '#e5e7eb', borderRadius: 999, overflow: 'hidden' }}>
            <div style={{
              height: '100%',
              width: `${progress}%`,
              background: phase === 'processing' ? '#7c3aed' : '#2563eb',
              borderRadius: 999,
              transition: 'width 0.4s ease',
            }} />
          </div>
        </div>
      )}

      {result && (
        <p style={{
          marginTop: '0.5rem',
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

      {showConfirm && (
        <div style={{
          position: 'fixed', inset: 0,
          background: 'rgba(0,0,0,0.4)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          zIndex: 50,
        }}>
          <div style={{
            background: '#fff',
            borderRadius: 12,
            padding: '2rem',
            maxWidth: 420,
            width: '90%',
            boxShadow: '0 20px 60px rgba(0,0,0,0.2)',
          }}>
            <h3 style={{ fontSize: '1.1rem', fontWeight: 700, marginBottom: '0.5rem', color: '#111827' }}>
              Replace existing BOQ?
            </h3>
            <p style={{ fontSize: '0.875rem', color: '#6b7280', marginBottom: '1.5rem', lineHeight: 1.6 }}>
              This project already has a BOQ loaded. Uploading a new file will{' '}
              <strong style={{ color: '#b91c1c' }}>permanently delete all existing BOQ items</strong>{' '}
              and replace them with the new file. This cannot be undone.
            </p>
            <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' }}>
              <button
                onClick={cancelReplace}
                style={{
                  padding: '0.5rem 1rem',
                  border: '1px solid #d1d5db',
                  borderRadius: 6,
                  background: '#fff',
                  cursor: 'pointer',
                  fontSize: '0.875rem',
                }}
              >
                Cancel
              </button>
              <button
                onClick={confirmReplace}
                style={{
                  padding: '0.5rem 1rem',
                  background: '#dc2626',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 6,
                  cursor: 'pointer',
                  fontSize: '0.875rem',
                  fontWeight: 500,
                }}
              >
                Yes, replace BOQ
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
