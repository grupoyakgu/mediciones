import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { notFound } from 'next/navigation'

export default async function ProjectLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: { projectId: string }
}) {
  const cookieStore = cookies()
  const supabase = createServerClient(
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

  const { data: project } = await supabase
    .from('projects')
    .select('id, name')
    .eq('id', params.projectId)
    .single()

  if (!project) notFound()

  return <>{children}</>
}
