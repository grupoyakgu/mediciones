import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import Link from 'next/link'
import OverviewCharts from './OverviewCharts'
import BoqTable from './BoqTable'
import BoqSection from './BoqSection'

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
    supabase.from('projects').select('name, currency, alert_threshold_pct, boq_file_name, boq_uploaded').eq('id', projectId).single(),
    supabase.from('boq_items').select('id, chapter_name, total_amount').eq('project_id', projectId),
    // Only approved invoices count towards the summary
    supabase.from('invoices').select('id, total_amount, created_at').eq('project_id', projectId).eq('status', 'approved').order('created_at'),
  ])

  const invoiceIds = (invoices ?? []).map(i => i.id)
  const { data: invoiceItems } = invoiceIds.length
    ? await supabase.from('invoice_items').select('total_amount, match_status, boq_item_id, sub_items').in('invoice_id', invoiceIds)
    : { data: [] }

  // Jaccard matching for sub-items (unmatched total KPI)
  function jaccardTokensOv(s: string): Set<string> {
    return new Set(s.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean))
  }
  function jaccardScoreOv(a: string, b: string): number {
    const ta = jaccardTokensOv(a), tb = jaccardTokensOv(b)
    let inter = 0; ta.forEach(t => { if (tb.has(t)) inter++ })
    const union = ta.size + tb.size - inter
    return union === 0 ? 0 : inter / union
  }
  const boqDescs = (boqItems ?? []).map(b => b.description ?? '')
  let unmatchedSubItemTotal = 0
  for (const item of invoiceItems ?? []) {
    const subs = Array.isArray((item as { sub_items?: unknown }).sub_items) ? (item as { sub_items: { description: string; total_amount: number | null }[] }).sub_items : []
    for (const sub of subs) {
      const best = boqDescs.reduce((m, d) => Math.max(m, jaccardScoreOv(sub.description, d)), 0)
      if (best < 0.51) unmatchedSubItemTotal += sub.total_amount ?? 0
    }
  }

  const totalBudget = (boqItems ?? []).reduce((s, r) => s + (r.total_amount ?? 0), 0)
  const totalInvoiced = (invoices ?? []).reduce((s, r) => s + (r.total_amount ?? 0), 0)
  const pctUsed = totalBudget > 0 ? (totalInvoiced / totalBudget) * 100 : 0
  const alertCount = (invoiceItems ?? []).filter(i => i.match_status !== 'ok').length
  const currency = (project as { currency?: string } | null)?.currency ?? 'EUR'
  const threshold = (project as { alert_threshold_pct?: number } | null)?.alert_threshold_pct ?? 90
  const projectName = (project as { name?: string } | null)?.name ?? ''
  const boqUploaded = (project as { boq_uploaded?: boolean } | null)?.boq_uploaded ?? false

  const chapterMap = new Map<string, { budget: number; invoiced: number }>()
  for (const item of boqItems ?? []) {
    const ch = item.chapter_name || 'Sin capítulo'
    const existing = chapterMap.get(ch) ?? { budget: 0, invoiced: 0 }
    existing.budget += item.total_amount ?? 0
    chapterMap.set(ch, existing)
  }
  const boqChapterMap = new Map<string, string>()
  for (const item of boqItems ?? []) boqChapterMap.set(item.id, item.chapter_name || 'Sin capítulo')
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
  const chapterData = Array.from(chapterMap.entries())
    .map(([name, v]) => ({ name: name.slice(0, 30), budget: v.budget, invoiced: v.invoiced }))
    .sort((a, b) => b.budget - a.budget)
    .slice(0, 10)

  const cumData: { date: string; cumulative: number }[] = []
  let running = 0
  for (const inv of invoices ?? []) {
    running += inv.total_amount ?? 0
    cumData.push({ date: inv.created_at.slice(0, 10), cumulative: running })
  }

  const fmt = (n: number) => new Intl.NumberFormat('es-ES', { style: 'currency', currency }).format(n)

  return (
    <div className="space-y-8">
      <div className="border-b border-gray-200 pb-6">
        <h1 className="text-xl font-semibold text-gray-900">{projectName}</h1>
        <p className="text-sm text-gray-500 mt-0.5">Overview · approved invoices only</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard label="Total Budget" value={fmt(totalBudget)} />
        <KpiCard label="Approved Invoiced" value={fmt(totalInvoiced)} />
        <KpiCard label="Budget Used" value={`${pctUsed.toFixed(1)}%`} warn={pctUsed >= threshold} />
        <Link href={`/dashboard/${projectId}/alerts`} className="block">
          <KpiCard label="Alerts" value={String(alertCount)} warn={alertCount > 0} clickable />
        </Link>
      </div>
      {unmatchedSubItemTotal > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-xl px-5 py-4 flex items-center gap-4">
          <span className="text-red-500 text-2xl">⚠️</span>
          <div>
            <p className="text-sm font-semibold text-red-800">Unmatched Sub-items (approved invoices)</p>
            <p className="text-xs text-red-600 mt-0.5">{fmt(unmatchedSubItemTotal)} from sub-items with no BOQ match — verify these line items against the BOQ.</p>
          </div>
        </div>
      )}

      <OverviewCharts chapterData={chapterData} cumData={cumData} currency={currency} />

      <BoqSection projectId={projectId} boqUploaded={boqUploaded} />

      <BoqTable projectId={projectId} />
    </div>
  )
}

function KpiCard({ label, value, warn, clickable }: { label: string; value: string; warn?: boolean; clickable?: boolean }) {
  return (
    <div className={`bg-white rounded-xl border p-5 transition-shadow ${warn ? 'border-amber-200' : 'border-gray-200'} ${clickable ? 'hover:shadow-md cursor-pointer' : ''}`}>
      <p className="text-xs text-gray-400 font-medium uppercase tracking-wider">{label}</p>
      <p className={`text-2xl font-bold mt-2 ${warn ? 'text-amber-600' : 'text-gray-900'}`}>{value}</p>
      {warn ? <p className="text-xs text-amber-500 mt-1">Needs attention →</p> : clickable && <p className="text-xs text-gray-400 mt-1">View alerts →</p>}
    </div>
  )
}
