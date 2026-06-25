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
    .from('pricing_project_excludes')
    .select('id, item_code, description, created_at')
    .eq('pricing_project_id', params.pricingId)
    .order('created_at', { ascending: true })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ excludes: data })
}

export async function POST(
  req: NextRequest,
  { params }: { params: { pricingId: string } }
) {
  const body = await req.json()
  const { item_code, description } = body as { item_code?: string; description?: string }
  const supabase = makeSupabase()
  const { data, error } = await supabase
    .from('pricing_project_excludes')
    .insert({ pricing_project_id: params.pricingId, item_code, description })
    .select()
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ exclude: data })
}

export async function DELETE(
  req: NextRequest
) {
  const { searchParams } = new URL(req.url)
  const id = searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })
  const supabase = makeSupabase()
  const { error } = await supabase
    .from('pricing_project_excludes')
    .delete()
    .eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
