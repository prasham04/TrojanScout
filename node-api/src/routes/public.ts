import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { Router } from 'express'
import axios from 'axios'
import { buildings, getListing, getListings, listingsMeta, zones } from '../data.js'
import { zoneCheck } from '../services/zones.js'
import { commute } from '../services/commute.js'
import { COST_DEFAULTS, costLines, trueCost } from '../services/cost.js'
import { DEFAULT_WEIGHTS, fitBreakdown, type Weights } from '../services/score.js'
import { blockPoints, incidentMeta, incidentsNear, recency, safetyResources, summarize } from '../services/safety.js'
import { route, streetArt, walkMinutes } from '../services/route.js'
import { reversePlace, searchPlaces } from '../services/places.js'
import { addReport, dpsAlerts, recentNear, recentReports } from '../services/recent.js'
import { dpsPositions } from '../services/dpsUnits.js'
import { config } from '../config.js'

export const publicRouter = Router()
const ai = axios.create({ baseURL: config.aiServiceUrl, headers: { 'X-Internal-Key': config.internalKey }, timeout: 15000 })
// On Render's free plan the AI service sleeps when idle and takes ~1–2 min to wake: user-facing calls wait that long
const AI_WAKE_MS = 120_000

// While it wakes, Render answers 502/503/504 (or drops the connection) straight away instead of holding the
// request. Retry those every 3 s until the request's own time limit, so a cold start is a wait, not an error.
const WAKING_STATUS = new Set([502, 503, 504])
const WAKING_CODES = new Set(['ECONNRESET', 'ECONNREFUSED', 'EAI_AGAIN', 'EPIPE'])
ai.interceptors.request.use((cfg) => {
  const c = cfg as typeof cfg & { wakeDeadline?: number }
  c.wakeDeadline ??= Date.now() + (cfg.timeout || 15_000)
  return cfg
})
ai.interceptors.response.use(undefined, async (err) => {
  const cfg = err?.config as (Parameters<typeof ai.request>[0] & { wakeDeadline?: number }) | undefined
  const waking = WAKING_STATUS.has(err?.response?.status) || WAKING_CODES.has(err?.code)
  if (!cfg || !waking || !cfg.wakeDeadline || cfg.url?.includes('/refresh')) throw err
  const left = cfg.wakeDeadline - Date.now()
  if (left < 3_500) throw err
  await new Promise((r) => setTimeout(r, 3_000))
  return ai.request({ ...cfg, timeout: Math.max(1_000, left - 3_000) })
})

/** Wake-up call: the site pings this when it loads, so both sleeping services start booting before the
 *  visitor reaches a page that needs them. Answers at once; the AI service is poked in the background. */
publicRouter.get('/warm', (_req, res) => {
  ai.get('/health', { timeout: AI_WAKE_MS }).catch(() => { /* waking up is all we wanted */ })
  res.json({ ok: true })
})
const bool = (v: unknown) => (v === 'true' ? true : v === 'false' ? false : undefined)

