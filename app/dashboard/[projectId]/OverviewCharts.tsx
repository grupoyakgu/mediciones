'use client'

import { useRouter } from 'next/navigation'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  LineChart, Line, Dot,
} from 'recharts'

interface ChapterDatum {
  name: string
  budget: number
  invoiced: number
}

interface CumDatum {
  date: string
  cumulative: number
  invoiceId: string
}

export default function OverviewCharts({
  projectId,
  chapterData,
  cumData,
  currency,
}: {
  projectId: string
  chapterData: ChapterDatum[]
  cumData: CumDatum[]
  currency: string
}) {
  const router = useRouter()
  const fmt = (v: number) =>
    new Intl.NumberFormat('es-ES', { style: 'currency', currency, notation: 'compact' }).format(v)

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* Chapter bar chart */}
      <div className="bg-white border border-gray-200 rounded-xl p-5">
        <h2 className="text-sm font-semibold text-gray-700 mb-4">Budget vs Invoiced by Chapter</h2>
        {chapterData.length === 0 ? (
          <p className="text-gray-400 text-sm text-center py-10">No BOQ data yet</p>
        ) : (
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={chapterData} layout="vertical" margin={{ left: 20, right: 20 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis type="number" tickFormatter={fmt} tick={{ fontSize: 11 }} />
              <YAxis type="category" dataKey="name" tick={{ fontSize: 10 }} width={120} />
              <Tooltip formatter={(v: number) => fmt(v)} />
              <Legend />
              <Bar dataKey="budget"   name="Budget"   fill="#3b82f6" />
              <Bar dataKey="invoiced" name="Invoiced" fill="#f97316" />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Cumulative spend line chart */}
      <div className="bg-white border border-gray-200 rounded-xl p-5">
        <h2 className="text-sm font-semibold text-gray-700 mb-1">Cumulative Spend</h2>
        <p className="text-xs text-gray-400 mb-3">Click a dot to open that invoice</p>
        {cumData.length === 0 ? (
          <p className="text-gray-400 text-sm text-center py-10">No invoices yet</p>
        ) : (
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={cumData} margin={{ left: 20, right: 20 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="date" tick={{ fontSize: 10 }} />
              <YAxis tickFormatter={fmt} tick={{ fontSize: 11 }} />
              <Tooltip formatter={(v: number) => fmt(v)} />
              <Line
                type="monotone"
                dataKey="cumulative"
                stroke="#3b82f6"
                strokeWidth={2}
                dot={(props) => {
                  const { cx, cy, payload } = props as { cx: number; cy: number; payload: CumDatum }
                  return (
                    <Dot
                      key={payload.invoiceId}
                      cx={cx}
                      cy={cy}
                      r={5}
                      fill="#3b82f6"
                      stroke="#fff"
                      strokeWidth={2}
                      style={{ cursor: 'pointer' }}
                      onClick={() => router.push(`/dashboard/${projectId}/invoices?invoice=${payload.invoiceId}`)}
                    />
                  )
                }}
                activeDot={{
                  r: 7,
                  style: { cursor: 'pointer' },
                  onClick: (_: unknown, payload: unknown) => {
                    const d = (payload as { payload?: CumDatum })?.payload
                    if (d?.invoiceId) router.push(`/dashboard/${projectId}/invoices?invoice=${d.invoiceId}`)
                  },
                }}
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  )
}
