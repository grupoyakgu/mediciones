import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

interface AlertItem {
  id: string
  description: string
  match_status: string
  match_notes: string | null
  total_amount: number | null
  invoices: { invoice_number: string | null; supplier: string | null; invoice_date: string | null } | null
}

const STATUS_LABEL: Record<string, string> = {
  not_in_boq:       'Not in BOQ',
  warning_quantity:  'Quantity Warning',
  warning_price:     'Price Warning',
}

const STATUS_COLOR: Record<string, string> = {
  not_in_boq:       'bg-red-50 border-red-200 text-red-700',
  warning_quantity:  'bg-orange-50 border-orange-200 text-orange-700',
  warning_price:     'bg-orange-50 border-orange-200 text-orange-700',
}

export default async function AlertsPage({ params }: { params: { projectId: string } }) {
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

  const { data: invoices } = await supabase
    .from('invoices')
    .select('id')
    .eq('project_id', params.projectId)

  const invoiceIds = (invoices ?? []).map(i => i.id)

  let alerts: AlertItem[] = []
  if (invoiceIds.length) {
    const { data } = await supabase
      .from('invoice_items')
      .select('id, description, match_status, match_notes, total_amount, invoices(invoice_number, supplier, invoice_date)')
      .neq('match_status', 'ok')
      .in('invoice_id', invoiceIds)
      .order('match_status')
    if (data) alerts = data as unknown as AlertItem[]
  }

  const groups = ['not_in_boq', 'warning_quantity', 'warning_price']

  return (
    <div className="space-y-6">
      {alerts.length === 0 && (
        <div className="text-center py-20">
          <p className="text-4xl mb-3">✅</p>
          <p className="text-gray-500">No alerts — all invoice items matched to the BOQ.</p>
        </div>
      )}
      {groups.map(status => {
        const items = alerts.filter(a => a.match_status === status)
        if (!items.length) return null
        return (
          <div key={status}>
            <h2 className={`inline-block text-sm font-semibold px-3 py-1 rounded-full border mb-4 ${STATUS_COLOR[status] ?? ''}`}>
              {STATUS_LABEL[status] ?? status} ({items.length})
            </h2>
            <div className="space-y-2">
              {items.map(item => (
                <div key={item.id} className="bg-white border border-gray-200 rounded-lg px-4 py-3 flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">{item.description}</p>
                    <p className="text-xs text-gray-400 mt-0.5">{item.match_notes}</p>
                    {item.invoices && (
                      <p className="text-xs text-gray-400 mt-0.5">
                        Invoice: {item.invoices.invoice_number ?? '—'}
                        {item.invoices.supplier ? ` · ${item.invoices.supplier}` : ''}
                        {item.invoices.invoice_date ? ` · ${item.invoices.invoice_date}` : ''}
                      </p>
                    )}
                  </div>
                  {item.total_amount != null && (
                    <span className="text-sm font-semibold text-gray-700 shrink-0">
                      {new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(item.total_amount)}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}