publicRouter.get('/zones', (_req, res) => res.json(zones))
// Official USC Lyft Rides ("Fryft") boundaries: UPC, HSC and Union Station
publicRouter.get('/ride-zones', (_req, res) => res.sendFile(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../data/usc_ride_zones.geojson')))
publicRouter.get('/buildings', (_req, res) => res.json(buildings))

publicRouter.get('/zone-check', (req, res) => {
  const lat = Number(req.query.lat), lng = Number(req.query.lng)
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return res.status(400).json({ error: 'lat and lng required' })
  res.json(zoneCheck(lat, lng))
})

publicRouter.get('/meta', (_req, res) => {
  const m = listingsMeta()
  const withZones = m.listings.map((l) => zoneCheck(l.lat, l.lng))
  res.json({
    count: m.listings.length, scrapedAt: m.scrapedAt, sources: m.sources,
    inDps: withZones.filter((z) => z.inDps).length, inFryft: withZones.filter((z) => z.inFryft).length,
    medianRent: (() => { const r = m.listings.map((l) => l.rent).filter((x): x is number => x != null).sort((a, b) => a - b); return r[Math.floor(r.length / 2)] ?? null })(),
  })
})

publicRouter.get('/listings', (req, res) => {
  const maxRent = req.query.maxRent ? Number(req.query.maxRent) : Infinity
  const inFryft = bool(req.query.inFryft), inDps = bool(req.query.inDps)
  const source = req.query.source ? String(req.query.source).toLowerCase() : undefined
  res.json(getListings()
    .filter((l) => maxRent === Infinity || (l.rent != null && l.rent <= maxRent))
    .filter((l) => !source || l.source.toLowerCase() === source)
    .map((l) => ({ ...l, ...zoneCheck(l.lat, l.lng) }))
    .filter((l) => (inFryft === undefined || l.inFryft === inFryft) && (inDps === undefined || l.inDps === inDps)))
})

// Hybrid (FAISS + BM25 + rerank) search lives in the AI service
publicRouter.get('/search', async (req, res) => {
  try {
    const { data } = await ai.get('/ai/listings/search', { params: req.query, timeout: AI_WAKE_MS })
    res.json({ ...data, results: data.results.map((l: { lat: number; lng: number }) => ({ ...l, ...zoneCheck(l.lat, l.lng) })) })
  } catch {
    res.status(503).json({ error: 'Search is unavailable (AI service offline).' })
  }
})

publicRouter.post('/refresh', async (_req, res) => {
  try { res.json((await ai.post('/ai/listings/refresh', null, { timeout: 300000 })).data) }
  catch { res.status(503).json({ error: 'AI service offline' }) }
})

// True Cost calculator: a listing (optionally one of its floorplans) or custom numbers. Returns every line with its formula.
publicRouter.post('/true-cost', (req, res) => {
  const b = req.body ?? {}
  const l = b.listingId ? getListing(String(b.listingId)) : undefined
  const unit = l?.units?.find((u) => u.label === b.unitLabel)
  const rent = b.rent != null ? Number(b.rent) : unit?.rent ?? l?.rent ?? 0
  const utilities = b.utilities != null ? Number(b.utilities)
    : unit ? (unit.roomType === 'entire' ? 60 + 30 * Math.max(unit.beds ?? 1, 1) : 75) : l?.utilitiesEst ?? 90
  const inFryft = l && b.inFryft == null ? zoneCheck(l.lat, l.lng).inFryft : Boolean(b.inFryft)
  const priceUnit = unit ? (unit.roomType === 'entire' ? 'per unit' : 'per room') : l?.priceUnit ?? 'per unit'
  const c = costLines({ rent, utilities, inFryft, lateNights: Number(b.lateNights ?? 2), needsMetro: Boolean(b.needsMetro), roommates: Number(b.roommates ?? 1), priceUnit })
  res.json({ ...c, inputs: { rent, utilities, inFryft, priceUnit, unit: unit ?? null }, defaults: COST_DEFAULTS, listing: l ?? null })
})

// Places anywhere in LA County (Photon/OpenStreetMap): suggestions as you type, reverse lookup, and a one-shot geocode.
publicRouter.get('/places', async (req, res) => {
  const q = String(req.query.q ?? '').trim()
  if (q.length < 2) return res.json([])
  const near = String(req.query.near ?? '').split(',').map(Number)
  res.json(await searchPlaces(q, near.length === 2 && near.every(Number.isFinite) ? (near as [number, number]) : undefined, req.query.final === '1'))
})

publicRouter.get('/places/reverse', async (req, res) => {
  const lat = Number(req.query.lat), lng = Number(req.query.lng)
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return res.status(400).json({ error: 'lat and lng required' })
  res.json(await reversePlace(lat, lng))
})

publicRouter.get('/geocode', async (req, res) => {
  const q = String(req.query.q ?? '').trim()
  if (q.length < 2) return res.status(400).json({ error: 'q required' })
  const hit = (await searchPlaces(q, undefined, true))[0]
  if (!hit) return res.status(404).json({ error: 'No place found in the LA area. Try a street address or landmark.' })
  res.json({ lat: hit.lat, lng: hit.lng, label: [hit.label, hit.detail].filter(Boolean).join(', '), ...zoneCheck(hit.lat, hit.lng) })
})

// Weighted incidents within 150 m, normalized by the 90th percentile across listings (for the fit score)
const incidentLoad = (lat: number, lng: number) =>
  incidentsNear([lat, lng], 150, { days: 183 }).reduce((sum, i) => sum + i.severity * recency(i.date), 0)
let loadP90: number | null = null
function incidentsNorm(lat: number, lng: number) {
  if (loadP90 === null) {
    const xs = getListings().map((l) => incidentLoad(l.lat, l.lng)).sort((a, b) => a - b)
    loadP90 = xs[Math.floor(xs.length * 0.9)] || 1
  }
  return Math.min(1, incidentLoad(lat, lng) / loadP90)
}

function weightsFrom(q: Record<string, unknown>): Weights {
  const n = (k: keyof Weights) => (q[`w_${k}`] != null ? Number(q[`w_${k}`]) : DEFAULT_WEIGHTS[k])
  return { cost: n('cost'), commute: n('commute'), zone: n('zone'), incidents: n('incidents') }
}

publicRouter.get('/listings/:id/report', async (req, res) => {
  const listing = getListing(req.params.id)
  if (!listing) return res.status(404).json({ error: 'not found' })
  const ids = String(req.query.buildings ?? '').split(',').filter(Boolean).map(Number)
  const targets = ids.length ? buildings.filter((b) => ids.includes(b.id)) : buildings.slice(0, 2)
  const lateNights = Number(req.query.lateNights ?? 2)
  const budget = Number(req.query.budget ?? 1500)

  const zonesRes = zoneCheck(listing.lat, listing.lng)
  const commuteRes = await commute(listing, targets)
  const cost = trueCost(listing, { lateNights })
  const facts = summarize(incidentsNear([listing.lat, listing.lng], 150, { days: 183 }))
  const top = Object.entries(facts.byCategory).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, v]) => `${v} ${k}`).join(', ')
  let block = {
    summary: facts.total
      ? `${facts.total} incidents reported to LAPD within 150 m in the last 6 months (${top}).`
      : 'No incidents reported to LAPD within 150 m in the last 6 months.',
    incidents6mo: facts.byCategory,
    citations: [{ n: 1, source: incidentMeta.source, date: incidentMeta.fetchedAt?.slice(0, 10) ?? '', url: 'https://data.lacity.org/' }] as unknown[],
  }
  try {
    const ai = (await axios.get(`${config.aiServiceUrl}/ai/neighborhood`, { params: { lat: listing.lat, lng: listing.lng }, headers: { 'X-Internal-Key': config.internalKey }, timeout: 8000 })).data
    if (ai?.summary && !/insufficient|unavailable|mock/i.test(ai.summary)) block = { ...ai, incidents6mo: facts.byCategory }
  } catch { /* LAPD facts above are enough */ }

  const longestWalkMin = Math.max(...commuteRes.map((c) => c.walk))
  // A whole unit is split by bedroom (1 per bedroom, or 2 when sharing): compare each person's share with the (per-person) budget.
  const people = peopleFor(listing, req.query.sharing)
  const perPerson = { people, total: cost.rent == null ? null : Math.round((cost.rent + cost.utilities) / people + cost.transit + cost.rideshare) }
  const fit = fitBreakdown({ total: perPerson.total, budget, longestWalkMin, inFryft: zonesRes.inFryft, inDps: zonesRes.inDps, incidentsNorm: incidentsNorm(listing.lat, listing.lng) }, weightsFrom(req.query))
  res.json({ listing, zones: zonesRes, commute: commuteRes, longestWalkMin, block, cost, perPerson, fitScore: fit.score, fit, incidentFacts: facts })
})

