import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'
import { notFound } from 'next/navigation'
import ProjectOverview from './ProjectOverview'

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
    <ProjectOverview
      projectId={project.id}
      projectName={project.name}
      approvedCount={approvedCount}
      approvedTotal={approvedTotal}
      boqUploaded={project.boq_uploaded ?? false}
    />
  )
}
