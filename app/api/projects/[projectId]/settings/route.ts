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

export async function PATCH(
  req: NextRequest,
  { params }: { params: { projectId: string } }
) {
  const body = await req.json()
  const supabase = makeSupabase()
  const { error } = await supabase
    .from('projects')
    .update({
      alert_threshold_pct: body.alert_threshold_pct,
      email_recipients:    body.email_recipients,
    })
    .eq('id', params.projectId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
