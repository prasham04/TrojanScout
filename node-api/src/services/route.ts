// Walking router over the OSM street graph (data/streets.json), around both USC campuses (UPC + HSC).
// fastest = shortest distance. safest = distance × penalties the user can see and adjust:
//   incidents (LAPD, severity × recency), outside DPS patrol, dark streets (open MyLA311 streetlight outages),
//   and people around (places open at that time + busy streets). Every factor is reported for both routes.
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Grid, meters, type LatLng } from './geo.js'
import { incidentsNear, riskAt, safetyResources, summarize } from './safety.js'
import { zoneCheck } from './zones.js'
import { laClock, litMeta, openMask, openPlaces, outageGrid, placeGrid, type Outage } from './lit.js'

const DATA_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../data')
const WALK_M_PER_MIN = 80
const RISK_WEIGHT = 2.0
const COUNT_RADIUS_M = 45
const MAJOR = new Set(['primary', 'secondary', 'tertiary', 'primary_link', 'secondary_link', 'tertiary_link'])
const DRIVABLE = new Set([...MAJOR, 'unclassified', 'residential', 'living_street'])

interface Edge { to: number; len: number; risk: number; riskNight: number; inDps: boolean; lit: boolean; highway: string; name: string; dark: Outage[]; places: number[] }
export const graph = { coords: [] as LatLng[], adj: [] as Edge[][], inDps: [] as boolean[], ready: false, riskP90: 1, riskP90Night: 1 }
let nodeGrid: Grid<number>

function build() {
  const f = path.join(DATA_DIR, 'streets.json')
  if (!existsSync(f)) return
  const st = JSON.parse(readFileSync(f, 'utf8')) as { nodes: Record<string, LatLng>; ways: { nodes: string[]; highway: string; lit?: string; name?: string }[] }
  const idx = new Map<string, number>()
  const id = (osm: string) => {
    let i = idx.get(osm)
    if (i === undefined) { i = graph.coords.length; idx.set(osm, i); graph.coords.push(st.nodes[osm]); graph.adj.push([]) }
    return i
  }
  for (const w of st.ways) {
    for (let k = 0; k + 1 < w.nodes.length; k++) {
      if (!st.nodes[w.nodes[k]] || !st.nodes[w.nodes[k + 1]]) continue
      const a = id(w.nodes[k]), b = id(w.nodes[k + 1])
      const pa = graph.coords[a], pb = graph.coords[b]
      const mid: LatLng = [(pa[0] + pb[0]) / 2, (pa[1] + pb[1]) / 2]
      const len = meters(pa, pb)
      const r = Math.max(45, len / 2)
      const e = { len, risk: riskAt(mid, r), riskNight: riskAt(mid, r, true), inDps: zoneCheck(mid[0], mid[1]).inDps, lit: w.lit === 'yes', highway: w.highway, name: w.name ?? '',
        dark: outageGrid.near(mid, Math.max(35, len / 2 + 10)),            // reported broken streetlights on this block
        places: placeGrid.near(mid, Math.max(45, len / 2 + 25)) }          // shops/cafés that could be open
      graph.adj[a].push({ to: b, ...e }); graph.adj[b].push({ to: a, ...e })
    }
  }
  graph.inDps = graph.coords.map((c) => zoneCheck(c[0], c[1]).inDps)
  const p90 = (xs: number[]) => xs.sort((x, y) => x - y)[Math.floor(xs.length * 0.9)] || 1
  const all = graph.adj.flat()
  graph.riskP90 = p90(all.map((e) => e.risk)); graph.riskP90Night = p90(all.map((e) => e.riskNight))
  nodeGrid = new Grid<number>(0.001, (i) => graph.coords[i])
  graph.coords.forEach((_, i) => graph.adj[i].length && nodeGrid.add(i))
  graph.ready = true
}
build()

export function nearestNode(p: LatLng): number | null {
  for (const r of [60, 150, 400]) {
    let best: number | null = null, bd = Infinity
    for (const i of nodeGrid?.near(p, r) ?? []) { const d = meters(p, graph.coords[i]); if (d < bd) { bd = d; best = i } }
    if (best !== null) return best
  }
  return null
}

