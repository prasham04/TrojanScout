import { useEffect, useState } from 'react'
import { CircleMarker, GeoJSON, Marker, Polyline, Tooltip, useMap, useMapEvents } from 'react-leaflet'
import L from 'leaflet'
import { useQuery } from '@tanstack/react-query'
import { API_URL, api, subscribeDpsUnits } from '../../api/client'
import type { DpsUnit, RouteResult } from '../../api/types'

export const COLORS = { inside: '#059669', outside: '#7c3aed', dps: '#dc2626', safest: '#059669', fastest: '#2563eb', incident: '#f97316' }

// ---- LAPD incidents, aggregated to hundred-block points ----
export function IncidentLayer({ days }: { days: number }) {
  const q = useQuery({ queryKey: ['incidents', days], queryFn: () => api.incidents(days) })
  return (
    <>
      {q.data?.points.map((p) => (
        <CircleMarker key={`${p.lat},${p.lng}`} center={[p.lat, p.lng]} radius={Math.min(3 + Math.sqrt(p.count) * 1.6, 12)} interactive
          pathOptions={{ stroke: false, fillColor: p.severe ? '#dc2626' : COLORS.incident, fillOpacity: Math.min(0.15 + p.count * 0.04, 0.55) }}>
          <Tooltip>
            <b>{p.block || 'Block'}</b> · {p.count} reported ({p.severe} violent/weapon)<br />
            {Object.entries(p.byCategory).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, v]) => `${v} ${k}`).join(' · ')}<br />
            <span style={{ opacity: 0.7 }}>latest {p.latest} · LAPD</span>
          </Tooltip>
        </CircleMarker>
      ))}
    </>
  )
}

// ---- Safety places: police & DPS stations, emergency phones, medical & vending (precise OSM positions) ----
const badge = (bg: string, fg: string, text: string, w = 26) => L.divIcon({
  className: '', iconSize: [w, 22], iconAnchor: [w / 2, 11],
  html: `<div style="background:${bg};color:${fg};border:2px solid #fff;border-radius:7px;height:22px;min-width:${w}px;padding:0 3px;display:grid;place-items:center;font-weight:800;font-size:10px;box-shadow:0 2px 6px rgba(0,0,0,.3)">${text}</div>`,
})
const ICONS = {
  dps_station: badge('#990000', '#ffc72c', 'DPS', 32),
  police_lapd: badge('#1e3a8a', '#fff', 'LAPD', 36),
  police_other: badge('#334155', '#fff', '👮', 24),
  blue_phone: L.divIcon({ className: '', html: '<div style="background:#2563eb;border:2px solid #fff;border-radius:50%;width:14px;height:14px;box-shadow:0 0 0 3px rgba(37,99,235,.3)"></div>', iconSize: [14, 14], iconAnchor: [7, 7] }),
  medical: badge('#059669', '#fff', '✚', 22),
  vending: badge('#7c3aed', '#fff', '💊', 22),
}
type Kind = 'police' | 'phones' | 'medical'
interface Res { type: string; name: string; lat: number; lng: number; operator?: string; address?: string; phone?: string; detail?: string; precision?: string; source?: string }

export function SafetyLayer({ show }: { show: Record<Kind, boolean> }) {
  const q = useQuery({ queryKey: ['safety-resources'], queryFn: api.safetyResources, staleTime: Infinity })
  const rs: Res[] = q.data?.resources ?? []
  const kindOf = (r: Res): Kind | null => r.type === 'police' || r.type === 'dps_station' ? 'police' : r.type === 'blue_phone' ? 'phones' : r.type === 'medical' || r.type === 'vending' ? 'medical' : null
  const icon = (r: Res) => r.type === 'police' ? (/Los Angeles Police|Community Police Station|LAPD/.test(`${r.name} ${r.operator}`) ? ICONS.police_lapd : ICONS.police_other) : ICONS[r.type as keyof typeof ICONS] ?? ICONS.blue_phone
  return (
    <>
      {rs.filter((r) => { const k = kindOf(r); return k && show[k] }).map((r) => (
        <Marker key={`${r.type}${r.name}${r.lat}`} position={[r.lat, r.lng]} icon={icon(r)} zIndexOffset={r.type === 'dps_station' ? 500 : 0}>
          <Tooltip direction="top">
            <b>{r.name}</b>{r.address ? ` · ${r.address}` : ''}{r.phone ? <><br />📞 {r.phone}</> : null}
            {r.detail ? <><br /><span style={{ fontSize: 11 }}>{r.detail}</span></> : null}
            <br /><span style={{ opacity: 0.6, fontSize: 10 }}>{r.precision === 'approximate' ? 'Approximate position' : 'Exact position'} · {String(r.source ?? '').replace(/^https?:\/\/(www\.)?/, '').split('/')[0]}</span>
          </Tooltip>
        </Marker>
      ))}
    </>
  )
}

