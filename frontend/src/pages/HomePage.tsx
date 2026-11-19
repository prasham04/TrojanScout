import { useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { motion } from 'motion/react'
import { ArrowRight, Calculator, Compass, CalendarDays, Car, CheckCircle2, MapPinned, MessageCircle, Route, Search, Settings2, ShieldAlert, Sparkles } from 'lucide-react'
import { Aurora, CountUp, Reveal, Spotlight } from '../components/ui/fx'
import { useQuery } from '@tanstack/react-query'
import { api } from '../api/client'
import ZoneArt, { type Pin } from '../components/landing/ZoneArt'
import { money, timeAgo } from '../lib/format'
import { openTour } from '../components/layout/Tour'

const EXAMPLES = ['private room with private bath under $1,200', '2B2B inside DPS', 'studio near Leavey', '3 bed 2 bath with parking']

function ZoneChecker() {
  const [addr, setAddr] = useState('')
  const [pin, setPin] = useState<Pin | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const check = async (lat: number, lng: number, label?: string) => {
    setErr('')
    const z = await api.zoneCheck(lat, lng)
    setPin({ lat, lng, inDps: z.inDps, inFryft: z.inFryft, label: label ?? `${lat.toFixed(4)}, ${lng.toFixed(4)}` })
  }
  const lookup = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!addr.trim()) return
    setBusy(true)
    try { const g = await api.geocode(addr); await check(g.lat, g.lng, g.label.split(',').slice(0, 2).join(',')) }
    catch (x) { setErr((x as Error).message) }
    finally { setBusy(false) }
  }

  return (
    <div className="overflow-hidden rounded-[28px] bg-[#120404]/90 text-white shadow-[0_30px_80px_-20px_rgba(0,0,0,.6)] ring-1 ring-white/10 backdrop-blur animate-float [animation-duration:9s]">
      <div className="relative aspect-[640/560] w-full">
        <ZoneArt pin={pin} onPick={(la, lo) => check(la, lo)} />
        <div className="pointer-events-none absolute bottom-3 right-3 flex flex-col gap-1 rounded-xl bg-black/50 px-3 py-2 text-[11px] backdrop-blur">
          <span><span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-emerald-400" />Listing inside DPS</span>
          <span><span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-violet-400" />Listing outside DPS</span>
          <span><span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-red-500" />DPS unit (live, simulated)</span>
        </div>
      </div>
      <form data-tour="zone-check" onSubmit={lookup} className="flex gap-2 border-t border-white/10 p-3">
        <input value={addr} onChange={(e) => setAddr(e.target.value)} placeholder="Type an address, or tap the map…"
          className="min-w-0 flex-1 rounded-xl bg-white/10 px-3 py-2 text-sm text-white placeholder-white/50 outline-none ring-1 ring-white/10 focus:ring-gold" />
        <button disabled={busy} className="rounded-xl bg-gold px-4 text-sm font-semibold text-ink shadow-[0_0_24px_-4px_rgba(255,199,44,.7)] disabled:opacity-60">{busy ? '…' : 'Check'}</button>
      </form>
      <div className="min-h-14 px-4 pb-4 text-sm">
        {err && <p className="text-red-300">{err}</p>}
        {!pin && !err && <p className="text-white/60">Is an apartment inside the USC DPS patrol zone? Check any address.</p>}
        {pin && (
          <p className="flex items-center gap-2">
            <span className={`grid h-7 w-7 place-items-center rounded-full ${pin.inDps ? 'bg-emerald-500/20 text-emerald-300' : 'bg-violet-500/20 text-violet-300'}`}>{pin.inDps ? '✓' : '!'}</span>
            <span><b>{pin.label}</b> is {pin.inDps ? 'inside' : 'outside'} the DPS patrol zone{pin.inDps ? '' : ', so no DPS patrols'}{pin.inFryft ? (pin.inDps ? ', and inside USC’s free Lyft boundary.' : ', but it is inside USC’s free Lyft boundary.') : (pin.inDps ? ', but outside USC’s free Lyft boundary.' : ' or free USC Lyft rides.')}</span>
          </p>
        )}
      </div>
    </div>
  )
}


