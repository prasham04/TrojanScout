import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { api } from '../api/client'
import ListingCard from '../components/listing/ListingCard'
import CostPage from './CostPage'
import { LayoutGroup, motion } from 'motion/react'
import { Calculator, Search as SearchIcon, SlidersHorizontal, Sparkles } from 'lucide-react'
import { Skeleton } from '../components/ui/fx'
import { useAppStore } from '../store/useAppStore'
import { money } from '../lib/format'
import type { Priorities } from '../api/types'
import StickyBar from '../components/ui/StickyBar'
import WakingNote from '../components/ui/WakingNote'

const PRIO: { k: keyof Priorities; label: string }[] = [{ k: 'cost', label: 'Cost' }, { k: 'commute', label: 'Commute' }, { k: 'zone', label: 'DPS & free Lyft' }, { k: 'incidents', label: 'Fewer incidents' }]
const TOP = 6

const EXAMPLES = [
  'private room with private bathroom under $1,200', '2B2B inside DPS', '3 bed 2 bath with parking', 'shared room cheapest',
  'studio between $1,500 and $2,000', 'furnished 1B1B 10 min walk to Viterbi', 'pet friendly near USC Village',
]
const LAYOUTS = ['Studio', '1B1B', '2B1B', '2B2B', '3B2B', '3B3B']
const ROOM_TYPES = [['', 'Any type'], ['entire', 'Entire unit'], ['private_room', 'Private room'], ['shared_room', 'Shared room']]

