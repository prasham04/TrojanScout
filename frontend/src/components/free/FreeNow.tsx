import { Link } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { searchFree } from '../../lib/free'

/** "Free ways to make this trip": the top few free options that work at this place, now or later tonight. */
export default function FreeNow({ at, query = 'get home at night', title = 'Free ways to make this trip' }: { at: [number, number] | null; query?: string; title?: string }) {
  const q = useQuery({
    queryKey: ['free-now', at, query],
    queryFn: () => searchFree({ q: query, lat: at![0], lng: at![1], usc: true }),
    enabled: !!at, refetchInterval: 60_000,
  })
  const items = (q.data?.results ?? []).filter((p) => p.areaOk !== false && p.eligible && (p.status.state === 'open' || p.status.state === 'closed')).slice(0, 3)
  if (!at || !items.length) return null
  return (
    <div className="rounded-xl bg-gold-50 p-3 ring-1 ring-gold">
      <div className="mb-1.5 text-xs font-bold text-amber-900">🎟 {title}</div>
      <ul className="space-y-1.5">
        {items.map((p) => (
          <li key={p.id} className="text-xs">
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold text-ink">{p.name.split(':')[0]}</span>
              {p.how.phone && <a href={`tel:${p.how.phone.replace(/[^\d+]/g, '')}`} className="shrink-0 font-semibold text-cardinal">📞 Call</a>}
            </div>
            <div className={p.status.state === 'open' ? 'text-emerald-700' : 'text-stone-500'}>{p.status.label}</div>
          </li>
        ))}
      </ul>
      <Link to={`/free?q=${encodeURIComponent(query)}`} className="mt-1.5 inline-block text-[11px] font-semibold text-cardinal">All free & safe options →</Link>
    </div>
  )
}