type Mode = 'fastest' | 'safest'
export interface Weights { incidents: number; dps: number; light: number; people: number }
export const DEFAULT_WEIGHTS: Weights = { incidents: 1, dps: 1, light: 1, people: 1 }
interface Ctx { night: boolean; w: Weights; open: boolean[] }
const openCount = (e: Edge, ctx: Ctx) => { let n = 0; for (const i of e.places) if (ctx.open[i]) n++; return n }

/** Every multiplier the safest route applies to one street segment (1 = no effect). */
function factors(e: Edge, ctx: Ctx) {
  const { night, w } = ctx
  // sqrt keeps very risky blocks distinguishable from mildly risky ones without one block dominating everything
  const risk = Math.sqrt(night ? e.riskNight / graph.riskP90Night : e.risk / graph.riskP90)
  const open = openCount(e, ctx)
  return {
    incidents: 1 + RISK_WEIGHT * w.incidents * risk,
    dps: e.inDps ? 1 : 1 + 0.6 * w.dps,
    light: (e.lit ? 1 - 0.1 * w.light : 1) * (night ? 1 + 0.35 * w.light * Math.min(e.dark.length, 3) : 1),
    people: Math.max(0.5, 1 - (night ? 0.06 : 0.02) * w.people * Math.min(open, 5) - (MAJOR.has(e.highway) ? (night ? 0.15 : 0.05) * w.people : 0)),
    paths: ['path', 'steps'].includes(e.highway) ? (night ? 1.4 : 1.1) : 1,
  }
}
function cost(e: Edge, mode: Mode, ctx: Ctx) {
  if (mode === 'fastest') return e.len
  const f = factors(e, ctx)
  return e.len * f.incidents * f.dps * f.light * f.people * f.paths
}

function dijkstra(src: number, dst: number, mode: Mode, ctx: Ctx): number[] | null {
  const n = graph.coords.length
  const dist = new Float64Array(n).fill(Infinity), prev = new Int32Array(n).fill(-1)
  const heap: [number, number][] = [[0, src]]; dist[src] = 0
  const push = (x: [number, number]) => { heap.push(x); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p } }
  const pop = () => { const top = heap[0]; const last = heap.pop()!; if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m } } return top }
  while (heap.length) {
    const [d, u] = pop()
    if (u === dst) break
    if (d > dist[u]) continue
    for (const e of graph.adj[u]) {
      const nd = d + cost(e, mode, ctx)
      if (nd < dist[e.to]) { dist[e.to] = nd; prev[e.to] = u; push([nd, e.to]) }
    }
  }
  if (!isFinite(dist[dst])) return null
  const path: number[] = []
  for (let v = dst; v !== -1; v = prev[v]) path.push(v)
  return path.reverse()
}

