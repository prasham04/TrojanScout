import { API_URL } from '../api/client'
import { authHeaders } from './auth'
import { liveStream } from './liveStream'

// Anonymous identity for this browser, used for anonymous safety reports (rides always use your signed-in account).
export function identity() {
  let id = ''
  let name = ''
  try {
    id = localStorage.getItem('ts-uid') ?? ''
    name = localStorage.getItem('ts-name') ?? ''
    if (!id) { id = `u-${crypto.randomUUID().slice(0, 12)}`; localStorage.setItem('ts-uid', id) }
  } catch { id = id || `u-${Math.random().toString(36).slice(2, 14)}` }
  return { id, name: name || `Trojan ${id.replace(/[^a-z0-9]/gi, '').slice(-4).toUpperCase()}` }
}

export interface Place { lat: number; lng: number; label: string }
export interface Quote { miles: number; minutes: number; fare: number }
export interface RiderCost { requestId: string; solo: Quote; share: number; saves: number; savesPct: number; detourMin: number }
export interface Plan { stops: { kind: 'pickup' | 'drop'; requestId: string; name: string; lat: number; lng: number; label: string }[]; miles: number; minutes: number; totalFare: number; riders: RiderCost[] }
/** Before both riders accept, a match says only who (if they shared with you), that they're on your route, when, and what you'd save. */
export interface Match { requestId: string; name: string; friend: boolean; groupSize: number; departAt: number; you: RiderCost; pendingJoin: boolean }
/** Rides are shared with friends only: all of them, or just the friend lists you pick. */
export interface Share { mode: 'friends' | 'lists'; lists: string[] }
export interface MyRide {
  id: string; userId: string; name: string; pickup: Place; drop: Place; departAt: number; seats: number; createdAt: number
  status: 'open' | 'matched'; share: Share; solo: Quote; matches: Match[]
  group: null | { id: string; plan: Plan; members: { requestId: string; name: string; pickup: Place; drop: Place; departAt: number }[] }
}
export interface RidesState {
  now: number; stats: { live: number; sharing: number }
  activity: { at: number; text: string }[]; mine: MyRide[]
  incoming: { joinId: string; from: { name: string; friend: boolean; departAt: number }; toRequestId: string; you: RiderCost }[]
}

/** Live state for the signed-in rider. The stream URL carries a rides-only pass, never the session token. */
export function subscribeRides(pass: string, onState: (s: RidesState) => void, onStatus: (live: boolean) => void) {
  return liveStream(`${API_URL}/api/rides/stream?pass=${encodeURIComponent(pass)}`,
    { state: (d) => onState(d as RidesState) }, onStatus)
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const r = await fetch(`${API_URL}/api/rides${path}`, { method, headers: { 'Content-Type': 'application/json', ...authHeaders() }, body: body ? JSON.stringify(body) : undefined })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(j.error ?? `${r.status}`)
  return j as T
}
export const rides = {
  quote: (p: Place, d: Place) => call<Quote>('GET', `/quote?pickup=${p.lat},${p.lng}&drop=${d.lat},${d.lng}`),
  pass: () => call<{ pass: string }>('POST', '/pass'),
  book: (b: { pickup: Place; drop: Place; departAt: number; seats: number; share: Share }) => call<{ id: string }>('POST', '', b),
  cancel: (id: string) => call('DELETE', `/${id}`),
  join: (targetId: string, myRequestId: string) => call('POST', `/${targetId}/join`, { myRequestId }),
  respond: (joinId: string, accept: boolean) => call('POST', `/joins/${joinId}`, { accept }),
}

export const QUICK_PICKUPS: Place[] = [
  { lat: 34.0256, lng: -118.2853, label: 'USC Village' }, { lat: 34.0206, lng: -118.2854, label: 'Tommy Trojan, USC' },
  { lat: 34.0287, lng: -118.2726, label: 'The Lorenzo' }, { lat: 34.0183, lng: -118.2915, label: 'Expo/Vermont Station' },
]
export const QUICK_DROPS: Place[] = [
  { lat: 34.0562, lng: -118.2365, label: 'Union Station' }, { lat: 34.0430, lng: -118.2673, label: 'Crypto.com Arena / LA Live' },
  { lat: 34.0617, lng: -118.3005, label: 'Koreatown (Wilshire/Vermont)' }, { lat: 34.0721, lng: -118.3576, label: 'The Grove' },
  { lat: 33.9416, lng: -118.4085, label: 'LAX' }, { lat: 34.0195, lng: -118.4912, label: 'Santa Monica Pier' },
]

export const inMin = (t: number, now: number) => {
  const m = Math.round((t - now) / 60000)
  return m <= 0 ? 'now' : `in ${m} min`
}
export const ago = (t: number, now: number) => {
  const s = Math.max(0, Math.round((now - t) / 1000))
  return s < 60 ? `${s}s ago` : `${Math.floor(s / 60)}m ${s % 60}s ago`
}
