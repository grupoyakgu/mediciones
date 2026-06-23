import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export async function GET(
  _req: NextRequest,
  { params }: { params: { projectId: string } }
) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  const supabase = createClient(supabaseUrl, key)

  const PAGE = 500
  let from = 0
  const all: Record<string, unknown>[] = []

  while (true) {
    const { data, error } = await supabase
      .from('boq_items')
      .select('id,chapter_id,chapter_name,item_code,description,unit,quantity,unit_price,total_amount')
      .eq('project_id', params.projectId)
      .order('chapter_id', { ascending: true })
      .range(from, from + PAGE - 1)

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    if (!data || data.length === 0) break
    all.push(...data)
    if (data.length < PAGE) break
    from += PAGE
  }

  return NextResponse.json({ items: all })
}
