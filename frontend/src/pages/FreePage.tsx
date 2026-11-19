import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import FreeCard, { Countdown } from '../components/free/FreeCard'
import { LayoutGroup, motion } from 'motion/react'
import { CalendarClock, GraduationCap, LocateFixed, Radio, Search as SearchIcon } from 'lucide-react'
import { Skeleton } from '../components/ui/fx'
import { CATEGORY_ICON, searchFree, upcomingFree } from '../lib/free'
import StickyBar from '../components/ui/StickyBar'
import WakingNote from '../components/ui/WakingNote'

const EXAMPLES = [
  'free ride home tonight', "I've been drinking and can't drive", 'someone is following me', 'my drink might be spiked',
  "can't afford the bus", 'my bike got stolen', 'stalker knows my address', 'harassed on the train', 'free stuff new years eve',
]

// Shown first on Free & Safe
const PINNED = ['drink-test-kits', 'bike-registration']

export default function FreePage() {
  const [params, setParams] = useSearchParams()
  const q = params.get('q') ?? ''
  const [draft, setDraft] = useState(q)
  const [category, setCategory] = useState('')
  const [nowOnly, setNowOnly] = useState(false)
  const [usc, setUsc] = useState(true)
  const [here, setHere] = useState<{ lat: number; lng: number } | null>(null)
  useEffect(() => { setDraft(q) }, [q])

  const res = useQuery({
    queryKey: ['free', q, category, nowOnly, usc, here],
    queryFn: () => searchFree({ q, category: category || undefined, availableNow: nowOnly || undefined, usc, lat: here?.lat ?? 34.0224, lng: here?.lng ?? -118.2851 }),
    placeholderData: keepPreviousData, refetchInterval: 60_000,
  })
  const up = useQuery({ queryKey: ['free-upcoming'], queryFn: upcomingFree })
  const r = res.data

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <div className="glass-dark mb-6 flex flex-wrap items-center gap-2 rounded-2xl px-4 py-3 text-sm">
        <span className="font-semibold">In danger right now?</span>
        <a href="tel:911" className="rounded-lg bg-red-600 px-3 py-1 font-bold !text-white">911</a>
        <a href="tel:2137404321" className="rounded-lg bg-white/10 px-3 py-1 font-semibold !text-white ring-1 ring-white/20">USC DPS 213-740-4321</a>
        <a href="tel:988" className="rounded-lg bg-white/10 px-3 py-1 font-semibold !text-white ring-1 ring-white/20">988 crisis line</a>
        <span className="text-xs text-white/60">Blue-light phones on campus connect straight to DPS.</span>
      </div>

      <p className="eyebrow">USC · Los Angeles · California</p>
      <h1 className="mt-1 text-4xl font-extrabold tracking-tight sm:text-5xl">Free <span className="font-display font-normal italic text-cardinal">&amp;</span> Safe</h1>
      <p className="mb-2 max-w-3xl text-stone-500">
        Free rides, escorts, apps, money help and lesser-known programs from USC, LA, California and beyond, in one place. Describe your
        situation and we'll show what you can use right now, where you are, with the official source for each.
      </p>

      <StickyBar>
      <form onSubmit={(e) => { e.preventDefault(); setParams(draft ? { q: draft } : {}) }} className="flex gap-2 p-1.5">
        <SearchIcon size={18} className="ml-2 self-center text-stone-400" />
        <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="What's going on? e.g. “need a free ride home tonight”"
          className="min-w-0 flex-1 bg-transparent px-2 py-2.5 outline-none" />
        <button className="btn-glow rounded-xl bg-gradient-to-r from-cardinal to-cardinal-dark px-6 font-semibold text-white">Search</button>
      </form>
      </StickyBar>
      <div className="mt-1 flex flex-wrap gap-2">
        {EXAMPLES.map((e) => <button key={e} onClick={() => setParams({ q: e })} className="rounded-full bg-white/70 px-3 py-1 text-xs ring-1 ring-stone-200 transition hover:-translate-y-0.5 hover:ring-cardinal">{e}</button>)}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2 text-sm">
        <div className="flex rounded-full bg-stone-900/[0.05] p-1">
          {[
            { on: nowOnly, set: () => setNowOnly(!nowOnly), icon: Radio, label: 'Available right now' },
            { on: usc, set: () => setUsc(!usc), icon: GraduationCap, label: "I'm a USC student" },
            { on: !!here, set: () => navigator.geolocation?.getCurrentPosition((p) => setHere({ lat: p.coords.latitude, lng: p.coords.longitude })), icon: LocateFixed, label: here ? 'Using your location' : 'Use my location' },
          ].map((t) => (
            <button key={t.label} type="button" onClick={t.set} className={`relative flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition ${t.on ? 'text-white' : 'text-stone-600 hover:text-ink'}`}>
              {t.on && <motion.span layoutId={`seg-${t.label}`} className="absolute inset-0 rounded-full bg-cardinal shadow-md shadow-cardinal/30" />}
              <t.icon size={13} className="relative" /><span className="relative">{t.label}</span>
            </button>
          ))}
        </div>
        <select value={category} onChange={(e) => setCategory(e.target.value)} className="rounded-full border border-stone-300 bg-white px-3 py-1.5 text-xs font-semibold">
          <option value="">All categories</option>
          {r?.categories.map((c) => <option key={c} value={c}>{CATEGORY_ICON[c] ?? ''} {c}</option>)}
        </select>
        {r && <span className="ml-auto text-xs text-stone-500">{r.count} programs · times in LA</span>}
      </div>

      {r && (r.understood.length > 0 || r.tonight || r.availableNow) && (
        <div className="mt-4 flex flex-wrap items-center gap-2 text-sm">
          <span className="font-semibold">Understood:</span>
          {r.understood.map((u) => <span key={u} className="rounded-full bg-cardinal-50 px-3 py-0.5 text-xs font-semibold text-cardinal ring-1 ring-red-200">{u}</span>)}
          {r.availableNow && <span className="rounded-full bg-emerald-50 px-3 py-0.5 text-xs font-semibold text-emerald-800 ring-1 ring-emerald-200">Available right now</span>}
          {r.tonight && <span className="rounded-full bg-emerald-50 px-3 py-0.5 text-xs font-semibold text-emerald-800 ring-1 ring-emerald-200">Tonight</span>}
        </div>
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_300px]">
        <LayoutGroup>
        <div className={`grid content-start gap-4 transition-opacity sm:grid-cols-2 ${res.isFetching ? 'opacity-70' : ''}`}>
          <WakingNote active={res.isLoading} />
          {res.isLoading && [0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-64 !rounded-3xl" />)}
          {res.isError && <p className="rounded-xl bg-red-50 p-4 text-sm text-red-700 sm:col-span-2">{(res.error as Error).message}</p>}
          {r && [...r.results.filter((p) => PINNED.includes(p.id)).sort((a, b) => PINNED.indexOf(a.id) - PINNED.indexOf(b.id)), ...r.results.filter((p) => !PINNED.includes(p.id))]
            .map((p) => <FreeCard key={p.id} p={p} featured={PINNED.includes(p.id)} />)}
          {r?.count === 0 && <p className="text-stone-500 sm:col-span-2">Nothing matches that right now. Try turning off “Available right now”.</p>}
        </div>
        </LayoutGroup>
        <aside className="space-y-3 lg:sticky lg:top-24 lg:self-start">
          <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-[#2a0606] to-[#130404] p-5 text-white shadow-[0_24px_60px_-24px_rgba(0,0,0,.6)]">
            <div className="pointer-events-none absolute -right-10 -top-10 h-36 w-36 rounded-full bg-gold/25 blur-3xl" />
            <h2 className="relative mb-2 flex items-center gap-2 font-bold"><CalendarClock size={18} className="text-gold" />Coming up free</h2>
            <p className="relative mb-3 text-xs text-white/60">Limited-time offers like free holiday rides. They're easy to miss, so they're collected here.</p>
            <ul className="relative space-y-3">
              {up.data?.map((u) => (
                <li key={u.id + u.status.next} className="rounded-2xl bg-white/5 p-3 ring-1 ring-white/10">
                  <div className="text-sm font-semibold leading-tight">{u.name}</div>
                  <div className={`mt-0.5 text-xs ${u.status.state === 'open' ? 'font-semibold text-emerald-300' : 'text-gold'}`}>{u.status.label}</div>
                  {u.status.next && u.status.state !== 'open' && <div className="mt-1 w-fit rounded-full bg-gold/15 px-2 py-0.5 text-[11px] font-bold text-gold ring-1 ring-gold/30">in <Countdown to={u.status.next} /></div>}
                  {u.how.phone && <a href={`tel:${u.how.phone.replace(/[^\d+]/g, '')}`} className="mt-1 block text-xs font-semibold !text-gold">📞 {u.how.phone}</a>}
                  {u.confidence === 'check' && <div className="text-[10px] text-white/40">Confirm this year's dates</div>}
                </li>
              ))}
              {!up.data?.length && <li className="text-xs text-white/50">Nothing scheduled in the next few months.</li>}
            </ul>
          </div>
          <div className="card p-4 text-xs text-stone-500">
            <h2 className="mb-1 text-sm font-bold text-ink">How this list stays honest</h2>
            Every program links its official source and the date we checked it. Where sources disagree (e.g. Fryft hours changed in 2025), it says so.
            Add or fix a program in <code>data/free_programs.json</code>; search and statuses update automatically.
          </div>
        </aside>
      </div>
    </div>
  )
}
