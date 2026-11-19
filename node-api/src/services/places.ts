// Place search for all of LA County: as-you-type suggestions + reverse geocoding.
//  1) Local campus gazetteer first (fuzzy, typo-tolerant): 670+ named OSM places around USC (data/campus_places.json),
//     USC nicknames ("Viterbi", "Marshall", "SAL", "JKP"…), our class buildings and every live listing.
//  2) Then Photon (photon.komoot.io, OpenStreetMap) for the rest of LA, re-ranked by distance.
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import axios from 'axios'
import { buildings, getListings } from '../data.js'
import { zoneCheck } from './zones.js'

export interface PlaceHit { label: string; detail: string; lat: number; lng: number; kind: string; inDps: boolean; source: 'campus' | 'listing' | 'osm' }

const DATA_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../data')
const LA_BBOX = '-118.95,33.70,-117.65,34.35'
const USC: [number, number] = [34.0224, -118.2851]
const UA = { 'User-Agent': 'TrojanScout/0.1 (USC student hackathon project)' }
const cache = new Map<string, PlaceHit[]>()

// ---------- gazetteer ----------
interface Entry { label: string; detail: string; lat: number; lng: number; kind: string; source: PlaceHit['source']; tokens: string[]; boost: string[] }

const STOP = new Set(['usc', 'the', 'at', 'near', 'in', 'of', 'a', 'an', 'and', 'apartments', 'apartment', 'apts', 'apt', 'building', 'los', 'angeles', 'la', 'ca', 'by', 'to', 'on'])
const norm = (s: string) => s.toLowerCase().replace(/&/g, ' and ').replace(/[’']/g, '').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim()
const toks = (s: string) => norm(s).split(' ').filter((t) => t && !STOP.has(t))

// USC nicknames → official OSM names (the nickname is added to those entries' search words)
const NICKNAMES: Record<string, string[]> = {
  'viterbi engineering': ['Ronald Tutor Hall', 'Salvatori Computer Science Center', 'Olin Hall of Engineering', 'Seeley Wintersmith Mudd Memorial Hall'],
  'marshall business school': ['Popovich Hall', 'Jill & Frank Fertitta Hall', 'Hoffman Hall', 'Accounting Building'],
  'sal cs computer science': ['Salvatori Computer Science Center'], 'rth': ['Ronald Tutor Hall'], 'ohe': ['Olin Hall of Engineering'],
  'jkp': ['Popovich Hall'], 'jff': ['Jill & Frank Fertitta Hall'], 'hoh': ['Hoffman Hall'],
  'tcc student union': ['Ronald Tutor Campus Center'], 'vkc': ['Von KleinSmid Center'], 'thh': ['Taper Hall'],
  'leavey library': ['Leavey Library'], 'doheny library dml': ['Edward L Doheny Junior Memorial Library'],
  'lyon gym': ['Lyon Recreation Center'], 'village': ['USC Village'], 'galen arena': ['Galen Center'],
  'annenberg ann': ['Wallis Annenberg Hall', 'Annenberg School for Communication & Journalism'],
  'coliseum football stadium': ['Los Angeles Memorial Coliseum'], 'tommy trojan': ['Tommy Trojan'], 'bovard': ['Bovard Administration Building'],
  'dulce cafe coffee': ['Cafe Dulce'], 'tjs trader joes groceries': ["Trader Joe's"],
}

const LANDMARKS: [string, string, number, number, string, string][] = [
  ['LAX Airport', '1 World Way, Los Angeles', 33.9416, -118.4085, 'aerodrome', 'lax airport los angeles international'],
  ['Union Station', '800 N Alameda St, Los Angeles', 34.0562, -118.2365, 'station', 'union station amtrak metrolink'],
  ['Crypto.com Arena / LA Live', '1111 S Figueroa St, Downtown', 34.0430, -118.2673, 'stadium', 'crypto arena staples center la live lakers'],
  ['The Grove', '189 The Grove Dr, Fairfax', 34.0721, -118.3576, 'retail', 'grove farmers market mall'],
  ['Koreatown (Wilshire/Vermont)', 'Wilshire Blvd & Vermont Ave', 34.0625, -118.2917, 'station', 'koreatown ktown wilshire vermont'],
  ['Santa Monica Pier', 'Ocean Front Walk, Santa Monica', 34.0089, -118.4974, 'pier', 'santa monica pier beach'],
  ['Hollywood & Highland', '6801 Hollywood Blvd, Hollywood', 34.1016, -118.3387, 'retail', 'hollywood highland walk of fame ovation'],
  ['Downtown LA (Pershing Square)', '532 S Olive St, Downtown', 34.0485, -118.2529, 'park', 'downtown dtla pershing square'],
  ['Little Tokyo', 'E 1st St & Central Ave', 34.0497, -118.2401, 'neighbourhood', 'little tokyo japanese village'],
  ['Arts District', 'Traction Ave, Downtown', 34.0407, -118.2353, 'neighbourhood', 'arts district'],
  ['UCLA (Westwood)', 'Westwood, Los Angeles', 34.0689, -118.4452, 'university', 'ucla westwood bruins'],
  ['Pasadena (Old Pasadena)', 'Colorado Blvd, Pasadena', 34.1458, -118.1505, 'neighbourhood', 'pasadena old town caltech'],
  ['Griffith Observatory', '2800 E Observatory Rd', 34.1184, -118.3004, 'attraction', 'griffith observatory park'],
  ['Venice Beach', 'Ocean Front Walk, Venice', 33.9850, -118.4695, 'beach', 'venice beach boardwalk'],
  ['Culver City', 'Culver Blvd, Culver City', 34.0211, -118.3965, 'neighbourhood', 'culver city'],
  ['Silver Lake', 'Sunset Blvd, Silver Lake', 34.0869, -118.2702, 'neighbourhood', 'silver lake silverlake'],
  ['Echo Park', 'Echo Park Ave', 34.0782, -118.2606, 'park', 'echo park lake'],
  ['Dodger Stadium', '1000 Vin Scully Ave', 34.0739, -118.2400, 'stadium', 'dodger stadium dodgers baseball'],
  ['SoFi Stadium', '1001 Stadium Dr, Inglewood', 33.9535, -118.3392, 'stadium', 'sofi stadium inglewood rams chargers'],
  ['Expo Park/USC Station', 'Exposition Blvd & Flower St', 34.0182, -118.2856, 'station', 'expo park usc station metro e line'],
  ['Expo/Vermont Station', 'Exposition Blvd & Vermont Ave', 34.0183, -118.2915, 'station', 'expo vermont station metro e line'],
  ['Jefferson/USC Station', 'Flower St & Jefferson Blvd', 34.0222, -118.2782, 'station', 'jefferson usc station metro e line'],
  ['7th St/Metro Center', '660 S Figueroa St', 34.0486, -118.2589, 'station', '7th street metro center station'],
  ['Natural History Museum', '900 Exposition Blvd', 34.0170, -118.2887, 'museum', 'natural history museum expo park'],
  ['California Science Center', '700 Exposition Park Dr', 34.0157, -118.2864, 'museum', 'science center endeavour expo park'],
]

let gaz: { entries: Entry[]; df: Map<string, number> } | null = null
function gazetteer() {
  if (gaz) return gaz
  const entries: Entry[] = []
  const add = (e: Omit<Entry, 'tokens' | 'boost'> & { words: string; boost?: string[] }) =>
    entries.push({ ...e, tokens: [...new Set(toks(e.words))], boost: e.boost ?? [] })
  const f = path.join(DATA_DIR, 'campus_places.json')
  const places: { name: string; alt: string[]; lat: number; lng: number; kind: string; address: string }[] = existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')).places : []
  for (const p of places) {
    const nick = Object.entries(NICKNAMES).filter(([, names]) => names.includes(p.name)).map(([k]) => k)
    add({ label: p.name, detail: [p.address, 'near USC'].filter(Boolean).join(', '), lat: p.lat, lng: p.lng, kind: p.kind, source: 'campus',
      words: [p.name, ...p.alt, p.address, ...nick].join(' '), boost: nick.flatMap((n) => n.split(' ')) })
  }
  for (const b of buildings) add({ label: b.name, detail: `USC class building (${b.code})`, lat: b.lat, lng: b.lng, kind: 'university', source: 'campus', words: `${b.name} ${b.code}`, boost: [b.code.toLowerCase()] })
  for (const l of getListings()) add({ label: l.name, detail: `${l.address} · ${l.source} listing`, lat: l.lat, lng: l.lng, kind: 'listing', source: 'listing', words: `${l.name} ${l.address}` })
  add({ label: 'USC Health Sciences Campus', detail: '1975 Zonal Ave, Los Angeles', lat: 34.0607, lng: -118.209, kind: 'university', source: 'campus', words: 'USC Health Sciences Campus HSC Keck School of Medicine', boost: ['hsc', 'health'] })
  // Common LA destinations, so they work even when the remote geocoder is down
  for (const [name, detail, lat, lng, kind, words] of LANDMARKS) add({ label: name, detail, lat, lng, kind, source: 'campus', words: `${name} ${words}` })
  const df = new Map<string, number>()
  for (const e of entries) for (const t of e.tokens) df.set(t, (df.get(t) ?? 0) + 1)
  return (gaz = { entries, df })
}

function editDistanceLe1(a: string, b: string) {
  if (Math.abs(a.length - b.length) > 1) return false
  let i = 0, j = 0, edits = 0
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue }
    if (++edits > 1) return false
    if (a.length > b.length) i++; else if (b.length > a.length) j++; else { i++; j++ }
  }
  return edits + (a.length - i) + (b.length - j) <= 1
}

