import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'
import LogoutButton from './LogoutButton'

const NAV_ITEMS = [
  { href: '/dashboard', label: '📊 Overview' },
  { href: '/dashboard/invoices', label: '🧾 Invoices' },
  { href: '/dashboard/alerts', label: '🚨 Alerts' },
  { href: '/dashboard/settings', label: '⚙️ Settings' },
]

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  return (
    <div style={{ display: 'flex', minHeight: '100vh', fontFamily: 'system-ui, sans-serif' }}>
      <nav style={{
        width: '240px', background: '#0f172a', color: 'white',
        display: 'flex', flexDirection: 'column', flexShrink: 0
      }}>
        <div style={{ padding: '1.5rem', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
          <div style={{ fontSize: '1rem', fontWeight: 700 }}>BOQ Dashboard</div>
          <div style={{ fontSize: '.72rem', color: '#64748b', marginTop: '.25rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {user.email}
          </div>
        </div>
        <div style={{ flex: 1, paddingTop: '.75rem' }}>
          {NAV_ITEMS.map(item => (
            <Link
              key={item.href}
              href={item.href}
              style={{
                display: 'block', padding: '.625rem 1.5rem',
                color: '#94a3b8', textDecoration: 'none', fontSize: '.875rem'
              }}
            >
              {item.label}
            </Link>
          ))}
        </div>
        <div style={{ padding: '1.5rem' }}>
          <LogoutButton />
        </div>
      </nav>
      <main style={{ flex: 1, padding: '2rem', background: '#f8fafc', overflowY: 'auto', minHeight: '100vh' }}>
        {children}
      </main>
    </div>
  )
}
