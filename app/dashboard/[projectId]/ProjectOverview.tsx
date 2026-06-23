'use client'

import { useState } from 'react'
import Link from 'next/link'
import BoqUpload from './BoqUpload'
import BoqTable from './BoqTable'

interface Props {
  projectId: string
  projectName: string
  approvedCount: number
  approvedTotal: number
  boqUploaded: boolean
}

export default function ProjectOverview({
  projectId,
  projectName,
  approvedCount,
  approvedTotal,
  boqUploaded: initialBoqUploaded,
}: Props) {
  const [boqUploaded, setBoqUploaded] = useState(initialBoqUploaded)
  const [boqKey, setBoqKey] = useState(0)

  function handleBoqSuccess() {
    setBoqUploaded(true)
    setBoqKey((k) => k + 1)
  }

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', padding: '2rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '0.5rem' }}>
        <Link href="/dashboard" style={{ color: '#2563eb', textDecoration: 'none', fontSize: '0.875rem' }}>
          ← Projects
        </Link>
      </div>

      <h1 style={{ fontSize: '1.75rem', fontWeight: 700, marginBottom: '0.25rem' }}>{projectName}</h1>
      <p style={{ color: '#6b7280', fontSize: '0.875rem', marginBottom: '2rem' }}>
        Overview · approved invoices only
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '1rem', marginBottom: '2rem' }}>
        <KpiCard label="Approved invoices" value={approvedCount.toString()} />
        <KpiCard label="Approved total" value={`€${approvedTotal.toLocaleString('es-ES', { minimumFractionDigits: 2 })}`} />
        <KpiCard label="BOQ status" value={boqUploaded ? 'Loaded' : 'Not loaded'} />
      </div>

      <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', marginBottom: '2rem', flexWrap: 'wrap' }}>
        <Link
          href={`/dashboard/${projectId}/invoices`}
          style={{
            display: 'inline-block',
            padding: '0.5rem 1.25rem',
            background: '#2563eb',
            color: '#fff',
            borderRadius: 6,
            textDecoration: 'none',
            fontSize: '0.875rem',
            fontWeight: 500,
          }}
        >
          Manage Invoices
        </Link>
      </div>

      <BoqUpload projectId={projectId} boqUploaded={boqUploaded} onSuccess={handleBoqSuccess} />

      <BoqTable key={boqKey} projectId={projectId} />
    </div>
  )
}

function KpiCard({ label, value }: { label: string; value: string }) {
  return (
    <div style={{
      border: '1px solid #e5e7eb',
      borderRadius: 10,
      padding: '1rem 1.25rem',
      background: '#fff',
    }}>
      <div style={{ fontSize: '0.75rem', color: '#6b7280', marginBottom: '0.4rem' }}>{label}</div>
      <div style={{ fontSize: '1.4rem', fontWeight: 700, color: '#111827' }}>{value}</div>
    </div>
  )
}
