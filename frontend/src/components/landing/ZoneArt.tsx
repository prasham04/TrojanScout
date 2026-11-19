import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { API_URL, api, subscribeDpsUnits } from '../../api/client'
import type { DpsUnit } from '../../api/types'

// A drawn (not tiled) view of the DPS zone: real OSM streets, the zone outline, live listings and DPS units.
// Nothing renders outside the frame, so there are no grey tile gaps.
const BOX = { s: 34.0075, w: -118.3050, n: 34.0425, e: -118.2650 }
const W = 640
const K = W / ((BOX.e - BOX.w) * Math.cos((34.025 * Math.PI) / 180))
const H = Math.round((BOX.n - BOX.s) * K)
const x = (lng: number) => (lng - BOX.w) * Math.cos((34.025 * Math.PI) / 180) * K
const y = (lat: number) => (BOX.n - lat) * K
const inv = (px: number, py: number): [number, number] => [BOX.n - py / K, BOX.w + px / (Math.cos((34.025 * Math.PI) / 180) * K)]
const pathOf = (pts: [number, number][]) => pts.map(([la, lo], i) => `${i ? 'L' : 'M'}${x(lo).toFixed(1)},${y(la).toFixed(1)}`).join('')

export interface Pin { lat: number; lng: number; inDps: boolean; inFryft?: boolean; label?: string }

export default function ZoneArt({ pin, onPick }: { pin: Pin | null; onPick: (lat: number, lng: number) => void }) {
  const streets = useQuery({ queryKey: ['street-art'], queryFn: () => fetch(`${API_URL}/api/streets/art`).then((r) => r.json()) as Promise<{ major: [number, number][][]; minor: [number, number][][] }>, staleTime: Infinity })
  const zones = useQuery({ queryKey: ['zones'], queryFn: api.zones })
  const listings = useQuery({ queryKey: ['listings'], queryFn: () => api.listings() })
  const [units, setUnits] = useState<DpsUnit[]>([])
  useEffect(() => subscribeDpsUnits(setUnits), [])

  const dps = useMemo(() => {
    const f = zones.data?.features.find((z) => z.properties?.name === 'DPS')
    const ring = (f?.geometry as GeoJSON.Polygon | undefined)?.coordinates[0]
    return ring ? ring.map(([lo, la], i) => `${i ? 'L' : 'M'}${x(lo).toFixed(1)},${y(la).toFixed(1)}`).join('') + 'Z' : ''
  }, [zones.data])
  const major = useMemo(() => streets.data?.major.map(pathOf).join(' ') ?? '', [streets.data])
  const minor = useMemo(() => streets.data?.minor.map(pathOf).join(' ') ?? '', [streets.data])

  const click = (e: React.MouseEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    const [la, lo] = inv(((e.clientX - r.left) / r.width) * W, ((e.clientY - r.top) / r.height) * H)
    onPick(la, lo)
  }

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-full w-full cursor-crosshair select-none" onClick={click} role="img" aria-label="Map of the USC DPS patrol zone">
      <defs>
        <radialGradient id="za-bg" cx="55%" cy="45%" r="75%"><stop offset="0%" stopColor="#2a0a0a" /><stop offset="100%" stopColor="#120404" /></radialGradient>
        <linearGradient id="za-zone" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stopColor="#990000" stopOpacity="0.55" /><stop offset="100%" stopColor="#ffc72c" stopOpacity="0.18" /></linearGradient>
        <filter id="za-glow" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="5" result="b" /><feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
      </defs>
      <rect width={W} height={H} fill="url(#za-bg)" />
      <path d={minor} fill="none" stroke="#ffffff" strokeOpacity="0.07" strokeWidth="0.8" />
      <path d={major} fill="none" stroke="#ffffff" strokeOpacity="0.22" strokeWidth="1.6" strokeLinecap="round" />
      {dps && <path d={dps} fill="url(#za-zone)" stroke="#ffc72c" strokeWidth="2.5" strokeLinejoin="round" filter="url(#za-glow)" />}
      {dps && <text x={x(-118.2995)} y={y(34.0337)} fill="#ffc72c" fontSize="12" fontWeight="700" letterSpacing="2">DPS PATROL ZONE</text>}
      {/* campus */}
      <g transform={`translate(${x(-118.2854)},${y(34.0206)})`}>
        <circle r="13" fill="#ffc72c" opacity="0.25" /><circle r="7" fill="#ffc72c" />
        <text y="26" textAnchor="middle" fill="#fff" fontSize="11" fontWeight="700">USC</text>
      </g>
      {listings.data?.map((l) => (
        <circle key={l.id} cx={x(l.lng)} cy={y(l.lat)} r="3.2" fill={l.inDps ? '#34d399' : '#a78bfa'} opacity="0.9" />
      ))}
      {units.map((u) => (
        <g key={u.id} style={{ transform: `translate(${x(u.lng)}px, ${y(u.lat)}px)`, transition: 'transform 2s linear' }}>
          <circle r="9" fill="#ef4444" opacity="0.25" className="ts-pulse" style={{ transformOrigin: 'center', transformBox: 'fill-box' }} />
          <circle r="4.5" fill="#ef4444" stroke="#fff" strokeWidth="1.5" />
        </g>
      ))}
      {pin && (
        <g transform={`translate(${x(pin.lng)},${y(pin.lat)})`}>
          <circle r="16" fill={pin.inDps ? '#34d399' : '#a78bfa'} opacity="0.3" className="ts-pulse" style={{ transformOrigin: 'center', transformBox: 'fill-box' }} />
          <path d="M0,0 C-7,-10 -9,-14 -9,-18 A9,9 0 1 1 9,-18 C9,-14 7,-10 0,0Z" fill="#fff" stroke={pin.inDps ? '#059669' : '#7c3aed'} strokeWidth="2.5" />
          <circle cy="-18" r="3.5" fill={pin.inDps ? '#059669' : '#7c3aed'} />
        </g>
      )}
    </svg>
  )
}