// ---------- Safety ----------
publicRouter.get('/route', (req, res) => {
  const p = (s: unknown) => String(s ?? '').split(',').map(Number) as [number, number]
  const from = p(req.query.from), to = p(req.query.to)
  if (from.length !== 2 || to.length !== 2 || [...from, ...to].some((x) => !Number.isFinite(x))) return res.status(400).json({ error: 'from=lat,lng&to=lat,lng required' })
  // night: explicit "true"/"false", else from the departure time; at: ISO departure time (default now); w: incidents,dps,light,people (0–3)
  const night = req.query.night === 'true' ? true : req.query.night === 'false' ? false : undefined
  const at = req.query.at ? new Date(String(req.query.at)) : undefined
  const ws = String(req.query.w ?? '').split(',').map(Number)
  const weights = ws.length === 4 && ws.every(Number.isFinite) ? { incidents: ws[0], dps: ws[1], light: ws[2], people: ws[3] } : undefined
  try { res.json(route(from, to, { night, at: at && !isNaN(+at) ? at : undefined, weights })) } catch (e) { res.status(422).json({ error: (e as Error).message }) }
})

publicRouter.get('/incidents', (req, res) => {
  const days = Math.min(Number(req.query.days ?? 180), 365)
  res.json({ ...incidentMeta, days, points: blockPoints(days) })
})

