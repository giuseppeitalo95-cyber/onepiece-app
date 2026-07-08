'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Layers3, LogOut, Menu, ScanLine, Search, ShieldCheck, User, Users, X } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { isAdminAccount } from '@/lib/admin'

type NavItemProps = {
  label: string
  href: string
  Icon: LucideIcon
  active?: boolean
  onClick?: () => void
}

const navItems = [
  { label: 'Scanner', href: '/scan', key: 'scan', Icon: ScanLine },
  { label: 'Collezione', href: '/dashboard', key: 'collezione', Icon: Layers3 },
  { label: 'Amici', href: '/friends', key: 'amici', Icon: Users },
  { label: 'Ricerca Carta', href: '/search', key: 'ricerca', Icon: Search },
  { label: 'Profilo', href: '/profile', key: 'profilo', Icon: User },
]

const NavItem = ({ label, href, Icon, active, onClick }: NavItemProps) => {
  const router = useRouter()

  return (
    <button
      onClick={() => {
        router.push(href)
        onClick?.()
      }}
      className={`flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-left text-sm transition ${active
        ? 'bg-cyan-300 text-slate-950 font-black shadow-lg shadow-cyan-950/30'
        : 'text-slate-300 hover:bg-white/[0.06] hover:text-cyan-100'}`}
    >
      <span className={`flex h-8 w-8 items-center justify-center rounded-xl ${active ? 'bg-slate-950/10' : 'bg-white/[0.04] text-cyan-200'}`}>
        <Icon size={17} />
      </span>
      {label}
    </button>
  )
}

export default function Sidebar({ activePage }: { activePage: string }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [isAdmin, setIsAdmin] = useState(false)

  useEffect(() => {
    const checkAdmin = async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.user) return

      const { data } = await supabase
        .from('profiles')
        .select('username')
        .eq('id', session.user.id)
        .maybeSingle()

      setIsAdmin(isAdminAccount(session.user, data))
    }

    checkAdmin()
  }, [])

  useEffect(() => {
    if (open) {
      document.body.style.overflow = 'hidden'
      document.documentElement.style.overflow = 'hidden'
    
    }

    return () => {
      document.body.style.overflow = 'auto'
      document.documentElement.style.overflow = 'auto'
    }
  }, [open])

  const logout = async () => {
    await supabase.auth.signOut({ scope: 'global' })
    router.replace('/')
  }

  return (
    <>
      <button
        onClick={() => setOpen(!open)}
        className="fixed left-3 top-3 z-50 rounded-2xl border border-white/10 bg-slate-950/90 p-2 text-cyan-100 shadow-lg shadow-black/40 backdrop-blur-xl transition hover:border-cyan-300/40 hover:text-white"
        aria-label={open ? 'Chiudi menu' : 'Apri menu'}
      >
        {open ? <X size={18} /> : <Menu size={18} />}
      </button>

      {open && (
        <div
          className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm"
          onClick={() => setOpen(false)}
          onTouchMove={(event) => event.preventDefault()}
        />
      )}

      <aside className={`fixed left-0 top-0 z-50 flex h-screen w-72 flex-col border-r border-white/10 bg-[#061116]/95 shadow-2xl shadow-black/50 backdrop-blur-2xl transition-transform duration-300 ${open ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="border-b border-white/10 px-5 pb-5 pt-6">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-cyan-300/25 bg-cyan-300/10">
              <img src="/luffyhatlogo.webp" alt="OPV" className="h-10 w-10 object-contain" />
            </div>
            <div>
              <div className="text-xs font-black uppercase tracking-[0.34em] text-cyan-100">OPV</div>
              <div className="mt-1 text-xs text-slate-400">Vault menu</div>
            </div>
          </div>
        </div>

        <nav className="flex flex-1 flex-col gap-2 p-4 text-sm">
          {[...navItems, ...(isAdmin ? [{ label: 'Admin', href: '/admin', key: 'admin', Icon: ShieldCheck }] : [])].map((item) => (
            <NavItem
              key={item.key}
              label={item.label}
              href={item.href}
              Icon={item.Icon}
              active={activePage === item.key}
              onClick={() => setOpen(false)}
            />
          ))}
        </nav>

        <div className="border-t border-white/10 p-4">
          <button
            onClick={logout}
            className="flex w-full items-center gap-3 rounded-2xl border border-red-400/20 bg-red-500/10 px-3 py-3 text-left font-bold text-red-200 transition hover:bg-red-500/20"
          >
            <LogOut size={16} />
            Disconnettiti
          </button>
        </div>
      </aside>
    </>
  )
}
