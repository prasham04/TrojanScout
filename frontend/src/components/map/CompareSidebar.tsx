import { useEffect, useState } from 'react'
import { useQueries, useQuery } from '@tanstack/react-query'
import { api } from '../../api/client'
import type { ReportV2 } from '../../api/types'
import { money, priceLabel } from '../../lib/format'
import { EXPLAIN } from '../../lib/explain'
import { COMPARE_ROWS, MAX_COMPARE, useAppStore, type CompareRow } from '../../store/useAppStore'
import InfoTip from '../ui/InfoTip'
import { COLORS } from './layers'

type Row = { label: string; group: 'Cost' | 'Commute' | 'Safety' | 'Home' | 'Overall'; tip?: string; get: (r: ReportV2) => number | string | null; best?: 'min' | 'max'; fmt?: (v: number) => string }

const ROWS: Record<CompareRow, Row> = {
  price: { group: 'Cost', label: 'Listed price', get: (r) => r.listing.rent, best: 'min', fmt: money },
  trueCost: { group: 'Cost', label: 'True Trojan Cost', tip: EXPLAIN.trueCost, get: (r) => r.cost.total, best: 'min', fmt: (v) => `${money(v)}/mo` },
  perPerson: { group: 'Cost', label: 'Your share / mo', tip: 'True Cost per person. A whole unit is assumed split evenly, one person per bedroom; rooms are already per person. This is the number the fit score compares with your budget.', get: (r) => r.perPerson.total, best: 'min', fmt: money },
  rideshare: { group: 'Cost', label: 'Late-night rides', tip: 'Paid rides home after dark, for the late nights in your preferences, when the listing is outside the free Lyft area.', get: (r) => (r.cost.total == null ? null : r.cost.rideshare), best: 'min', fmt: (v) => `${money(v)}/mo` },
  longestWalk: { group: 'Commute', label: 'Longest walk', tip: EXPLAIN.longestWalk, get: (r) => r.longestWalkMin, best: 'min', fmt: (v) => `${v} min` },
  incidents: { group: 'Safety', label: 'Incidents within 150 m', tip: EXPLAIN.incidents, get: (r) => r.incidentFacts.total, best: 'min', fmt: (v) => `${v}` },
  dps: { group: 'Safety', label: 'DPS patrol zone', tip: EXPLAIN.dps, get: (r) => (r.zones.inDps ? 'Inside' : 'Outside') },
  fryft: { group: 'Safety', label: 'Free Lyft area', tip: EXPLAIN.fryft, get: (r) => (r.zones.inFryft ? 'Inside' : 'Outside') },
  floorplans: { group: 'Home', label: 'Floorplans', get: (r) => (r.listing.units ?? []).map((u) => u.label).slice(0, 4).join(', ') || null },
  fit: { group: 'Overall', label: 'Fit score', tip: EXPLAIN.fit, get: (r) => Math.round(r.fit.score * 100), best: 'max', fmt: (v) => `${v}/100` },
}
const GROUPS: Row['group'][] = ['Overall', 'Cost', 'Commute', 'Safety', 'Home']
const TINT = ['#990000', '#d97706', '#2563eb']  // A, B, C
const LETTER = ['A', 'B', 'C']

export const COMPARE_SIZES = [380, 560, 760]

function Photo({ src }: { src?: string }) {
  const [bad, setBad] = useState(false)
  return src && !bad
    ? <img src={src} alt="" onError={() => setBad(true)} className="h-full w-full object-cover" />
    : <div className="grid h-full place-items-center bg-gradient-to-br from-stone-100 to-stone-200 text-2xl">🏢</div>
}

