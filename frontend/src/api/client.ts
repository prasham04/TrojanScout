import { liveStream } from '../lib/liveStream'
import { fetchEventSource } from '@microsoft/fetch-event-source'
import type {
  Building, ChatEvent, CostBreakdown, IncidentsResponse, ListingV2, Meta, Profile, ReportV2, RouteResult,
  SafetyResource, SmartSearchResponse, Zones, DpsUnit,
} from './types'

export const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:4000'
type Params = Record<string, string | number | boolean | undefined | null>

async function get<T>(path: string, params?: Params): Promise<T> {
  const url = new URL(path, API_URL)
  Object.entries(params ?? {}).forEach(([k, v]) => v !== undefined && v !== null && v !== '' && url.searchParams.set(k, String(v)))
  const res = await fetch(url)
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `${res.status} ${res.statusText}`)
  return res.json() as Promise<T>
}
async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(new URL(path, API_URL), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
  return res.json() as Promise<T>
}

const weights = (p: Profile) => ({ w_cost: p.priorities.cost, w_commute: p.priorities.commute, w_zone: p.priorities.zone, w_incidents: p.priorities.incidents })

export const api = {
  meta: () => get<Meta>('/api/meta'),
  zones: () => get<GeoJSON.FeatureCollection>('/api/zones'),
  buildings: () => get<Building[]>('/api/buildings'),
  zoneCheck: (lat: number, lng: number) => get<Zones>('/api/zone-check', { lat, lng }),
  geocode: (q: string) => get<{ lat: number; lng: number; label: string } & Zones>('/api/geocode', { q }),
  listings: (p: Params = {}) => get<ListingV2[]>('/api/listings', p),
  search: (p: Params) => get<SmartSearchResponse>('/api/search', p),
  report: (id: string, p: Profile) =>
    get<ReportV2>(`/api/listings/${encodeURIComponent(id)}/report`, { buildings: p.buildingIds.join(','), lateNights: p.lateNights, budget: p.budget, sharing: p.sharing ?? 'private', ...weights(p) }),
  trueCost: (b: { listingId?: string; unitLabel?: string; rent?: number; utilities?: number; inFryft?: boolean; lateNights: number; needsMetro: boolean; roommates: number }) =>
    post<CostBreakdown>('/api/true-cost', b),
  /** Recommendation: cosine(preference vector, listing feature vector) blended with fit. `sims` = embedding cosine to the search text. */
  fitRank: (ids: string[], p: Profile, sims: (number | null)[] = []) =>
    get<Record<string, { match: number; cosine: number; fit: number; perPerson: number | null; longestWalkMin: number; parts: Record<string, number>; why: string[] }>>('/api/fit-rank', {
      ids: ids.join(','), sim: sims.map((s) => (s == null ? '' : s)).join(','), buildings: p.buildingIds.join(','), lateNights: p.lateNights, budget: p.budget, sharing: p.sharing ?? 'private', ...weights(p) }),
  route: (from: [number, number], to: [number, number], at: Date, w: { incidents: number; dps: number; light: number; people: number }) =>
    get<RouteResult>('/api/route', { from: from.join(','), to: to.join(','), at: at.toISOString(), w: [w.incidents, w.dps, w.light, w.people].join(',') }),
  incidents: (days = 180) => get<IncidentsResponse>('/api/incidents', { days }),
  safetyResources: () => get<{ note: string; phones: Record<string, string>; resources: SafetyResource[] }>('/api/safety-resources'),
  dpsUnits: () => get<{ simulated: boolean; units: DpsUnit[] }>('/api/dps-units'),
}

/** Live DPS unit positions (server-sent events, GET → native EventSource is fine). */
export function subscribeDpsUnits(onUnits: (u: DpsUnit[]) => void) {
  return liveStream(`${API_URL}/api/dps-units/stream`, { units: (d) => onUnits((d as { units: DpsUnit[] }).units) })
}

// EventSource only supports GET, so POST via fetch-event-source.
export function streamChat(
  body: { message: string; profile: Profile; history: { role: string; content: string }[] },
  onEvent: (e: ChatEvent) => void,
  signal?: AbortSignal,
) {
  return fetchEventSource(`${API_URL}/api/chat`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal, openWhenHidden: true,
    onmessage(msg) {
      if (!msg.event) return
      onEvent({ event: msg.event, data: msg.data ? JSON.parse(msg.data) : {} } as ChatEvent)
    },
    onerror(err) { throw err },
  })
}