export default function SearchPage() {
  const [params, setParams] = useSearchParams()
  const q = params.get('q') ?? ''
  const ignore = params.get('ignore') ?? ''
  const [draft, setDraft] = useState(q)
  const [roomType, setRoomType] = useState('')
  const [layout, setLayout] = useState('')
  const [privateBath, setPrivateBath] = useState(false)
  const [maxRent, setMaxRent] = useState('')
  useEffect(() => { setDraft(q) }, [q])
  const { profile, setProfile, costListingId, openCost } = useAppStore()
  const [showAll, setShowAll] = useState(false)
  const [tune, setTune] = useState(false)

  const lay = layout === 'Studio' ? { beds: 0, baths: undefined } : layout ? { beds: +layout[0], baths: +layout[2] } : {}
  const search = useQuery({
    queryKey: ['search', q, ignore, roomType, layout, privateBath, maxRent],
    queryFn: () => api.search({ q, k: 36, ignore, roomType: roomType || undefined, privateBath: privateBath || undefined, maxRent: maxRent || undefined, ...lay }),
    placeholderData: keepPreviousData,
  })
  const r = search.data
  // rank what the search found by fit to YOUR preferences; re-ranks as soon as a preference changes
  const ids = useMemo(() => (r?.results ?? []).map((h) => h.id), [r])
  const sims = useMemo(() => (r?.results ?? []).map((h) => h.cosine ?? null), [r])
  const fits = useQuery({ queryKey: ['fit-rank', ids, sims, profile], queryFn: () => api.fitRank(ids, profile, sims), enabled: ids.length > 0, placeholderData: keepPreviousData })
  const ranked = useMemo(() => {
    const list = [...(r?.results ?? [])]
    if (!fits.data) return list
    return list.map((h, i) => ({ h, i })).sort((a, b) => (fits.data![b.h.id]?.match ?? -1) - (fits.data![a.h.id]?.match ?? -1) || a.i - b.i).map((x) => x.h)
  }, [r, fits.data])
  useEffect(() => { setShowAll(false) }, [q, roomType, layout, privateBath, maxRent])
  // True Cost panel: the listing you picked (or ?cost= from the map), otherwise your #1 match
  useEffect(() => { const c = params.get('cost'); if (c) openCost(c) }, [params, openCost])
  const costId = costListingId && (ranked.some((h) => h.id === costListingId) || params.get('cost') === costListingId) ? costListingId : ranked[0]?.id
  const costName = ranked.find((h) => h.id === costId)?.name
  const drop = (key: string) => { const p = new URLSearchParams(params); p.set('ignore', [...ignore.split(',').filter(Boolean), key].join(',')); setParams(p) }
  const go = (text: string) => setParams(text ? { q: text } : {})

  return (
    <div className="mx-auto max-w-7xl px-4 py-8">
      <p className="eyebrow">Live listings · ranked for you</p>
      <h1 className="mb-2 mt-1 text-4xl font-extrabold tracking-tight sm:text-5xl">Smart <span className="font-display font-normal italic text-cardinal">search</span></h1>

      <StickyBar>
      <form onSubmit={(e) => { e.preventDefault(); go(draft) }} className="flex gap-2 p-1.5">
        <SearchIcon size={18} className="ml-2 self-center text-stone-400" />
        <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="e.g. furnished 2B2B under $3,200, 10 min walk to Viterbi, inside DPS"
          className="min-w-0 flex-1 rounded-xl bg-transparent px-2 py-2.5 outline-none" />
        <button className="btn-glow rounded-xl bg-gradient-to-r from-cardinal to-cardinal-dark px-6 font-semibold text-white">Search</button>
      </form>
      </StickyBar>
      <div className="mt-1 flex flex-wrap gap-2">
        {EXAMPLES.map((e) => <button key={e} onClick={() => go(e)} className="rounded-full bg-white/70 px-3 py-1 text-xs ring-1 ring-stone-200 transition hover:-translate-y-0.5 hover:ring-cardinal">{e}</button>)}
      </div>

      {r && (q || r.understood.length > 0) && (
        <div className="card mt-5 p-4">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-semibold">Understood as:</span>
            {r.understood.length === 0 && <span className="text-stone-500">no hard filters, ranking by meaning only</span>}
            {r.understood.map((c) => (
              <span key={c.key} className="inline-flex items-center gap-1 rounded-full bg-cardinal-50 px-3 py-1 text-xs font-semibold text-cardinal ring-1 ring-red-200">
                {c.label}<button onClick={() => drop(c.key)} aria-label={`Remove ${c.label}`} className="ml-0.5 opacity-60 hover:opacity-100">✕</button>
              </span>
            ))}
            {r.semanticText && <span className="text-xs text-stone-500">+ ranked by “{r.semanticText}”</span>}
          </div>
          <p className="mt-2 text-[11px] text-stone-400">
            {r.count} results in {r.tookMs} ms · parsed by {r.parser === 'rules+llm' ? 'rules + LLM' : 'built-in language rules (add an LLM key for even better understanding)'}
            {ignore && <> · <button className="font-medium text-cardinal" onClick={() => { const p = new URLSearchParams(params); p.delete('ignore'); setParams(p) }}>restore removed filters</button></>}
          </p>
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2 text-sm">
        <select value={roomType} onChange={(e) => setRoomType(e.target.value)} className="rounded-lg border border-stone-300 bg-white px-2 py-1.5">
          {ROOM_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <div className="flex overflow-hidden rounded-lg ring-1 ring-stone-300">
          {LAYOUTS.map((l) => (
            <button key={l} onClick={() => setLayout(layout === l ? '' : l)} className={`px-2.5 py-1.5 text-xs font-semibold ${layout === l ? 'bg-cardinal text-white' : 'bg-white hover:bg-stone-50'}`}>{l}</button>
          ))}
        </div>
        <label className="flex items-center gap-1.5 rounded-lg bg-white px-2 py-1.5 ring-1 ring-stone-300"><input type="checkbox" checked={privateBath} onChange={(e) => setPrivateBath(e.target.checked)} className="accent-cardinal" />Private bathroom</label>
        <select value={maxRent} onChange={(e) => setMaxRent(e.target.value)} className="rounded-lg border border-stone-300 bg-white px-2 py-1.5">
          <option value="">Any price</option>{[900, 1200, 1500, 2000, 3000, 4000].map((v) => <option key={v} value={v}>Under ${v.toLocaleString()}</option>)}
        </select>
        <div className="flex items-center gap-1.5" title="Prices are per person. A whole apartment's rent is split by bedroom: e.g. a 2B2B is split 2 ways with your own bedroom, or 4 ways when you share bedrooms. Room listings are already per person.">
          <span className="text-xs font-semibold text-stone-500">Split whole apartments:</span>
          <div className="flex overflow-hidden rounded-lg ring-1 ring-stone-300">
            {([['private', 'Own bedroom'], ['shared', 'Shared bedroom']] as const).map(([v, l]) => (
              <button key={v} onClick={() => setProfile({ sharing: v })}
                className={`px-2.5 py-1.5 text-xs font-semibold ${(profile.sharing ?? 'private') === v ? 'bg-cardinal text-white' : 'bg-white hover:bg-stone-50'}`}>{l}</button>
            ))}
          </div>
        </div>
      </div>

      {search.isError && <p className="mt-8 rounded-xl bg-red-50 p-4 text-sm text-red-700">{(search.error as Error).message}</p>}
      {r?.count === 0 && <p className="mt-8 text-center text-stone-500">No listings match all of that. Remove a filter chip above to widen the search.</p>}
      <div className="mt-6 grid items-start gap-6 lg:grid-cols-[1fr_420px]">
      <div className="min-w-0">
      {r && r.count > 0 && (
        <div className="card relative overflow-hidden p-5">
          <div className="pointer-events-none absolute -right-16 -top-16 h-40 w-40 rounded-full bg-gold/20 blur-3xl" />
          <div className="relative flex flex-wrap items-center gap-x-3 gap-y-1">
            <h2 className="flex items-center gap-2 text-xl font-extrabold"><Sparkles size={18} className="text-cardinal" />Top {Math.min(TOP, ranked.length)} for you</h2>
            <span className="text-xs text-stone-500">recommended by how closely each place matches your priorities{q ? ' and your search' : ''} (cosine similarity): budget {money(profile.budget)}, {profile.buildingIds.length} class buildings, {profile.lateNights} late nights/week. Click a card for its True Cost.</span>
            <button onClick={() => setTune(!tune)} className="ml-auto flex items-center gap-1 rounded-full px-3 py-1 text-xs font-semibold text-cardinal ring-1 ring-cardinal/30 hover:bg-cardinal-50"><SlidersHorizontal size={13} />{tune ? 'Done' : 'Adjust priorities'}</button>
            <Link to="/preferences" className="text-xs font-semibold text-stone-500 hover:text-cardinal">All preferences →</Link>
          </div>
          {tune && (
            <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
              <label className="text-xs"><span className="flex justify-between font-medium"><span>Budget</span><b>{money(profile.budget)}</b></span>
                <input type="range" min={600} max={4000} step={50} value={profile.budget} onChange={(e) => setProfile({ budget: +e.target.value })} className="w-full accent-cardinal" /></label>
              {PRIO.map(({ k, label }) => (
                <label key={k} className="text-xs"><span className="flex justify-between font-medium"><span>{label}</span><b>{Math.round(profile.priorities[k] * 100)}</b></span>
                  <input type="range" min={0} max={1} step={0.05} value={profile.priorities[k]} onChange={(e) => setProfile({ priorities: { ...profile.priorities, [k]: +e.target.value } })} className="w-full accent-cardinal" /></label>
              ))}
            </div>
          )}
        </div>
      )}
      {search.isLoading && <div className="mt-4"><WakingNote active={search.isLoading} /></div>}
      {search.isLoading && <div className="mt-4 grid gap-4 sm:grid-cols-2">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-96 !rounded-3xl" />)}</div>}
      <LayoutGroup>
      <div className={`mt-4 grid gap-4 transition-opacity sm:grid-cols-2 ${search.isFetching || fits.isFetching ? 'opacity-70' : ''}`}>
        {ranked.slice(0, showAll ? ranked.length : TOP).map((h, i) => (
          // cards glide to their new place when your priorities change the ranking
          <motion.div key={h.id} layout initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ layout: { type: 'spring', stiffness: 260, damping: 30 }, delay: Math.min(i, 6) * 0.04 }}>
            <ListingCard listing={h} showRanks={!!r?.semanticText} rank={i < TOP ? i + 1 : undefined} match={fits.data?.[h.id]?.match} why={fits.data?.[h.id]?.why}
              costSelected={h.id === costId} onSelect={() => openCost(h.id)} />
          </motion.div>
        ))}
      </div>
      </LayoutGroup>
      {ranked.length > TOP && (
        <div className="mt-5 text-center">
          <button onClick={() => setShowAll(!showAll)} className="rounded-full bg-white px-6 py-2.5 text-sm font-semibold shadow-sm ring-1 ring-stone-300 transition hover:-translate-y-0.5 hover:ring-cardinal">
            {showAll ? `Show only the top ${TOP}` : `Show ${ranked.length - TOP} more`}
          </button>
        </div>
      )}
      </div>

      {/* True Trojan Cost for the selected listing */}
      {costId && (
        <aside className="lg:sticky lg:top-24 lg:self-start">
          <div className="glass overflow-hidden rounded-3xl">
            <div className="relative overflow-hidden border-b border-stone-900/10 bg-gradient-to-r from-cardinal to-cardinal-dark px-4 py-3 text-white">
              <div className="pointer-events-none absolute -right-8 -top-10 h-28 w-28 rounded-full bg-gold/30 blur-2xl" />
              <div className="relative flex items-center gap-2 font-bold"><Calculator size={16} />True Trojan Cost</div>
              <div className="relative truncate text-xs text-white/75">{costId === ranked[0]?.id && costListingId !== costId ? 'Your #1 match · ' : ''}{costName ?? 'Selected listing'} · click any card to switch</div>
            </div>
            <div className="max-h-[calc(100vh-9rem)] overflow-y-auto p-3"><CostPage fixedId={costId} embedded /></div>
          </div>
        </aside>
      )}
      </div>

      <details className="mt-10 rounded-2xl bg-white p-5 text-sm text-stone-600 ring-1 ring-stone-200">
        <summary className="cursor-pointer font-semibold text-ink">How smart search works</summary>
        <ol className="mt-3 list-decimal space-y-1 pl-5">
          <li><b>Understand</b>: language rules (plus an LLM if configured) pull out price, room type, bed/bath layout, private bathroom, amenities, zones and walk time.</li>
          <li><b>Filter</b>: those become hard constraints, checked per floorplan, so “2B2B under $3k” needs a 2B2B unit under $3k.</li>
          <li><b>Rank</b>: what’s left of your words is matched by meaning (bge-small embeddings in FAISS) and exact keywords (BM25), fused, then re-ranked by a cross-encoder.</li>
        </ol>
      </details>
    </div>
  )
}
