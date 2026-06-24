'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'

interface Project {
  id: string
  name: string
  currency: string
}

function GrupoYakguLogo() {
  return (
    <svg width="120" height="36" viewBox="0 0 120 36" fill="none" xmlns="http://www.w3.org/2000/svg">
      <line x1="14" y1="2" x2="14" y2="34" stroke="white" strokeWidth="1.5" />
      <text
        x="7"
        y="26"
        fill="white"
        fontSize="6"
        fontFamily="Arial, sans-serif"
        fontWeight="400"
        letterSpacing="2"
        writingMode="tb"
        transform="rotate(180, 7, 18)"
        textAnchor="middle"
      >
        GRUPO
      </text>
      <text
        x="22"
        y="27"
        fill="white"
        fontSize="18"
        fontFamily="Arial, sans-serif"
        fontWeight="700"
        letterSpacing="1"
      >
        YAKGU
      </text>
    </svg>
  )
}

export default function Sidebar({ userEmail }: { userEmail: string }) {
  const pathname = usePathname()
  const router = useRouter()
  const [projects, setProjects] = useState<Project[]>([])
  const [expanded, setExpanded] = useState(true)

  const projectMatch = pathname.match(/^\/dashboard\/([^/]+)/)
  const activeProjectId = projectMatch ? projectMatch[1] : null
  const activeProject = projects.find(p => p.id === activeProjectId)

  const loadProjects = useCallback(async () => {
    const res = await fetch('/api/projects')
    const data = await res.json()
    setProjects(data.projects ?? [])
  }, [])

  useEffect(() => {
    loadProjects()
    window.addEventListener('projectsChanged', loadProjects)
    return () => window.removeEventListener('projectsChanged', loadProjects)
  }, [loadProjects])

  async function handleLogout() {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  const projectBase = activeProjectId ? `/dashboard/${activeProjectId}` : ''

  const projectTabs = [
    { label: 'Overview', href: projectBase, icon: '▦' },
    { label: 'Invoices', href: `${projectBase}/invoices`, icon: '🧾' },
    { label: 'Alerts', href: `${projectBase}/alerts`, icon: '⚠' },
    { label: 'Settings', href: `${projectBase}/settings`, icon: '⚙' },
  ]

  function isTabActive(href: string) {
    if (href === projectBase) return pathname === projectBase
    return pathname.startsWith(href)
  }

  return (
    <aside className="w-56 flex-shrink-0 flex flex-col border-r border-white/8 bg-[#0a0a0a] h-full">
      {/* Logo */}
      <div className="px-5 pt-6 pb-5 border-b border-white/8">
        <Link href="/dashboard">
          <GrupoYakguLogo />
        </Link>
        <p className="text-[10px] text-white/30 mt-2 tracking-widest uppercase">Financial Manager</p>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto py-4 px-3 space-y-0.5">
        {/* All Projects */}
        <Link
          href="/dashboard"
          className={`flex items-center gap-2.5 px-3 py-2 rounded-md text-sm transition-colors ${
            pathname === '/dashboard'
              ? 'bg-white/10 text-white font-medium'
              : 'text-white/50 hover:text-white hover:bg-white/5'
          }`}
        >
          <span className="text-base leading-none">⊞</span>
          All Projects
        </Link>

        {/* Active project section */}
        {activeProjectId && activeProject && (
          <div className="mt-4">
            <div
              className="flex items-center gap-2 px-3 py-1.5 cursor-pointer"
              onClick={() => setExpanded(!expanded)}
            >
              <span className="text-white/30 text-xs">{expanded ? '▾' : '▸'}</span>
              <span className="text-xs text-white/40 uppercase tracking-wider truncate font-medium">
                {activeProject.name}
              </span>
            </div>
            {expanded && (
              <div className="space-y-0.5 mt-0.5">
                {projectTabs.map(tab => (
                  <Link
                    key={tab.href}
                    href={tab.href}
                    className={`flex items-center gap-2.5 px-3 py-2 rounded-md text-sm transition-colors ml-2 ${
                      isTabActive(tab.href)
                        ? 'bg-white/10 text-white font-medium'
                        : 'text-white/50 hover:text-white hover:bg-white/5'
                    }`}
                  >
                    <span className="text-sm leading-none w-4 text-center">{tab.icon}</span>
                    {tab.label}
                  </Link>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Other projects */}
        {projects.length > 0 && (
          <div className="mt-6">
            <p className="px-3 text-[10px] text-white/25 uppercase tracking-widest mb-2">Projects</p>
            {projects.map(p => (
              <Link
                key={p.id}
                href={`/dashboard/${p.id}`}
                className={`flex items-center gap-2.5 px-3 py-2 rounded-md text-sm transition-colors ${
                  activeProjectId === p.id
                    ? 'bg-white/10 text-white font-medium'
                    : 'text-white/50 hover:text-white hover:bg-white/5'
                }`}
              >
                <span className="w-1.5 h-1.5 rounded-full bg-white/30 flex-shrink-0" />
                <span className="truncate">{p.name}</span>
              </Link>
            ))}
          </div>
        )}

        {/* Project Pricing — last item */}
        <div className="mt-4">
          <Link
            href="/dashboard/pricing"
            className={`flex items-center gap-2.5 px-3 py-2 rounded-md text-sm transition-colors ${
              pathname.startsWith('/dashboard/pricing')
                ? 'bg-white/10 text-white font-medium'
                : 'text-white/50 hover:text-white hover:bg-white/5'
            }`}
          >
            <span className="text-base leading-none text-white">$</span>
            Project Pricing
          </Link>
        </div>
      </nav>

      {/* Footer */}
      <div className="px-4 py-4 border-t border-white/8 space-y-2">
        <p className="text-[11px] text-white/30 truncate">{userEmail}</p>
        <button
          onClick={handleLogout}
          className="w-full text-left text-xs text-white/40 hover:text-white transition-colors py-1"
        >
          Sign out →
        </button>
      </div>
    </aside>
  )
}
