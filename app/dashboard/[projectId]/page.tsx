import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import BoqTable from './BoqTable'

async function getProjectData(projectId: string) {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  const { data: project } = await supabase
    .from('projects')
    .select('id, name, created_at, boq_uploaded')
    .eq('id', projectId)
    .single()

  if (!project) return null

  const { data: invoices } = await supabase
    .from('invoices')
    .select('id, total_amount, status')
    .eq('project_id', projectId)
    .eq('status', 'approved')

  const approvedTotal = (invoices ?? []).reduce((s, inv) => s + (inv.total_amount ?? 0), 0)
  const approvedCount = (invoices ?? []).length

  return { project, approvedTotal, approvedCount }
}

export default async function ProjectPage({ params }: { params: { projectId: string } }) {
  const data = await getProjectData(params.projectId)
  if (!data) notFound()

  const { project, approvedTotal, approvedCount } = data

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', padding: '2rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '0.5rem' }}>
        <Link href="/dashboard" style={{ color: '#2563eb', textDecoration: 'none', fontSize: '0.875rem' }}>
          ← Projects
        </Link>
      </div>

      <h1 style={{ fontSize: '1.75rem', fontWeight: 700, marginBottom: '0.25rem' }}>{project.name}</h1>
      <p style={{ color: '#6b7280', fontSize: '0.875rem', marginBottom: '2rem' }}>
        Overview · approved invoices only
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '1rem', marginBottom: '2rem' }}>
        <KpiCard label="Approved invoices" value={approvedCount.toString()} />
        <KpiCard label="Approved total" value={`€${approvedTotal.toLocaleString('es-ES', { minimumFractionDigits: 2 })}`} />
        <KpiCard label="BOQ status" value={project.boq_uploaded ? 'Loaded' : 'Not loaded'} />
      </div>

      <div style={{ display: 'flex', gap: '1rem', marginBottom: '2rem' }}>
        <Link
          href={`/dashboard/${project.id}/invoices`}
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

      <BoqTable projectId={params.projectId} />
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