export default function CompareSidebar({ onFocus }: { onFocus: (id: string) => void }) {
  const { compareIds, toggleCompare, clearCompare, profile, compareRows, toggleCompareRow, compareWidth, setCompareWidth } = useAppStore()
  const sizeIdx = COMPARE_SIZES.reduce((best, w, i) => (Math.abs(w - compareWidth) < Math.abs(COMPARE_SIZES[best] - compareWidth) ? i : best), 0)
  const [customize, setCustomize] = useState(false)
  const [showFit, setShowFit] = useState(false)
  const listings = useQuery({ queryKey: ['listings'], queryFn: () => api.listings() })
  const reports = useQueries({ queries: compareIds.map((id) => ({ queryKey: ['report', id, profile], queryFn: () => api.report(id, profile) })) })
  const ready = reports.map((q) => q.data).filter((r): r is ReportV2 => !!r)
  // three listings don't fit in the narrow size: widen once
  useEffect(() => { if (compareIds.length === 3 && compareWidth < COMPARE_SIZES[1] && window.innerWidth >= 1100) setCompareWidth(COMPARE_SIZES[1]) }, [compareIds.length]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!compareIds.length) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
        <div className="text-4xl">⚖️</div>
        <h2 className="font-bold">Compare listings</h2>
        <p className="text-sm text-stone-500">Click a dot, then <b>+ Add to compare</b>. Up to {MAX_COMPARE} side by side.</p>
        <div className="mt-2 space-y-1.5 text-left text-xs text-stone-600">
          <div><span className="mr-2 inline-block h-3 w-3 rounded-full align-middle" style={{ background: COLORS.inside }} />Listing inside the DPS patrol zone</div>
          <div><span className="mr-2 inline-block h-3 w-3 rounded-full align-middle" style={{ background: COLORS.outside }} />Listing outside the DPS patrol zone</div>
          <div><span className="mr-2 inline-block h-3 w-3 rounded-sm align-middle" style={{ background: COLORS.dps }} />DPS patrol unit (live, simulated)</div>
          <div><span className="mr-2 inline-block h-3 w-3 rounded-full border-2 border-gold bg-white align-middle" />In your compare list</div>
        </div>
      </div>
    )
  }

  const values = (row: Row) => reports.map((q) => (q.data ? row.get(q.data) : null))
  const bestOf = (row: Row) => {
    if (!row.best) return null
    const vals = values(row).filter((v): v is number => typeof v === 'number')
    return vals.length > 1 ? (row.best === 'min' ? Math.min(...vals) : Math.max(...vals)) : null
  }
  // how many rows each listing wins, for the verdict
  const wins = compareIds.map((_, i) => compareRows.filter((k) => { const b = bestOf(ROWS[k]); return b !== null && values(ROWS[k])[i] === b }).length)
  const fits = reports.map((q) => (q.data ? Math.round(q.data.fit.score * 100) : -1))
  const top = fits.indexOf(Math.max(...fits))
  const nameOf = (i: number) => reports[i]?.data?.listing.name ?? listings.data?.find((x) => x.id === compareIds[i])?.name ?? '…'
  const cols = `minmax(96px,0.9fr) repeat(${compareIds.length}, minmax(0,1fr))`

  return (
    <div className="flex h-full flex-col bg-white">
      <div className="flex items-center justify-between gap-2 border-b border-stone-200 px-4 py-3">
        <h2 className="font-bold">Compare <span className="text-stone-400">({compareIds.length}/{MAX_COMPARE})</span></h2>
        <div className="flex items-center gap-3 text-xs font-medium">
          <div className="hidden overflow-hidden rounded-md ring-1 ring-stone-300 md:flex" title="Panel width">
            {['S', 'M', 'L'].map((l, i) => (
              <button key={l} onClick={() => setCompareWidth(COMPARE_SIZES[i])} className={`px-1.5 py-0.5 ${sizeIdx === i ? 'bg-cardinal text-white' : 'hover:bg-stone-100'}`}>{l}</button>
            ))}
          </div>
          <button onClick={() => setCustomize(!customize)} className={customize ? 'text-cardinal' : 'text-stone-500 hover:text-cardinal'}>⚙ Rows</button>
          <button onClick={clearCompare} className="text-stone-500 hover:text-cardinal">Clear</button>
        </div>
      </div>
      {customize && (
        <div className="grid grid-cols-2 gap-1 border-b border-stone-200 bg-stone-50 px-4 py-3 text-xs">
          <p className="col-span-2 mb-1 text-stone-500">Choose what to compare:</p>
          {COMPARE_ROWS.map((r) => (
            <label key={r} className="flex cursor-pointer items-center gap-1.5">
              <input type="checkbox" checked={compareRows.includes(r)} onChange={() => toggleCompareRow(r)} className="accent-cardinal" />{ROWS[r].label}
            </label>
          ))}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-auto">
        {/* listing headers (sticky) */}
        <div className="sticky top-0 z-10 grid gap-2 border-b border-stone-200 bg-white/95 px-3 py-3 backdrop-blur" style={{ gridTemplateColumns: cols }}>
          <div className="self-end pb-1 text-[11px] text-stone-400">★ = best in row</div>
          {compareIds.map((id, i) => {
            const l = reports[i].data?.listing ?? listings.data?.find((x) => x.id === id)
            return (
              <div key={id} className="min-w-0 overflow-hidden rounded-xl bg-white ring-1 ring-stone-200" style={{ borderTop: `3px solid ${TINT[i]}` }}>
                <div className="relative aspect-[16/10]">
                  <Photo src={l?.photos?.[0]} />
                  <span className="absolute left-1.5 top-1.5 grid h-5 w-5 place-items-center rounded-full text-[11px] font-bold text-white shadow" style={{ background: TINT[i] }}>{LETTER[i]}</span>
                  <button onClick={() => toggleCompare(id)} aria-label="Remove" className="absolute right-1.5 top-1.5 grid h-5 w-5 place-items-center rounded-full bg-white/90 text-[10px] shadow hover:text-cardinal">✕</button>
                </div>
                <button onClick={() => onFocus(id)} className="block w-full px-2 py-1.5 text-left" title="Show on map">
                  <div className="line-clamp-2 text-xs font-semibold leading-snug hover:text-cardinal">{l?.name ?? '…'}</div>
                  <div className="mt-0.5 line-clamp-1 text-[11px] text-stone-500">{l ? priceLabel(l, profile.sharing) : ''}</div>
                </button>
              </div>
            )
          })}
        </div>

        {/* verdict */}
        {ready.length === compareIds.length && compareIds.length > 1 && top >= 0 && (
          <div className="mx-3 mt-3 rounded-xl p-3 text-xs ring-1" style={{ background: `${TINT[top]}0d`, borderColor: TINT[top] }}>
            <div className="font-bold" style={{ color: TINT[top] }}>{LETTER[top]} · {nameOf(top)} fits you best ({fits[top]}/100)</div>
            <div className="mt-0.5 text-stone-600">
              Best in {wins[top]} of {compareRows.filter((k) => ROWS[k].best).length} comparable rows
              {compareIds.map((_, i) => i !== top && ` · ${LETTER[i]} best in ${wins[i]}`)}. Based on your budget, buildings and priorities in Preferences.
            </div>
          </div>
        )}

        {/* rows, grouped */}
        <div className="px-3 pb-2">
          {GROUPS.map((g) => {
            const keys = compareRows.filter((k) => ROWS[k].group === g)
            if (!keys.length) return null
            return (
              <div key={g} className="mt-3">
                <div className="mb-1 text-[10px] font-bold uppercase tracking-wider text-stone-400">{g}</div>
                <div className="overflow-hidden rounded-xl ring-1 ring-stone-200">
                  {keys.map((key, ri) => {
                    const row = ROWS[key]
                    const best = bestOf(row)
                    const vals = values(row)
                    const nums = vals.filter((v): v is number => typeof v === 'number')
                    const max = nums.length ? Math.max(...nums) : 0
                    return (
                      <div key={key} className={`grid items-center gap-2 px-2 py-2 text-xs ${ri ? 'border-t border-stone-100' : ''}`} style={{ gridTemplateColumns: cols }}>
                        <div className="flex items-center gap-1 font-medium text-stone-600">{row.label}{row.tip && <InfoTip>{row.tip}</InfoTip>}</div>
                        {reports.map((q, i) => {
                          const v = vals[i]
                          const isBest = best !== null && v === best
                          const good = v === 'Inside'
                          return (
                            <div key={compareIds[i]} className={`min-w-0 rounded-lg px-1.5 py-1 text-center ${isBest ? 'bg-emerald-50 font-bold text-emerald-700' : ''}`}>
                              {q.isLoading ? <span className="inline-block h-3 w-10 animate-pulse rounded bg-stone-200" />
                                : v == null ? <span className="text-stone-300">—</span>
                                : typeof v === 'number'
                                  ? <>
                                      <div>{row.fmt ? row.fmt(v) : v}{isBest && ' ★'}</div>
                                      {row.best && max > 0 && <div className="mx-auto mt-1 h-1 w-full max-w-[90px] overflow-hidden rounded-full bg-stone-100"><div className="h-full rounded-full" style={{ width: `${Math.max(6, (v / max) * 100)}%`, background: isBest ? '#059669' : '#a8a29e' }} /></div>}
                                    </>
                                  : <span className={`break-words ${v === 'Inside' || v === 'Outside' ? (good ? 'text-emerald-700' : 'text-purple-700') : ''}`}>{v === 'Inside' ? '✓ Inside' : v === 'Outside' ? '✗ Outside' : v}</span>}
                            </div>
                          )
                        })}
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>

        {compareRows.includes('fit') && ready.length > 0 && (
          <div className="px-3 pb-2">
            <button onClick={() => setShowFit(!showFit)} className="text-xs font-semibold text-cardinal">{showFit ? '▾' : '▸'} How the fit scores were calculated</button>
            {showFit && (
              <div className="mt-2 space-y-2">
                {ready.map((r) => {
                  const i = compareIds.indexOf(r.listing.id)
                  return (
                    <div key={r.listing.id} className="rounded-lg bg-stone-50 p-2 text-[11px]">
                      <div className="mb-1 font-semibold"><span style={{ color: TINT[i] }}>{LETTER[i]}</span> · {r.listing.name}: {Math.round(r.fit.score * 100)}/100</div>
                      {Object.entries(r.fit.parts).map(([k, p]) => (
                        <div key={k} className="flex items-center gap-2">
                          <span className="w-16 capitalize text-stone-500">{k}</span>
                          <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-stone-200"><span className="block h-full" style={{ width: `${p.value * 100}%`, background: TINT[i] }} /></span>
                          <span className="w-24 text-right text-stone-500">{Math.round(p.value * 100)} × {Math.round(p.weight * 100)}%</span>
                        </div>
                      ))}
                    </div>
                  )
                })}
                <p className="text-[11px] text-stone-400">Score = Σ (sub-score × weight). Change the weights in Preferences.</p>
              </div>
            )}
          </div>
        )}
        <p className="px-3 pb-3 text-[11px] text-stone-400">Costs and walks are estimates for the buildings in your Preferences. Click a name to see it on the map.</p>
      </div>
    </div>
  )
}
