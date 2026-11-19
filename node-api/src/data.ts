// Listings come from data/listings.json (written by the ai-service scraper, refreshed on a schedule).
// Falls back to data/listings.csv seed rows if the scraper hasn't run yet. Re-read when the file changes.
import { existsSync, readFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import type { FeatureCollection, Polygon } from 'geojson'

const DATA_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../data')

export interface Unit { label: string; roomType: string; beds: number | null; baths: number | null; privateBath: boolean | null; rent: number | null; count: number }
export interface Listing {
  id: string; source: string; url: string; name: string; address: string; lat: number; lng: number
  rent: number | null; rentMax?: number | null; priceUnit: string; callForPricing?: boolean
  beds: number | null; bedsMax?: number | null; baths?: number | null; availability?: string | null
  propertyTypes?: string[]; amenities?: string[]; photos?: string[]; description?: string
  utilitiesEst: number; distanceToCampusMi?: number | null; scrapedAt?: string
  units?: Unit[]; roomTypes?: string[]; sampleData?: boolean
}
export interface Building { id: number; name: string; code: string; lat: number; lng: number }

export const zones = JSON.parse(readFileSync(path.join(DATA_DIR, 'zones.geojson'), 'utf8')) as FeatureCollection<Polygon>
export const buildings = JSON.parse(readFileSync(path.join(DATA_DIR, 'buildings.json'), 'utf8')) as Building[]

const LIVE = path.join(DATA_DIR, 'listings.json')
let cache: { mtime: number; listings: Listing[]; scrapedAt: string | null; sources: Record<string, unknown> } | null = null

function seed(): Listing[] {
  const [header, ...rows] = readFileSync(path.join(DATA_DIR, 'listings.csv'), 'utf8').trim().split('\n')
  const cols = header.split(',')
  return rows.map((r) => {
    const o = Object.fromEntries(cols.map((c, i) => [c, r.split(',')[i]]))
    return { id: `seed:${o.id}`, source: 'Seed', url: o.url, name: o.address, address: o.address, lat: +o.lat, lng: +o.lng,
      rent: +o.rent, priceUnit: 'per unit', beds: +o.beds, utilitiesEst: +o.utilities_est }
  })
}

export function listingsMeta() {
  if (!existsSync(LIVE)) return { listings: seed(), scrapedAt: null, sources: { seed: 'scraper has not run yet' } }
  const mtime = statSync(LIVE).mtimeMs
  if (!cache || cache.mtime !== mtime) {
    const d = JSON.parse(readFileSync(LIVE, 'utf8'))
    cache = { mtime, listings: d.listings, scrapedAt: d.scrapedAt, sources: d.sources }
  }
  return cache
}

export const getListings = () => listingsMeta().listings
export const getListing = (id: string) => getListings().find((l) => l.id === id)
