'use client'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'

export default function LogoutButton() {
  const router = useRouter()

  async function handleLogout() {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  return (
    <button
      onClick={handleLogout}
      style={{
        background: 'none', border: '1px solid rgba(255,255,255,0.15)',
        color: '#94a3b8', padding: '.5rem .75rem', borderRadius: '6px',
        cursor: 'pointer', width: '100%', fontSize: '.8rem'
      }}
    >
      Sign Out
    </button>
  )
}
