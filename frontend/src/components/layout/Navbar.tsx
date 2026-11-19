import { useState } from 'react'
import { Link, NavLink, useLocation } from 'react-router'
import { motion } from 'motion/react'
import { Car, Map, Menu, Search, ShieldAlert, Sparkles, TriangleAlert, X } from 'lucide-react'
import { useAppStore } from '../../store/useAppStore'
import { AlertBell } from '../free/Alerts'
import { signIn, token, useMe } from '../../lib/auth'

// Ask Scout floats on every page; True Cost lives in Search; Preferences lives in your profile.
const LINKS = [
  { to: '/map', label: 'Explore Map', icon: Map },
  { to: '/search', label: 'Search', icon: Search },
  { to: '/rides', label: 'Book Ride', icon: Car },
  { to: '/free', label: 'Free & Safe', icon: Sparkles },
]

export default function Navbar() {
  const [open, setOpen] = useState(false)
  const compareCount = useAppStore((s) => s.compareIds.length)
  const me = useMe()
  const { pathname } = useLocation()
  const active = (to: string) => pathname === to || pathname.startsWith(`${to}/`)
  return (
    <header className="glass sticky top-0 z-[1000] !rounded-none !border-x-0 !border-t-0 !border-b-stone-200/70">
      <nav className="mx-auto flex h-16 max-w-7xl items-center gap-4 px-4">
        <Link to="/" className="group flex items-center gap-2.5" onClick={() => setOpen(false)}>
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-cardinal to-cardinal-dark text-sm font-extrabold text-gold shadow-md shadow-cardinal/30 transition group-hover:rotate-[-6deg]">TS</span>
          <span className="text-[19px] font-extrabold tracking-tight">Trojan<span className="font-display text-[23px] font-normal italic text-cardinal">Scout</span></span>
        </Link>
        <div className="ml-auto hidden items-center gap-1 rounded-full bg-stone-900/[0.04] p-1 lg:flex">
          {LINKS.map(({ to, label, icon: Icon }) => (
            <NavLink key={to} to={to} data-tour={`nav-${to.slice(1)}`} className={`relative flex items-center gap-1.5 whitespace-nowrap rounded-full px-3.5 py-1.5 text-sm font-semibold transition ${active(to) ? 'text-white' : 'text-stone-600 hover:text-ink'}`}>
              {active(to) && <motion.span layoutId="nav-pill" className="absolute inset-0 rounded-full bg-cardinal shadow-md shadow-cardinal/30" transition={{ type: 'spring', stiffness: 420, damping: 34 }} />}
              <Icon size={15} className="relative" />
              <span className="relative">{label}</span>
              {to === '/map' && compareCount > 0 && <span className="relative ml-0.5 rounded-full bg-gold px-1.5 text-[11px] font-bold text-ink">{compareCount}</span>}
            </NavLink>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-2 lg:ml-2">
          <NavLink to="/report" data-tour="nav-report" className={({ isActive }) => `hidden items-center gap-1.5 rounded-full px-3.5 py-1.5 text-sm font-semibold ring-1 transition sm:flex ${isActive ? 'bg-red-700 text-white ring-red-700' : 'text-red-700 ring-red-200 hover:bg-red-50'}`}>
            <TriangleAlert size={15} />Report
          </NavLink>
          <NavLink to="/emergency" data-tour="nav-emergency" title="Emergency contacts" className={({ isActive }) => `hidden h-9 w-9 place-items-center rounded-full ring-1 transition sm:grid ${isActive ? 'bg-red-700 text-white ring-red-700' : 'text-red-700 ring-red-200 hover:bg-red-50'}`}>
            <ShieldAlert size={17} />
          </NavLink>
          <span data-tour="nav-alerts" className="rounded-full"><AlertBell /></span>
          {token() && me.data ? (
            <Link to="/profile" data-tour="nav-account" title={`${me.data.name} · profile`} className="relative grid h-9 w-9 place-items-center rounded-full bg-gradient-to-br from-cardinal to-cardinal-dark text-sm font-bold text-gold shadow-md shadow-cardinal/30 ring-2 ring-white">
              {me.data.name[0]?.toUpperCase()}
              {me.data.incoming.length > 0 && <span className="absolute -right-0.5 -top-0.5 h-3 w-3 rounded-full bg-gold ring-2 ring-white" />}
            </Link>
          ) : (
            <button onClick={() => signIn()} data-tour="nav-account" className="rounded-full bg-ink px-4 py-1.5 text-sm font-semibold text-white shadow-md transition hover:bg-stone-800">Sign in</button>
          )}
        </div>
        <button data-tour="menu" className="rounded-xl p-2 lg:hidden" aria-label="Menu" onClick={() => setOpen(!open)}>{open ? <X size={22} /> : <Menu size={22} />}</button>
      </nav>
      {open && (
        <div className="flex flex-col gap-1 border-t border-stone-200/70 px-4 py-3 lg:hidden">
          {[...LINKS, { to: '/report', label: 'Report suspicious activity', icon: TriangleAlert }, { to: '/emergency', label: 'Emergency contacts', icon: ShieldAlert }].map(({ to, label, icon: Icon }) => (
            <NavLink key={to} to={to} onClick={() => setOpen(false)} className={`flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold ${active(to) ? 'bg-cardinal text-white' : 'text-stone-700 hover:bg-stone-100'}`}><Icon size={16} />{label}</NavLink>
          ))}
        </div>
      )}
    </header>
  )
}
