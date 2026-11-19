// Google Maps "Directions" deep links (Maps URLs API: no key needed, opens the app on phones).
// For our computed routes we pass up to 8 evenly spaced waypoints so Google follows the same streets
// (e.g. the safest route) instead of re-routing along its own fastest path.
type P = [number, number]
type Mode = 'walking' | 'driving' | 'bicycling' | 'transit'

const fmt = (p: P) => `${p[0].toFixed(6)},${p[1].toFixed(6)}`

export function sampleWaypoints(coords: P[], max = 8): P[] {
  if (coords.length <= 2) return []
  const inner = coords.slice(1, -1)
  if (inner.length <= max) return inner
  return Array.from({ length: max }, (_, i) => inner[Math.round(((i + 1) * inner.length) / (max + 1))])
}

export function googleMapsDirections(origin: P, destination: P, mode: Mode = 'walking', waypoints: P[] = []) {
  const u = new URL('https://www.google.com/maps/dir/')
  u.searchParams.set('api', '1')
  u.searchParams.set('origin', fmt(origin))
  u.searchParams.set('destination', fmt(destination))
  u.searchParams.set('travelmode', mode)
  if (waypoints.length) u.searchParams.set('waypoints', waypoints.map(fmt).join('|'))
  return u.toString()
}

/** Directions for one of our computed routes (keeps the same path via waypoints). */
export function googleMapsForRoute(coords: P[], mode: Mode = 'walking') {
  return googleMapsDirections(coords[0], coords[coords.length - 1], mode, sampleWaypoints(coords))
}

export interface UberStop { lat: number; lng: number; label: string }

// Labels we generate ourselves ("Dropped pin", "Your start") aren't real places: use coordinates for those.
const GENERIC = /^(dropped pin|pin |your |destination|on the way|near |.*\barea$)/i
const named = (p: UberStop) => !!p.label && !GENERIC.test(p.label.trim())
/** A Google Maps place: the place's name (so Maps shows "Union Station", not the nearest street address), else coordinates. */
export const gmPlace = (p: UberStop) => named(p) ? (/los angeles|, ca\b|\bca \d{5}/i.test(p.label) ? p.label : `${p.label}, Los Angeles, CA`) : `${p.lat.toFixed(6)},${p.lng.toFixed(6)}`

/** Google Maps driving directions through every stop, shown by name. */
export function googleMapsStops(stops: UberStop[], mode: Mode = 'driving') {
  const u = new URL('https://www.google.com/maps/dir/')
  u.searchParams.set('api', '1')
  u.searchParams.set('origin', gmPlace(stops[0]))
  u.searchParams.set('destination', gmPlace(stops[stops.length - 1]))
  u.searchParams.set('travelmode', mode)
  if (stops.length > 2) u.searchParams.set('waypoints', stops.slice(1, -1).map(gmPlace).join('|'))
  return u.toString()
}

/** Uber web booking link: pickup → ONE destination.
 *  Uber's link fills only the first drop-off field reliably; passing the shared ride's middle stops made Uber show
 *  a co-rider's pickup as the destination. So we send the real final destination, and the app lists the middle
 *  stops for the booker to add with "Add stop". */
export function uberLink(pickup: UberStop, destination: UberStop) {
  const place = (p: UberStop) => JSON.stringify({ addressLine1: p.label.split(',')[0], addressLine2: p.label.split(',').slice(1).join(',').trim() || 'Los Angeles, CA', latitude: p.lat, longitude: p.lng })
  const u = new URL('https://m.uber.com/go/product-selection')
  u.searchParams.set('pickup', place(pickup))
  u.searchParams.set('drop[0]', place(destination))
  return u.toString()
}