function tokenMatches(q: string, t: string) {
  if (t.startsWith(q)) return true                                     // prefix: "vit" → viterbi
  if (q.length >= 5 && editDistanceLe1(q, t.slice(0, q.length))) return true  // one typo: "lorenso" (not "expo"→"express")
  return q.length >= 5 && editDistanceLe1(q, t)
}

function localSearch(q: string, near: [number, number]): PlaceHit[] {
  const { entries, df } = gazetteer()
  const qt = toks(q)
  if (!qt.length) return []
  const N = entries.length
  // rare words decide: "dulce usc village" → "dulce" (1 place) outweighs "village" (many)
  const idf = (w: string) => {
    let d = 0
    for (const [t, n] of df) if (tokenMatches(w, t)) d += n
    return Math.log((N + 1) / (d + 1)) + 1
  }
  const weights = qt.map(idf)
  const total = weights.reduce((a, b) => a + b, 0)
  // Words the candidate doesn't contain are only OK if together they name a place right next to it
  // ("dulce usc village" → Cafe Dulce is inside USC Village), never as free-floating partial matches.
  const qset = new Set(qt)
  const contextOk = (e: Entry, missing: string[]) => !missing.length || entries.some((c) => {
    if (c === e) return false
    const lt = toks(c.label)
    return lt.length > 0 && missing.every((w) => lt.includes(w)) && lt.every((t) => qset.has(t)) &&
      Math.hypot((c.lat - e.lat) * 111000, (c.lng - e.lng) * 92000) < 300
  })
  const scored = entries.map((e) => {
    let got = 0
    const missing: string[] = []
    qt.forEach((w, i) => {
      if (e.tokens.some((t) => tokenMatches(w, t))) got += weights[i] * (e.boost.includes(w) ? 1.3 : 1)
      else missing.push(w)
    })
    if (!got || !contextOk(e, missing)) return { e, score: 0 }
    got = got + missing.reduce((s, w) => s + weights[qt.indexOf(w)], 0) * 0.8  // context words count, a bit less
    const km = Math.hypot((e.lat - near[0]) * 111, (e.lng - near[1]) * 92)
    const exact = norm(e.label).startsWith(norm(q)) ? 0.25 : 0
    return { e, score: got / total + exact - km / 400 + (e.source === 'campus' && e.kind === 'university' ? 0.02 : 0) }
  }).filter((x) => x.score >= 0.55).sort((a, b) => b.score - a.score)
  return scored.slice(0, 6).map(({ e }) => ({ label: e.label, detail: e.detail, lat: e.lat, lng: e.lng, kind: e.kind, source: e.source, inDps: zoneCheck(e.lat, e.lng).inDps }))
}

