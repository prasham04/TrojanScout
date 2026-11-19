import { useState } from 'react'
import { Link } from 'react-router'
import { Building2, Calculator, Check, Footprints, MapPin, Plus, Star } from 'lucide-react'
import type { ListingV2, SmartHit } from '../../api/types'
import { perPersonLabel } from '../../lib/format'
import { useAppStore } from '../../store/useAppStore'
import ZoneBadges from './ZoneBadges'
import FloorplanList from './FloorplanList'
import { Ring, Spotlight } from '../ui/fx'

export default function ListingCard({ listing, showRanks = false, match, why, rank, costSelected = false, onSelect }: {
  listing: ListingV2 | SmartHit; showRanks?: boolean; match?: number; why?: string[]; rank?: number; costSelected?: boolean; onSelect?: () => void
}) {
  const { compareIds, toggleCompare } = useAppStore()
  const sharing = useAppStore((s) => s.profile.sharing ?? 'private')
  const price = perPersonLabel(listing, sharing)
  const comparing = compareIds.includes(listing.id)
  const hit = listing as SmartHit
  const [imgOk, setImgOk] = useState(true)
  return (
    <Spotlight as="article" onClick={onSelect} role={onSelect ? 'button' : undefined} tabIndex={onSelect ? 0 : undefined}
      onKeyDown={(e: React.KeyboardEvent) => onSelect && e.key === 'Enter' && onSelect()}
      title={onSelect ? 'Show the True Cost for this place' : undefined}
      className={`group flex h-full flex-col overflow-hidden rounded-3xl bg-white transition duration-300 hover:-translate-y-1 hover:shadow-[0_24px_48px_-24px_rgba(28,25,23,.35)] ${onSelect ? 'cursor-pointer' : ''} ${costSelected ? 'shadow-[0_0_0_2px_#990000,0_20px_50px_-20px_rgba(153,0,0,.45)]' : 'shadow-[0_1px_2px_rgba(28,25,23,.04),0_8px_24px_-16px_rgba(28,25,23,.2)] ring-1 ring-stone-900/[0.06]'}`}>
      <div className="relative aspect-[16/10] overflow-hidden bg-stone-100">
        {listing.photos?.[0] && imgOk
          ? <img src={listing.photos[0]} alt="" loading="lazy" onError={() => setImgOk(false)} className="h-full w-full object-cover transition duration-700 group-hover:scale-[1.04]" />
          : <div className="grid h-full place-items-center bg-gradient-to-br from-cardinal-50 via-white to-gold-50 text-stone-300"><Building2 size={44} strokeWidth={1.4} /></div>}
        <div className="absolute inset-0 bg-gradient-to-t from-black/45 via-transparent to-black/10" />
        <span className={`absolute left-3 top-3 flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-bold backdrop-blur ${listing.sampleData ? 'bg-gold text-ink' : 'bg-white/85 text-stone-700'}`}>
          {listing.sampleData && <Star size={11} fill="currentColor" />}{listing.sampleData ? 'Featured' : listing.source}
        </span>
        {hit.walkMin != null && <span className="absolute right-3 top-3 flex items-center gap-1 rounded-full bg-black/55 px-2.5 py-1 text-[11px] font-semibold text-white backdrop-blur"><Footprints size={12} />{hit.walkMin} min</span>}
        {rank != null && <span className="absolute bottom-3 left-3 rounded-full bg-gradient-to-r from-cardinal to-cardinal-dark px-2.5 py-1 text-[11px] font-bold text-white shadow-lg shadow-black/20">#{rank} for you</span>}
        {costSelected && <span className="absolute bottom-3 right-3 flex items-center gap-1 rounded-full bg-white px-2.5 py-1 text-[11px] font-bold text-cardinal shadow-lg"><Calculator size={12} />True Cost →</span>}
        {listing.photoCredit && !costSelected && <span className="absolute bottom-0 right-0 max-w-[60%] truncate rounded-tl-lg bg-black/45 px-2 py-0.5 text-[9px] text-white/80" title={listing.photoCredit}>{listing.photoCredit}</span>}
      </div>
      <div className="flex flex-1 flex-col gap-2.5 p-4">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <h3 className="font-bold leading-snug">{listing.name}</h3>
            <p className="flex items-center gap-1 truncate text-xs text-stone-500"><MapPin size={11} className="shrink-0" />{listing.address}</p>
          </div>
          {match != null && (
            <span title={`${match}% match: cosine similarity between your priorities${why?.length ? ' and this place (' + why.join(', ') + ')' : ''}, blended with fit`}>
              <Ring value={match} size={46} label={<span className="text-[11px]">{match}<span className="text-[8px]">%</span></span>} />
            </span>
          )}
        </div>
        <div>
          <p className="num text-xl font-bold text-cardinal">{price.price}{price.price !== 'Call for pricing' && <span className="text-sm font-semibold text-cardinal/70"> /person · mo</span>}</p>
          {price.note && <p className="text-[11px] text-stone-500">{price.note}{sharing === 'shared' ? ' (2 per bedroom)' : ' (1 per bedroom)'}</p>}
        </div>
        <p className="text-xs text-stone-500">{[listing.distanceToCampusMi != null && `${listing.distanceToCampusMi} mi to campus`, listing.availability].filter(Boolean).join(' · ')}</p>
        <ZoneBadges inDps={listing.inDps} inFryft={listing.inFryft} />
        {!!why?.length && <div className="flex flex-wrap gap-1">{why.map((w) => <span key={w} className="flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-800 ring-1 ring-emerald-200"><Check size={11} />{w}</span>)}</div>}
        {!!listing.units?.length && <FloorplanList units={listing.units} highlight={hit.matchedUnits ?? []} compact />}
        {showRanks && (hit.denseRank || hit.bm25Rank) && <p className="text-[11px] text-stone-400">meaning match #{hit.denseRank ?? '–'} · keyword match #{hit.bm25Rank ?? '–'}</p>}
        <div className="mt-auto flex gap-2 pt-2" onClick={(e) => e.stopPropagation()}>
          <Link to={`/map?focus=${encodeURIComponent(listing.id)}`} className="btn-glow flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-gradient-to-r from-cardinal to-cardinal-dark px-3 py-2 text-sm font-semibold !text-white"><MapPin size={14} />Show on map</Link>
          <button onClick={() => toggleCompare(listing.id)} className={`flex items-center gap-1 rounded-xl px-3 py-2 text-sm font-semibold ring-1 ring-inset transition ${comparing ? 'bg-gold ring-gold' : 'ring-stone-300 hover:bg-stone-50'}`}>
            {comparing ? <><Check size={14} />Comparing</> : <><Plus size={14} />Compare</>}
          </button>
        </div>
      </div>
    </Spotlight>
  )
}
