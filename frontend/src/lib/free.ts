import { API_URL } from '../api/client'

export interface FreeStatus { state: 'open' | 'closed' | 'upcoming' | 'info'; label: string; next: string | null; occasion?: string }
export interface FreeProgram {
  id: string; name: string; provider: string; category: string; cost: string; eligibility: string[]; area: string
  summary: string; how: { phone?: string; url?: string; app?: string }; tags: string; caveats: string
  sources: string[]; verified: string; confidence: 'confirmed' | 'check' | 'closed'
  points?: { label: string; lat: number; lng: number }[]
  status: FreeStatus; areaOk: boolean | null; eligible: boolean; score: number
}
export interface FreeSearch { query: string; now: string; availableNow: boolean; tonight: boolean; understood: string[]; count: number; results: FreeProgram[]; categories: string[] }
export interface Upcoming { id: string; name: string; provider: string; status: FreeStatus; summary: string; how: FreeProgram['how']; confidence: string }

export async function searchFree(p: { q?: string; lat?: number; lng?: number; usc?: boolean; category?: string; availableNow?: boolean }) {
  const u = new URL('/api/free/search', API_URL)
  Object.entries(p).forEach(([k, v]) => v !== undefined && v !== '' && u.searchParams.set(k, String(v)))
  const r = await fetch(u)
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? 'Search unavailable')
  return (await r.json()) as FreeSearch
}
export const upcomingFree = async () => (await fetch(`${API_URL}/api/free/upcoming`)).json() as Promise<Upcoming[]>

export const ELIGIBILITY: Record<string, string> = {
  usc: 'USC students', anyone: 'Anyone', low_income: 'Income-based', la_county: 'LA County residents', south_la: 'South LA residents',
  students: 'Students', survivor: 'Survivors', '21plus': '21+',
}
export const CATEGORY_ICON: Record<string, string> = {
  'night ride': '🌙', escort: '🛡', app: '📱', 'theft prevention': '🔒', 'health & harm reduction': '💊', transit: '🚇',
  support: '🤝', 'holiday ride': '🎉', 'money help': '💳', bike: '🚲', report: '💡', nightlife: '🍸', 'survivor support': '🏠',
}

// ---- alerts + trip options ----
export interface FreeAlert { id: string; kind: 'deadline' | 'free-day' | 'service-gap' | 'tonight'; priority: number; title: string; body: string; programId: string; url?: string; phone?: string; at: string }
export interface TripOption {
  id: string; name: string; provider: string; why: string; steps: string[]; cost: string; minutes: number | null; when: string
  state: 'open' | 'closed' | 'upcoming' | 'info' | 'ended'; how: { phone?: string; url?: string; app?: string }; tips: string[]
  caveats: string; confidence: string; source: string | null; walkTo: [number, number] | null
}
export const freeAlerts = async (): Promise<FreeAlert[]> => (await fetch(`${API_URL}/api/free/alerts`)).json()
export async function tripOptions(from: [number, number], to: [number, number], usc = true): Promise<TripOption[]> {
  const r = await fetch(`${API_URL}/api/free/trip?fromLat=${from[0]}&fromLng=${from[1]}&toLat=${to[0]}&toLng=${to[1]}&usc=${usc}`)
  if (!r.ok) throw new Error('Trip options unavailable')
  return r.json()
}
/** Lyft deep link with pickup + destination prefilled (opens the app on phones, ride.lyft.com on desktop). */
export function lyftLink(from: [number, number], to: [number, number]) {
  const u = new URL('https://lyft.com/ride')
  u.searchParams.set('id', 'lyft')
  u.searchParams.set('pickup[latitude]', String(from[0])); u.searchParams.set('pickup[longitude]', String(from[1]))
  u.searchParams.set('destination[latitude]', String(to[0])); u.searchParams.set('destination[longitude]', String(to[1]))
  return u.toString()
}