type Tile = { to: string; icon: typeof Route; title: string; body: string; span: string; tone?: 'dark' | 'gold' | 'red'; art?: 'route' | 'map' }
const TILES: Tile[] = [
  { to: '/map?mode=route', icon: Route, title: 'Safest Route', body: 'Routes that weigh reported crime, DPS patrols, broken streetlights and open places, and show every factor.', span: 'sm:col-span-2 lg:row-span-2', tone: 'dark', art: 'route' },
  { to: '/map', icon: MapPinned, title: 'Explore Map', body: 'Live listings, DPS and free-Lyft zones, police, blue-light phones and DPS alerts on one map.', span: 'sm:col-span-2', art: 'map' },
  { to: '/search', icon: Search, title: 'Smart Search', body: 'Type it how you’d say it. Your top 6 by match, with the True Cost beside them.', span: '' },
  { to: '/rides', icon: Car, title: 'Book a Ride', body: 'Split a ride with friends going your way. Stops stay private until you both accept.', span: '' },
  { to: '/free', icon: Sparkles, title: 'Free & Safe', body: 'USC and LA programs most students never hear about, with live hours and deadlines.', span: 'sm:col-span-2', tone: 'gold' },
  { to: '/emergency', icon: ShieldAlert, title: 'Emergency Contacts', body: '911, USC DPS and every crisis line, one tap away.', span: '', tone: 'red' },
  { to: '/ask', icon: MessageCircle, title: 'Ask Scout', body: 'An AI agent that checks zones, commute and cost, and shows its work.', span: '' },
  { to: '/true-cost', icon: Calculator, title: 'True Trojan Cost', body: 'Rent isn’t the bill. Every hidden cost, line by line.', span: '' },
  { to: '/preferences', icon: Settings2, title: 'Preferences', body: 'Budget, class buildings and priorities. They personalize every score.', span: '' },
]

function RouteArt() {
  // an abstract street grid with the safest route drawing itself
  return (
    <svg viewBox="0 0 400 260" className="absolute inset-0 h-full w-full opacity-90" aria-hidden>
      {Array.from({ length: 9 }, (_, i) => <line key={`h${i}`} x1="0" x2="400" y1={i * 32 + 6} y2={i * 32 + 6} stroke="rgb(255 255 255 / .06)" />)}
      {Array.from({ length: 13 }, (_, i) => <line key={`v${i}`} y1="0" y2="260" x1={i * 32 + 8} x2={i * 32 + 8} stroke="rgb(255 255 255 / .06)" />)}
      <path d="M40 230 L40 166 L136 166 L136 70 L296 70 L296 38 L360 38" fill="none" stroke="#2563eb" strokeWidth="4" strokeDasharray="8 8" strokeLinecap="round" opacity=".7" />
      <motion.path d="M40 230 L104 230 L104 134 L232 134 L232 70 L328 70 L328 38 L360 38" fill="none" stroke="#10b981" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round"
        style={{ filter: 'drop-shadow(0 0 8px rgb(16 185 129 / .8))' }} initial={{ pathLength: 0 }} whileInView={{ pathLength: 1 }} viewport={{ once: true }} transition={{ duration: 2, ease: [0.6, 0.05, 0.3, 1] }} />
      <circle cx="40" cy="230" r="7" fill="#fff" /><circle cx="360" cy="38" r="8" fill="#ffc72c" style={{ filter: 'drop-shadow(0 0 10px rgb(255 199 44 / .9))' }} />
    </svg>
  )
}
function MapArt() {
  const dots = [[30, 40, 1], [60, 70, 1], [90, 30, 0], [130, 60, 1], [170, 35, 1], [210, 75, 0], [250, 45, 1], [290, 70, 1], [320, 30, 1]]
  return (
    <svg viewBox="0 0 360 110" className="absolute inset-x-0 bottom-0 h-24 w-full" aria-hidden>
      <path d="M20 95 L20 15 L340 15 L340 95 Z" fill="rgb(153 0 0 / .05)" stroke="#990000" strokeDasharray="4 4" />
      {dots.map(([x, y, inside], i) => (
        <motion.circle key={i} cx={x} cy={y} r="5" fill={inside ? '#059669' : '#7c3aed'} stroke="#fff" strokeWidth="2"
          initial={{ scale: 0 }} whileInView={{ scale: 1 }} viewport={{ once: true }} transition={{ delay: 0.3 + i * 0.07, type: 'spring', stiffness: 300 }} />
      ))}
    </svg>
  )
}

