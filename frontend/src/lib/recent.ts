import { API_URL } from '../api/client'

export interface RecentItem { source: string; verified: boolean; title: string; when: string; at: string; where: string; precision: string; distanceM: number; url: string | null; lat: number; lng: number }
export interface RecentResult { hours: number; radiusM: number; count: number; items: RecentItem[]; lapd: { lastTwoWeeks: number; severe: number; dataThrough: string | null; note: string }; dpsFetchedAt: string | null }
export interface DpsAlert { id: string; title: string; url: string; postedAt: string; occurredAt: string | null; location: string; lat: number; lng: number; precision: 'exact' | 'street' | 'campus'; summary: string }

export async function recentNear(lat: number, lng: number, hours = 24, radius = 500): Promise<RecentResult> {
  return (await fetch(`${API_URL}/api/recent?lat=${lat}&lng=${lng}&hours=${hours}&radius=${radius}`)).json()
}
export const dpsAlerts = async (): Promise<{ fetchedAt: string | null; alerts: DpsAlert[] }> => (await fetch(`${API_URL}/api/dps-alerts`)).json()
/** The AI check turned the report down; `reasons` says what to fix. */
export class ReportRejected extends Error {
  reasons: string[]
  constructor(reasons: string[]) { super(reasons[0] ?? 'Not posted'); this.reasons = reasons }
}
export interface PostedReport { id: string; category: string; description: string; severity?: string; check?: { checkedBy: string; reasons: string[] } }
export async function report(b: { lat: number; lng: number; category: string; description: string; userId?: string; where?: string; occurredAt?: string }): Promise<PostedReport> {
  const r = await fetch(`${API_URL}/api/reports`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) })
  const j = await r.json().catch(() => ({}))
  if (r.status === 422) throw new ReportRejected(j.reasons?.length ? j.reasons : ['The report needs more detail about what happened.'])
  if (!r.ok) throw new Error(j.error ?? 'Could not save report')
  return j
}
export const REPORT_CATEGORIES = ['Suspicious behaviour', 'Following someone', 'Harassment', 'Theft / break-in', 'Assault', 'Weapon seen', 'Other']
