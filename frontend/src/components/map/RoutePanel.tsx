import { useState } from 'react'
import { Link } from 'react-router'
import type { Building, RouteResult, RouteWeights } from '../../api/types'
import { googleMapsForRoute } from '../../lib/directions'
import TripOptions from '../free/TripOptions'
import PlaceInput from '../rides/PlaceInput'
import type { Place } from '../../lib/rides'
import RecentCheck from '../safety/RecentCheck'
import { useMe } from '../../lib/auth'

/** Route colors, used on the map and in this panel. */
export const ROUTE_COLORS = { safest: '#059669', fastest: '#2563eb' }

export const LEAVING = [
  { key: 'now', label: 'Now' }, { key: '21', label: '9 PM' }, { key: '23', label: '11 PM' }, { key: '1', label: '1 AM' },
] as const
export type Leaving = (typeof LEAVING)[number]['key']

interface Props {
  buildings: Building[]; start: Place | null; setStart: (p: Place | null) => void
  destId: number; setDestId: (id: number) => void; customDest: Place | null; setCustomDest: (p: Place | null) => void; end: [number, number] | null
  leaving: Leaving; setLeaving: (l: Leaving) => void; weights: RouteWeights; setWeights: (w: RouteWeights) => void
  picking: 'from' | 'to' | null; setPicking: (v: 'from' | 'to' | null) => void; onPreview: (p: Place | null) => void
  result: RouteResult | undefined; loading: boolean; error: string | null
}

const WEIGHT_INFO: { key: keyof RouteWeights; label: string; short: string; hint: string }[] = [
  { key: 'incidents', label: 'Avoid reported crime', short: 'Crime', hint: 'LAPD incidents near each block' },
  { key: 'dps', label: 'Stay inside DPS patrol', short: 'DPS', hint: 'USC DPS patrols UPC and HSC' },
  { key: 'light', label: 'Avoid dark streets', short: 'Light', hint: 'Open streetlight-out reports (LA 311)' },
  { key: 'people', label: 'Prefer people around', short: 'People', hint: 'Places open at that time, busy streets' },
]
const level = (v: number) => (v === 0 ? 'off' : v < 1 ? 'low' : v === 1 ? 'normal' : v < 2.5 ? 'high' : 'max')

function Row({ label, fast, safe, better, note }: { label: React.ReactNode; fast: React.ReactNode; safe: React.ReactNode; better?: 'safe' | 'fast' | null; note?: string }) {
  return (
    <tr className="border-t border-stone-100 align-top">
      <td className="py-1.5 pr-2 text-stone-600">{label}{note && <div className="text-[10px] text-stone-400">{note}</div>}</td>
      <td className={`px-1 py-1.5 text-center font-semibold ${better === 'fast' ? 'text-blue-700' : ''}`}>{fast}{better === 'fast' && ' ✓'}</td>
      <td className={`px-1 py-1.5 text-center font-semibold ${better === 'safe' ? 'text-emerald-700' : ''}`}>{safe}{better === 'safe' && ' ✓'}</td>
    </tr>
  )
}
/** which side is better (lower is better unless lowerBetter = false) */
const cmp = (f: number, s: number, lowerBetter = true): 'safe' | 'fast' | null => (f === s ? null : (s < f) === lowerBetter ? 'safe' : 'fast')

