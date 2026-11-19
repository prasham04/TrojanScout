// Shared rides: real-time ride requests, route matching and fare splitting between FRIENDS only.
// Every rider is a signed-in account; nobody outside your friends (or the lists you pick) ever sees you.
// State is in memory (move to Supabase for production). Every browser subscribes over SSE.
import { friendIds, listMembers } from './users.js'
import { EventEmitter } from 'node:events'
import { randomUUID } from 'node:crypto'
import { meters, type LatLng } from './geo.js'

// ---------- pricing (UberX-style estimate for LA; shown as an estimate) ----------
export const FARE = { base: 1.25, perMile: 1.15, perMin: 0.3, bookingFee: 3.1, minFare: 8.5, mph: 18, roadFactor: 1.35 }
const roadMiles = (a: LatLng, b: LatLng) => (meters(a, b) * FARE.roadFactor) / 1609.34
const minutesFor = (mi: number) => (mi / FARE.mph) * 60
export function fareFor(mi: number) {
  return Math.max(FARE.minFare, FARE.base + FARE.bookingFee + FARE.perMile * mi + FARE.perMin * minutesFor(mi))
}
export function soloQuote(p: LatLng, d: LatLng) {
  const mi = roadMiles(p, d)
  return { miles: +mi.toFixed(2), minutes: Math.round(minutesFor(mi)), fare: +fareFor(mi).toFixed(2) }
}

// ---------- model ----------
export interface Place { lat: number; lng: number; label: string }
export interface RideRequest {
  id: string; userId: string; name: string; pickup: Place; drop: Place; departAt: number; seats: number
  createdAt: number; status: 'open' | 'matched' | 'cancelled' | 'expired'; groupId?: string
  share: Share
}
/** Who may see that you're riding their way: all your friends, or only friends in lists you choose. Never strangers. */
export interface Share { mode: 'friends' | 'lists'; lists: string[] }

/** Can `viewerId` be told that `r` is travelling on their route? (Never where exactly: only after both accept.) */
export function canSee(viewerId: string, r: RideRequest) {
  if (r.share.mode === 'friends') return friendIds(r.userId).has(viewerId)
  return listMembers(r.userId, r.share.lists).has(viewerId)
}
export interface JoinRequest { id: string; fromRequestId: string; toRequestId: string; createdAt: number; status: 'pending' | 'accepted' | 'declined' }
export interface Group { id: string; requestIds: string[]; createdAt: number }

const requests = new Map<string, RideRequest>()
const joins = new Map<string, JoinRequest>()
const groups = new Map<string, Group>()
const activity: { at: number; text: string; requestIds: string[] }[] = []
export const bus = new EventEmitter()
bus.setMaxListeners(500)
const changed = () => bus.emit('change')
const log = (text: string, ...rs: RideRequest[]) => { activity.unshift({ at: Date.now(), text, requestIds: rs.map((r) => r.id) }); activity.length = Math.min(activity.length, 25) }
const short = (label: string) => label.split(',')[0]

// ---------- matching ----------
type Stop = { kind: 'pickup' | 'drop'; req: RideRequest; p: LatLng }
const MAX_TIME_GAP_MS = 20 * 60e3
const MAX_SEATS = 4

/** Best stop order for a set of riders (pickup before own drop), with each rider's detour and fare share. */
export function planGroup(riders: RideRequest[]) {
  const stops: Stop[] = riders.flatMap((r) => [
    { kind: 'pickup' as const, req: r, p: [r.pickup.lat, r.pickup.lng] as LatLng },
    { kind: 'drop' as const, req: r, p: [r.drop.lat, r.drop.lng] as LatLng },
  ])
  let best: { order: Stop[]; miles: number } | null = null
  const perm = (done: Stop[], left: Stop[]) => {
    if (!left.length) {
      let mi = 0
      for (let i = 1; i < done.length; i++) mi += roadMiles(done[i - 1].p, done[i].p)
      if (!best || mi < best.miles) best = { order: [...done], miles: mi }
      return
    }
    for (let i = 0; i < left.length; i++) {
      const s = left[i]
      if (s.kind === 'drop' && !done.some((d) => d.kind === 'pickup' && d.req.id === s.req.id)) continue
      if (!done.length && s.kind !== 'pickup') continue
      perm([...done, s], [...left.slice(0, i), ...left.slice(i + 1)])
    }
  }
  perm([], stops)
  const plan = best as unknown as { order: Stop[]; miles: number }
  const totalFare = fareFor(plan.miles)
  const solo = riders.map((r) => soloQuote([r.pickup.lat, r.pickup.lng], [r.drop.lat, r.drop.lng]))
  const soloSum = solo.reduce((s, q) => s + q.fare, 0)
  const riderInfo = riders.map((r, k) => {
    const i0 = plan.order.findIndex((s) => s.kind === 'pickup' && s.req.id === r.id)
    const i1 = plan.order.findIndex((s) => s.kind === 'drop' && s.req.id === r.id)
    let inCar = 0
    for (let i = i0 + 1; i <= i1; i++) inCar += roadMiles(plan.order[i - 1].p, plan.order[i].p)
    const share = (totalFare * solo[k].fare) / soloSum
    return {
      requestId: r.id, solo: solo[k], share: +share.toFixed(2), saves: +(solo[k].fare - share).toFixed(2),
      savesPct: Math.round((1 - share / solo[k].fare) * 100), detourMin: Math.max(0, Math.round(minutesFor(inCar) - solo[k].minutes)),
    }
  })
  return {
    stops: plan.order.map((s) => ({ kind: s.kind, requestId: s.req.id, name: s.req.name, lat: s.p[0], lng: s.p[1], label: s.kind === 'pickup' ? s.req.pickup.label : s.req.drop.label })),
    miles: +plan.miles.toFixed(2), minutes: Math.round(minutesFor(plan.miles)), totalFare: +totalFare.toFixed(2), riders: riderInfo,
  }
}

