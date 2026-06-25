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
    .select('id, name, created_at, updated_at')
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
  const { name } = body as { name: string }
  if (!name) return NextResponse.json({ error: 'name is required' }, { status: 400 })
  const supabase = makeSupabase()
  const { error } = await supabase
    .from('pricing_projects')
    .update({ name, updated_at: new Date().toISOString() })
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
