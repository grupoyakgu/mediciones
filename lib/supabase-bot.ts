import { createClient } from '@supabase/supabase-js'

export function createBotClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Missing Supabase env vars for bot')
  return createClient(url, key)
}

export interface ProjectRow {
  id: string
  name: string
  boq_file_name: string | null
  boq_uploaded_at: string | null
}

export async function listAllProjects(): Promise<ProjectRow[]> {
  const supabase = createBotClient()
  const { data, error } = await supabase
    .from('projects')
    .select('id, name, boq_file_name, boq_uploaded_at')
    .order('name')
  if (error) throw error
  return data ?? []
}

export async function findProjectByName(name: string): Promise<ProjectRow | null> {
  const supabase = createBotClient()
  const { data } = await supabase
    .from('projects')
    .select('id, name, boq_file_name, boq_uploaded_at')
    .ilike('name', `%${name}%`)
    .limit(1)
    .single()
  return data ?? null
}

export async function buildProjectContext(projectId: string): Promise<string> {
  const supabase = createBotClient()

  const [{ data: project }, { data: boqItems }, { data: invoices }] = await Promise.all([
    supabase
      .from('projects')
      .select('name, boq_file_name, boq_uploaded_at')
      .eq('id', projectId)
      .single(),
    supabase
      .from('boq_items')
      .select('chapter_id, chapter_name, item_code, description, unit, quantity, unit_price, total_amount')
      .eq('project_id', projectId)
      .order('chapter_id'),
    supabase
      .from('invoices')
      .select('invoice_number, supplier, invoice_date, total_amount, status')
      .eq('project_id', projectId)
      .order('invoice_date', { ascending: false })
      .limit(20),
  ])

  let ctx = `## Active Project: ${project?.name ?? 'Unknown'}\n`
  if (project?.boq_file_name) ctx += `BOQ file: ${project.boq_file_name}\n`
  ctx += '\n### Bill of Quantities (BOQ Items):\n'

  if (boqItems && boqItems.length > 0) {
    ctx += 'chapter_id | chapter_name | item_code | description | unit | quantity | unit_price | total_amount\n'
    for (const item of boqItems) {
      ctx += `${item.chapter_id ?? ''} | ${item.chapter_name ?? ''} | ${item.item_code ?? ''} | ${item.description ?? ''} | ${item.unit ?? ''} | ${item.quantity ?? ''} | ${item.unit_price ?? ''} | ${item.total_amount ?? ''}\n`
    }
    const budgetTotal = (boqItems as Array<{total_amount: number | null}>)
      .reduce((s, r) => s + (r.total_amount ?? 0), 0)
    ctx += `\nTotal BOQ items: ${boqItems.length}\n`
    ctx += `Total budget: €${budgetTotal.toLocaleString('es-ES', { minimumFractionDigits: 2 })}\n`
  } else {
    ctx += 'No BOQ items loaded yet. The user needs to upload a BOQ Excel file from the dashboard first.\n'
  }

  if (invoices && invoices.length > 0) {
    ctx += '\n### Invoices Processed:\n'
    const invTotal = (invoices as Array<{total_amount: number | null}>)
      .reduce((s, r) => s + (r.total_amount ?? 0), 0)
    for (const inv of (invoices as Array<{invoice_number: string | null; supplier: string | null; invoice_date: string | null; total_amount: number | null; status: string | null}>)) {
      ctx += `- ${inv.invoice_number ?? 'N/A'} | ${inv.supplier ?? ''} | ${inv.invoice_date ?? ''} | €${inv.total_amount ?? 0}\n`
    }
    ctx += `Total invoiced: €${invTotal.toLocaleString('es-ES', { minimumFractionDigits: 2 })}\n`
  } else {
    ctx += '\n### Invoices: None processed yet.\n'
  }

  return ctx
}