function distToSegment(p: LatLng, a: LatLng, b: LatLng) {
  const k = Math.cos((a[0] * Math.PI) / 180)
  const [px, py, ax, ay, bx, by] = [p[1] * k, p[0], a[1] * k, a[0], b[1] * k, b[0]]
  const dx = bx - ax, dy = by - ay
  const t = dx || dy ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy))) : 0
  return meters(p, [ay + t * dy, (ax + t * dx) / k])
}

/** How another rider relates to my trip, in words. */
function relation(me: RideRequest, other: RideRequest) {
  const mp: LatLng = [me.pickup.lat, me.pickup.lng], md: LatLng = [me.drop.lat, me.drop.lng]
  const op: LatLng = [other.pickup.lat, other.pickup.lng], od: LatLng = [other.drop.lat, other.drop.lng]
  const pu = meters(mp, op), dr = meters(md, od)
  const tags: string[] = []
  if (pu <= 600) tags.push(`Pickup ${Math.round(pu / 10) * 10} m from yours`)
  else if (distToSegment(op, mp, md) <= 700) tags.push('Pickup on your way')
  else tags.push(`Pickup ${(pu / 1609).toFixed(1)} mi away`)
  if (dr <= 600) tags.push(`Drop ${Math.round(dr / 10) * 10} m from yours`)
  else if (distToSegment(od, mp, md) <= 700) tags.push('Drops off on your way')
  else if (distToSegment(md, op, od) <= 700) tags.push('Continues past your stop')
  else tags.push(`Drop ${(dr / 1609).toFixed(1)} mi from yours`)
  return { tags, pickupM: Math.round(pu), dropM: Math.round(dr) }
}

const ridersOf = (r: RideRequest) => (r.groupId ? groups.get(r.groupId)!.requestIds.map((id) => requests.get(id)!) : [r])

/** Compatible riders for one of my open requests: everyone saves money and nobody's detour is too long. */
export function matchesFor(me: RideRequest) {
  if (me.status !== 'open') return []
  const friends = friendIds(me.userId)
  const out = []
  for (const other of requests.values()) {
    if (other.userId === me.userId || !['open', 'matched'].includes(other.status)) continue
    // both sides must have chosen to share with each other (and with everyone already in their car)
    if (!ridersOf(other).every((x) => canSee(me.userId, x) && canSee(x.userId, me))) continue
    if (Math.abs(other.departAt - me.departAt) > MAX_TIME_GAP_MS) continue
    const riders = [...ridersOf(other), me]
    if (riders.length > 3 || riders.reduce((s, r) => s + r.seats, 0) > MAX_SEATS) continue
    const plan = planGroup(riders)
    const ok = plan.riders.every((x) => x.saves > 0.5 && x.detourMin <= Math.max(6, Math.round(x.solo.minutes * 0.4)))
    if (!ok) continue
    const mine = plan.riders.find((x) => x.requestId === me.id)!
    out.push({
      requestId: other.id, name: other.name, friend: friends.has(other.userId), groupSize: riders.length - 1,
      departAt: other.departAt, pickupArea: short(other.pickup.label), dropArea: short(other.drop.label),
      ...relation(me, other), you: mine, plan,
      pendingJoin: [...joins.values()].some((j) => j.fromRequestId === me.id && j.toRequestId === other.id && j.status === 'pending'),
    })
  }
  return out.sort((a, b) => Number(b.friend) - Number(a.friend) || b.you.saves - a.you.saves).slice(0, 12)
}

// ---------- mutations ----------
export function createRequest(b: { userId: string; name: string; pickup: Place; drop: Place; departAt?: number; seats?: number; share?: Share }) {
  const r: RideRequest = {
    id: randomUUID().slice(0, 8), userId: b.userId, name: b.name.slice(0, 30) || 'Trojan', pickup: b.pickup, drop: b.drop,
    departAt: b.departAt ?? Date.now(), seats: Math.min(2, Math.max(1, b.seats ?? 1)), createdAt: Date.now(), status: 'open',
    share: b.share ?? { mode: 'friends', lists: [] },
  }
  requests.set(r.id, r)
  log('A friend booked a ride', r)  // shown only to people this ride is shared with; never says where
  changed()
  return r
}