function Compare({ r }: { r: RouteResult }) {
  const f = r.fastest, s = r.safest
  const [show, setShow] = useState<'dark' | 'open' | null>(null)
  const toggle = (k: 'dark' | 'open') => setShow(show === k ? null : k)
  return (
    <div className="rounded-xl bg-white p-2 text-xs ring-1 ring-stone-200">
      <table className="w-full">
        <thead>
          <tr className="text-[11px]">
            <th className="pb-1 text-left font-medium text-stone-500">What we measured</th>
            <th className="px-1 pb-1 text-center"><span className="inline-flex items-center gap-1 font-bold text-blue-700"><span className="h-1.5 w-4 rounded-full" style={{ background: ROUTE_COLORS.fastest }} />Fastest</span></th>
            <th className="px-1 pb-1 text-center"><span className="inline-flex items-center gap-1 font-bold text-emerald-700"><span className="h-1.5 w-4 rounded-full" style={{ background: ROUTE_COLORS.safest }} />Safest</span></th>
          </tr>
        </thead>
        <tbody>
          <Row label="Walk" fast={`${f.minutes} min`} safe={`${s.minutes} min`} better={cmp(f.minutes, s.minutes)} note={`${(f.distanceM / 1609).toFixed(2)} vs ${(s.distanceM / 1609).toFixed(2)} mi`} />
          <Row label="Inside DPS patrol" fast={`${f.pctInsideDps}%`} safe={`${s.pctInsideDps}%`} better={cmp(f.pctInsideDps, s.pctInsideDps, false)} />
          <Row label={<button onClick={() => toggle('dark')} className="text-left underline decoration-dotted">Broken streetlights {show === 'dark' ? '▴' : '▾'}</button>}
            fast={f.darkStreetlights.length} safe={s.darkStreetlights.length} better={cmp(f.darkStreetlights.length, s.darkStreetlights.length)} note={r.night ? 'open LA 311 reports on the way' : 'shown now, weighted only after dark'} />
          <Row label="Streets tagged lit" fast={`${f.pctLit}%`} safe={`${s.pctLit}%`} better={cmp(f.pctLit, s.pctLit, false)} note="OpenStreetMap; many streets are untagged" />
          <Row label={<button onClick={() => toggle('open')} className="text-left underline decoration-dotted">Places open on the way {show === 'open' ? '▴' : '▾'}</button>}
            fast={f.openNow.length} safe={s.openNow.length} better={cmp(f.openNow.length, s.openNow.length, false)} note="at your departure time" />
          <Row label="Busy streets" fast={`${f.pctBusy}%`} safe={`${s.pctBusy}%`} better={cmp(f.pctBusy, s.pctBusy, false)} />
          <Row label="Emergency phones" fast={f.emergencyPhones.length} safe={s.emergencyPhones.length} better={cmp(f.emergencyPhones.length, s.emergencyPhones.length, false)} />
        </tbody>
      </table>
      {show === 'dark' && (
        <ul className="mt-2 max-h-40 space-y-1 overflow-y-auto rounded-lg bg-stone-50 p-2">
          {s.darkStreetlights.length === 0 && <li className="text-stone-500">None reported on the safest route.</li>}
          {s.darkStreetlights.map((o) => <li key={o.address + o.reported + o.lat}>💡 <b>{o.address || 'Streetlight'}</b> · reported {o.reported} · {o.status}</li>)}
        </ul>
      )}
      {show === 'open' && (
        <ul className="mt-2 max-h-40 space-y-1 overflow-y-auto rounded-lg bg-stone-50 p-2">
          {s.openNow.length === 0 && <li className="text-stone-500">Nothing with published hours is open on the safest route at that time.</li>}
          {s.openNow.map((o) => <li key={o.name + o.lat}>🟡 <b>{o.name}</b> <span className="text-stone-500">· {o.kind} · {o.hours}</span></li>)}
        </ul>
      )}
    </div>
  )
}

