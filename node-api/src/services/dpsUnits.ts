// SIMULATED DPS patrol units. USC does not publish live vehicle positions, so this drives N units along real
// streets inside the DPS zone (random patrol loops, ~20 mph) to show what a live feed would look like.
// Swap `tick()` for a real AVL/GPS feed if one is ever available.
import { graph, isDrivable, patrolNodes } from './route.js'
import { meters, type LatLng } from './geo.js'

interface Unit { id: string; callsign: string; from: number; to: number; prev: number; t: number; status: string }
const SPEED_MPS = 9
const units: Unit[] = []
let started = false

function nextNode(u: Unit) {
  const opts = graph.adj[u.to].filter((e) => e.inDps && isDrivable(e.highway) && e.to !== u.from)
  const any = opts.length ? opts : graph.adj[u.to].filter((e) => e.inDps && isDrivable(e.highway))
  return any.length ? any[Math.floor(Math.random() * any.length)].to : u.from
}

function tick(dt: number) {
  for (const u of units) {
    let budget = SPEED_MPS * dt
    while (budget > 0) {
      const seg = meters(graph.coords[u.from], graph.coords[u.to]) || 1
      const left = seg * (1 - u.t)
      if (budget < left) { u.t += budget / seg; budget = 0 }
      else { budget -= left; const n = nextNode(u); u.prev = u.from; u.from = u.to; u.to = n; u.t = 0 }
    }
  }
}

export function startDpsSimulation(n = 7) {
  if (started || !graph.ready) return
  const nodes = patrolNodes()
  if (!nodes.length) return
  const statuses = ['On patrol', 'On patrol', 'On patrol', 'Responding', 'On patrol', 'Escort', 'On patrol']
  for (let k = 0; k < n; k++) {
    const s = nodes[Math.floor(Math.random() * nodes.length)]
    const u: Unit = { id: `dps-${k + 1}`, callsign: `DPS ${11 + k * 3}`, from: s, to: s, prev: s, t: 0, status: statuses[k % statuses.length] }
    u.to = nextNode(u)
    units.push(u)
  }
  setInterval(() => tick(1), 1000)
  started = true
}

export function dpsPositions() {
  return units.map((u) => {
    const a = graph.coords[u.from], b = graph.coords[u.to]
    const pos: LatLng = [a[0] + (b[0] - a[0]) * u.t, a[1] + (b[1] - a[1]) * u.t]
    const heading = (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI
    return { id: u.id, callsign: u.callsign, status: u.status, lat: +pos[0].toFixed(6), lng: +pos[1].toFixed(6), heading: Math.round(heading) }
  })
}