// ---- Recent DPS alerts (last 30 days, older ones fade; last 7 days pulse) + student reports (72 h) ----
const pulseIcon = L.divIcon({ className: '', iconSize: [36, 36], iconAnchor: [18, 18], html: '<span style="position:absolute;inset:0;border-radius:9999px;background:rgb(220 38 38 / .45)" class="ts-pulse"></span>' })
export function RecentAlertsLayer() {
  const dps = useQuery({ queryKey: ['dps-alerts'], queryFn: async () => (await fetch(`${API_URL}/api/dps-alerts`)).json() as Promise<{ alerts: { id: string; title: string; occurredAt: string | null; postedAt: string; location: string; lat: number; lng: number; precision: string; url: string }[] }>, refetchInterval: 10 * 60_000 })
  const reps = useQuery({ queryKey: ['reports'], queryFn: async () => (await fetch(`${API_URL}/api/reports?hours=72`)).json() as Promise<{ id: string; category: string; description: string; createdAt: string; lat: number; lng: number }[]>, refetchInterval: 60_000 })
  const since = Date.now() - 30 * 864e5
  const fade = (iso: string) => Math.max(0.35, 1 - (Date.now() - Date.parse(iso)) / (30 * 864e5))
  const hoursAgo = (iso: string) => { const h = Math.round((Date.now() - Date.parse(iso)) / 3600e3); return h < 48 ? `${h} h ago` : `${Math.round(h / 24)} days ago` }
  return (
    <>
      {dps.data?.alerts.filter((a) => Date.parse(a.occurredAt ?? a.postedAt) >= Date.now() - 7 * 864e5 && a.precision !== 'campus').map((a) => (
        <Marker key={`p${a.id}`} position={[a.lat, a.lng]} icon={pulseIcon} interactive={false} zIndexOffset={-100} />
      ))}
      {dps.data?.alerts.filter((a) => Date.parse(a.occurredAt ?? a.postedAt) >= since && a.precision !== 'campus').map((a) => (
        <CircleMarker key={a.id} center={[a.lat, a.lng]} radius={9} pathOptions={{ color: '#fff', weight: 2, fillColor: '#b91c1c', fillOpacity: fade(a.occurredAt ?? a.postedAt), opacity: fade(a.occurredAt ?? a.postedAt) }}>
          <Tooltip direction="top"><b>⚠ {a.title}</b> · {hoursAgo(a.occurredAt ?? a.postedAt)}<br />{a.location}<br /><span style={{ opacity: 0.7, fontSize: 10 }}>USC DPS alert{a.precision === 'street' ? ' · street-level location' : ''}</span></Tooltip>
        </CircleMarker>
      ))}
      {reps.data?.map((r) => (
        <CircleMarker key={r.id} center={[r.lat, r.lng]} radius={8} pathOptions={{ color: '#b91c1c', weight: 2, dashArray: '3 3', fillColor: '#fecaca', fillOpacity: 0.9 }}>
          <Tooltip direction="top"><b>{r.category}</b> · {hoursAgo(r.createdAt)}<br />{r.description}<br /><span style={{ opacity: 0.7, fontSize: 10 }}>Student report (unverified)</span></Tooltip>
        </CircleMarker>
      ))}
    </>
  )
}

// ---- Official USC Lyft Rides ("Fryft") boundaries: UPC, HSC, Union Station ----
const RIDE_ZONE_STYLE: Record<string, L.PathOptions> = {
  usc_lyft_upc: { color: '#db2777', weight: 2, fillColor: '#f472b6', fillOpacity: 0.08, dashArray: '6 4' },
  usc_lyft_hsc: { color: '#db2777', weight: 2, fillColor: '#f472b6', fillOpacity: 0.25 },
  usc_lyft_union_station: { color: '#db2777', weight: 2, fillColor: '#f472b6', fillOpacity: 0.25, dashArray: '3 3' },
}
const RIDE_ZONE_INFO: Record<string, string> = {
  usc_lyft_upc: 'USC Lyft Rides, UPC: free shared Lyft 7 PM–2 AM daily when pickup and drop-off are both inside.',
  usc_lyft_hsc: 'USC Lyft Rides, HSC: free shared Lyft 5 PM–2 AM Mon–Fri inside this boundary (needs the HSC Lyft Invite form). Traced from USC’s official HSC map.',
  usc_lyft_union_station: 'Union Station is part of the HSC Lyft program (rides to/from the HSC zone).',
}
export function RideZonesLayer({ focus }: { focus: 'hsc' | 'upc' | null }) {
  const q = useQuery({ queryKey: ['ride-zones'], queryFn: async () => (await fetch(`${API_URL}/api/ride-zones`)).json() as Promise<GeoJSON.FeatureCollection>, staleTime: Infinity })
  const map = useMap()
  useEffect(() => {
    if (!focus || !q.data) return
    const f = q.data.features.find((x) => x.properties?.name === `usc_lyft_${focus}`)
    if (f) map.flyToBounds(L.geoJSON(f).getBounds(), { paddingTopLeft: [310, 40], paddingBottomRight: [40, 40], duration: 0.8 })
  }, [focus, q.data, map])
  if (!q.data) return null
  return <GeoJSON data={q.data} style={(f) => RIDE_ZONE_STYLE[f?.properties?.name] ?? {}}
    onEachFeature={(f, layer) => layer.bindTooltip(RIDE_ZONE_INFO[f.properties?.name] ?? f.properties?.label, { sticky: true })} />
}

