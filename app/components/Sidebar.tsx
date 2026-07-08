'use client'

import { useRouter } from 'next/navigation'
import { Layers3, ScanLine, User, Users } from 'lucide-react'
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
  { label: 'Amici', href: '/friends', key: 'amici', Icon: Users },
  { label: 'Profilo', href: '/profile', key: 'profilo', Icon: User },
]

export default function Sidebar({ activePage }: { activePage: string }) {
  const router = useRouter()

  return (
    <nav className="fixed inset-x-0 bottom-2 z-40 mx-auto flex w-[min(calc(100%-1rem),560px)] items-center justify-between rounded-[1.6rem] border border-white/10 bg-[#061116]/92 p-1.5 shadow-[0_18px_50px_rgba(0,0,0,0.45)] backdrop-blur-2xl sm:bottom-4">
      {navItems.map(({ label, href, key, Icon }) => {
        const active = activePage === key

        return (
          <button
            key={key}
            onClick={() => router.push(href)}
            className={`flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-[1.2rem] px-2 py-2 text-[10px] font-black transition sm:flex-row sm:gap-2 sm:text-xs ${active
              ? 'bg-cyan-300 text-slate-950 shadow-lg shadow-cyan-950/30'
              : 'text-slate-400 hover:bg-white/[0.06] hover:text-cyan-100'}`}
            aria-label={label}
          >
            <Icon size={active ? 19 : 18} strokeWidth={active ? 2.8 : 2.2} />
            <span className="truncate">{label}</span>
          </button>
        )
      })}
    </nav>
  )
}