function describe(nodes: number[], from: LatLng, to: LatLng, ctx: Ctx) {
  const night = ctx.night
  const coords = nodes.map((i) => graph.coords[i])
  let len = 0, lenDps = 0, lenLit = 0, lenMajor = 0, safeCost = 0
  const names: string[] = []
  const dark = new Map<string, Outage>(), open = new Set<number>()
  for (let k = 0; k + 1 < nodes.length; k++) {
    const e = graph.adj[nodes[k]].find((x) => x.to === nodes[k + 1])!
    len += e.len; if (e.inDps) lenDps += e.len; if (e.lit) lenLit += e.len; if (MAJOR.has(e.highway)) lenMajor += e.len
    safeCost += cost(e, 'safest', ctx)
    for (const o of e.dark) dark.set(o.id, o)
    for (const i of e.places) if (ctx.open[i]) open.add(i)
    if (e.name && names[names.length - 1] !== e.name) names.push(e.name)
  }
  // incidents within 45 m of the path (vertices + midpoints), last 6 months — same radius the router scores with
  const seen = new Map<string, ReturnType<typeof incidentsNear>[number]>()
  const samples: LatLng[] = []
  for (let k = 0; k < coords.length; k++) {
    samples.push(coords[k])
    if (k + 1 < coords.length) samples.push([(coords[k][0] + coords[k + 1][0]) / 2, (coords[k][1] + coords[k + 1][1]) / 2])
  }
  for (const p of samples) for (const i of incidentsNear(p, COUNT_RADIUS_M, { days: 183 })) if (i.category !== 'non-street') seen.set(i.id, i)
  const phones = (safetyResources.resources as { type: string; lat: number; lng: number; name: string }[])
    .filter((r) => r.type === 'blue_phone' && coords.some((c) => meters(c, [r.lat, r.lng]) < 75))
  const inc = [...seen.values()]
  return {
    coords: [from, ...coords, to],
    distanceM: Math.round(len), minutes: Math.max(1, Math.round(len / WALK_M_PER_MIN)),
    pctInsideDps: len ? Math.round((lenDps / len) * 100) : 0, pctLit: len ? Math.round((lenLit / len) * 100) : 0,
    incidents: summarize(inc), severeIncidents: inc.filter((i) => i.severity >= 3).length,
    nightIncidents: inc.filter((i) => i.night).length,
    riskScore: Math.round(inc.reduce((s, i) => s + i.severity * (night && i.night ? 1.5 : 1), 0)),
    emergencyPhones: phones.map((p) => p.name), streets: names.slice(0, 8),
    pctBusy: len ? Math.round((lenMajor / len) * 100) : 0,
    darkStreetlights: [...dark.values()].sort((a, b) => b.reported.localeCompare(a.reported)).map((o) => ({ address: o.address, reported: o.reported, status: o.status, lat: o.lat, lng: o.lng })),
    openNow: [...open].map((i) => ({ name: openPlaces[i].name, kind: openPlaces[i].kind, hours: openPlaces[i].hours, lat: openPlaces[i].lat, lng: openPlaces[i].lng })),
    safetyCost: Math.round(safeCost),  // the number the safest route minimizes (meters × multipliers)
  }
}

export function route(from: LatLng, to: LatLng, opts: { night?: boolean; at?: Date; weights?: Partial<Weights> } = {}) {
  if (!graph.ready) throw new Error('Street graph not loaded. Run: cd ai-service && python -m app.safety.ingest')
  const far = meters(from, to)
  if (far > 4000) throw new Error(`Too far to walk: about ${(far / 1609).toFixed(1)} miles in a straight line. See the free rides and shuttles below.`)
  const a = nearestNode(from), b = nearestNode(to)
  if (a === null || b === null) throw new Error('Start or end is outside the mapped area around USC')
  const at = opts.at ?? new Date()
  const { hour } = laClock(at)
  const night = opts.night ?? (hour >= 19 || hour < 6)
  const w: Weights = { ...DEFAULT_WEIGHTS, ...Object.fromEntries(Object.entries(opts.weights ?? {}).filter(([, v]) => Number.isFinite(v)).map(([k, v]) => [k, Math.min(3, Math.max(0, v as number))])) }
  const ctx: Ctx = { night, w, open: openMask(at) }
  const fast = dijkstra(a, b, 'fastest', ctx), safe = dijkstra(a, b, 'safest', ctx)
  if (!fast || !safe) throw new Error('No walkable path found')
  const fastest = describe(fast, from, to, ctx)
  const safest = describe(safe, from, to, ctx)
  const same = fast.length === safe.length && fast.every((x, i) => x === safe[i])
  const extra = safest.minutes - fastest.minutes
  const diffs = [
    fastest.darkStreetlights.length > safest.darkStreetlights.length && `${fastest.darkStreetlights.length - safest.darkStreetlights.length} fewer reported broken streetlights`,
    safest.openNow.length > fastest.openNow.length && `${safest.openNow.length - fastest.openNow.length} more places open along the way`,
    safest.pctInsideDps > fastest.pctInsideDps && `${safest.pctInsideDps - fastest.pctInsideDps}% more inside DPS patrol`,
  ].filter(Boolean) as string[]
  return {
    night, at: at.toISOString(), weights: w, fastest, safest: same ? fastest : safest, sameRoute: same,
    summary: same
      ? 'The fastest route is already the best choice on every factor you weighted.'
      : `The safest route takes ${extra > 0 ? `${extra} more min` : 'about the same time'}` + (diffs.length ? `: ${diffs.join(', ')}, and it stays on lower-risk blocks.` : ' and stays on lower-risk blocks.'),
    parameters: [
      { key: 'incidents', label: 'Reported crime nearby', weight: w.incidents, effect: `× (1 + ${(RISK_WEIGHT * w.incidents).toFixed(1)} × √risk)`, source: 'LAPD NIBRS, last 6 months, within ~45 m, severity × recency' + (night ? ', night incidents ×1.5' : '') },
      { key: 'dps', label: 'Outside DPS patrol', weight: w.dps, effect: `× ${(1 + 0.6 * w.dps).toFixed(2)} per meter outside`, source: 'USC DPS patrol areas (UPC + HSC)' },
      { key: 'light', label: 'Dark streets', weight: w.light, effect: night ? `× (1 + ${(0.35 * w.light).toFixed(2)} per broken streetlight, up to 3); lit streets −${Math.round(10 * w.light)}%` : `lit streets −${Math.round(10 * w.light)}% (outages only count after dark)`,
        source: `MyLA311 open streetlight repair requests (${litMeta.outages} near campus, refreshed ${litMeta.outagesFetchedAt?.slice(0, 10) ?? 'never'}) + OSM lit=yes` },
      { key: 'people', label: 'People around', weight: w.people, effect: `−${Math.round((night ? 6 : 2) * w.people)}% per open place (up to 5), busy streets −${Math.round((night ? 15 : 5) * w.people)}%`, source: `${litMeta.places} places with OpenStreetMap opening hours, checked for ${at.toLocaleTimeString('en-US', { timeZone: 'America/Los_Angeles', hour: 'numeric', minute: '2-digit' })}` },
    ],
    method: 'Shortest path on OpenStreetMap streets. The safest route minimizes meters × the multipliers above; the fastest minimizes meters only.',
  }
}