// ---- Live DPS units (simulated feed, server-sent events) ----
const carIcon = (heading: number) => L.divIcon({
  className: '',
  html: `<div style="transform:rotate(${heading}deg);width:22px;height:22px;display:grid;place-items:center"><svg width="16" height="22" viewBox="0 0 16 22"><rect x="1" y="1" width="14" height="20" rx="4" fill="#dc2626" stroke="#fff" stroke-width="1.5"/><rect x="3" y="4" width="10" height="4" rx="1" fill="#fecaca"/><rect x="4" y="11" width="3" height="2" fill="#2563eb"/><rect x="9" y="11" width="3" height="2" fill="#fff"/></svg></div>`,
  iconSize: [22, 22], iconAnchor: [11, 11],
})

export function DpsUnitsLayer() {
  const [units, setUnits] = useState<DpsUnit[]>([])
  useEffect(() => subscribeDpsUnits(setUnits), [])
  return (
    <>
      {units.map((u) => (
        <Marker key={u.id} position={[u.lat, u.lng]} icon={carIcon(-u.heading + 90)} zIndexOffset={1000}>
          <Tooltip direction="top">🚓 {u.callsign} · {u.status}<br /><span style={{ opacity: 0.7 }}>Simulated live position</span></Tooltip>
        </Marker>
      ))}
    </>
  )
}

// ---- Safest vs fastest route ----
export function RouteLayer({ result, start, end }: { result: RouteResult | undefined; start: [number, number] | null; end: [number, number] | null }) {
  const map = useMap()
  useEffect(() => {
    if (!result) return
    const pts = [...result.safest.coords, ...result.fastest.coords]
    map.fitBounds(L.latLngBounds(pts), { paddingTopLeft: [310, 40], paddingBottomRight: [40, 40], maxZoom: 17 })
  }, [result, map])
  return (
    <>
      {result && !result.sameRoute && <Polyline positions={result.fastest.coords} pathOptions={{ color: '#ffffff', weight: 8, opacity: 0.8 }} />}
      {result && !result.sameRoute && <Polyline positions={result.fastest.coords} pathOptions={{ color: COLORS.fastest, weight: 5, opacity: 0.85, dashArray: '10 7', className: 'route-fast' }}><Tooltip sticky>Fastest · {result.fastest.minutes} min</Tooltip></Polyline>}
      {result && <Polyline positions={result.safest.coords} pathOptions={{ color: '#ffffff', weight: 9, opacity: 0.9 }} />}
      {result && <Polyline key={`safe${result.safest.coords.length}${result.safest.coords[1]?.join()}`} positions={result.safest.coords} pathOptions={{ color: COLORS.safest, weight: 6, opacity: 1, className: 'route-safe' }}><Tooltip sticky>Safest · {result.safest.minutes} min</Tooltip></Polyline>}
      {result && [...result.fastest.darkStreetlights, ...result.safest.darkStreetlights].filter((o, i, a) => a.findIndex((x) => x.lat === o.lat && x.lng === o.lng) === i).map((o) => (
        <CircleMarker key={`dk${o.lat}${o.lng}`} center={[o.lat, o.lng]} radius={6} pathOptions={{ color: '#facc15', weight: 2, fillColor: '#1c1917', fillOpacity: 1 }}>
          <Tooltip direction="top">💡 Streetlight out · {o.address}<br /><span style={{ fontSize: 10, opacity: 0.7 }}>reported {o.reported} to LA 311 · {o.status}</span></Tooltip>
        </CircleMarker>
      ))}
      {result?.safest.openNow.map((o) => (
        <CircleMarker key={`op${o.lat}${o.lng}`} center={[o.lat, o.lng]} radius={5} pathOptions={{ color: '#fff', weight: 1.5, fillColor: '#f59e0b', fillOpacity: 1 }}>
          <Tooltip direction="top">🟡 Open: {o.name}<br /><span style={{ fontSize: 10, opacity: 0.7 }}>{o.hours}</span></Tooltip>
        </CircleMarker>
      ))}
      {start && <CircleMarker center={start} radius={8} pathOptions={{ color: '#fff', weight: 3, fillColor: '#111827', fillOpacity: 1 }}><Tooltip permanent direction="left">Start</Tooltip></CircleMarker>}
      {end && <CircleMarker center={end} radius={8} pathOptions={{ color: '#fff', weight: 3, fillColor: '#990000', fillOpacity: 1 }}><Tooltip permanent direction="right">Destination</Tooltip></CircleMarker>}
    </>
  )
}

export function ClickToPick({ active, onPick }: { active: boolean; onPick: (p: [number, number]) => void }) {
  useMapEvents({ click: (e) => { if (active) onPick([e.latlng.lat, e.latlng.lng]) } })
  return null
}
