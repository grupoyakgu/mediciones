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
  const { data, error } = await supabase
    .from('alerts')
    .select('id, type, description, status, created_at, invoice_id, invoices(invoice_number, supplier)')
    .eq('project_id', params.projectId)
    .order('created_at', { ascending: false })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ alerts: data })
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
