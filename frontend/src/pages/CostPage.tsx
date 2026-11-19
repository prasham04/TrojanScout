import { useEffect, useMemo, useState } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { api } from '../api/client'
import type { ListingV2 } from '../api/types'
import { money, peopleFor, priceLabel } from '../lib/format'
import { useAppStore } from '../store/useAppStore'
import { Link } from 'react-router'
import { motion } from 'motion/react'
import { CountUp } from '../components/ui/fx'

const LINE_STYLE: Record<string, { color: string; icon: string }> = {
  rent: { color: 'bg-cardinal', icon: '🏠' }, utilities: { color: 'bg-amber-500', icon: '💡' },
  transit: { color: 'bg-sky-600', icon: '🚇' }, rideshare: { color: 'bg-violet-600', icon: '🌙' },
}

export default function CostPage({ fixedId, embedded = false }: { fixedId?: string; embedded?: boolean } = {}) {
  const profile = useAppStore((s) => s.profile)
  const listings = useQuery({ queryKey: ['listings'], queryFn: () => api.listings() })
  const [mode, setMode] = useState<'listing' | 'custom'>('listing')
  const [filter, setFilter] = useState('')
  const [picked, setPicked] = useState<ListingV2 | null>(null)
  const [unitLabel, setUnitLabel] = useState('')
  const [rent, setRent] = useState(1300)
  const [utilities, setUtilities] = useState(90)
  const [inFryft, setInFryft] = useState(false)
  const [lateNights, setLateNights] = useState(profile.lateNights)
  const needsMetro = false  // U-Pass is included in USC fees
  const [roommates, setRoommates] = useState(1)

  const options = useMemo(() => (listings.data ?? [])
    .filter((l) => (l.units ?? []).some((u) => u.rent) || l.rent != null)
    .filter((l) => `${l.name} ${l.address} ${l.source}`.toLowerCase().includes(filter.toLowerCase()))
    .slice(0, 40), [listings.data, filter])
  const fixed = fixedId ? listings.data?.find((l) => l.id === fixedId) ?? null : null
  useEffect(() => { if (fixed) { setPicked(fixed); setUnitLabel(''); setMode('listing') } }, [fixed?.id]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!fixedId && !picked && options[0]) setPicked(options[0]) }, [options, picked, fixedId])
  const pricedUnits = (picked?.units ?? []).filter((u) => u.rent)
  const unit = pricedUnits.find((u) => u.label === unitLabel) ?? pricedUnits[0]
  const canSplit = mode === 'custom' || unit?.roomType === 'entire'
  // a whole apartment starts split by bedroom (1 or 2 per bedroom, from your Search setting); rooms are already per person
  const sharing = profile.sharing ?? 'private'
  useEffect(() => { if (mode === 'listing' && unit) setRoommates(peopleFor(unit, sharing)) }, [mode, picked?.id, unit?.label, sharing]) // eslint-disable-line react-hooks/exhaustive-deps
  const maxPeople = Math.max(6, unit ? peopleFor(unit, 'shared') : 6)

  const body = mode === 'listing' && picked
    ? { listingId: picked.id, unitLabel: unit?.label, lateNights, needsMetro, roommates: canSplit ? roommates : 1 }
    : { rent, utilities, inFryft, lateNights, needsMetro, roommates }
  const q = useQuery({ queryKey: ['true-cost', body], queryFn: () => api.trueCost(body), enabled: mode === 'custom' || !!picked, placeholderData: keepPreviousData })
  const c = q.data
  const overBudget = c ? c.total - profile.budget : 0

  return (
    <div className={embedded ? 'space-y-4' : 'mx-auto max-w-6xl px-4 py-8'}>
      {!embedded && <><h1 className="text-3xl font-extrabold tracking-tight">True Trojan Cost</h1>
      <p className="mb-6 max-w-3xl text-stone-500">
        The listed rent is only part of your monthly bill. This adds what listings leave out (utilities, a Metro pass, and the rides home
        you pay for when you live outside USC’s free Lyft boundary), shows the math for every line, and compares it to your budget.
      </p></>}

      <div className={embedded ? 'space-y-4' : 'grid gap-6 lg:grid-cols-[400px_1fr]'}>
        {/* ---------- inputs ---------- */}
        <div className="space-y-5">
          <section className="card p-5">
            <h2 className="mb-3 font-bold">1 · What are you renting?</h2>
            {embedded && picked && <p className="mb-2 text-sm"><b>{picked.name}</b> <span className="text-stone-500">· {priceLabel(picked, sharing)}</span></p>}
            {!embedded && <div className="mb-3 grid grid-cols-2 rounded-xl bg-stone-100 p-1 text-sm font-medium">
              {(['listing', 'custom'] as const).map((m) => (
                <button key={m} onClick={() => setMode(m)} className={`rounded-lg py-1.5 ${mode === m ? 'bg-white shadow' : 'text-stone-500'}`}>{m === 'listing' ? 'A live listing' : 'My own numbers'}</button>
              ))}
            </div>}
            {mode === 'listing' ? (
              <div className="space-y-2">
                {!embedded && <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Search by name, street or source…" className="w-full rounded-lg border border-stone-300 px-3 py-2 text-sm" />}
                {!embedded && <ul className="max-h-56 space-y-1 overflow-y-auto pr-1">
                  {options.map((l) => (
                    <li key={l.id}>
                      <button onClick={() => { setPicked(l); setUnitLabel('') }}
                        className={`flex w-full items-center gap-3 rounded-xl p-2 text-left text-sm ring-1 ${picked?.id === l.id ? 'bg-cardinal-50 ring-cardinal' : 'ring-transparent hover:bg-stone-50'}`}>
                        {l.photos?.[0] ? <img src={l.photos[0]} alt="" className="h-10 w-12 rounded-md object-cover" /> : <span className="grid h-10 w-12 place-items-center rounded-md bg-stone-100">🏢</span>}
                        <span className="min-w-0 flex-1"><span className="block truncate font-medium">{l.name}</span><span className="block truncate text-xs text-stone-500">{priceLabel(l, sharing)} · {l.source}</span></span>
                        <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${l.inDps ? 'bg-emerald-600' : 'bg-violet-600'}`} title={l.inDps ? 'Inside zone' : 'Outside zone'} />
                      </button>
                    </li>
                  ))}
                </ul>}
                {pricedUnits.length > 1 && (
                  <div>
                    <div className="mb-1 mt-2 text-xs font-semibold text-stone-500">Floorplan / room type</div>
                    <div className="flex flex-wrap gap-1.5">
                      {pricedUnits.map((u) => (
                        <button key={u.label} onClick={() => setUnitLabel(u.label)}
                          className={`rounded-lg px-2 py-1 text-xs ring-1 ${unit?.label === u.label ? 'bg-cardinal text-white ring-cardinal' : 'ring-stone-300 hover:bg-stone-50'}`}>
                          {u.label} · {money(u.rent)}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-4">
                <Slider label="Monthly rent (whole unit or your room)" value={rent} set={setRent} min={500} max={6000} step={25} fmt={money} />
                <Slider label="Utilities for the unit" value={utilities} set={setUtilities} min={0} max={400} step={5} fmt={money} />
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={inFryft} onChange={(e) => setInFryft(e.target.checked)} className="accent-cardinal" />The address is inside USC’s free Lyft boundary</label>
              </div>
            )}
          </section>

          <section className="space-y-4 card p-5">
            <h2 className="font-bold">2 · How will you live there?</h2>
            {canSplit && <Slider label="People splitting rent & utilities" value={roommates} set={setRoommates} min={1} max={maxPeople} step={1} fmt={(v) => (v === 1 ? 'Just me' : `${v} people`)} />}
            <Slider label="Late nights out per week" value={lateNights} set={setLateNights} min={0} max={7} step={1} fmt={(v) => `${v} night${v === 1 ? '' : 's'}`} />
            <p className="-mt-2 text-xs text-stone-500">Labs, library, work shifts: nights you’d need a ride home after dark.</p>
            <p className="text-xs text-stone-500">🚇 Metro and DASH: $0 extra. Your U-Pass is included in USC fees.</p>
          </section>
        </div>

        {/* ---------- results ---------- */}
        <div className={`space-y-5 ${q.isFetching ? 'opacity-70' : ''}`}>
          {c && (
            <>
              <section className="card p-6">
                <div className="flex flex-wrap items-end justify-between gap-4">
                  <div>
                    <div className="text-sm text-stone-500">Your real monthly cost{c.people > 1 ? ' (your share)' : ''}</div>
                    <div className="text-5xl font-bold text-cardinal"><CountUp value={c.total} format={(n) => money(Math.round(n))} /></div>
                    <div className="mt-1 text-sm text-stone-500"><span className="num">{money(c.total * 12)}</span> over a 12-month lease</div>
                  </div>
                  <div className="space-y-2 text-right">
                    <div className="rounded-xl bg-gold-50 px-4 py-2 ring-1 ring-gold">
                      <div className="text-xs text-stone-600">Hidden on top of rent</div>
                      <div className="num text-xl font-bold">+{money(c.hiddenCost)}/mo</div>
                    </div>
                  </div>
                </div>
                <div className="mt-6 flex h-6 overflow-hidden rounded-full bg-stone-100">
                  {c.lines.filter((l) => l.amount > 0).map((l) => (
                    <motion.div key={l.key} className={`${LINE_STYLE[l.key].color} grid place-items-center overflow-hidden whitespace-nowrap text-[10px] font-semibold text-white`}
                      initial={{ width: 0 }} animate={{ width: `${(l.amount / c.total) * 100}%` }} transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }} title={l.label}>
                      {l.amount / c.total > 0.09 ? l.label : ''}
                    </motion.div>
                  ))}
                </div>
                <div className="mt-4">
                  <div className="mb-1 flex justify-between text-xs text-stone-500"><span>vs your budget ({money(profile.budget)}, set in <Link to="/preferences" className="font-medium text-cardinal">Profile → Preferences</Link>)</span>
                    <span className={overBudget > 0 ? 'font-semibold text-red-700' : 'font-semibold text-emerald-700'}>{overBudget > 0 ? `${money(overBudget)} over` : `${money(-overBudget)} under`}</span></div>
                  <div className="relative h-2 rounded-full bg-stone-100">
                    <motion.div className={`h-2 rounded-full ${overBudget > 0 ? 'bg-red-500' : 'bg-emerald-500'}`} initial={{ width: 0 }} animate={{ width: `${Math.min(100, (c.total / Math.max(profile.budget, 1)) * 66.6)}%` }} transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }} />
                    <div className="absolute top-[-3px] h-3.5 w-0.5 bg-ink" style={{ left: '66.6%' }} title="Budget" />
                  </div>
                </div>
              </section>

              <section className="card p-6">
                <h2 className="mb-1 font-bold">Line by line: what we added and why</h2>
                <p className="mb-4 text-sm text-stone-500">Every number below is an estimate you can check. Change the inputs on the left to see each line move.</p>
                <ol className="space-y-3">
                  {c.lines.map((l, i) => (
                    <li key={l.key} className="flex gap-3 rounded-xl bg-stone-50 p-3">
                      <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-full text-lg ${l.amount ? 'bg-white ring-1 ring-stone-200' : 'bg-stone-100 opacity-60'}`}>{LINE_STYLE[l.key].icon}</span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline justify-between gap-3">
                          <span className="font-semibold">{i + 1}. {l.label}</span>
                          <span className="num text-lg font-bold">{money(l.amount)}</span>
                        </div>
                        <div className="font-mono text-xs text-cardinal">{l.formula}</div>
                        <p className="mt-0.5 text-sm text-stone-600">{l.why}</p>
                      </div>
                    </li>
                  ))}
                  <li className="flex items-baseline justify-between border-t border-stone-200 px-3 pt-3">
                    <span className="font-bold">= True Trojan Cost</span><span className="num text-xl font-bold text-cardinal">{money(c.total)}/mo</span>
                  </li>
                </ol>
              </section>

              <section className={`grid gap-3 ${embedded ? 'grid-cols-1' : 'sm:grid-cols-3'}`}>
                <WhatIf title="If it were inside the free Lyft area" value={c.whatIf.ifInsideFryft} delta={c.whatIf.ifInsideFryft - c.total} note="Late rides home become free." />
                <WhatIf title="If it were outside the free Lyft area" value={c.whatIf.ifOutsideFryft} delta={c.whatIf.ifOutsideFryft - c.total} note={`${c.ridesPerMonth} rides/mo × $${c.farePerRide.toFixed(2)}`} />
                <WhatIf title="Each extra late night/week" value={c.whatIf.perExtraLateNight} delta={c.whatIf.perExtraLateNight} note={c.inputs.inFryft ? 'Free inside USC’s Lyft boundary.' : '4.3 extra rides a month.'} plain />
              </section>
            </>
          )}
          {q.isLoading && <div className="h-80 animate-pulse rounded-2xl bg-stone-100" />}
        </div>
      </div>
    </div>
  )
}

function WhatIf({ title, value, delta, note, plain }: { title: string; value: number; delta: number; note: string; plain?: boolean }) {
  return (
    <div className="card p-4">
      <div className="text-xs font-semibold text-stone-500">{title}</div>
      <div className="mt-1 text-2xl font-extrabold">{plain ? `+${money(value)}` : money(value)}<span className="text-sm font-medium text-stone-400">/mo</span></div>
      {!plain && <div className={`text-xs font-semibold ${delta < 0 ? 'text-emerald-700' : delta > 0 ? 'text-red-700' : 'text-stone-400'}`}>{delta === 0 ? 'same as now' : `${delta > 0 ? '+' : '−'}${money(Math.abs(delta))} vs now`}</div>}
      <p className="mt-1 text-xs text-stone-500">{note}</p>
    </div>
  )
}

function Slider({ label, value, set, min, max, step, fmt }: { label: string; value: number; set: (v: number) => void; min: number; max: number; step: number; fmt: (v: number) => string }) {
  return (
    <div>
      <div className="flex justify-between text-sm"><span className="font-medium">{label}</span><span className="font-semibold">{fmt(value)}</span></div>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => set(+e.target.value)} className="w-full accent-cardinal" />
    </div>
  )
}
