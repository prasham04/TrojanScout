import { useQuery, useQueryClient } from '@tanstack/react-query'
import { API_URL } from '../api/client'
import type { Place } from './rides'

export interface PublicUser { id: string; name: string; email: string }
export interface FriendList { id: string; name: string; members: string[] }
export interface Contact { id: string; name: string; phone: string; email?: string; relation: string; emergency: boolean }
export interface Me {
  id: string; email: string; name: string; issuer: string; home: Place | null; places: Place[]; contacts: Contact[]; onboarded: boolean
  preferences: Record<string, unknown> | null; lists: FriendList[]
  friends: PublicUser[]; incoming: PublicUser[]; outgoing: PublicUser[]; invited: string[]; suggestions: PublicUser[]
}

const KEY = 'ts-token'
export const token = () => { try { return localStorage.getItem(KEY) } catch { return null } }
export const authHeaders = (): Record<string, string> => { const t = token(); return t ? { Authorization: `Bearer ${t}` } : {} }

/** Full-page redirect into the OIDC flow (TrojanScout → identity provider → back to /auth/done). */
export const signIn = (returnTo = window.location.pathname) => { window.location.href = `${API_URL}/auth/login?return=${encodeURIComponent(returnTo)}` }

export function saveSession(t: string, me: Me) {
  try {
    localStorage.setItem(KEY, t)
    // rides use this identity, so a signed-in rider is the same person across devices and friends can see them
    localStorage.setItem('ts-uid', me.id); localStorage.setItem('ts-name', me.name)
  } catch { /* ignore */ }
}
export function signOut() {
  try { localStorage.removeItem(KEY); localStorage.removeItem('ts-uid'); localStorage.removeItem('ts-name') } catch { /* ignore */ }
  window.location.href = '/'
}

async function call<T>(method: string, path: string, body?: unknown, t = token()): Promise<T> {
  const r = await fetch(`${API_URL}/api${path}`, { method, headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: `Bearer ${t}` } : {}) }, body: body ? JSON.stringify(body) : undefined })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(j.error ?? `${r.status}`)
  return j as T
}
export const meApi = {
  get: (t?: string) => call<Me>('GET', '/me', undefined, t ?? token()),
  patch: (b: Partial<Pick<Me, 'name' | 'home' | 'places' | 'onboarded' | 'preferences'>>) => call<Me>('PATCH', '/me', b),
  addContact: (c: Omit<Contact, 'id'>) => call<Me>('POST', '/me/contacts', c),
  removeContact: (id: string) => call<Me>('DELETE', `/me/contacts/${id}`),
  addFriend: (email: string) => call<{ status: 'sent' | 'invited' | 'friends' | 'accepted' | 'self'; profile: Me }>('POST', '/me/friends', { email }),
  cancelRequest: (idOrEmail: string) => call<Me>('DELETE', `/me/requests/${encodeURIComponent(idOrEmail)}`),
  saveList: (l: { id?: string; name: string; members: string[] }) => l.id ? call<Me>('PUT', `/me/lists/${l.id}`, l) : call<Me>('POST', '/me/lists', l),
  deleteList: (id: string) => call<Me>('DELETE', `/me/lists/${id}`),
  respond: (id: string, accept: boolean) => call<Me>('POST', `/me/friends/${id}/${accept ? 'accept' : 'decline'}`),
  removeFriend: (id: string) => call<Me>('DELETE', `/me/friends/${id}`),
}

export function useMe() {
  return useQuery({ queryKey: ['me'], queryFn: () => meApi.get(), enabled: !!token(), retry: false, staleTime: 30_000, refetchInterval: 20_000 })
}
export function useSetMe() {
  const qc = useQueryClient()
  return (m: Me) => qc.setQueryData(['me'], m)
}

export interface AppAlert { id: string; kind: 'safety' | 'friend' | 'ride'; priority: number; title: string; body: string; url?: string; link?: string; at: string }
export const appAlerts = async (): Promise<{ signedIn: boolean; watching: string[]; alerts: AppAlert[] }> =>
  (await fetch(`${API_URL}/api/alerts`, { headers: authHeaders() })).json()
