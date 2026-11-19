// Accounts, preferences, emergency contacts, friends and friend lists.
// A user is registered the first time they complete sign-in (email verified by a one-time code, or the university SSO),
// keyed by issuer + subject. Stored in data/users.json for the demo; the shape maps onto a Supabase `profiles` table.
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import { SignJWT, jwtVerify } from 'jose'
import type { Request, Response, NextFunction } from 'express'
import { config } from '../config.js'

const DATA_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../data')
const FILE = path.join(DATA_DIR, 'users.json')

export interface Contact { id: string; name: string; phone: string; email?: string; relation: string; emergency: boolean }
export interface Place { lat: number; lng: number; label: string }
export interface FriendList { id: string; name: string; members: string[] }
export interface User {
  id: string; iss: string; sub: string; email: string; name: string; createdAt: string
  home: Place | null; places: Place[]; contacts: Contact[]; friends: string[]
  requests: { from: string; at: string }[]  // incoming friend requests (they asked, you haven't answered)
  lists: FriendList[]                       // e.g. "Roommates": who may see that you're riding their way
  preferences: Record<string, unknown> | null
  onboarded: boolean
}
interface Store { users: User[]; invites: { email: string; from: string; at: string }[] }

const load = (): Store => {
  if (!existsSync(FILE)) return { users: [], invites: [] }
  const raw = JSON.parse(readFileSync(FILE, 'utf8'))
  const s: Store = Array.isArray(raw) ? { users: raw, invites: [] } : raw
  // drop the old auto-accepting demo personas; friends are real accounts now
  s.users = s.users.filter((u) => !(u as { demoPersona?: boolean }).demoPersona && u.iss !== 'persona')
  const ids = new Set(s.users.map((u) => u.id))
  for (const u of s.users) {
    u.friends = (u.friends ?? []).filter((f) => ids.has(f)); u.requests = (u.requests ?? []).filter((r) => ids.has(r.from))
    u.lists ??= []; u.preferences ??= null
    for (const l of u.lists) l.members = l.members.filter((m) => u.friends.includes(m))
  }
  return s
}
const db = load()
const save = () => writeFileSync(FILE, JSON.stringify(db, null, 1))
save()

export const getUser = (id: string) => db.users.find((u) => u.id === id)
export const byEmail = (email: string) => db.users.find((u) => u.email.toLowerCase() === email.trim().toLowerCase())
export const friendIds = (id: string) => new Set(getUser(id)?.friends ?? [])
export const listMembers = (id: string, listIds: string[]) =>
  new Set((getUser(id)?.lists ?? []).filter((l) => listIds.includes(l.id)).flatMap((l) => l.members))

export function upsertFromIdToken(iss: string, sub: string, email: string, name: string) {
  let u = db.users.find((x) => x.iss === iss && x.sub === sub)
  const isNew = !u
  if (!u) {
    u = { id: `usr-${randomUUID().slice(0, 10)}`, iss, sub, email, name: name || email.split('@')[0], createdAt: new Date().toISOString(),
      home: null, places: [], contacts: [], friends: [], requests: [], lists: [], preferences: null, onboarded: false }
    db.users.push(u)
    // friend requests sent to this email before they signed up
    for (const inv of db.invites.filter((i) => i.email === email.toLowerCase())) if (getUser(inv.from)) u.requests.push({ from: inv.from, at: inv.at })
    db.invites = db.invites.filter((i) => i.email !== email.toLowerCase())
  } else if (email) u.email = email
  save()
  return { user: u, isNew }
}

export function updateUser(id: string, patch: Partial<Pick<User, 'name' | 'home' | 'places' | 'onboarded' | 'preferences'>>) {
  const u = getUser(id); if (!u) return null
  Object.assign(u, patch); save(); return u
}
export function addContact(id: string, c: Omit<Contact, 'id'>) { const u = getUser(id)!; u.contacts.push({ ...c, id: randomUUID().slice(0, 8) }); save() }
export function removeContact(id: string, contactId: string) { const u = getUser(id)!; u.contacts = u.contacts.filter((c) => c.id !== contactId); save() }

function link(a: User, b: User) {
  a.friends = [...new Set([...a.friends, b.id])]; b.friends = [...new Set([...b.friends, a.id])]
  a.requests = a.requests.filter((r) => r.from !== b.id); b.requests = b.requests.filter((r) => r.from !== a.id)
}

