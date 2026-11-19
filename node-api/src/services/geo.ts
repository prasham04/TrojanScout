// Small, fast geo helpers + a uniform grid index (cheaper than turf for hot loops).
export type LatLng = [number, number]
const R = 6371000
const rad = (d: number) => (d * Math.PI) / 180

export function meters(a: LatLng, b: LatLng) {
  const dLat = rad(b[0] - a[0]), dLng = rad(b[1] - a[1])
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

export class Grid<T> {
  private cells = new Map<string, T[]>()
  constructor(private cell = 0.001, private pos: (t: T) => LatLng) {}
  private key(lat: number, lng: number) { return `${Math.floor(lat / this.cell)}:${Math.floor(lng / this.cell)}` }
  add(t: T) { const [la, lo] = this.pos(t); const k = this.key(la, lo); (this.cells.get(k) ?? this.cells.set(k, []).get(k)!).push(t) }
  near(p: LatLng, radiusM: number): T[] {
    const span = Math.ceil(radiusM / (this.cell * 111000)) + 1
    const ci = Math.floor(p[0] / this.cell), cj = Math.floor(p[1] / this.cell)
    const out: T[] = []
    for (let i = ci - span; i <= ci + span; i++) for (let j = cj - span; j <= cj + span; j++) {
      for (const t of this.cells.get(`${i}:${j}`) ?? []) if (meters(p, this.pos(t)) <= radiusM) out.push(t)
    }
    return out
  }
}
