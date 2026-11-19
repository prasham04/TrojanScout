// "Lit & Alive": two things that make a street feel safer at night, beyond crime counts.
//  - Dark streets: open streetlight repair requests from MyLA311 (data/streetlight_outages.json).
//  - People around: places open at the time you're walking, from OpenStreetMap opening_hours (data/open_places.json).
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Grid, type LatLng } from './geo.js'

const DATA_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../data')
const load = <T,>(f: string, empty: T): T => { const p = path.join(DATA_DIR, f); return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : empty }

export interface Outage { id: string; lat: number; lng: number; reported: string; status: string; address: string }
export interface OpenPlace { name: string; kind: string; hours: string; lat: number; lng: number }

const so = load('streetlight_outages.json', { outages: [] as Outage[], source: 'none', fetchedAt: null as string | null, since: null as string | null })
const op = load('open_places.json', { places: [] as OpenPlace[], fetchedAt: null as string | null })
export const outages: Outage[] = so.outages
export const openPlaces: OpenPlace[] = op.places
export const litMeta = { outages: outages.length, outagesSince: so.since, outagesFetchedAt: so.fetchedAt, places: openPlaces.length, placesFetchedAt: op.fetchedAt }

export const outageGrid = new Grid<Outage>(0.001, (o) => [o.lat, o.lng])
outages.forEach((o) => outageGrid.add(o))
export const placeGrid = new Grid<number>(0.001, (i) => [openPlaces[i].lat, openPlaces[i].lng])
openPlaces.forEach((_, i) => placeGrid.add(i))

// ---------- opening_hours (the common subset of the OSM syntax) ----------
const DAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su']
type Interval = [number, number]  // minutes from midnight; end may exceed 1440 for overnight
const parsed = new Map<string, Interval[][] | null>()

function parse(src: string): Interval[][] | null {
  if (parsed.has(src)) return parsed.get(src)!
  let week: Interval[][] | null = Array.from({ length: 7 }, () => [] as Interval[])
  try {
    const s = src.trim()
    if (s === '24/7') { week = week.map(() => [[0, 1440]]) } else {
      for (const rule of s.split(';').map((r) => r.trim()).filter(Boolean)) {
        if (/^(PH|SH)\b/.test(rule)) continue  // public / school holidays: ignore
        const m = rule.match(/^((?:(?:Mo|Tu|We|Th|Fr|Sa|Su)(?:-(?:Mo|Tu|We|Th|Fr|Sa|Su))?,?)+)?\s*(.*)$/)
        if (!m) throw new Error('bad')
        const days = new Set<number>()
        if (m[1]) for (const part of m[1].split(',').filter(Boolean)) {
          const [a, b] = part.split('-').map((d) => DAYS.indexOf(d))
          if (a < 0) throw new Error('bad')
          if (b === undefined) days.add(a); else for (let d = a; ; d = (d + 1) % 7) { days.add(d); if (d === b) break }
        } else for (let d = 0; d < 7; d++) days.add(d)
        const rest = m[2].replace(/,?\s*PH\s+off/i, '').trim()
        let iv: Interval[] = []
        if (/^(off|closed)$/i.test(rest)) iv = []
        else if (rest === '24/7' || rest === '') iv = [[0, 1440]]
        else for (const t of rest.split(',')) {
          const tm = t.trim().match(/^(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})\+?$/)
          if (!tm) throw new Error('bad')
          const a = +tm[1] * 60 + +tm[2]; let b = +tm[3] * 60 + +tm[4]
          if (b <= a) b += 1440  // past midnight
          iv.push([a, b])
        }
        for (const d of days) week[d] = iv  // a later rule replaces earlier ones for its days
      }
    }
  } catch { week = null }
  parsed.set(src, week)
  return week
}

/** Weekday (0 = Monday) and minutes since midnight in Los Angeles. */
export function laClock(at: Date) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', weekday: 'short', hour: 'numeric', minute: 'numeric', hourCycle: 'h23' })
    .formatToParts(at).map((x) => [x.type, x.value]))
  return { day: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(p.weekday), min: +p.hour * 60 + +p.minute, hour: +p.hour }
}

/** true / false, or null when the hours can't be read. */
export function isOpen(hours: string, at: Date): boolean | null {
  const w = parse(hours)
  if (!w) return null
  const { day, min } = laClock(at)
  if (w[day].some(([a, b]) => min >= a && min < b)) return true
  const prev = w[(day + 6) % 7]  // yesterday's hours that run past midnight
  return prev.some(([, b]) => b > 1440 && min < b - 1440)
}

/** Which places are open at `at` (index-aligned with openPlaces). */
export function openMask(at: Date) { return openPlaces.map((p) => isOpen(p.hours, at) === true) }