export default function RoutePanel(p: Props) {
  const me = useMe()
  const contacts = me.data?.contacts ?? []
  const [tune, setTune] = useState(false)
  const r = p.result
  const destLabel = p.customDest?.label ?? p.buildings.find((b) => b.id === p.destId)?.name ?? 'your destination'
  const home = me.data?.home
  const fromQuick: Place[] = [
    ...(home ? [{ ...home, label: `Home · ${home.label.split(',')[0]}` }] : []),
    { lat: 34.0256, lng: -118.2853, label: 'USC Village' }, { lat: 34.0287, lng: -118.2726, label: 'The Lorenzo' }, { lat: 34.0622, lng: -118.2035, label: 'HSC (Keck)' },
  ]
  return (
    <div className="space-y-3 text-sm">
      <PlaceInput label="From" dot="🟢" value={p.start} onChange={p.setStart} quick={fromQuick} myLocation
        picking={p.picking === 'from'} onPickMap={() => p.setPicking(p.picking === 'from' ? null : 'from')} onPreview={p.onPreview} />
      <div>
        <div className="mb-1 text-xs font-semibold text-stone-500">To</div>
        {p.customDest ? (
          <div className="flex items-center justify-between rounded-lg bg-stone-50 px-3 py-2 ring-1 ring-stone-200">
            <span className="truncate font-medium">🔴 {p.customDest.label}</span>
            <button onClick={() => p.setCustomDest(null)} className="ml-2 text-xs text-stone-500 hover:text-cardinal">change</button>
          </div>
        ) : (
          <>
            <select value={p.destId} onChange={(e) => p.setDestId(+e.target.value)} className="w-full rounded-lg border border-stone-300 bg-white px-2 py-2">
              {(['UPC', 'HSC'] as const).map((c) => (
                <optgroup key={c} label={c === 'UPC' ? 'University Park Campus' : 'Health Sciences Campus'}>
                  {p.buildings.filter((b) => (b.campus ?? 'UPC') === c).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </optgroup>
              ))}
            </select>
            <div className="mt-1.5">
              <PlaceInput label="Or anywhere else" dot="🔴" value={null} onChange={(x) => x && p.setCustomDest(x)}
                picking={p.picking === 'to'} onPickMap={() => p.setPicking(p.picking === 'to' ? null : 'to')} onPreview={p.onPreview}
                quick={[{ lat: 34.0562, lng: -118.2365, label: 'Union Station' }, { lat: 34.0287, lng: -118.2726, label: 'The Lorenzo' }]} />
            </div>
          </>
        )}
      </div>

      <div>
        <div className="mb-1 flex items-center justify-between text-xs font-semibold text-stone-500"><span>Leaving</span>{r && <span className="font-normal">{r.night ? '🌙 after dark' : '☀️ daytime'}</span>}</div>
        <div className="grid grid-cols-4 overflow-hidden rounded-lg text-xs font-semibold ring-1 ring-stone-300">
          {LEAVING.map((l) => <button key={l.key} onClick={() => p.setLeaving(l.key)} className={`py-1.5 ${p.leaving === l.key ? 'bg-cardinal text-white' : 'bg-white hover:bg-stone-50'}`}>{l.label}</button>)}
        </div>
      </div>

      <div className="rounded-xl bg-stone-50 p-2.5 ring-1 ring-stone-200">
        <button onClick={() => setTune(!tune)} className="flex w-full items-center justify-between text-xs font-semibold">
          <span>⚖️ What “safest” means to you</span><span className="text-stone-400">{tune ? 'hide' : 'adjust'}</span>
        </button>
        {!tune && <div className="mt-1.5 flex flex-wrap gap-1">{WEIGHT_INFO.map((x) => <span key={x.key} className="rounded-full bg-white px-2 py-0.5 text-[10px] ring-1 ring-stone-200">{x.short}: <b>{level(p.weights[x.key])}</b></span>)}</div>}
        {tune && (
          <div className="mt-2 space-y-2">
            {WEIGHT_INFO.map((x) => (
              <label key={x.key} className="block text-xs">
                <span className="flex justify-between"><span className="font-medium">{x.label}</span><b>{level(p.weights[x.key])}</b></span>
                <input type="range" min={0} max={3} step={0.5} value={p.weights[x.key]} onChange={(e) => p.setWeights({ ...p.weights, [x.key]: +e.target.value })} className="w-full accent-cardinal" />
                <span className="text-[10px] text-stone-400">{x.hint}</span>
              </label>
            ))}
            <button onClick={() => p.setWeights({ incidents: 1, dps: 1, light: 1, people: 1 })} className="text-[11px] font-semibold text-stone-500 hover:text-cardinal">Reset to normal</button>
          </div>
        )}
      </div>

      {p.loading && <div className="h-24 animate-pulse rounded-xl bg-stone-100" />}
      {p.error && (/Too far to walk/i.test(p.error)
        ? <p className="rounded-lg bg-amber-50 p-2 text-xs text-amber-900 ring-1 ring-amber-200">🚶 {p.error}</p>
        : /outside the mapped area|No walkable path/i.test(p.error)
        ? <p className="rounded-lg bg-stone-50 p-2 text-xs text-stone-600">That’s beyond walking range of the streets we map around UPC and HSC, so use one of the options below. “Safest walk to the stop” routes you to the shuttle safely.</p>
        : <p className="rounded-lg bg-red-50 p-2 text-xs text-red-700">{p.error}</p>)}
      {!p.start && !p.loading && <p className="rounded-lg bg-stone-50 p-2 text-xs text-stone-500">Choose where you’re starting: search, tap a shortcut, use your location, or pick on the map (or press “Safest walk” on a listing).</p>}

      {r && (
        <div className="space-y-2">
          <p className="rounded-lg bg-emerald-50 p-2 text-xs font-medium text-emerald-900 ring-1 ring-emerald-200">{r.summary}</p>
          <Compare r={r} />
          <div className="grid grid-cols-2 gap-2">
            <a href={googleMapsForRoute(r.safest.coords)} target="_blank" rel="noreferrer" className="rounded-lg px-2 py-2 text-center text-xs font-semibold !text-white" style={{ background: ROUTE_COLORS.safest }}>🧭 Safest in Maps ↗</a>
            <a href={googleMapsForRoute(r.fastest.coords)} target="_blank" rel="noreferrer" className="rounded-lg px-2 py-2 text-center text-xs font-semibold !text-white" style={{ background: ROUTE_COLORS.fastest }}>🧭 Fastest in Maps ↗</a>
          </div>
          {r.safest.streets.length > 0 && <p className="text-[11px] text-stone-500">Safest goes via {r.safest.streets.slice(0, 5).join(' → ')}</p>}
          {contacts.length > 0 ? (
            <div className="flex flex-wrap items-center gap-1.5 text-xs"><span className="text-stone-500">Text my route & ETA to</span>
              {contacts.slice(0, 3).map((c) => (
                <a key={c.id} href={`sms:${c.phone.replace(/[^\d+]/g, '')}?&body=${encodeURIComponent(`Walking now, ETA ~${r.safest.minutes} min. My route: ${googleMapsForRoute(r.safest.coords)}`)}`}
                  className="rounded-full bg-white px-2 py-0.5 font-semibold text-cardinal ring-1 ring-stone-300">💬 {c.name}</a>
              ))}
            </div>
          ) : me.data ? <Link to="/profile" className="block text-xs text-stone-500 hover:text-cardinal">Add an emergency contact to text them this route →</Link> : null}
          <details className="rounded-lg bg-stone-50 p-2 text-[11px] text-stone-600">
            <summary className="cursor-pointer font-semibold">ⓘ How is the safest route chosen?</summary>
            <p className="mt-1">{r.method}</p>
            <ul className="mt-1 space-y-1">
              {r.parameters.map((x) => <li key={x.key}><b>{x.label}</b> (weight {x.weight}): {x.effect}. <span className="text-stone-400">Data: {x.source}.</span></li>)}
            </ul>
          </details>
        </div>
      )}
      {/* after the routes: what happened there today, then the free and shared alternatives */}
      {(p.end || p.start) && (
        <div className="space-y-1.5">
          {p.end && <RecentCheck at={p.end} label={destLabel} compact collapsible />}
          {p.start && <RecentCheck at={[p.start.lat, p.start.lng]} label="your start" compact collapsible />}
        </div>
      )}
      <TripOptions from={p.start ? [p.start.lat, p.start.lng] : null} to={p.end} onWalkTo={(pt, label) => p.setCustomDest({ lat: pt[0], lng: pt[1], label })} />
      {p.start && p.end && (
        <Link to={`/rides?from=${p.start.lat},${p.start.lng}&fromLabel=${encodeURIComponent(p.start.label)}&to=${p.end[0]},${p.end[1]}&toLabel=${encodeURIComponent(destLabel)}`}
          className="flex items-center justify-between rounded-xl bg-ink px-3 py-2.5 text-xs font-semibold !text-white hover:bg-stone-800">
          <span>🚗 Share a ride on this trip<span className="block text-[11px] font-normal text-stone-300">See friends and students going the same way</span></span><span>→</span>
        </Link>
      )}
    </div>
  )
}
