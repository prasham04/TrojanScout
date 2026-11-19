import { Router } from 'express'
import { randomBytes } from 'node:crypto'
import { z } from 'zod'
import { requireUser, type User } from '../services/users.js'
import { bus, cancelRequest, createRequest, FARE, requestJoin, respondJoin, soloQuote, stateFor } from '../services/rides.js'

// Shared rides are for signed-in students and their friends only: every action below uses the signed-in account,
// never an id sent by the browser, so nobody can ride (or watch) as someone else.
export const ridesRouter = Router()

const Place = z.object({ lat: z.number(), lng: z.number(), label: z.string().max(120) })
const me = (res: { locals: Record<string, unknown> }) => res.locals.user as User

// EventSource can't send an Authorization header, so the page first trades its session for a rides-only pass.
const passes = new Map<string, { userId: string; exp: number }>()
const PASS_MS = 12 * 3600e3
ridesRouter.post('/pass', requireUser, (_req, res) => {
  const now = Date.now()
  for (const [k, v] of passes) if (v.exp < now) passes.delete(k)
  const pass = randomBytes(24).toString('base64url')
  passes.set(pass, { userId: me(res).id, exp: now + PASS_MS })
  res.json({ pass })
})

// Live state for one signed-in rider (their requests, matches with friends, incoming requests, friends' activity).
ridesRouter.get('/stream', (req, res) => {
  const p = passes.get(String(req.query.pass ?? ''))
  if (!p || p.exp < Date.now()) return res.status(401).json({ error: 'sign in required' })
  const userId = p.userId
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' })
  res.flushHeaders()
  let queued = false
  const send = () => {
    if (queued) return
    queued = true
    setTimeout(() => { queued = false; res.write('event: state\ndata: ' + JSON.stringify(stateFor(userId)) + '\n\n') }, 150)  // coalesce bursts
  }
  send()
  bus.on('change', send)
  const tick = setInterval(send, 10_000)  // keeps "departs in" fresh + keepalive
  req.on('close', () => { bus.off('change', send); clearInterval(tick) })
})

ridesRouter.get('/quote', (req, res) => {
  const p = String(req.query.pickup ?? '').split(',').map(Number), d = String(req.query.drop ?? '').split(',').map(Number)
  if (p.length !== 2 || d.length !== 2 || [...p, ...d].some((x) => !Number.isFinite(x))) return res.status(400).json({ error: 'pickup=lat,lng&drop=lat,lng' })
  res.json({ ...soloQuote(p as [number, number], d as [number, number]), pricing: FARE })
})

ridesRouter.post('/', requireUser, (req, res) => {
  const u = me(res)
  const b = z.object({ pickup: Place, drop: Place, departAt: z.number().optional(), seats: z.number().int().min(1).max(2).optional(),
    share: z.object({ mode: z.enum(['friends', 'lists']), lists: z.array(z.string()).max(20).default([]) }).default({ mode: 'friends', lists: [] }) }).parse(req.body)
  if (!u.friends.length) return res.status(400).json({ error: 'Add a friend first: rides are shared only with friends' })
  if (b.share.mode === 'lists') b.share.lists = b.share.lists.filter((id) => u.lists.some((l) => l.id === id))
  if (b.share.mode === 'lists' && !b.share.lists.length) return res.status(400).json({ error: 'Pick at least one list' })
  res.json(createRequest({ ...b, userId: u.id, name: u.name }))
})

ridesRouter.delete('/:id', requireUser, (req, res) => {
  res.json({ ok: cancelRequest(String(req.params.id), me(res).id) })
})

ridesRouter.post('/:id/join', requireUser, (req, res) => {
  const b = z.object({ myRequestId: z.string() }).parse(req.body)
  try { res.json(requestJoin(b.myRequestId, String(req.params.id), me(res).id)) } catch (e) { res.status(409).json({ error: (e as Error).message }) }
})

ridesRouter.post('/joins/:joinId', requireUser, (req, res) => {
  const b = z.object({ accept: z.boolean() }).parse(req.body)
  res.json({ ok: respondJoin(String(req.params.joinId), b.accept, me(res).id) })
})