const STEPS = [
  { icon: MapPinned, title: 'Pick a home', body: 'Search live listings. Each one shows DPS and free-Lyft coverage and what’s happened nearby.' },
  { icon: CalendarDays, title: 'See your week there', body: 'Your classes, late nights and weekends: which trips are free Lyft, which walks are after dark.' },
  { icon: CheckCircle2, title: 'Decide with the real numbers', body: 'True Cost, your top matches and the safest way to get around, before you sign.' },
]

export default function HomePage() {
  const nav = useNavigate()
  const [q, setQ] = useState('')
  const meta = useQuery({ queryKey: ['meta'], queryFn: api.meta, refetchInterval: 60_000 })
  const incidents = useQuery({ queryKey: ['incidents-meta'], queryFn: () => api.incidents(180) })
  const m = meta.data

  return (
    <div>
      <section className="relative overflow-clip bg-[#3b0000] text-white">
        <div className="absolute inset-0 bg-gradient-to-br from-cardinal via-[#7a0000] to-[#2a0000]" />
        <Aurora />
        <div className="absolute inset-0 opacity-[0.07] [background-image:radial-gradient(rgb(255_255_255)_1px,transparent_1px)] [background-size:22px_22px]" />
        <div className="relative mx-auto grid max-w-7xl items-center gap-10 px-4 py-14 md:grid-cols-[1.05fr_1fr] md:py-20">
          <div className="flex flex-col gap-6">
            <div className="flex flex-wrap items-center gap-2">
              <motion.span initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="w-fit rounded-full bg-white/10 px-3 py-1 text-xs font-semibold ring-1 ring-white/20 backdrop-blur">
                <span className="live-dot mr-1.5 inline-block h-2 w-2 rounded-full bg-gold" />
                {m ? `${m.count} live listings · updated ${timeAgo(m.scrapedAt)}` : 'Loading live listings…'}
              </motion.span>
              <motion.button initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} onClick={openTour}
                className="flex items-center gap-1.5 rounded-full bg-gold px-3 py-1 text-xs font-bold text-ink shadow-[0_0_20px_-4px_rgba(255,199,44,.9)] transition hover:brightness-95">
                <Compass size={13} />Take the tour
              </motion.button>
            </div>
            <motion.h1 initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05, duration: 0.6 }} className="text-5xl font-extrabold leading-[1.02] tracking-tight sm:text-6xl">
              Off-campus housing that <span className="font-display text-6xl font-normal italic text-gold sm:text-7xl">actually works</span> for a Trojan.
            </motion.h1>
            <motion.p initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.12, duration: 0.6 }} className="max-w-lg text-lg text-white/75">
              Zillow tells you the rent. TrojanScout tells you if USC has your back there: DPS patrols, free Lyft rides home, the safest walk to class, and what you’ll really pay.
            </motion.p>
            <motion.form initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.18, duration: 0.6 }}
              data-tour="home-search" onSubmit={(e) => { e.preventDefault(); nav(`/search?q=${encodeURIComponent(q)}`) }} className="flex max-w-lg gap-2 rounded-2xl bg-white/95 p-1.5 shadow-[0_20px_60px_-15px_rgba(0,0,0,.5)] ring-1 ring-white/40">
              <Search size={18} className="ml-2 self-center text-stone-400" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Try “2B2B under $3k near Viterbi”" className="min-w-0 flex-1 rounded-xl px-1 text-ink outline-none" />
              <button className="rounded-xl bg-gold px-5 py-2.5 font-semibold text-ink shadow-[0_0_30px_-6px_rgba(255,199,44,.9)] transition hover:brightness-95">Search</button>
            </motion.form>
            <div className="flex flex-wrap gap-2">
              {EXAMPLES.map((e) => (
                <button key={e} onClick={() => nav(`/search?q=${encodeURIComponent(e)}`)} className="rounded-full bg-white/10 px-3 py-1 text-xs ring-1 ring-white/20 backdrop-blur transition hover:bg-white/20">{e}</button>
              ))}
            </div>
          </div>
          <ZoneChecker />
        </div>
      </section>

      <section className="relative mx-auto -mt-10 grid max-w-4xl grid-cols-3 gap-3 px-4">
        {[
          { v: m?.count, f: (n: number) => Math.round(n).toString(), l: 'live listings' },
          { v: m ? Math.round((m.inDps / Math.max(m.count, 1)) * 100) : undefined, f: (n: number) => `${Math.round(n)}%`, l: 'inside the DPS zone' },
          { v: incidents.data?.count, f: (n: number) => Math.round(n).toLocaleString(), l: 'LAPD incidents mapped (6 mo)' },
        ].map((s, i) => (
          <Reveal key={s.l} i={i}>
            <div className="glass rounded-2xl p-4 text-center">
              <div className="text-3xl font-bold text-cardinal">{s.v != null ? <CountUp value={s.v} format={s.f} /> : <span className="num">—</span>}</div>
              <div className="text-xs text-stone-500">{s.l}</div>
            </div>
          </Reveal>
        ))}
      </section>

      <section className="mx-auto max-w-7xl px-4 pb-8 pt-16">
        <Reveal><p className="eyebrow text-center">One app, one decision</p></Reveal>
        <Reveal i={1}><h2 className="mt-2 text-center text-4xl font-extrabold tracking-tight sm:text-5xl">See your week <span className="font-display font-normal italic text-cardinal">before</span> you sign the lease</h2></Reveal>
        <div className="mt-10 grid gap-4 md:grid-cols-3">
          {STEPS.map((s, i) => (
            <Reveal key={s.title} i={i + 2}>
              <div className="card relative h-full p-6">
                <span className="num absolute right-5 top-4 text-5xl font-bold text-stone-900/[0.05]">0{i + 1}</span>
                <span className="grid h-11 w-11 place-items-center rounded-2xl bg-gradient-to-br from-cardinal to-cardinal-dark text-gold shadow-md shadow-cardinal/30"><s.icon size={20} /></span>
                <h3 className="mt-4 text-lg font-bold">{s.title}</h3>
                <p className="mt-1 text-sm text-stone-500">{s.body}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 py-12">
        <Reveal><h2 className="mb-2 text-center text-4xl font-extrabold tracking-tight">Everything a lease decision needs</h2></Reveal>
        <Reveal i={1}><p className="mx-auto mb-10 max-w-2xl text-center text-stone-500">Official boundaries, live listings, LAPD data and real costs, cross-referenced in seconds.</p></Reveal>
        <div className="grid auto-rows-[minmax(190px,auto)] gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {TILES.map((t, i) => {
            const dark = t.tone === 'dark', gold = t.tone === 'gold', red = t.tone === 'red'
            return (
              <Reveal key={t.title} i={i} className={t.span}>
                <Link to={t.to} className="block h-full">
                  <Spotlight className={`group relative h-full overflow-hidden rounded-3xl p-6 transition duration-300 hover:-translate-y-1 ${dark ? 'bg-[#140707] text-white shadow-[0_30px_60px_-30px_rgba(0,0,0,.7)]' : gold ? 'bg-gradient-to-br from-gold-50 to-[#fff1c4] ring-1 ring-gold/50' : red ? 'bg-gradient-to-br from-red-700 to-cardinal-dark text-white' : 'card'}`}>
                    {t.art === 'route' && <><RouteArt /><div className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-[#140707] via-[#140707]/85 to-transparent" /></>}
                    {t.art === 'map' && <MapArt />}
                    <div className={`relative flex h-full flex-col ${t.art === 'route' ? 'justify-end' : ''} ${t.art === 'map' ? 'pb-24' : ''}`}>
                      <span className={`grid h-11 w-11 place-items-center rounded-2xl ${dark || red ? 'bg-white/10 text-gold ring-1 ring-white/15' : gold ? 'bg-white text-amber-700 ring-1 ring-gold/50' : 'bg-cardinal-50 text-cardinal'}`}><t.icon size={20} /></span>
                      <h3 className={`mt-4 flex items-center gap-1.5 text-lg font-bold ${dark || red ? '' : 'group-hover:text-cardinal'}`}>{t.title}<ArrowRight size={16} className="transition group-hover:translate-x-1" /></h3>
                      <p className={`mt-1 max-w-md text-sm ${dark || red ? 'text-white/70' : 'text-stone-500'}`}>{t.body}</p>
                    </div>
                  </Spotlight>
                </Link>
              </Reveal>
            )
          })}
        </div>
        {m?.medianRent && <p className="mt-10 text-center text-sm text-stone-500">Median listed price right now: <b className="num text-ink">{money(m.medianRent)}</b>. Safety shown as facts, never labels. Costs are estimates.</p>}
      </section>
    </div>
  )
}
