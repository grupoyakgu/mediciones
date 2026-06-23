'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

export default function ProjectNav({ projectId }: { projectId: string }) {
  const pathname = usePathname()
  const base = `/dashboard/${projectId}`

  const tabs = [
    { label: 'Overview',  href: base },
    { label: 'Invoices',  href: `${base}/invoices` },
    { label: 'Alerts',    href: `${base}/alerts` },
    { label: 'Settings',  href: `${base}/settings` },
  ]

  return (
    <nav className="flex gap-1 mt-3 border-b border-gray-200">
      {tabs.map(tab => {
        const active = tab.href === base ? pathname === base : pathname.startsWith(tab.href)
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              active
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {tab.label}
          </Link>
        )
      })}
    </nav>
  )
}