/** Send a friend request by email. They must accept it. If they have no account yet, it waits for them to sign up. */
export function requestFriend(fromId: string, email: string): { status: 'sent' | 'invited' | 'friends' | 'accepted' | 'self' } {
  const me = getUser(fromId)!, them = byEmail(email)
  if (!them) {
    const e = email.trim().toLowerCase()
    if (!db.invites.some((i) => i.email === e && i.from === fromId)) db.invites.push({ email: e, from: fromId, at: new Date().toISOString() })
    save(); return { status: 'invited' }
  }
  if (them.id === me.id) return { status: 'self' }
  if (me.friends.includes(them.id)) return { status: 'friends' }
  if (me.requests.some((r) => r.from === them.id)) { link(me, them); save(); return { status: 'accepted' } }  // they had already asked you
  if (!them.requests.some((r) => r.from === me.id)) them.requests.push({ from: me.id, at: new Date().toISOString() })
  save(); return { status: 'sent' }
}
export function respondFriend(id: string, fromId: string, accept: boolean) {
  const me = getUser(id)!, them = getUser(fromId)
  if (them && accept && me.requests.some((r) => r.from === fromId)) link(me, them)
  else me.requests = me.requests.filter((r) => r.from !== fromId)
  save()
}
export function cancelRequest(id: string, toId: string) {
  const them = getUser(toId); if (them) them.requests = them.requests.filter((r) => r.from !== id)
  db.invites = db.invites.filter((i) => !(i.from === id && i.email === toId))
  save()
}
export function removeFriend(id: string, otherId: string) {
  for (const [a, b] of [[id, otherId], [otherId, id]]) {
    const u = getUser(a); if (!u) continue
    u.friends = u.friends.filter((f) => f !== b)
    for (const l of u.lists) l.members = l.members.filter((m) => m !== b)
  }
  save()
}

// ---- friend lists ----
export function saveList(id: string, list: { id?: string; name: string; members: string[] }) {
  const u = getUser(id)!
  const members = [...new Set(list.members)].filter((m) => u.friends.includes(m))
  const existing = list.id ? u.lists.find((l) => l.id === list.id) : undefined
  if (existing) Object.assign(existing, { name: list.name, members })
  else u.lists.push({ id: randomUUID().slice(0, 8), name: list.name, members })
  save()
}
export function deleteList(id: string, listId: string) { const u = getUser(id)!; u.lists = u.lists.filter((l) => l.id !== listId); save() }

const pub = (u: User) => ({ id: u.id, name: u.name, email: u.email })
export function profile(id: string) {
  const u = getUser(id); if (!u) return null
  const outgoing = db.users.filter((x) => x.requests.some((r) => r.from === id)).map(pub)
  const invited = db.invites.filter((i) => i.from === id).map((i) => i.email)
  const contactUsers = u.contacts.map((c) => c.email && byEmail(c.email)).filter((x): x is User => !!x && x.id !== id && !u.friends.includes(x.id) && !outgoing.some((o) => o.id === x.id))
  return {
    id: u.id, email: u.email, name: u.name, issuer: u.iss, home: u.home, places: u.places, contacts: u.contacts,
    onboarded: u.onboarded, preferences: u.preferences, lists: u.lists,
    friends: u.friends.map(getUser).filter((x): x is User => !!x).map(pub),
    incoming: u.requests.map((r) => getUser(r.from)).filter((x): x is User => !!x).map(pub),
    outgoing, invited, suggestions: [...new Map(contactUsers.map((x) => [x.id, pub(x)])).values()],
  }
}

// ---- session tokens (our own JWT, issued after the identity provider's id_token is verified) ----
const secret = new TextEncoder().encode(process.env.SESSION_SECRET ?? `${config.internalKey}-trojanscout-session`)
export const signSession = (u: User) => new SignJWT({ name: u.name, email: u.email }).setProtectedHeader({ alg: 'HS256' }).setSubject(u.id).setIssuedAt().setExpirationTime('7d').sign(secret)

export async function sessionUser(req: Request): Promise<User | null> {
  const h = req.headers.authorization
  if (!h?.startsWith('Bearer ')) return null
  try { const { payload } = await jwtVerify(h.slice(7), secret); return getUser(String(payload.sub)) ?? null } catch { return null }
}
export async function requireUser(req: Request, res: Response, next: NextFunction) {
  const u = await sessionUser(req)
  if (!u) return res.status(401).json({ error: 'sign in required' })
  res.locals.user = u; next()
}
