import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

// PAGE must stay at or below Supabase's max_rows setting (default 100).
// We never break on data.length < PAGE because max_rows truncates responses
// silently — we only stop when a page comes back empty.
const PAGE = 100

export async function GET(
  _req: NextRequest,
  { params }: { params: { projectId: string } }
) {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  const all: Record<string, unknown>[] = []
  let from = 0

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
    from += PAGE
    // Do NOT break when data.length < PAGE: Supabase max_rows may have
    // truncated the page without it being the last page of real data.
  }

  return NextResponse.json({ items: all })
}
