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
  { params }: { params: { pricingId: string } }
) {
  const supabase = makeSupabase()
  const { data, error } = await supabase
    .from('pricing_project_alerts')
    .select('id, item_code, description, type, priority, created_at')
    .eq('pricing_project_id', params.pricingId)
    .order('created_at', { ascending: false })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ alerts: data })
}

export async function POST(
  req: NextRequest,
  { params }: { params: { pricingId: string } }
) {
  const body = await req.json() as { item_code?: string; description?: string }[]
  if (!Array.isArray(body)) return NextResponse.json({ error: 'body must be an array' }, { status: 400 })
  const supabase = makeSupabase()
  const rows = body.map(({ item_code, description }) => ({
    pricing_project_id: params.pricingId,
    item_code,
    description,
    type: 'excluded_item_found',
    priority: 'high',
  }))
  const { data, error } = await supabase
    .from('pricing_project_alerts')
    .insert(rows)
    .select()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ alerts: data })
}