function label(p: Record<string, string | undefined>) {
  const street = [p.housenumber, p.street].filter(Boolean).join(' ')
  const name = p.name ?? street ?? 'Place'
  const detail = [p.name && street ? street : null, p.district ?? p.locality, p.city].filter(Boolean).join(', ')
  return { label: name || street, detail }
}

/** One-shot lookup (used only when the user presses Enter / Find and Photon is unavailable). Nominatim allows this; not autocomplete. */
async function nominatimOnce(q: string): Promise<PlaceHit[]> {
  const { data } = await axios.get('https://nominatim.openstreetmap.org/search', {
    params: { q: /los angeles|, ca\b/i.test(q) ? q : `${q}, Los Angeles County, CA`, format: 'json', limit: 3, viewbox: LA_BBOX, bounded: 1 }, headers: UA, timeout: 8000,
  })
  return data.map((d: { display_name: string; lat: string; lon: string; type: string }) => {
    const [first, ...rest] = d.display_name.split(', ')
    const lat = Number(d.lat), lng = Number(d.lon)
    return { label: first, detail: rest.slice(0, 3).join(', '), lat, lng, kind: d.type, inDps: zoneCheck(lat, lng).inDps, source: 'osm' as const }
  })
}

export async function searchPlaces(q: string, near: [number, number] = USC, final = false, localOnly = false): Promise<PlaceHit[]> {
  const key = `${q.toLowerCase().trim()}|${near.map((x) => x.toFixed(2)).join(',')}|${final}|${localOnly}`
  if (cache.has(key)) return cache.get(key)!
  const local = localSearch(q, near)
  let remote: PlaceHit[] = []
  let remoteFailed = false
  if (local.length < 6 && !localOnly) {
    try {
      const { data } = await axios.get('https://photon.komoot.io/api/', { params: { q, lat: near[0], lon: near[1], limit: 8, bbox: LA_BBOX, lang: 'en' }, headers: UA, timeout: 6000 })
      remote = (data.features ?? []).map((f: { properties: Record<string, string>; geometry: { coordinates: [number, number] } }, i: number) => {
        const [lng, lat] = f.geometry.coordinates
        const km = Math.hypot((lat - near[0]) * 111, (lng - near[1]) * 92)
        return { ...label(f.properties), lat, lng, kind: f.properties.osm_value ?? '', inDps: zoneCheck(lat, lng).inDps, source: 'osm' as const, _s: i + km / 6 }
      }).sort((a: { _s: number }, b: { _s: number }) => a._s - b._s).map(({ _s, ...h }: { _s: number } & PlaceHit) => h) // eslint-disable-line @typescript-eslint/no-unused-vars
    } catch { remoteFailed = true }
    if (remoteFailed && final && !local.length) {
      try { remote = await nominatimOnce(q); remoteFailed = false } catch { /* nothing else to try */ }
    }
  }
  const out: PlaceHit[] = []
  for (const h of [...local, ...remote]) {  // drop near-duplicates (same name within ~80 m)
    if (!out.some((o) => norm(o.label) === norm(h.label) && Math.hypot((o.lat - h.lat) * 111000, (o.lng - h.lng) * 92000) < 80)) out.push(h)
  }
  const res = out.slice(0, 7)
  if (!remoteFailed) cache.set(key, res)  // never cache a result that is empty only because the remote was down
  return res
}

