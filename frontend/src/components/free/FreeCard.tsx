import { useEffect, useState } from 'react'
import { motion } from 'motion/react'
import {
  Bike, Bus, CalendarHeart, CreditCard, ExternalLink, HandHeart, Home, Lightbulb, Lock, Martini, Moon, Phone, Pill, ShieldCheck, Smartphone, Sparkles, TriangleAlert,
  type LucideIcon,
} from 'lucide-react'
import { ELIGIBILITY, type FreeProgram } from '../../lib/free'
import { Spotlight } from '../ui/fx'

const CATEGORY: Record<string, LucideIcon> = {
  'night ride': Moon, escort: ShieldCheck, app: Smartphone, 'theft prevention': Lock, 'health & harm reduction': Pill, transit: Bus, shuttle: Bus,
  support: HandHeart, 'holiday ride': CalendarHeart, 'money help': CreditCard, bike: Bike, report: Lightbulb, nightlife: Martini, 'survivor support': Home,
  'emergency ride': Phone,
}

/** "in 3d 4h" style countdown to a program's next opening or deadline; ticks every minute. */
export function Countdown({ to }: { to: string }) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 60_000); return () => clearInterval(t) }, [])
  const ms = Date.parse(to) - now
  if (!(ms > 0)) return null
  const d = Math.floor(ms / 864e5), h = Math.floor((ms % 864e5) / 36e5), m = Math.floor((ms % 36e5) / 6e4)
  return <span className="num">{d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m`}</span>
}

function StatusChip({ p }: { p: FreeProgram }) {
  const s = p.status.state
  const tone = s === 'open' ? 'bg-emerald-50 text-emerald-800 ring-emerald-300 shadow-[0_0_18px_-4px_rgba(16,185,129,.55)]'
    : s === 'upcoming' ? 'bg-gold-50 text-amber-800 ring-gold shadow-[0_0_18px_-6px_rgba(255,199,44,.8)]'
    : s === 'closed' ? 'bg-stone-100 text-stone-600 ring-stone-200' : 'bg-stone-50 text-stone-500 ring-stone-200'
  return (
    <span className={`flex w-fit items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ${tone}`}>
      {s === 'open' && <span className="live-dot h-2 w-2 rounded-full bg-emerald-500" />}
      {p.status.label}
      {(s === 'upcoming' || s === 'closed') && p.status.next && <span className="rounded-full bg-white/80 px-1.5 text-[10px] font-bold">opens in <Countdown to={p.status.next} /></span>}
    </span>
  )
}

export default function FreeCard({ p, compact = false, featured = false }: { p: FreeProgram; compact?: boolean; featured?: boolean }) {
  const Icon = CATEGORY[p.category] ?? Sparkles
  const free = /^free/i.test(p.cost)
  return (
    <motion.div layout initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }} className={`h-full ${featured ? 'sm:col-span-2' : ''}`}>
      <Spotlight as="article" className={`flex h-full flex-col gap-2.5 overflow-hidden rounded-3xl p-5 transition duration-300 hover:-translate-y-1 ${featured ? 'bg-gradient-to-br from-white via-white to-gold-50 shadow-[0_20px_50px_-24px_rgba(153,0,0,.35)] ring-1 ring-gold/40' : 'card'} ${!p.eligible ? 'opacity-60' : ''}`}>
        {featured && <div className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full bg-gold/25 blur-3xl" />}
        <div className="relative flex items-start gap-3">
          <span className={`grid shrink-0 place-items-center rounded-2xl ${featured ? 'h-12 w-12 bg-gradient-to-br from-cardinal to-cardinal-dark text-gold shadow-md shadow-cardinal/30' : 'h-10 w-10 bg-cardinal-50 text-cardinal'}`}><Icon size={featured ? 22 : 18} /></span>
          <div className="min-w-0 flex-1">
            {featured && <p className="eyebrow mb-0.5 !text-cardinal">Featured</p>}
            <h3 className={`font-bold leading-snug ${featured ? 'text-lg' : ''}`}>{p.name}</h3>
            <p className="text-xs text-stone-500">{p.provider}</p>
          </div>
          <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-bold ${free ? 'bg-emerald-600 text-white shadow-[0_0_16px_-4px_rgba(5,150,105,.7)]' : 'bg-stone-200 text-stone-700'}`}>{p.cost}</span>
        </div>
        <div className="relative"><StatusChip p={p} /></div>
        <p className={`relative text-stone-700 ${featured ? 'text-[15px]' : 'text-sm'}`}>{p.summary}</p>
        {!compact && (
          <div className="relative flex flex-wrap gap-1">
            {p.eligibility.map((e) => <span key={e} className="rounded-full bg-stone-100 px-2 py-0.5 text-[11px] text-stone-600">{ELIGIBILITY[e] ?? e}</span>)}
            {p.areaOk === true && <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] text-emerald-700">✓ covers your location</span>}
            {p.areaOk === false && <span className="rounded-full bg-violet-50 px-2 py-0.5 text-[11px] text-violet-700">Not at your location</span>}
            {!p.eligible && <span className="rounded-full bg-stone-100 px-2 py-0.5 text-[11px] text-stone-500">USC students only</span>}
          </div>
        )}
        {p.caveats && !compact && <p className="relative flex gap-1.5 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-900"><TriangleAlert size={14} className="mt-px shrink-0" />{p.caveats}</p>}
        <div className="relative mt-auto flex flex-wrap items-center gap-2 pt-1">
          {p.how.phone && <a href={`tel:${p.how.phone.replace(/[^\d+]/g, '')}`} className="btn-glow flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-cardinal to-cardinal-dark px-3 py-1.5 text-xs font-semibold !text-white"><Phone size={13} />{p.how.phone}</a>}
          {p.how.url && <a href={p.how.url} target="_blank" rel="noreferrer" className="flex items-center gap-1 rounded-xl px-3 py-1.5 text-xs font-semibold !text-stone-700 ring-1 ring-stone-300 transition hover:bg-stone-50">Open<ExternalLink size={12} /></a>}
          {p.how.app && <span className="flex items-center gap-1 text-xs text-stone-500"><Smartphone size={12} />{p.how.app}</span>}
        </div>
        {!compact && (
          <p className="relative text-[10px] text-stone-400">
            {p.confidence === 'closed' ? <b className="text-red-700">Closed to new applicants · </b> : p.confidence === 'check' ? 'Sources disagree or not yet confirmed for 2026 · ' : ''}Checked {p.verified} ·{' '}
            {p.sources.slice(0, 2).map((s, i) => <a key={s} href={s} target="_blank" rel="noreferrer" className="underline">{i ? ' · ' : ''}source {i + 1}</a>)}
          </p>
        )}
      </Spotlight>
    </motion.div>
  )
}