export function cancelRequest(id: string, userId: string) {
  const r = requests.get(id)
  if (!r || r.userId !== userId) return false
  r.status = 'cancelled'
  if (r.groupId) leaveGroup(r)
  changed()
  return true
}

function leaveGroup(r: RideRequest) {
  const g = groups.get(r.groupId!)
  if (!g) return
  g.requestIds = g.requestIds.filter((id) => id !== r.id)
  r.groupId = undefined
  if (g.requestIds.length < 2) { for (const id of g.requestIds) { const x = requests.get(id)!; x.groupId = undefined; if (x.status === 'matched') x.status = 'open' } groups.delete(g.id) }
}

export function requestJoin(fromRequestId: string, toRequestId: string, userId: string) {
  const from = requests.get(fromRequestId), to = requests.get(toRequestId)
  if (!from || !to || from.userId !== userId) throw new Error('Request not found')
  if (!matchesFor(from).some((m) => m.requestId === to.id)) throw new Error('No longer a compatible match')
  const j: JoinRequest = { id: randomUUID().slice(0, 8), fromRequestId, toRequestId, createdAt: Date.now(), status: 'pending' }
  joins.set(j.id, j)
  changed()
  return j
}

export function respondJoin(joinId: string, accept: boolean, userId: string) {
  const j = joins.get(joinId)
  if (!j || j.status !== 'pending') return false
  const to = requests.get(j.toRequestId), from = requests.get(j.fromRequestId)
  if (!to || !from) return false
  const owners = ridersOf(to).map((r) => r.userId)
  if (!owners.includes(userId)) return false
  j.status = accept ? 'accepted' : 'declined'
  if (accept && from.status === 'open') {
    const g = to.groupId ? groups.get(to.groupId)! : { id: randomUUID().slice(0, 8), requestIds: [to.id], createdAt: Date.now() }
    groups.set(g.id, g)
    g.requestIds.push(from.id)
    for (const id of g.requestIds) { const r = requests.get(id)!; r.groupId = g.id; r.status = 'matched' }
    log('Friends just started sharing a ride 🎉', from, to)
  }
  changed()
  return true
}

// ---------- views ----------
// Privacy: until both riders accept, the other person only learns WHO (if you shared with them) and that you're on the
// same route, when you leave and what they'd save. Pickups, drops, areas and the stop order are revealed only to a formed group.
type Match = ReturnType<typeof matchesFor>[number]
const publicMatch = (m: Match) => ({ requestId: m.requestId, name: m.name, friend: m.friend, groupSize: m.groupSize, departAt: m.departAt, you: m.you, pendingJoin: m.pendingJoin })


export function stateFor(userId: string) {
  const friends = friendIds(userId)
  const mine = [...requests.values()].filter((r) => r.userId === userId && r.status !== 'cancelled' && r.status !== 'expired')
  const myIds = new Set(mine.map((r) => r.id))
  // the live strip only counts rides this person is allowed to see (their own + friends who shared with them)
  const visible = (r: RideRequest | undefined) => !!r && (r.userId === userId || canSee(userId, r))
  const live = [...requests.values()].filter((r) => (r.status === 'open' || r.status === 'matched') && visible(r))
  return {
    now: Date.now(),
    stats: { live: live.length, sharing: [...groups.values()].filter((g) => g.requestIds.some((id) => visible(requests.get(id)))).length },
    activity: activity.filter((a) => a.requestIds.every((id) => visible(requests.get(id)))).slice(0, 12).map(({ at, text }) => ({ at, text })),
    mine: mine.map((r) => ({
      ...r, solo: soloQuote([r.pickup.lat, r.pickup.lng], [r.drop.lat, r.drop.lng]),
      matches: matchesFor(r).map(publicMatch),
      group: r.groupId ? (() => { const g = groups.get(r.groupId!)!; const riders = g.requestIds.map((id) => requests.get(id)!); return { id: g.id, plan: planGroup(riders), members: riders.map((x) => ({ requestId: x.id, name: x.name, pickup: x.pickup, drop: x.drop, departAt: x.departAt })) } })() : null,
    })),
    incoming: [...joins.values()].filter((j) => j.status === 'pending' && myIds.has(j.toRequestId)).map((j) => {
      const from = requests.get(j.fromRequestId)!, to = requests.get(j.toRequestId)!
      const plan = planGroup([...ridersOf(to), from])
      return { joinId: j.id, from: { name: from.name, friend: friends.has(from.userId), departAt: from.departAt }, toRequestId: to.id, you: plan.riders.find((x) => x.requestId === to.id) }
    }),
  }
}

// ---------- housekeeping ----------
export function startRides() {
  setInterval(() => {  // expire stale requests
    let dirty = false
    for (const r of requests.values()) {
      const stale = r.status === 'open' && Date.now() > Math.max(r.departAt + 10 * 60e3, r.createdAt + 45 * 60e3)
      if (stale) { r.status = 'expired'; dirty = true }
    }
    if (dirty) changed()
  }, 15_000)
}