export function walkMinutes(from: LatLng, to: LatLng) {
  if (!graph.ready) return Math.round((meters(from, to) * 1.3) / WALK_M_PER_MIN)
  const a = nearestNode(from), b = nearestNode(to)
  const p = a !== null && b !== null ? dijkstra(a, b, 'fastest', { night: false, w: DEFAULT_WEIGHTS, open: [] }) : null
  if (!p) return Math.round((meters(from, to) * 1.3) / WALK_M_PER_MIN)
  let len = meters(from, graph.coords[p[0]]) + meters(graph.coords[p[p.length - 1]], to)
  for (let k = 0; k + 1 < p.length; k++) len += graph.adj[p[k]].find((x) => x.to === p[k + 1])!.len
  return Math.max(1, Math.round(len / WALK_M_PER_MIN))
}

// --- for the DPS unit simulation: road nodes inside the DPS zone ---
export function patrolNodes() {
  return graph.coords.map((_, i) => i).filter((i) => graph.inDps[i] && graph.adj[i].some((e) => DRIVABLE.has(e.highway) && e.inDps))
}
export const isDrivable = (h: string) => DRIVABLE.has(h)

// Simplified street lines for decorative/overview drawings (landing page art). Cached.
let art: { major: [number, number][][]; minor: [number, number][][] } | null = null
export function streetArt(bbox = { s: 34.0075, w: -118.3050, n: 34.0425, e: -118.2650 }) {
  if (art) return art
  const f = path.join(DATA_DIR, 'streets.json')
  if (!existsSync(f)) return (art = { major: [], minor: [] })
  const st = JSON.parse(readFileSync(f, 'utf8')) as { nodes: Record<string, LatLng>; ways: { nodes: string[]; highway: string }[] }
  const inBox = (p: LatLng) => p[0] >= bbox.s && p[0] <= bbox.n && p[1] >= bbox.w && p[1] <= bbox.e
  const round = (p: LatLng): [number, number] => [+p[0].toFixed(5), +p[1].toFixed(5)]
  art = { major: [], minor: [] }
  for (const w of st.ways) {
    const kind = MAJOR.has(w.highway) ? 'major' : ['residential', 'unclassified', 'living_street'].includes(w.highway) ? 'minor' : null
    if (!kind) continue
    const pts = w.nodes.map((n) => st.nodes[n]).filter((p) => p && inBox(p)).map(round)
    if (pts.length >= 2) art[kind].push(pts)
  }
  return art
}
