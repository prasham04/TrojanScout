import { zoneCheck } from './zones.js'
import { FARE, fareFor } from './rides.js'
import type { Listing } from '../data.js'

export interface Profile { budget: number; buildingIds: number[]; lateNights: number; priorities: Record<string, number> }

export const COST_DEFAULTS = {
  metroPass: 0,           // USC students already have a Metro U-Pass through their mandatory transportation fee
  avgMiles: 2,            // average late-night trip home from campus
  weeksPerMonth: 4.3,
  fare: FARE,             // same ride-fare model as Book Ride (UberX-style estimate)
}

export interface CostInput {
  rent: number; utilities: number; inFryft: boolean; lateNights: number; needsMetro: boolean
  roommates?: number      // people splitting an entire unit (1 = just you)
  priceUnit?: string
}

/** Line-by-line True Trojan Cost, with the formula and a plain-English reason for every line. */
export function costLines(i: CostInput) {
  const d = COST_DEFAULTS
  const people = Math.max(1, i.roommates ?? 1)
  const fare = Math.round(fareFor(d.avgMiles) * 100) / 100
  const ridesPerMonth = i.lateNights * d.weeksPerMonth
  const rentShare = i.rent / people
  const utilShare = i.utilities / people
  const rideshare = i.inFryft ? 0 : ridesPerMonth * fare
  const transit = i.needsMetro ? d.metroPass : 0
  const lines = [
    { key: 'rent', label: 'Rent', amount: Math.round(rentShare),
      formula: people > 1 ? `$${i.rent.toLocaleString()} ÷ ${people} people` : `$${i.rent.toLocaleString()} ${i.priceUnit === 'per room' ? 'per room' : 'listed'}`,
      why: people > 1 ? 'Your share of the unit rent, split evenly.' : 'What the landlord charges each month.' },
    { key: 'utilities', label: 'Utilities', amount: Math.round(utilShare),
      formula: people > 1 ? `$${i.utilities} ÷ ${people} people` : `$${i.utilities} estimate`,
      why: 'Electric, gas, internet and water/trash. Estimated at $60 + $30 per bedroom for a whole unit, or ~$75 for a room. Many listings exclude these.' },
    { key: 'transit', label: 'Metro & DASH', amount: transit,
      formula: '$0: your U-Pass is included in USC fees',
      why: 'USC students get a Metro U-Pass through the mandatory transportation fee, so Metro buses and trains (and LADOT DASH) cost nothing extra.' },
    { key: 'rideshare', label: 'Late-night rides', amount: Math.round(rideshare),
      formula: i.inFryft ? `$0: USC Lyft covers rides inside its boundary` : `${i.lateNights}/week × ${d.weeksPerMonth} weeks × $${fare.toFixed(2)}/ride`,
      why: i.inFryft
        ? 'Inside USC’s free Lyft boundary, a shared Lyft home is free 7 PM–2 AM (up to $1,000 a month).'
        : `Outside USC’s free Lyft boundary you pay for rides home after dark. A ${d.avgMiles}-mile ride ≈ $${FARE.base} base + $${FARE.bookingFee} booking fee + $${FARE.perMile}/mile + $${FARE.perMin}/min (min $${FARE.minFare}), the same estimate Book Ride uses.` },
  ]
  const total = lines.reduce((s, l) => s + l.amount, 0)
  return {
    lines, total, perPersonRent: Math.round(rentShare), people, ridesPerMonth: Math.round(ridesPerMonth * 10) / 10, farePerRide: fare,
    hiddenCost: total - Math.round(rentShare),
    // what-if scenarios, so the page can show what each choice is worth
    whatIf: {
      ifInsideFryft: total - Math.round(rideshare),
      ifOutsideFryft: total - Math.round(rideshare) + Math.round(ridesPerMonth * fare),
      perExtraLateNight: Math.round(i.inFryft ? 0 : d.weeksPerMonth * fare),
    },
  }
}

// Back-compat summary used by the Report Card / compare (rent here is the listing's lowest price)
export function trueCost(listing: Pick<Listing, 'rent' | 'utilitiesEst' | 'lat' | 'lng' | 'priceUnit'>,
                         profile: Pick<Profile, 'lateNights'>, needsMetro = false, inFryftOverride?: boolean) {
  const inFryft = inFryftOverride ?? zoneCheck(listing.lat, listing.lng).inFryft
  const c = costLines({ rent: listing.rent ?? 0, utilities: listing.utilitiesEst, inFryft, lateNights: profile.lateNights, needsMetro, priceUnit: listing.priceUnit })
  const by = Object.fromEntries(c.lines.map((l) => [l.key, l.amount]))
  const known = listing.rent != null  // "call for pricing": never pretend the cost is just utilities
  return {
    rent: known ? by.rent : null, utilities: by.utilities, transit: by.transit, rideshare: by.rideshare, total: known ? c.total : null,
    assumptions: [
      `${profile.lateNights} late nights/week`, `~$${c.farePerRide.toFixed(2)} per ride`,
      inFryft ? 'inside Fryft: late rides free' : 'outside Fryft: you pay for late rides',
      `utilities estimated at $${listing.utilitiesEst}`, `rent is ${listing.priceUnit}`,
      ...(listing.rent == null ? ['rent not published (call for pricing)'] : []),
    ],
  }
}
