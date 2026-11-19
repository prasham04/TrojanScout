// "Has anything happened here recently?" Three sources, newest first:
//  1) USC DPS crime alerts (dps.usc.edu WordPress feed): posted within hours, the closest thing to real time.
//     The location is parsed from the alert ("Inside the McCarthy Way Entrance…", "Troy Hall", "Royal Street")
//     and placed with the campus gazetteer; precision is reported honestly (exact / street / campus).
//  2) Student reports made in TrojanScout (unverified, shown as such, kept 7 days).
//  3) LAPD open data (accurate but ~2 weeks behind).
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import axios from 'axios'
import { meters, type LatLng } from './geo.js'
import { incidentMeta, incidentsNear } from './safety.js'
import { blockPoint, intersection, searchPlaces, streetPoint } from './places.js'
import { zoneCheck } from './zones.js'

const DATA_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../data')
const UA = { 'User-Agent': 'TrojanScout/0.1 (USC student hackathon project)' }
const CAMPUS: LatLng = [34.0206, -118.2854]
const HSC: LatLng = [34.0622, -118.2035]
const HSC_WORDS = /Health Sciences Campus|\bHSC\b|Keck|Norris|Zonal|Soto Street|Valley Boulevard|LAC\+USC|Lincoln Park/i

export interface DpsAlert {
  id: string; title: string; url: string; postedAt: string; occurredAt: string | null
  location: string; lat: number; lng: number; precision: 'exact' | 'street' | 'campus'; summary: string; campus: 'UPC' | 'HSC'
}
export interface StudentReport {
  id: string; lat: number; lng: number; category: string; description: string; createdAt: string; userId: string
  severity?: 'low' | 'caution' | 'danger'; where?: string; occurredAt?: string; checkedBy?: string
}

let dps: DpsAlert[] = []
let dpsFetchedAt: string | null = null
const reportsFile = path.join(DATA_DIR, 'reports.json')
let reports: StudentReport[] = existsSync(reportsFile) ? JSON.parse(readFileSync(reportsFile, 'utf8')) : []

const strip = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&#8217;|&rsquo;/g, "'").replace(/&#038;|&amp;/g, '&').replace(/&nbsp;|&#160;/g, ' ').replace(/\s+/g, ' ').trim()

function occurred(text: string): string | null {
  const m = text.match(/Occurrence:?\s*(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})\s*([ap])\.?m/i)
  if (!m) return null
  let h = Number(m[4]) % 12
  if (m[6].toLowerCase() === 'p') h += 12
  // DPS times are Pacific; build an ISO string with the LA offset for that date
  const local = `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}T${String(h).padStart(2, '0')}:${m[5]}:00`
  const offset = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', timeZoneName: 'shortOffset' }).formatToParts(new Date(local + 'Z')).find((p) => p.type === 'timeZoneName')?.value ?? 'GMT-8'
  const [, sign, hh] = offset.match(/GMT([+-])(\d+)/) ?? ['', '-', '8']
  return `${local}${sign}${hh.padStart(2, '0')}:00`
}

// ---- precise locating (local data first; one cached geocode for "N block of …" addresses) ----
const geoCacheFile = path.join(DATA_DIR, 'geocode_cache.json')
const geoCache: Record<string, LatLng | null> = existsSync(geoCacheFile) ? JSON.parse(readFileSync(geoCacheFile, 'utf8')) : {}
async function geocodeAddress(q: string): Promise<LatLng | null> {
  if (q in geoCache) return geoCache[q]
  let hit: LatLng | null = null
  try {
    const { data } = await axios.get('https://nominatim.openstreetmap.org/search', { params: { q, format: 'json', limit: 1 }, headers: UA, timeout: 8000 })
    if (data[0]) hit = [Number(data[0].lat), Number(data[0].lon)]
  } catch { /* leave null */ }
  geoCache[q] = hit
  writeFileSync(geoCacheFile, JSON.stringify(geoCache))
  await new Promise((r) => setTimeout(r, 1100))  // Nominatim: max 1 request/second
  return hit
}

