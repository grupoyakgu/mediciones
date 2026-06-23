'use client'

import { useRef, useState } from 'react'

interface Props {
  projectId: string
  boqUploaded: boolean
  onSuccess: () => void
}

type Phase = 'idle' | 'sending' | 'parsing' | 'importing'

export default function BoqUpload({ projectId, boqUploaded, onSuccess }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [pendingFile, setPendingFile] = useState<File | null>(null)
  const [showConfirm, setShowConfirm] = useState(false)
  const [phase, setPhase] = useState<Phase>('idle')
  const [imported, setImported] = useState(0)
  const [total, setTotal] = useState(0)
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null)

  const uploading = phase !== 'idle'

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

  async function startUpload(file: File) {
    setPhase('sending')
    setImported(0)
    setTotal(0)
    setResult(null)

    const formData = new FormData()
    formData.append('file', file)
    formData.append('projectId', projectId)

    try {
      const res = await fetch('/api/boq/upload', { method: 'POST', body: formData })

      if (!res.body) throw new Error('No response body')

      setPhase('parsing')

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''

        for (const line of lines) {
          if (!line.trim()) continue
          let msg: Record<string, unknown>
          try { msg = JSON.parse(line) } catch { continue }

          if (msg.error) {
            setResult({ ok: false, msg: String(msg.error) })
            setPhase('idle')
            return
          }
          if (msg.phase === 'importing') {
            setPhase('importing')
            setTotal(Number(msg.total) || 0)
          }
          if (msg.imported != null) {
            setImported(Number(msg.imported))
            setTotal(Number(msg.total) || 0)
          }
          if (msg.done) {
            setResult({ ok: true, msg: `${msg.count} rows imported successfully.` })
            setPhase('idle')
            onSuccess()
            return
          }
        }
      }

      // Stream ended without a done message
      if (phase !== 'idle') {
        setResult({ ok: false, msg: 'Upload ended unexpectedly.' })
        setPhase('idle')
      }
    } catch (err) {
      setResult({ ok: false, msg: String(err) })
      setPhase('idle')
    }
  }

  const progress = total > 0 ? Math.round((imported / total) * 100) : 0

  function phaseLabel() {
    if (phase === 'sending') return 'Sending file…'
    if (phase === 'parsing') return 'Parsing file…'
    if (phase === 'importing') return `Importing rows… ${imported} / ${total}`
    return ''
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
        <div style={{ marginTop: '0.75rem', maxWidth: 420 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', color: '#6b7280', marginBottom: '0.3rem' }}>
            <span>{phaseLabel()}</span>
            {phase === 'importing' && total > 0 && <span>{progress}%</span>}
          </div>
          <div style={{ height: 7, background: '#e5e7eb', borderRadius: 999, overflow: 'hidden' }}>
            {phase === 'importing' && total > 0 ? (
              <div style={{
                height: '100%',
                width: `${progress}%`,
                background: '#2563eb',
                borderRadius: 999,
                transition: 'width 0.2s ease',
              }} />
            ) : (
              /* indeterminate stripe while sending/parsing */
              <div style={{
                height: '100%',
                width: '40%',
                background: '#93c5fd',
                borderRadius: 999,
                animation: 'boq-slide 1.2s ease-in-out infinite',
              }} />
            )}
          </div>
          <style>{`
            @keyframes boq-slide {
              0%   { margin-left: -40%; }
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
