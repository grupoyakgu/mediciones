import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

function makeSupabase() {
  const cookieStore = cookies()
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (toSet: { name: string; value: string; options: Parameters<typeof cookieStore.set>[2] }[]) => {
          toSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options))
        }
      }
    }
  )
}

export async function GET(
  _req: NextRequest,
  { params }: { params: { projectId: string } }
) {
  const supabase = makeSupabase()
  const { data: alertRows, error } = await supabase
    .from('alerts')
    .select('id, type, description, status, created_at, invoice_id')
    .eq('project_id', params.projectId)
    .order('created_at', { ascending: false })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Fetch invoice metadata separately to avoid PostgREST schema-cache join issues
  const invoiceIds = [...new Set((alertRows ?? []).map(a => a.invoice_id).filter(Boolean))]
  const invoiceMap: Record<string, { invoice_number: string | null; supplier: string | null }> = {}
  if (invoiceIds.length) {
    const { data: invRows } = await supabase
      .from('invoices')
      .select('id, invoice_number, supplier')
      .in('id', invoiceIds)
    for (const inv of invRows ?? []) invoiceMap[inv.id] = { invoice_number: inv.invoice_number, supplier: inv.supplier }
  }

  const alerts = (alertRows ?? []).map(a => ({
    ...a,
    invoices: a.invoice_id ? (invoiceMap[a.invoice_id] ?? null) : null,
  }))
  return NextResponse.json({ alerts })
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { projectId: string } }
) {
  const { id } = await req.json()
  const supabase = makeSupabase()
  const { error } = await supabase
    .from('alerts')
    .update({ status: 'read' })
    .eq('id', id)
    .eq('project_id', params.projectId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
