import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as turf from '@turf/turf'
import type { Feature, FeatureCollection, Polygon } from 'geojson'
import { zones } from '../data.js'

const find = (name: string) => zones.features.find((f) => f.properties?.name === name)
// USC's official Lyft Rides ("Fryft") boundaries: UPC (Normandie–Main, Washington–MLK) and HSC (+ Union Station)
const RIDE_FILE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../data/usc_ride_zones.geojson')
const rideZones = (existsSync(RIDE_FILE) ? JSON.parse(readFileSync(RIDE_FILE, 'utf8')) : { features: [] }) as FeatureCollection<Polygon>
const lyft = rideZones.features.filter((f) => ['usc_lyft_upc', 'usc_lyft_hsc', 'usc_lyft_union_station'].includes(f.properties?.name))

export function zoneCheck(lat: number, lng: number) {
  const pt = turf.point([lng, lat])
  const dps = find('DPS'), dpsHsc = find('DPS_HSC')
  const inDps = (dps ? turf.booleanPointInPolygon(pt, dps) : false) || (dpsHsc ? turf.booleanPointInPolygon(pt, dpsHsc) : false)
  const inFryft = lyft.some((f) => turf.booleanPointInPolygon(pt, f))
  // distance to the nearest free-Lyft edge (0 when there's no boundary data)
  let metersToFryftEdge = 0
  for (const f of lyft) {
    const line = turf.polygonToLine(f as Feature<Polygon>)
    const lf = line.type === 'FeatureCollection' ? line.features[0] : line
    const m = Math.round(turf.pointToLineDistance(pt, lf as any, { units: 'meters' }))
    metersToFryftEdge = metersToFryftEdge ? Math.min(metersToFryftEdge, m) : m
  }
  return { inDps, inFryft, metersToFryftEdge }
}
