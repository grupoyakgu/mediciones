import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import OverviewCharts from './OverviewCharts'

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

export default async function OverviewPage({ params }: { params: { projectId: string } }) {
  const supabase = makeSupabase()
  const { projectId } = params

  const [{ data: project }, { data: boqItems }, { data: invoices }] = await Promise.all([
    supabase.from('projects').select('name, currency, alert_threshold_pct, boq_file_name').eq('id', projectId).single(),
    supabase.from('boq_items').select('id, chapter_name, total_amount').eq('project_id', projectId),
    supabase.from('invoices').select('id, total_amount, created_at').eq('project_id', projectId).order('created_at'),
  ])

  const invoiceIds = (invoices ?? []).map(i => i.id)
  const { data: invoiceItems } = invoiceIds.length
    ? await supabase.from('invoice_items').select('total_amount, match_status, boq_item_id').in('invoice_id', invoiceIds)
    : { data: [] }

  const totalBudget = (boqItems ?? []).reduce((s, r) => s + (r.total_amount ?? 0), 0)
  const totalInvoiced = (invoices ?? []).reduce((s, r) => s + (r.total_amount ?? 0), 0)
  const pctUsed = totalBudget > 0 ? (totalInvoiced / totalBudget) * 100 : 0
  const alertCount = (invoiceItems ?? []).filter(i => i.match_status !== 'ok').length
  const currency = (project as { currency?: string } | null)?.currency ?? 'EUR'
  const threshold = (project as { alert_threshold_pct?: number } | null)?.alert_threshold_pct ?? 90

  // Chapter budget vs invoiced
  const chapterMap = new Map<string, { budget: number; invoiced: number }>()
  for (const item of boqItems ?? []) {
    const ch = item.chapter_name || 'Sin capítulo'
    const existing = chapterMap.get(ch) ?? { budget: 0, invoiced: 0 }
    existing.budget += item.total_amount ?? 0
    chapterMap.set(ch, existing)
  }
  const boqChapterMap = new Map<string, string>()
  for (const item of boqItems ?? []) {
    boqChapterMap.set(item.id, item.chapter_name || 'Sin capítulo')
  }
  for (const item of invoiceItems ?? []) {
    if (item.boq_item_id) {
      const ch = boqChapterMap.get(item.boq_item_id)
      if (ch) {
        const existing = chapterMap.get(ch) ?? { budget: 0, invoiced: 0 }
        existing.invoiced += item.total_amount ?? 0
        chapterMap.set(ch, existing)
      }
    }
  }
  const chapterData = [...chapterMap.entries()]
    .map(([name, v]) => ({ name: name.slice(0, 30), budget: v.budget, invoiced: v.invoiced }))
    .sort((a, b) => b.budget - a.budget)
    .slice(0, 10)

  // Cumulative spend
  const cumData: { date: string; cumulative: number }[] = []
  let running = 0
  for (const inv of invoices ?? []) {
    running += inv.total_amount ?? 0
    cumData.push({ date: inv.created_at.slice(0, 10), cumulative: running })
  }

  const fmt = (n: number) =>
    new Intl.NumberFormat('es-ES', { style: 'currency', currency }).format(n)

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard label="Total Budget" value={fmt(totalBudget)} />
        <KpiCard label="Total Invoiced" value={fmt(totalInvoiced)} />
        <KpiCard label="% Used" value={`${pctUsed.toFixed(1)}%`} warn={pctUsed >= threshold} />
        <KpiCard label="Alerts" value={String(alertCount)} warn={alertCount > 0} />
      </div>
      <OverviewCharts chapterData={chapterData} cumData={cumData} currency={currency} />
    </div>
  )
}

function KpiCard({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className={`bg-white rounded-xl border p-4 ${
      warn ? 'border-orange-300 bg-orange-50' : 'border-gray-200'
    }`}>
      <p className="text-xs text-gray-500 uppercase tracking-wide">{label}</p>
      <p className={`text-2xl font-bold mt-1 ${
        warn ? 'text-orange-600' : 'text-gray-900'
      }`}>{value}</p>
    </div>
  )
}
