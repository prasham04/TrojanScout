import type { Listing, ListingV2, Sharing, Unit } from '../api/types'

export const money = (n: number | null | undefined) => (n == null ? '—' : `$${Math.round(n).toLocaleString()}`)

/** Rent per person per month (whole apartments split by bedroom, see peopleFor). */
export function priceLabel(l: Listing & { units?: Unit[] }, sharing: Sharing = 'private') {
  const p = perPersonLabel(l as ListingV2, sharing)
  return p.price === 'Call for pricing' ? p.price : `${p.price} /person`
}

export function bedsLabel(l: Pick<Listing, 'beds' | 'bedsMax'>) {
  if (l.beds == null) return ''
  const one = (n: number) => (n === 0 ? 'Studio' : `${n} bd`)
  return l.bedsMax != null && l.bedsMax !== l.beds ? `${one(l.beds)}–${l.bedsMax} bd` : one(l.beds)
}

export function timeAgo(iso: string | null | undefined) {
  if (!iso) return 'never'
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m} min ago`
  const h = Math.round(m / 60)
  return h < 24 ? `${h} h ago` : `${Math.round(h / 24)} d ago`
}

/** People splitting one priced unit. Rooms are already priced per person; a whole apartment is split
 *  one person per bedroom ('private') or two per bedroom ('shared'). A studio counts as one bedroom. */
export function peopleFor(u: Pick<Unit, 'roomType' | 'beds'>, sharing: Sharing = 'private') {
  if (u.roomType !== 'entire') return 1
  return Math.max(1, u.beds ?? 1) * (sharing === 'shared' ? 2 : 1)
}

/** Lowest–highest rent per person across a listing's priced floorplans, plus one example split to explain it. */
export function perPersonPrice(l: ListingV2, sharing: Sharing = 'private') {
  const priced = (l.units ?? []).filter((u) => u.rent)
  const rows = priced.length
    ? priced.map((u) => ({ label: u.label, total: u.rent as number, people: peopleFor(u, sharing) }))
    : l.rent != null
      ? [{ label: '', total: l.rent, people: l.priceUnit === 'per unit' ? peopleFor({ roomType: 'entire', beds: l.beds }, sharing) : 1 },
         ...(l.rentMax && l.rentMax !== l.rent ? [{ label: '', total: l.rentMax, people: l.priceUnit === 'per unit' ? peopleFor({ roomType: 'entire', beds: l.bedsMax ?? l.beds }, sharing) : 1 }] : [])]
      : []
  if (!rows.length) return null
  const each = rows.map((r) => ({ ...r, each: Math.round(r.total / r.people) }))
  const min = Math.min(...each.map((r) => r.each)), max = Math.max(...each.map((r) => r.each))
  const split = each.filter((r) => r.people > 1).sort((a, b) => a.each - b.each)[0]
  return { min, max, split }
}

export function perPersonLabel(l: ListingV2, sharing: Sharing = 'private') {
  const p = perPersonPrice(l, sharing)
  if (!p) return { price: 'Call for pricing', note: '' }
  const price = p.min !== p.max ? `${money(p.min)}–${money(p.max)}` : money(p.min)
  const note = p.split ? `${p.split.label ? p.split.label + ' ' : 'Whole unit '}${money(p.split.total)} ÷ ${p.split.people} people` : ''
  return { price, note }
}
