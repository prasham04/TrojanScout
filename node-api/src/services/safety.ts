// LAPD incidents (data/incidents.json, written by ai-service `python -m app.safety.ingest`) + USC safety resources.
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Grid, type LatLng } from './geo.js'

const DATA_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../data')

export interface Incident {
  id: string; lat: number; lng: number; date: string; hour: number; night: boolean
  category: string; severity: number; against: string; description: string; premise: string; block: string
}

const file = path.join(DATA_DIR, 'incidents.json')
const raw = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : { incidents: [], source: 'none', synthetic: true }
export const incidentMeta = { source: raw.source as string, synthetic: !!raw.synthetic, since: raw.since as string | undefined, count: raw.incidents.length as number, fetchedAt: raw.fetchedAt as string | undefined }
export const incidents: Incident[] = raw.incidents
const grid = new Grid<Incident>(0.001, (i) => [i.lat, i.lng])
incidents.forEach((i) => grid.add(i))

const resFile = path.join(DATA_DIR, 'safety_resources.json')
export const safetyResources = existsSync(resFile) ? JSON.parse(readFileSync(resFile, 'utf8')) : { resources: [], phones: {} }

const today = Date.now()
/** Recent incidents count more: 1.0 this week → 0.5 at 6 months. */
export const recency = (date: string) => Math.max(0.5, 1 - (today - Date.parse(date)) / (365 * 864e5))

export function incidentsNear(p: LatLng, radiusM: number, opts: { days?: number; nightOnly?: boolean } = {}) {
  const cutoff = opts.days ? today - opts.days * 864e5 : 0
  return grid.near(p, radiusM).filter((i) => (!cutoff || Date.parse(i.date) >= cutoff) && (!opts.nightOnly || i.night))
}

/** Weighted risk around a point: Σ severity × recency (× 1.5 for night-time incidents when night=true). */
export function riskAt(p: LatLng, radiusM = 45, night = false) {
  let r = 0
  for (const i of grid.near(p, radiusM)) r += i.severity * recency(i.date) * (night && i.night ? 1.5 : 1)
  return r
}

export function summarize(list: Incident[]) {
  const byCategory: Record<string, number> = {}
  for (const i of list) if (i.category !== 'non-street') byCategory[i.category] = (byCategory[i.category] ?? 0) + 1
  const person = list.filter((i) => i.against.startsWith('Person')).length
  return { total: Object.values(byCategory).reduce((a, b) => a + b, 0), againstPerson: person, byCategory }
}

/** Incidents aggregated to LAPD hundred-block points (what the map draws). */
export function blockPoints(days = 180) {
  const cutoff = today - days * 864e5
  const by = new Map<string, { lat: number; lng: number; block: string; count: number; severe: number; night: number; byCategory: Record<string, number>; latest: string }>()
  for (const i of incidents) {
    if (Date.parse(i.date) < cutoff || i.category === 'non-street') continue
    const k = `${i.lat},${i.lng}`
    const b = by.get(k) ?? { lat: i.lat, lng: i.lng, block: i.block, count: 0, severe: 0, night: 0, byCategory: {}, latest: i.date }
    b.count++; if (i.severity >= 3) b.severe++; if (i.night) b.night++
    b.byCategory[i.category] = (b.byCategory[i.category] ?? 0) + 1
    if (i.date > b.latest) b.latest = i.date
    by.set(k, b)
  }
  return [...by.values()]
}
