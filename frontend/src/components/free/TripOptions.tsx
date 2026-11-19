import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { lyftLink, tripOptions, type TripOption } from '../../lib/free'

/** Free & little-known ways to make THIS trip right now; each says why it applies. */
export default function TripOptions({ from, to, onWalkTo, compact = false }: {
  from: [number, number] | null; to: [number, number] | null; onWalkTo?: (p: [number, number], label: string) => void; compact?: boolean
}) {
  const q = useQuery({
    queryKey: ['trip-options', from, to],
    queryFn: () => tripOptions(from!, to!),
    enabled: !!from && !!to, refetchInterval: 60_000,
  })
  if (!from || !to) return null
  const opts = (q.data ?? []).filter((o) => !compact || o.cost !== 'Not covered').slice(0, compact ? 3 : 6)
  if (q.isLoading) return <div className="h-16 animate-pulse rounded-xl bg-gold-50" />
  if (!opts.length) return null
  return (
    <div className="space-y-2">
      <div className="text-xs font-bold text-amber-900">🎟 Free & little-known ways to make this trip</div>
      {opts.map((o) => <Option key={o.id} o={o} from={from} to={to} onWalkTo={onWalkTo} />)}
    </div>
  )
}

function Option({ o, from, to, onWalkTo }: { o: TripOption; from: [number, number]; to: [number, number]; onWalkTo?: (p: [number, number], label: string) => void }) {
  const free = /free/i.test(o.cost)
  const live = o.state === 'open'
  const [more, setMore] = useState(false)
  return (
    <div className={`rounded-xl p-3 text-xs ring-1 ${o.cost === 'Not covered' ? 'bg-stone-50 ring-stone-200' : live && free ? 'bg-emerald-50 ring-emerald-300' : 'bg-gold-50 ring-gold'}`}>
      <div className="flex items-start justify-between gap-2">
        <span className="font-bold leading-tight text-ink">{o.name}</span>
        <span className={`shrink-0 rounded-full px-2 py-0.5 font-bold ${free ? 'bg-emerald-600 text-white' : 'bg-stone-200 text-stone-700'}`}>{o.cost}</span>
      </div>
      <div className={`mt-0.5 font-semibold ${live ? 'text-emerald-700' : 'text-stone-500'}`}>{o.when}{o.minutes ? ` · ~${o.minutes} min` : ''}</div>
      {more && <>
        <p className="mt-1 text-stone-600">{o.why}</p>
        {o.steps.length > 0 && <ol className="mt-1.5 list-decimal space-y-0.5 pl-4 text-stone-700">{o.steps.map((s) => <li key={s}>{s}</li>)}</ol>}
        {o.tips.map((t) => <p key={t} className="mt-1 text-amber-900">💡 {t}</p>)}
        {o.confidence === 'check' && <p className="mt-1 text-[10px] text-stone-400">Some details unconfirmed for 2026; check the official page.</p>}
      </>}
      <div className="mt-2 flex flex-wrap gap-2">
        {(o.id === 'fryft' || o.id === 'lyft-hsc') && o.cost === 'Free' && (
          <a href={lyftLink(from, to)} target="_blank" rel="noreferrer" className="rounded-lg bg-[#ff00bf] px-2.5 py-1 font-semibold !text-white">Open Lyft (choose Shared) ↗</a>
        )}
        {o.walkTo && onWalkTo && (
          <button onClick={() => onWalkTo(o.walkTo!, o.steps[0]?.replace(/^Walk \d+ min to /, '') ?? 'Stop')} className="rounded-lg bg-emerald-600 px-2.5 py-1 font-semibold text-white">🛡 Safest walk to the stop</button>
        )}
        {o.how.phone && <a href={`tel:${o.how.phone.replace(/[^\d+]/g, '')}`} className="rounded-lg bg-cardinal px-2.5 py-1 font-semibold !text-white">📞 {o.how.phone}</a>}
        {o.how.url && <a href={o.how.url} target="_blank" rel="noreferrer" className="rounded-lg px-2.5 py-1 font-semibold !text-stone-700 ring-1 ring-stone-300">{o.id === 'lax-shuttle' ? 'Reserve ↗' : 'Official page ↗'}</a>}
        <button onClick={() => setMore(!more)} className="rounded-lg px-2.5 py-1 font-semibold text-stone-600 hover:bg-white/60">{more ? 'Less ▴' : 'How it works ▾'}</button>
      </div>
    </div>
  )
}
