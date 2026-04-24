'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { LogOut, Menu, X } from 'lucide-react'
import { supabase } from '@/lib/supabase'

type NavItemProps = {
  label: string
  href: string
  active?: boolean
  onClick?: () => void
}

const navItems = [
  { label: 'Collezione', href: '/dashboard', key: 'collezione' },
  { label: 'Amici', href: '/friends', key: 'amici' },
  { label: 'Ricerca Carta', href: '/search', key: 'ricerca' },
  { label: 'Statistiche', href: '/dashboard#stats', key: 'statistiche' },
  { label: 'Deck Meta', href: '/dashboard#meta', key: 'deckmeta' },
  { label: 'Profilo', href: '/profile', key: 'profilo' },
]

const NavItem = ({ label, href, active, onClick }: NavItemProps) => {
  const router = useRouter()

  return (
    <button
      onClick={() => {
        router.push(href)
        onClick?.()
      }}
      className={`text-left px-3 py-2 rounded-lg transition w-full text-sm ${active
        ? 'bg-amber-400/10 text-amber-300 font-semibold'
        : 'text-gray-300 hover:text-amber-300 hover:bg-slate-800/40'}`}
    >
      {label}
    </button>
  )
}

export default function Sidebar({ activePage }: { activePage: string }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)

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
    await supabase.auth.signOut()
    router.push('/')
  }

  return (
    <>
      <button
        onClick={() => setOpen(!open)}
        className="fixed left-3 top-3 z-50 rounded-2xl bg-slate-900/95 p-2 text-amber-300 shadow-lg shadow-black/40"
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

      <aside className={`fixed left-0 top-0 h-screen w-60 bg-slate-900 border-r border-teal-800/30 flex flex-col z-50 transition-transform duration-300 ${open ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="p-6 border-b border-teal-800/20 text-center">
          <div className="text-amber-300 font-bold tracking-[0.3em]">MENU</div>
        </div>

        <nav className="flex flex-col gap-2 p-4 text-sm flex-1">
          {navItems.map((item) => (
            <NavItem
              key={item.key}
              label={item.label}
              href={item.href}
              active={activePage === item.key}
              onClick={() => setOpen(false)}
            />
          ))}
        </nav>

        <div className="p-4 border-t border-slate-800">
          <button
            onClick={logout}
            className="w-full text-left text-red-500 hover:text-red-400 font-semibold flex items-center gap-2"
          >
            <LogOut size={16} />
            Disconnettiti
          </button>
        </div>
      </aside>
    </>
  )
}
