// Profile (contacts, friends, home), plus one alerts feed for the whole app.
import { Router } from 'express'
import { z } from 'zod'
import { addContact, cancelRequest, deleteList, getUser, profile, removeContact, removeFriend, requestFriend, requireUser, respondFriend, saveList, sessionUser, updateUser, type User } from '../services/users.js'
import { dpsAlerts, recentReports } from '../services/recent.js'
import { stateFor } from '../services/rides.js'
import { meters, type LatLng } from '../services/geo.js'

export const meRouter = Router()
const PlaceZ = z.object({ lat: z.number(), lng: z.number(), label: z.string().max(120) })
const me = (res: { locals: Record<string, unknown> }) => res.locals.user as User

meRouter.get('/me', requireUser, (_req, res) => res.json(profile(me(res).id)))
meRouter.patch('/me', requireUser, (req, res) => {
  const b = z.object({ name: z.string().min(1).max(40).optional(), home: PlaceZ.nullable().optional(), places: z.array(PlaceZ).max(10).optional(), onboarded: z.boolean().optional(),
    preferences: z.record(z.string(), z.unknown()).nullable().optional() }).parse(req.body)
  if (b.preferences && JSON.stringify(b.preferences).length > 4000) return res.status(400).json({ error: 'preferences too large' })
  updateUser(me(res).id, b); res.json(profile(me(res).id))
})
meRouter.post('/me/contacts', requireUser, (req, res) => {
  const b = z.object({ name: z.string().min(1).max(40), phone: z.string().min(3).max(30), email: z.string().email().max(80).optional().or(z.literal('')), relation: z.string().max(30).default('Friend'), emergency: z.boolean().default(true) }).parse(req.body)
  addContact(me(res).id, { ...b, email: b.email || undefined }); res.json(profile(me(res).id))
})
meRouter.delete('/me/contacts/:id', requireUser, (req, res) => { removeContact(me(res).id, req.params.id as string); res.json(profile(me(res).id)) })
meRouter.post('/me/friends', requireUser, (req, res) => {
  const { email } = z.object({ email: z.string().email().max(80) }).parse(req.body)
  res.json({ ...requestFriend(me(res).id, email), profile: profile(me(res).id) })
})
meRouter.delete('/me/requests/:id', requireUser, (req, res) => { cancelRequest(me(res).id, req.params.id as string); res.json(profile(me(res).id)) })
// friend lists: who may see that you're riding their way
const ListZ = z.object({ name: z.string().min(1).max(30), members: z.array(z.string()).max(200) })
meRouter.post('/me/lists', requireUser, (req, res) => { saveList(me(res).id, ListZ.parse(req.body)); res.json(profile(me(res).id)) })
meRouter.put('/me/lists/:id', requireUser, (req, res) => { saveList(me(res).id, { ...ListZ.parse(req.body), id: req.params.id as string }); res.json(profile(me(res).id)) })
meRouter.delete('/me/lists/:id', requireUser, (req, res) => { deleteList(me(res).id, req.params.id as string); res.json(profile(me(res).id)) })
meRouter.post('/me/friends/:id/:action', requireUser, (req, res) => {
  respondFriend(me(res).id, req.params.id as string, req.params.action === 'accept'); res.json(profile(me(res).id))
})
meRouter.delete('/me/friends/:id', requireUser, (req, res) => { removeFriend(me(res).id, req.params.id as string); res.json(profile(me(res).id)) })

// ---- alerts for the whole app (free-program alerts are merged in by the frontend) ----
const CAMPUS: LatLng = [34.0206, -118.2854]
const HSC: LatLng = [34.0622, -118.2035]
const ago = (t: number) => { const m = Math.round((Date.now() - t) / 60000); return m < 60 ? `${m} min ago` : `${Math.round(m / 60)} h ago` }

meRouter.get('/alerts', async (req, res) => {
  const user = await sessionUser(req)
  const watch: { p: LatLng; label: string }[] = [{ p: CAMPUS, label: 'campus' }, { p: HSC, label: 'HSC' }]
  if (user?.home) watch.unshift({ p: [user.home.lat, user.home.lng], label: 'home' })
  for (const pl of user?.places ?? []) watch.push({ p: [pl.lat, pl.lng], label: pl.label })
  const out: { id: string; kind: string; priority: number; title: string; body: string; url?: string; link?: string; at: string }[] = []

  for (const a of dpsAlerts().alerts) {
    const t = Date.parse(a.occurredAt ?? a.postedAt)
    if (Date.now() - t > 24 * 3600e3) continue
    const w = watch.find((x) => meters(x.p, [a.lat, a.lng]) < (x.label === 'campus' || x.label === 'HSC' ? 1500 : 600))
    if (!w) continue
    out.push({ id: a.id, kind: 'safety', priority: Date.now() - t < 3 * 3600e3 && !['campus', 'HSC'].includes(w.label) ? 0 : 1, at: new Date(t).toISOString(),
      title: `USC DPS: ${a.title}`, body: `${ago(t)} · ${a.location}${!['campus', 'HSC'].includes(w.label) ? ` · ${Math.round(meters(w.p, [a.lat, a.lng]))} m from ${w.label}` : ''}. Plan a safe route before heading out tonight.`, url: a.url, link: `/map?mode=route` })
  }
  for (const r of recentReports(24)) {
    const w = watch.find((x) => meters(x.p, [r.lat, r.lng]) < 500)
    if (!w || r.userId === user?.id) continue
    out.push({ id: `rep-${r.id}`, kind: 'safety', priority: 2, at: r.createdAt, title: `Student report near ${w.label}: ${r.category}`, body: `${ago(Date.parse(r.createdAt))} · unverified · ${r.description.slice(0, 120)}`, link: '/map' })
  }
  if (user) {
    for (const rq of user.requests) {
      const f = getUser(rq.from); if (!f) continue
      out.push({ id: `fr-${rq.from}`, kind: 'friend', priority: 1, at: rq.at, title: `${f.name} wants to be friends`, body: 'Friends see each other’s rides first and can split fares.', link: '/profile' })
    }
    const st = stateFor(user.id)
    // a friend who chose to share with you is on your route (only after you've booked; never where they're going)
    for (const r of st.mine) for (const m of r.matches.filter((x) => x.friend)) {
      out.push({ id: `fm-${r.id}-${m.requestId}`, kind: 'ride', priority: 1, at: new Date().toISOString(), title: `${m.name} is travelling on your route`, body: `Share the car and you'd pay $${m.you.share.toFixed(2)} instead of $${m.you.solo.fare.toFixed(2)}.`, link: '/rides' })
    }
    for (const j of st.incoming) {
      out.push({ id: `join-${j.joinId}`, kind: 'ride', priority: 0, at: new Date().toISOString(), title: `${j.from.name} wants to share your ride`, body: `They're on your route. You'd pay $${j.you?.share.toFixed(2)} instead of $${j.you?.solo.fare.toFixed(2)}.`, link: '/rides' })
    }
  }
  res.json({ signedIn: !!user, watching: watch.map((w) => w.label), alerts: out.sort((a, b) => a.priority - b.priority || Date.parse(b.at) - Date.parse(a.at)) })
})