// Free & Safe directory (search lives in ai-service; it embeds the programs for meaning-based search)
publicRouter.get('/free/search', async (req, res) => {
  try { res.json((await ai.get('/ai/free/search', { params: req.query, timeout: AI_WAKE_MS })).data) }
  catch { res.status(503).json({ error: 'Free & Safe search is unavailable (AI service offline).' }) }
})
publicRouter.get('/free/alerts', async (req, res) => {
  try { res.json((await ai.get('/ai/free/alerts', { params: req.query, timeout: 15000 })).data) } catch { res.json([]) }
})
publicRouter.get('/free/trip', async (req, res) => {
  try { res.json((await ai.get('/ai/free/trip', { params: req.query, timeout: AI_WAKE_MS })).data) }
  catch { res.status(503).json({ error: 'Trip options unavailable' }) }
})
publicRouter.get('/free/upcoming', async (req, res) => {
  try { res.json((await ai.get('/ai/free/upcoming', { params: req.query, timeout: AI_WAKE_MS })).data) }
  catch { res.json([]) }
})

publicRouter.get('/streets/art', (_req, res) => { res.set('Cache-Control', 'public, max-age=86400'); res.json(streetArt()) })

// ---------- last-24h checks ----------
publicRouter.get('/recent', (req, res) => {
  const lat = Number(req.query.lat), lng = Number(req.query.lng)
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return res.status(400).json({ error: 'lat and lng required' })
  res.json(recentNear([lat, lng], Math.min(Number(req.query.radius ?? 500), 2000), Math.min(Number(req.query.hours ?? 24), 24 * 14)))
})
publicRouter.get('/dps-alerts', (_req, res) => res.json(dpsAlerts()))
publicRouter.get('/reports', (req, res) => res.json(recentReports(Math.min(Number(req.query.hours ?? 72), 168))))
// Suspicious-activity report: checked by the AI (specific behaviour, no profiling, no spam, no private details) before
// anyone else sees it. Rejected reports aren't stored. Severity is fixed at "danger" for now.
publicRouter.post('/reports', async (req, res) => {
  const b = req.body ?? {}
  const lat = Number(b.lat), lng = Number(b.lng)
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || !b.category) return res.status(400).json({ error: 'lat, lng and category required' })
  const description = String(b.description ?? '').slice(0, 1000)
  let v: { valid: boolean; reasons: string[]; summary: string; category: string; severity: 'danger'; checkedBy: string }
  try {
    v = (await ai.post('/ai/report/check', { description, category: b.category, where: b.where ?? '', when: b.occurredAt ?? 'just now' }, { timeout: 45000 })).data
  } catch {
    return res.status(503).json({ error: 'The report checker is offline. If it’s an emergency call 911 or DPS 213-740-4321.' })
  }
  if (!v.valid) return res.status(422).json({ error: 'Not posted', reasons: v.reasons })
  const rep = addReport({ lat, lng, category: String(v.category || b.category).slice(0, 40), description: v.summary || description, userId: String(b.userId ?? 'anon'),
    severity: v.severity, where: String(b.where ?? '').slice(0, 120), occurredAt: b.occurredAt ? String(b.occurredAt) : undefined, checkedBy: v.checkedBy })
  res.json({ ...rep, check: v })
})

// Recommendations: cosine similarity between the student's preference vector and each listing's feature vector.
//   Listing vector x (each feature z-scored across the candidates, oriented so higher = better for a student):
//     [affordability vs budget, shorter longest walk, inside DPS, inside free USC Lyft, fewer incidents, meaning match to the search]
//     (the last one is the bge-small embedding cosine between the search text and the listing, sent as `sim`)
//   Preference vector u = the student's priority weights on the same axes.
//   cos(u, x) says how well a listing's strengths line up with what this student cares about. Cosine ignores magnitude,
//   so it's blended with the absolute fit score: match = 70% cosine + 30% fit.
/** People splitting a listing's price: rooms are per person; a whole unit is split 1 per bedroom, or 2 with sharing=shared. */
function peopleFor(l: { priceUnit?: string; beds?: number | null }, sharing: unknown) {
  if (l.priceUnit !== 'per unit') return 1
  return Math.max(1, l.beds ?? 1) * (sharing === 'shared' ? 2 : 1)
}