export async function reversePlace(lat: number, lng: number): Promise<PlaceHit> {
  const key = `rev|${lat.toFixed(4)},${lng.toFixed(4)}`
  if (cache.has(key)) return cache.get(key)![0]
  let hit: PlaceHit = { label: `${lat.toFixed(4)}, ${lng.toFixed(4)}`, detail: 'Dropped pin', lat, lng, kind: 'pin', inDps: zoneCheck(lat, lng).inDps, source: 'osm' }
  // nearest named campus place within 35 m reads better than a street address
  const near = gazetteer().entries.map((e) => ({ e, m: Math.hypot((e.lat - lat) * 111000, (e.lng - lng) * 92000) })).filter((x) => x.m < 35 && x.e.source !== 'listing').sort((a, b) => a.m - b.m)[0]
  if (near) hit = { ...hit, label: near.e.label, detail: near.e.detail, kind: near.e.kind, source: 'campus' }
  else {
    try {
      const { data } = await axios.get('https://photon.komoot.io/reverse', { params: { lat, lon: lng, limit: 1, lang: 'en' }, headers: UA, timeout: 6000 })
      const f = data.features?.[0]
      if (f) hit = { ...hit, ...label(f.properties), kind: f.properties.osm_value ?? '' }
    } catch { /* keep coordinates label */ }
  }
  cache.set(key, [hit])
  return hit
}