const STREET = '(?:\\d+(?:st|nd|rd|th)|[A-Z][a-z]+)(?: [A-Z][a-z]+){0,2} (?:Street|St|Avenue|Ave|Boulevard|Blvd|Way|Drive|Dr|Place|Pl|Walk)'
const near = (p: LatLng | null) => p && (meters(p, CAMPUS) < 4000 || meters(p, HSC) < 2500) ? p : null

async function locate(text: string): Promise<{ location: string; lat: number; lng: number; precision: DpsAlert['precision']; campus: DpsAlert['campus'] }> {
  const field = text.match(/Location:?\s*(.+?)(?=\s+(?:Report Number|Date|Incident|Description|Suspect|Case|Vehicle)\b|$)/i)?.[1]?.trim() ?? ''
  const atHsc = HSC_WORDS.test(`${field} ${text.slice(0, 400)}`)
  const home = atHsc ? HSC : CAMPUS
  const done = (p: LatLng, precision: DpsAlert['precision'], label = field) => ({ location: label || (atHsc ? 'Health Sciences Campus' : 'University Park Campus'), lat: p[0], lng: p[1], precision, campus: (meters(p, HSC) < meters(p, CAMPUS) ? 'HSC' : 'UPC') as DpsAlert['campus'] })
  // 1) "intersection of X and Y" → the real street intersection
  const inter = field.match(new RegExp(`intersection of (${STREET}) and (${STREET})`, 'i')) ?? text.match(new RegExp(`intersection of (${STREET}) and (${STREET})`))
  if (inter) { const p = near(intersection(inter[1], inter[2])); if (p) return done(p, 'exact') }
  // 2) "1100 block of West 37th Place" → middle of that block
  const block = field.match(/(\d+)\s+block of\s+(.+?)(?:,|$)/i)
  if (block) {
    const p = near(blockPoint(Number(block[1]), block[2])) ?? near(await geocodeAddress(`${Number(block[1]) + 50} ${block[2]}, Los Angeles, CA 90007`))
    if (p) return done(p, 'exact')
  }
  // 3) named places (field first, then the narrative) via the campus gazetteer, local only
  const names = [
    field.replace(/\b(inside|outside|near|at|in front of|the|University Park Campus|UPC)\b/gi, ' ').replace(/\s+/g, ' ').trim(),
    ...[...text.matchAll(/\b(?:into|inside|at|near|outside|in front of)\s+((?:[A-Z][\w'.&-]+ ){0,5}(?:Hall|Center|Library|Building|Structure|Village|Plaza|Garage|House|Gallery|Field))/g)].map((m) => m[1]),
  ].filter((s) => s && s.length > 3)
  for (const q of names) {
    const hit = (await searchPlaces(q, home, false, true))[0]
    if (hit && near([hit.lat, hit.lng])) return done([hit.lat, hit.lng], 'exact')
  }
  // 4) a street named in the location + another in the narrative → their intersection; else nearest point of that street
  const streets = [...text.matchAll(new RegExp(`\\b(${STREET})`, 'g'))].map((m) => m[1].replace(/\b(Entrance|Gate)\b/, '').trim())
  const fieldStreet = field.match(new RegExp(STREET))?.[0]
  if (fieldStreet) {
    for (const other of streets.filter((s) => s !== fieldStreet)) { const p = near(intersection(fieldStreet, other)); if (p) return done(p, 'exact', `${field} (${fieldStreet} & ${other})`) }
    const p = near(streetPoint(fieldStreet)); if (p) return done(p, 'street')
  }
  for (const s of streets) { const p = near(streetPoint(s)); if (p) return done(p, 'street', field ? `${field} (near ${s})` : s) }
  return done(home, 'campus')
}

export async function refreshDps() {
  try {
    const { data } = await axios.get('https://dps.usc.edu/wp-json/wp/v2/posts', {
      params: { per_page: 30, _fields: 'id,date,title,link,content' }, headers: UA, timeout: 15000,
    })
    const out: DpsAlert[] = []
    for (const p of data as { id: number; date: string; title: { rendered: string }; link: string; content: { rendered: string } }[]) {
      const text = strip(p.content.rendered)
      if (!/Occurrence/i.test(text)) continue  // advisories, tips and news posts: not incident alerts
      const loc = await locate(text)
      out.push({
        id: `dps-${p.id}`, title: strip(p.title.rendered), url: p.link, postedAt: p.date, occurredAt: occurred(text), ...loc,
        summary: text.replace(/.*?Incident (?:Summary|Description):?\s*/i, '').slice(0, 280),
      })
    }
    if (out.length) { dps = out; dpsFetchedAt = new Date().toISOString() }
  } catch { /* keep the last good copy */ }
}

export function startRecent() {
  refreshDps()
  setInterval(refreshDps, 20 * 60_000)
}

export function addReport(r: Omit<StudentReport, 'id' | 'createdAt'>) {
  const rep = { ...r, id: randomUUID().slice(0, 8), createdAt: new Date().toISOString(), description: r.description.slice(0, 280) }
  const cutoff = Date.now() - 7 * 864e5
  reports = [rep, ...reports.filter((x) => Date.parse(x.createdAt) > cutoff)].slice(0, 500)
  writeFileSync(reportsFile, JSON.stringify(reports))
  return rep
}

const ago = (iso: string) => {
  const m = Math.round((Date.now() - Date.parse(iso)) / 60000)
  return m < 60 ? `${m} min ago` : m < 48 * 60 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago`
}

/** Everything reported near a point within the last `hours` (campus-level DPS alerts count anywhere inside the DPS zone). */
export function recentNear(p: LatLng, radiusM = 500, hours = 24) {
  const since = Date.now() - hours * 3600e3
  const inZone = zoneCheck(p[0], p[1]).inDps
  const dpsHits = dps.filter((a) => Date.parse(a.occurredAt ?? a.postedAt) >= since &&
    (a.precision === 'campus' ? inZone && meters(p, [a.lat, a.lng]) < 1500 : meters(p, [a.lat, a.lng]) <= radiusM))
    .map((a) => ({ source: 'USC DPS alert', verified: true, title: a.title, when: ago(a.occurredAt ?? a.postedAt), at: a.occurredAt ?? a.postedAt,
      where: a.location, precision: a.precision, distanceM: Math.round(meters(p, [a.lat, a.lng])), url: a.url, lat: a.lat, lng: a.lng }))
  const repHits = reports.filter((r) => Date.parse(r.createdAt) >= since && meters(p, [r.lat, r.lng]) <= radiusM)
    .map((r) => ({ source: 'Student report', verified: false, title: r.category, when: ago(r.createdAt), at: r.createdAt,
      where: r.description, precision: 'exact', distanceM: Math.round(meters(p, [r.lat, r.lng])), url: null, lat: r.lat, lng: r.lng }))
  const items = [...dpsHits, ...repHits].sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
  const lapdWeek = incidentsNear(p, radiusM, { days: 14 }).filter((i) => i.category !== 'non-street')
  return {
    hours, radiusM, count: items.length, items,
    lapd: { lastTwoWeeks: lapdWeek.length, severe: lapdWeek.filter((i) => i.severity >= 3).length, dataThrough: incidentMeta.fetchedAt?.slice(0, 10) ?? null,
      note: 'LAPD open data is published with a ~2 week lag, so it can\'t show the last 24 hours.' },
    dpsFetchedAt,
  }
}

export const dpsAlerts = () => ({ fetchedAt: dpsFetchedAt, alerts: dps })
export const recentReports = (hours = 72) => reports.filter((r) => Date.parse(r.createdAt) >= Date.now() - hours * 3600e3)