const walkCache = new Map<string, number>()
publicRouter.get('/fit-rank', (req, res) => {
  const ids = String(req.query.ids ?? '').split(',').filter(Boolean).slice(0, 200)
  const sims = String(req.query.sim ?? '').split(',').map((v) => (v === '' ? NaN : Number(v)))
  const bIds = String(req.query.buildings ?? '').split(',').filter(Boolean).map(Number)
  const targets = bIds.length ? buildings.filter((b) => bIds.includes(b.id)) : buildings.slice(0, 2)
  const lateNights = Number(req.query.lateNights ?? 2), budget = Number(req.query.budget ?? 1500)
  const w = weightsFrom(req.query)
  const rows: { id: string; fit: number; perPerson: number | null; longestWalkMin: number; parts: Record<string, number>; raw: number[] }[] = []
  ids.forEach((id, n) => {
    const l = getListing(id); if (!l) return
    const walks = targets.map((b) => {
      const k = `${id}|${b.id}`
      if (!walkCache.has(k)) walkCache.set(k, walkMinutes([l.lat, l.lng], [b.lat, b.lng]))
      return walkCache.get(k)!
    })
    const longestWalkMin = walks.length ? Math.max(...walks) : 0
    const z = zoneCheck(l.lat, l.lng)
    const cost = trueCost(l, { lateNights })
    const people = peopleFor(l, req.query.sharing)
    const perPerson = cost.rent == null ? null : Math.round((cost.rent + cost.utilities) / people + cost.transit + cost.rideshare)
    const inc = incidentsNorm(l.lat, l.lng)
    const f = fitBreakdown({ total: perPerson, budget, longestWalkMin, inFryft: z.inFryft, inDps: z.inDps, incidentsNorm: inc }, w)
    rows.push({ id, fit: Math.round(f.score * 100), perPerson, longestWalkMin,
      parts: Object.fromEntries(Object.entries(f.parts).map(([k, p]) => [k, Math.round(p.value * 100)])),
      raw: [perPerson == null ? NaN : (budget - perPerson) / Math.max(budget, 1), -longestWalkMin, z.inDps ? 1 : 0, z.inFryft ? 1 : 0, -inc, sims[n]] })
  })
  const hasText = rows.some((r) => Number.isFinite(r.raw[5]))
  const D = 6
  // z-score each axis across the candidates (unknown values sit slightly below average)
  const stats = Array.from({ length: D }, (_, d) => {
    const xs = rows.map((r) => r.raw[d]).filter(Number.isFinite)
    const mean = xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0
    const sd = Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, xs.length)) || 1
    return { mean, sd }
  })
  const zsum = w.cost + w.commute + w.zone + w.incidents || 1
  const u = [w.cost, w.commute, w.zone / 2, w.zone / 2, w.incidents, hasText ? 0.35 * zsum : 0]
  const norm = (v: number[]) => Math.sqrt(v.reduce((a, b) => a + b * b, 0))
  const AXES = ['cheaper for your budget', 'shorter walk to your classes', 'inside DPS patrol', 'inside the free USC Lyft area', 'fewer incidents nearby', 'closest to what you searched']
  const out: Record<string, unknown> = {}
  for (const r of rows) {
    const x = r.raw.map((v, d) => (Number.isFinite(v) ? (v - stats[d].mean) / stats[d].sd : -0.5))
    const nx = norm(x), nu = norm(u)
    const cosine = nx && nu ? x.reduce((a, v, d) => a + v * u[d], 0) / (nx * nu) : 0
    const match = Math.round(100 * (0.7 * (cosine + 1) / 2 + 0.3 * (r.fit / 100)))
    const why = x.map((v, d) => ({ d, c: v * u[d] })).filter((t) => t.c > 0.05 && x[t.d] > 0.3).sort((a, b) => b.c - a.c).slice(0, 3).map((t) => AXES[t.d])
    out[r.id] = { match, cosine: Math.round(cosine * 1000) / 1000, fit: r.fit, perPerson: r.perPerson, longestWalkMin: r.longestWalkMin, parts: r.parts, why }
  }
  res.json(out)
})

publicRouter.get('/safety-resources', (_req, res) => res.json(safetyResources))

publicRouter.get('/dps-units', (_req, res) => res.json({ simulated: true, updatedAt: new Date().toISOString(), units: dpsPositions() }))

publicRouter.get('/dps-units/stream', (req, res) => {
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' })
  res.flushHeaders()
  const send = () => res.write('event: units\ndata: ' + JSON.stringify({ simulated: true, units: dpsPositions() }) + '\n\n')
  send()
  const t = setInterval(send, 2000)
  req.on('close', () => clearInterval(t))
})
