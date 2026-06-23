import { createClient } from '@supabase/supabase-js'

function getAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

export async function listAllProjects(): Promise<{ id: string; name: string }[]> {
  const { data, error } = await getAdmin()
    .from('projects')
    .select('id, name')
    .order('created_at', { ascending: false })
  if (error) return []
  return data ?? []
}

export async function findProjectByName(name: string): Promise<{ id: string; name: string } | null> {
  const { data, error } = await getAdmin()
    .from('projects')
    .select('id, name')
    .ilike('name', `%${name}%`)
    .limit(1)
    .single()
  if (error || !data) return null
  return data
}

export async function buildProjectContext(projectId: string): Promise<string> {
  const supabaseAdmin = getAdmin()
  const PAGE = 500
  let from = 0
  const boqItems: Record<string, unknown>[] = []

  while (true) {
    const { data, error } = await supabaseAdmin
      .from('boq_items')
      .select('chapter_id,chapter_name,item_code,description,unit,quantity,unit_price,total_amount')
      .eq('project_id', projectId)
      .order('chapter_id', { ascending: true })
      .range(from, from + PAGE - 1)
    if (error || !data || data.length === 0) break
    boqItems.push(...data)
    if (data.length < PAGE) break
    from += PAGE
  }

  const { data: invoices } = await getAdmin()
    .from('invoices')
    .select('id,invoice_number,invoice_date,supplier,total_amount,status')
    .eq('project_id', projectId)
    .order('invoice_date', { ascending: false })
    .limit(20)

  const totalBOQ = boqItems.reduce((sum, item) => {
    const t = (item.total_amount as number | null) ?? ((item.quantity as number ?? 0) * (item.unit_price as number ?? 0))
    return sum + t
  }, 0)

  const approvedInvoices = (invoices ?? []).filter((inv) => inv.status === 'approved')
  const totalApproved = approvedInvoices.reduce((sum, inv) => sum + (inv.total_amount ?? 0), 0)

  const lines: string[] = [
    `BOQ: ${boqItems.length} items, total budget: €${totalBOQ.toLocaleString('es-ES', { minimumFractionDigits: 2 })}`,
    `Invoices: ${(invoices ?? []).length} total, ${approvedInvoices.length} approved, approved total: €${totalApproved.toLocaleString('es-ES', { minimumFractionDigits: 2 })}`,
    '',
    'RECENT INVOICES:',
    ...(invoices ?? []).slice(0, 10).map((inv) =>
      `  #${inv.invoice_number} | ${inv.invoice_date} | ${inv.supplier ?? '-'} | €${(inv.total_amount ?? 0).toLocaleString('es-ES', { minimumFractionDigits: 2 })} | ${inv.status}`
    ),
    '',
    'BOQ CHAPTERS SUMMARY:',
  ]

  const chapters = new Map<string, { name: string; total: number }>()
  for (const item of boqItems) {
    const chId = (item.chapter_id as string ?? '').split('.')[0]
    const chName = item.chapter_name as string ?? ''
    const t = (item.total_amount as number | null) ?? ((item.quantity as number ?? 0) * (item.unit_price as number ?? 0))
    const existing = chapters.get(chId)
    if (!existing) chapters.set(chId, { name: chName, total: t })
    else existing.total += t
  }

  for (const [chId, { name, total }] of Array.from(chapters.entries()).sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true }))) {
    lines.push(`  ${chId} — ${name}: €${total.toLocaleString('es-ES', { minimumFractionDigits: 2 })}`)
  }

  return lines.join('\n')
}
