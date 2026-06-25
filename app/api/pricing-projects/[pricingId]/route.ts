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
    .from('pricing_projects')
    .select('id, name, created_at, updated_at, results, unpriced_file_name, ref_items')
    .eq('id', params.pricingId)
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ project: data })
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { pricingId: string } }
) {
  const body = await req.json()
  const { name, results, unpriced_file_name, ref_items } = body as {
    name?: string
    results?: unknown
    unpriced_file_name?: string | null
    ref_items?: unknown
  }

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (name !== undefined) {
    if (!name) return NextResponse.json({ error: 'name cannot be empty' }, { status: 400 })
    updates.name = name
  }
  if (results !== undefined) updates.results = results
  if (unpriced_file_name !== undefined) updates.unpriced_file_name = unpriced_file_name
  if (ref_items !== undefined) updates.ref_items = ref_items

  const supabase = makeSupabase()
  const { error } = await supabase
    .from('pricing_projects')
    .update(updates)
    .eq('id', params.pricingId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { pricingId: string } }
) {
  const supabase = makeSupabase()
  const { error } = await supabase
    .from('pricing_projects')
    .delete()
    .eq('id', params.pricingId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
