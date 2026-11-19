import { useEffect } from 'react'
import { Link } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { api } from '../../api/client'
import type { ListingV2 } from '../../api/types'
import { money, priceLabel } from '../../lib/format'
import { EXPLAIN } from '../../lib/explain'
import { MAX_COMPARE, useAppStore } from '../../store/useAppStore'
import ZoneBadges from '../listing/ZoneBadges'
import FloorplanList from '../listing/FloorplanList'
import InfoTip from '../ui/InfoTip'
import { googleMapsDirections } from '../../lib/directions'

// Report Card content, shown in a popup right next to the dot.
export default function ListingPopup({ listing, onResize, onSafeRoute }: { listing: ListingV2; onResize: () => void; onSafeRoute: (l: ListingV2) => void }) {
  const profile = useAppStore((s) => s.profile)
  const { compareIds, toggleCompare } = useAppStore()
  const q = useQuery({ queryKey: ['report', listing.id, profile], queryFn: () => api.report(listing.id, profile) })
  const buildings = useQuery({ queryKey: ['buildings'], queryFn: api.buildings })
  useEffect(() => { onResize() }, [q.status, onResize])
  const comparing = compareIds.includes(listing.id)
  const full = !comparing && compareIds.length >= MAX_COMPARE
  const r = q.data

  return (
    <div className="text-ink">
      {listing.photos?.[0] && (
        <div className="relative">
          <img src={listing.photos[0]} alt="" className="h-28 w-full object-cover" onLoad={onResize} />
          {listing.photoCredit && <span className="absolute inset-x-0 bottom-0 truncate bg-black/55 px-2 py-0.5 text-[9px] text-white" title={listing.photoCredit}>{listing.photoCredit}</span>}
        </div>
      )}
      <div className="max-h-[52vh] space-y-3 overflow-y-auto p-4">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wide text-stone-400">{listing.sampleData ? '⭐ Featured' : listing.source}</div>
          <div className="text-base font-bold leading-tight">{listing.name}</div>
          <div className="text-xs text-stone-500">{listing.address}</div>
        </div>
        <div className="flex items-baseline justify-between">
          <span className="text-lg font-extrabold text-cardinal">{priceLabel(listing, profile.sharing)}</span>
          {r && <span className="rounded-full bg-gold-50 px-2 py-0.5 text-xs font-bold ring-1 ring-gold">Fit {Math.round(r.fit.score * 100)} <InfoTip side="left">{EXPLAIN.fit}</InfoTip></span>}
        </div>
        <ZoneBadges inDps={r?.zones.inDps ?? listing.inDps} inFryft={r?.zones.inFryft ?? listing.inFryft} />
        {!!listing.units?.length && <FloorplanList units={listing.units} compact />}

        {q.isLoading && <div className="h-20 animate-pulse rounded-lg bg-stone-100" />}
        {r && (
          <>
            <div>
              <div className="mb-1 flex items-center gap-1 text-xs font-semibold text-stone-500">🚶 Door-to-desk · longest {r.longestWalkMin} min <InfoTip side="left">{EXPLAIN.longestWalk}</InfoTip></div>
              <ul className="space-y-0.5 text-xs">
                {r.commute.map((c) => {
                  const b = buildings.data?.find((x) => x.name === c.building)
                  return (
                    <li key={c.building} className="flex items-center justify-between gap-2"><span className="truncate">{c.building}</span>
                      <span className="flex shrink-0 items-center gap-2 text-stone-600">🚶 {c.walk}m · 🚲 {c.bike}m
                        {b && <a href={googleMapsDirections([listing.lat, listing.lng], [b.lat, b.lng], 'walking')} target="_blank" rel="noreferrer" title="Directions in Google Maps" className="rounded bg-stone-100 px-1 !text-stone-700 hover:bg-stone-200">🧭</a>}
                      </span></li>
                  )
                })}
              </ul>
            </div>
            <Link to={`/search?cost=${encodeURIComponent(listing.id)}`} className="block w-full rounded-xl bg-stone-50 p-2.5 text-left !text-ink ring-1 ring-transparent hover:ring-cardinal" title="Check the full True Cost in Search">
              <div className="flex justify-between text-xs"><span className="font-semibold text-stone-500">💸 True Trojan Cost →</span><span className="font-bold">{r.cost.total == null ? 'Price not published' : `${money(r.cost.total)}/mo`}</span></div>
              <div className="mt-1 text-[11px] text-stone-500">
                {r.cost.total == null ? 'Call the landlord for rent; ' : `rent ${money(r.cost.rent)} + `}utilities {money(r.cost.utilities)} + rides {money(r.cost.rideshare)} (est.)
              </div>
            </Link>
            <div className="text-xs text-stone-600">
              <span className="font-semibold text-stone-500">🏘 Block facts <InfoTip side="left">{EXPLAIN.incidents}</InfoTip></span>
              <p className="mt-0.5">{r.block.summary}</p>
            </div>
          </>
        )}
        <div className="flex gap-2">
          <button onClick={() => onSafeRoute(listing)} className="flex-1 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-700">🛡 Safest walk to class</button>
          <a href={googleMapsDirections([listing.lat, listing.lng], [34.0206, -118.2854], 'walking')} target="_blank" rel="noreferrer"
            className="rounded-lg px-3 py-2 text-sm font-semibold !text-stone-700 ring-1 ring-stone-300 hover:bg-stone-50" title="Walking directions to campus in Google Maps">🧭 Maps</a>
        </div>
        <div className="flex gap-2">
          <button disabled={full} onClick={() => toggleCompare(listing.id)}
            className={`flex-1 rounded-lg px-3 py-2 text-sm font-semibold disabled:opacity-40 ${comparing ? 'bg-gold text-ink' : 'bg-cardinal text-white hover:bg-cardinal-dark'}`}>
            {comparing ? '✓ In compare' : full ? `Compare full (${MAX_COMPARE})` : '+ Add to compare'}
          </button>
          {listing.url && <a href={listing.url} target="_blank" rel="noreferrer" className="rounded-lg px-3 py-2 text-sm font-semibold !text-stone-700 ring-1 ring-stone-300 hover:bg-stone-50">View ↗</a>}
        </div>
      </div>
    </div>
  )
}
