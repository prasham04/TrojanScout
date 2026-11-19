import { Router, type RequestHandler } from 'express'
import { z } from 'zod'
import { buildings, getListing, getListings } from '../data.js'
import { zoneCheck } from '../services/zones.js'
import { commute } from '../services/commute.js'
import { trueCost } from '../services/cost.js'
import { fitScore } from '../services/score.js'
import { config } from '../config.js'

export const internalRouter = Router()

const requireKey: RequestHandler = (req, res, next) =>
  req.header('X-Internal-Key') === config.internalKey ? next() : res.status(401).json({ error: 'bad internal key' })
internalRouter.use(requireKey)

const Id = z.union([z.string(), z.number()]).transform(String)

const Profile = z.object({
  budget: z.number().default(1500), buildingIds: z.array(z.number()).default([]), lateNights: z.number().default(2),
  priorities: z.record(z.string(), z.number()).default({}),
})

internalRouter.post('/search', (req, res) => {
  const f = z.object({ maxRent: z.number().optional(), beds: z.number().optional(), inFryft: z.boolean().optional(), inDps: z.boolean().optional() }).parse(req.body)
  const out = getListings()
    .map((l) => ({ ...l, ...zoneCheck(l.lat, l.lng) }))
    .filter((l) => (f.maxRent == null || (l.rent != null && l.rent <= f.maxRent)) && (f.beds == null || (l.bedsMax ?? l.beds ?? 0) >= f.beds) &&
      (f.inFryft == null || l.inFryft === f.inFryft) && (f.inDps == null || l.inDps === f.inDps))
    .slice(0, 20)
  res.json(out)
})

internalRouter.post('/zone-check', (req, res) => {
  const { lat, lng } = z.object({ lat: z.number(), lng: z.number() }).parse(req.body)
  res.json(zoneCheck(lat, lng))
})

internalRouter.post('/commute', async (req, res) => {
  const { listingId, buildingIds } = z.object({ listingId: Id, buildingIds: z.array(z.number()) }).parse(req.body)
  const l = getListing(listingId)
  if (!l) return res.status(404).json({ error: 'listing not found' })
  res.json(await commute(l, buildings.filter((b) => buildingIds.includes(b.id))))
})

internalRouter.post('/true-cost', (req, res) => {
  const { listingId, profile } = z.object({ listingId: Id, profile: Profile }).parse(req.body)
  const l = getListing(listingId)
  if (!l) return res.status(404).json({ error: 'listing not found' })
  res.json(trueCost(l, profile))
})

internalRouter.post('/score', (req, res) => {
  const { listingIds, profile } = z.object({ listingIds: z.array(Id), profile: Profile }).parse(req.body)
  res.json(listingIds.map((id) => {
    const l = getListing(id)
    if (!l) return { listingId: id, fitScore: 0 }
    const zr = zoneCheck(l.lat, l.lng), c = trueCost(l, profile)
    return { listingId: id, fitScore: fitScore({ total: c.total, budget: profile.budget, longestWalkMin: 15, inFryft: zr.inFryft, inDps: zr.inDps, incidentsNorm: 0 }) }
  }))
})
