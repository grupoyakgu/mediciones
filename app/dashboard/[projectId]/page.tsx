import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import OverviewCharts from './OverviewCharts'

interface BoqItem {
  id: string
  chapter_name: string
  total_amount: number | null
}

interface InvoiceItem {
  total_amount: number | null
  match_status: string
  boq_item_id: string | null
}

export default async function OverviewPage({ params }: { params: { projectId: string } }) {
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

  const { projectId } = params

  const [{ data: project }, { data: boqItems }, { data: invoices }, { data: invoiceItems }] = await Promise.all([
    supabase.from('projects').select('name, currency, alert_threshold_pct, boq_file_name').eq('id', projectId).single(),
    supabase.from('boq_items').select('id, chapter_name, total_amount').eq('project_id', projectId),
    supabase.from('invoices').select('id, total_amount, created_at').eq('project_id', projectId).order('created_at'),
    supabase.from('invoice_items').select('total_amount, match_status, boq_item_id, invoice_id').eq(
      'invoice_id',
      supabase.from('invoices').select('id').eq('project_id', projectId)
    ),
  ])

  // Aggregate totals
  const totalBudget = (boqItems as BoqItem[] | null)?.reduce((s, r) => s + (r.total_amount ?? 0), 0) ?? 0
  const totalInvoiced = (invoices as { id: string; total_amount: number | null; created_at: string }[] | null)
    ?.reduce((s, r) => s + (r.total_amount ?? 0), 0) ?? 0
  const pctUsed = totalBudget > 0 ? (totalInvoiced / totalBudget) * 100 : 0
  const alertCount = (invoiceItems as InvoiceItem[] | null)?.filter(i => i.match_status !== 'ok').length ?? 0
  const currency = (project as { currency?: string } | null)?.currency ?? 'EUR'
  const threshold = (project as { alert_threshold_pct?: number } | null)?.alert_threshold_pct ?? 90

  // Chapter budget vs invoiced (top 10 by budget)
  const chapterMap = new Map<string, { budget: number; invoiced: number }>()
  for (const item of (boqItems as BoqItem[] | null) ?? []) {
    const ch = item.chapter_name || 'Sin capítulo'
    const existing = chapterMap.get(ch) ?? { budget: 0, invoiced: 0 }
    existing.budget += item.total_amount ?? 0
    chapterMap.set(ch, existing)
  }
  // Map invoiced amounts back to chapters via boq_item_id
  const boqChapterMap = new Map<string, string>()
  for (const item of (boqItems as BoqItem[] | null) ?? []) {
    boqChapterMap.set(item.id, item.chapter_name || 'Sin capítulo')
  }
  for (const item of (invoiceItems as InvoiceItem[] | null) ?? []) {
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

  // Cumulative spend by invoice date
  const cumData: { date: string; cumulative: number }[] = []
  let running = 0
  for (const inv of (invoices as { id: string; total_amount: number | null; created_at: string }[] | null) ?? []) {
    running += inv.total_amount ?? 0
    cumData.push({ date: inv.created_at.slice(0, 10), cumulative: running })
  }

  const fmt = (n: number) =>
    new Intl.NumberFormat('es-ES', { style: 'currency', currency }).format(n)

  return (
    <div className="space-y-6">
      {/* KPI cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard label="Total Budget" value={fmt(totalBudget)} />
        <KpiCard label="Total Invoiced" value={fmt(totalInvoiced)} />
        <KpiCard
          label="% Used"
          value={`${pctUsed.toFixed(1)}%`}
          warn={pctUsed >= threshold}
        />
        <KpiCard label="Alerts" value={String(alertCount)} warn={alertCount > 0} />
      </div>

      {/* Charts */}
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
