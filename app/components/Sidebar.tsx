'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Layers3, LibraryBig, ScanLine, User, Users } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

type NavItem = {
  label: string
  href: string
  key: string
  Icon: LucideIcon
}

const navItems: NavItem[] = [
  { label: 'Scanner', href: '/scan', key: 'scan', Icon: ScanLine },
  { label: 'Collezione', href: '/dashboard', key: 'collezione', Icon: Layers3 },
  { label: 'Deck', href: '/decks', key: 'decks', Icon: LibraryBig },
  { label: 'Amici', href: '/friends', key: 'amici', Icon: Users },
  { label: 'Profilo', href: '/profile', key: 'profilo', Icon: User },
]

const getPageKey = (pathname: string) => {
  if (pathname.startsWith('/dashboard')) return 'collezione'
  if (pathname.startsWith('/decks')) return 'decks'
  if (pathname.startsWith('/friends')) return 'amici'
  if (pathname.startsWith('/profile')) return 'profilo'
  return 'scan'
}

export default function Sidebar({ activePage }: { activePage?: string }) {
  const pathname = usePathname()
  const currentPage = getPageKey(pathname || '/scan') || activePage || 'scan'

  return (
    <nav
      className="op-bottom-nav fixed inset-x-0 z-50 mx-auto flex w-[min(calc(100%-1rem),560px)] items-center justify-between rounded-[1.55rem] border border-white/16 bg-[#1a414b]/90 p-1.5 shadow-[0_18px_38px_rgba(0,0,0,0.24)] backdrop-blur-2xl"
      style={{ bottom: 'max(0.5rem, env(safe-area-inset-bottom))' }}
    >
      {navItems.map(({ label, href, key, Icon }) => {
        const active = currentPage === key

        return (
          <Link
            key={key}
            href={href}
            prefetch
            className={`relative flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-[1.15rem] px-2 py-2 text-[10px] font-black transition sm:flex-row sm:gap-2 sm:text-xs ${active
              ? 'op-nav-active text-slate-950'
              : 'text-slate-300 hover:bg-white/[0.08] hover:text-cyan-50'}`}
            aria-label={label}
          >
            {active && <span className="pointer-events-none absolute inset-0 rounded-[1.15rem] bg-gradient-to-r from-cyan-300 to-rose-300" />}
            <span className={`relative flex h-6 w-6 items-center justify-center rounded-full ${active ? 'op-nav-icon bg-white/30' : ''}`}>
              <Icon size={active ? 19 : 18} strokeWidth={active ? 2.9 : 2.2} />
            </span>
            <span className="relative truncate">{label}</span>
          </Link>
        )
      })}
    </nav>
  )
}