// ---------- street-network lookups (OSM ways in data/streets.json) ----------
let streetIdx: { byName: Map<string, [number, number][]> } | null = null
const ABBR: Record<string, string> = { st: 'street', ave: 'avenue', blvd: 'boulevard', dr: 'drive', pl: 'place', rd: 'road' }
const DIRS = new Set(['north', 'south', 'east', 'west', 'n', 's', 'e', 'w'])
const streetKey = (s: string) => norm(s).split(' ').map((t) => ABBR[t] ?? t).filter((t) => !DIRS.has(t)).join(' ')

function streets() {
  if (streetIdx) return streetIdx
  const f = path.join(DATA_DIR, 'streets.json')
  const byName = new Map<string, [number, number][]>()
  if (existsSync(f)) {
    const st = JSON.parse(readFileSync(f, 'utf8')) as { nodes: Record<string, [number, number]>; ways: { nodes: string[]; name?: string }[] }
    for (const w of st.ways) {
      if (!w.name) continue
      const k = streetKey(w.name)
      const pts = w.nodes.map((n) => st.nodes[n]).filter(Boolean)
      byName.set(k, [...(byName.get(k) ?? []), ...pts])
    }
  }
  return (streetIdx = { byName })
}

function pointsOf(name: string) {
  const k = streetKey(name)
  const { byName } = streets()
  return byName.get(k) ?? [...byName.entries()].filter(([n]) => n.endsWith(k) || k.endsWith(n)).flatMap(([, p]) => p)
}

/** Where two named streets meet (closest pair of points, within 40 m), nearest USC if they meet more than once. */
export function intersection(a: string, b: string): [number, number] | null {
  const A = pointsOf(a), B = pointsOf(b)
  let best: { p: [number, number]; d: number } | null = null
  for (const p of A) for (const q of B) {
    const d = Math.hypot((p[0] - q[0]) * 111000, (p[1] - q[1]) * 92000)
    if (d < 40) {
      const score = d + Math.hypot((p[0] - USC[0]) * 111000, (p[1] - USC[1]) * 92000) / 50
      if (!best || score < best.d) best = { p: [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2], d: score }
    }
  }
  return best?.p ?? null
}

/** The point of a named street closest to campus (used when only a street is given). */
export function streetPoint(name: string): [number, number] | null {
  const pts = pointsOf(name)
  if (!pts.length) return null
  return pts.reduce((a, b) => (Math.hypot(a[0] - USC[0], a[1] - USC[1]) < Math.hypot(b[0] - USC[0], b[1] - USC[1]) ? a : b))
}

/** "1100 block of West 37th Place": LA's west-side house numbers rise steadily westward, so a fit over our listings'
 *  real addresses (≈ -118.255 − 0.0000306 × number) gives the longitude; the street itself gives the latitude. */
let numFit: { a: number; b: number } | null = null
function houseNumberFit() {
  if (numFit) return numFit
  const pts = getListings().map((l) => [Number(l.address.match(/^(\d+)(?:[-–]\d+)?\s+(?:W\.?|West)\s/)?.[1]), l.lng]).filter(([x]) => Number.isFinite(x)) as [number, number][]
  const n = pts.length, sx = pts.reduce((s, [x]) => s + x, 0), sy = pts.reduce((s, [, y]) => s + y, 0)
  const sxx = pts.reduce((s, [x]) => s + x * x, 0), sxy = pts.reduce((s, [x, y]) => s + x * y, 0)
  const b = n > 5 ? (n * sxy - sx * sy) / (n * sxx - sx * sx) : -0.0000306
  return (numFit = { a: n > 5 ? (sy - b * sx) / n : -118.255, b })
}

export function blockPoint(num: number, street: string): [number, number] | null {
  if (!/^\s*(?:W\.?|West)\b/i.test(street)) return null  // only the west-side numbering is modeled
  const { a, b } = houseNumberFit()
  const lng = a + b * (num + 50)
  const pts = pointsOf(street).filter((p) => Math.abs(p[1] - lng) < 0.0025)
  if (!pts.length) return null
  const p = pts.reduce((x, y) => (Math.abs(x[1] - lng) < Math.abs(y[1] - lng) ? x : y))
  return [p[0], lng]
}
