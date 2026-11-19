import * as turf from '@turf/turf'
import type { Building, Listing } from '../data.js'
import { walkMinutes } from './route.js'

const TRAM_RIDE_MIN = 6 // TODO(Prasham): calibrate from USC tram schedule

// Walk = shortest path on the real OSM street graph (80 m/min). Bike ≈ 3.2× walking speed.
// Tram = walk to the stop (~40% of the walk) + fixed ride. Never call a paid routing API live in the demo.
export async function commute(listing: Pick<Listing, 'lat' | 'lng'>, targets: Building[]) {
  return targets.map((b) => {
    const walk = walkMinutes([listing.lat, listing.lng], [b.lat, b.lng])
    const km = turf.distance([listing.lng, listing.lat], [b.lng, b.lat], { units: 'kilometers' })
    return { building: b.name, walk, bike: Math.max(1, Math.round(walk / 3.2)), tram: km > 1 ? Math.round(walk * 0.4) + TRAM_RIDE_MIN : null }
  })
}
