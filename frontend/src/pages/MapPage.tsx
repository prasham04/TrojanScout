import { useCallback, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router'
import { MapContainer } from 'react-leaflet'
import { motion } from 'motion/react'
import { ChevronDown, ChevronUp, Layers, Moon, Scale, ShieldCheck, Sun } from 'lucide-react'
import Basemap from '../components/map/Basemap'
import { useQuery } from '@tanstack/react-query'
import { API_URL, api } from '../api/client'
import type { ListingV2, RouteWeights } from '../api/types'
import type { Place } from '../lib/rides'
import { useAppStore } from '../store/useAppStore'
import ZoneLayer from '../components/map/ZoneLayer'
import ListingMarker from '../components/map/ListingMarker'
import BuildingMarker from '../components/map/BuildingMarker'
import CompareSidebar, { COMPARE_SIZES } from '../components/map/CompareSidebar'
import RoutePanel, { type Leaving } from '../components/map/RoutePanel'
import { CircleMarker, Tooltip } from 'react-leaflet'
import FlyTo from '../components/map/FitBounds'
import { ClickToPick, COLORS, DpsUnitsLayer, IncidentLayer, RecentAlertsLayer, RideZonesLayer, RouteLayer, SafetyLayer } from '../components/map/layers'
import ReportForm from '../components/safety/ReportForm'
import InfoTip from '../components/ui/InfoTip'
import { EXPLAIN } from '../lib/explain'
import { money } from '../lib/format'

export const USC: [number, number] = [34.0224, -118.2851]

export default function MapPage() {
  const [params, setParams] = useSearchParams()
  const focusId = params.get('focus')
  const { compareIds, highlightedIds, profile, compareWidth, setCompareWidth } = useAppStore()
  const [tab, setTab] = useState<'layers' | 'route'>(params.get('mode') === 'route' ? 'route' : 'layers')
  const [layers, setLayers] = useState({ zone: true, incidents: false, police: true, phones: true, medical: true, recent: true, units: true, lyft: true })
  const [maxRent, setMaxRent] = useState(4000)
  const [insideOnly, setInsideOnly] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(() => window.innerWidth >= 1024)  // tablets: map first, compare on demand
  // phones: start collapsed so the map is visible first (the panel would otherwise cover it)
  const [panelOpen, setPanelOpen] = useState(() => window.innerWidth >= 640 || params.get('mode') === 'route')
  // night map after 7 PM (LA time) unless you switch it
  const [night, setNight] = useState(() => { const h = +new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles', hour: 'numeric', hourCycle: 'h23' }); return h >= 19 || h < 6 })
  const [zoneFocus, setZoneFocus] = useState<'hsc' | 'upc' | null>(null)
  const [reporting, setReporting] = useState<'off' | 'pick' | [number, number]>('off')

  // safe-route state
  const [start, setStart] = useState<Place | null>(null)
  const [destId, setDestId] = useState(profile.buildingIds[0] ?? 9)
  const [customDest, setCustomDest] = useState<Place | null>(null)
  const [leaving, setLeaving] = useState<Leaving>('now')
  const [weights, setWeights] = useState<RouteWeights>({ incidents: 1, dps: 1, light: 1, people: 1 })
  const [picking, setPicking] = useState<'from' | 'to' | null>(null)
  const [preview, setPreview] = useState<Place | null>(null)
  // departure time: now, or tonight at 9 PM / 11 PM / 1 AM (LA time)
  const departAt = useMemo(() => {
    if (leaving === 'now') return new Date()
    const h = +leaving, d = new Date()
    const la = new Date(d.toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }))
    const t = new Date(d.getTime() + ((h - la.getHours() + 24) % 24) * 3600e3 - la.getMinutes() * 60e3)
    return t
  }, [leaving])

  const zones = useQuery({ queryKey: ['zones'], queryFn: api.zones })
  const buildings = useQuery({ queryKey: ['buildings'], queryFn: api.buildings })
  const listings = useQuery({ queryKey: ['listings'], queryFn: () => api.listings() })
  const building = buildings.data?.find((b) => b.id === destId)
  const dest = customDest ?? building
  const route = useQuery({
    queryKey: ['route', start?.lat, start?.lng, dest?.lat, dest?.lng, leaving, weights],
    queryFn: () => api.route([start!.lat, start!.lng], [dest!.lat, dest!.lng], departAt, weights),
    placeholderData: (prev) => prev,
    enabled: !!start && !!dest,
  })

  const shown = useMemo(() => (listings.data ?? []).filter((l) =>
    (maxRent >= 4000 || (l.rent != null && l.rent <= maxRent)) && (!insideOnly || l.inDps)), [listings.data, maxRent, insideOnly])
  const highlightSet = new Set([...(params.get('ids')?.split(',') ?? []), ...highlightedIds])
  const focused = listings.data?.find((l) => l.id === focusId)

  const safeRouteFrom = useCallback((l: ListingV2) => {
    setStart({ lat: l.lat, lng: l.lng, label: l.name }); setTab('route'); setPanelOpen(true); setPicking(null)
  }, [])

  // drag the compare panel's left edge to resize
  const dragging = useRef(false)
  const [dragW, setDragW] = useState<number | null>(null)
  const onDrag = (e: React.PointerEvent) => {
    dragging.current = true
    const move = (ev: PointerEvent) => { if (dragging.current) setDragW(Math.min(760, Math.max(340, window.innerWidth - ev.clientX))) }
    const up = (ev: PointerEvent) => {
      dragging.current = false
      const w = window.innerWidth - ev.clientX  // snap to the nearest size so the table always lays out cleanly
      setCompareWidth(COMPARE_SIZES.reduce((a, b) => (Math.abs(b - w) < Math.abs(a - w) ? b : a)))
      setDragW(null)
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up)
    e.preventDefault()
  }

  const toggle = (k: keyof typeof layers) => setLayers({ ...layers, [k]: !layers[k] })
  return (
    <div className="relative flex h-full">
      {/* while picking, markers and zones ignore clicks so the click always lands on the map */}
      <div className={`relative min-w-0 flex-1 ${night ? 'map-night' : ''} ${picking || reporting === 'pick' ? 'map-picking cursor-crosshair' : ''}`}>
        <MapContainer center={USC} zoom={15} className="h-full w-full" zoomControl={false}>
          <Basemap extraAttribution=" · incidents: LAPD" night={night} />
          {zones.data && layers.zone && <ZoneLayer data={zones.data} visible={{ DPS: true, DPS_HSC: true }} />}
          {layers.lyft && <RideZonesLayer focus={zoneFocus} />}
          {layers.incidents && <IncidentLayer days={180} />}
          <SafetyLayer show={{ police: layers.police, phones: layers.phones, medical: layers.medical }} />
          {layers.recent && <RecentAlertsLayer />}
          {buildings.data?.map((b) => <BuildingMarker key={b.id} building={b} chosen={profile.buildingIds.includes(b.id)} />)}
          {shown.map((l) => (
            <ListingMarker key={l.id} listing={l} focused={l.id === focusId} highlighted={highlightSet.has(l.id)} comparing={compareIds.includes(l.id)} onSafeRoute={safeRouteFrom} />
          ))}
          {tab === 'route' && <RouteLayer result={route.data} start={start ? [start.lat, start.lng] : null} end={dest && start ? [dest.lat, dest.lng] : null} />}
          {preview && <CircleMarker center={[preview.lat, preview.lng]} radius={10} pathOptions={{ color: '#990000', weight: 3, fillColor: '#ffc72c', fillOpacity: 1 }}><Tooltip permanent direction="top" offset={[0, -8]}>{preview.label}</Tooltip></CircleMarker>}
          {layers.units && <DpsUnitsLayer />}
          <ClickToPick active={tab === 'route' && !!picking} onPick={async (p) => {
            const set = picking === 'to' ? setCustomDest : setStart
            setPicking(null)
            set({ lat: p[0], lng: p[1], label: 'Dropped pin' })
            try {  // name the spot you clicked
              const r = await (await fetch(`${API_URL}/api/places/reverse?lat=${p[0]}&lng=${p[1]}`)).json()
              if (r.label) set({ lat: p[0], lng: p[1], label: [r.label, (r.detail || '').split(',')[0]].filter(Boolean).join(', ') })
            } catch { /* keep "Dropped pin" */ }
          }} />
          <ClickToPick active={reporting === 'pick'} onPick={(p) => setReporting(p)} />
          <FlyTo target={focused ? [focused.lat, focused.lng] : null} />
        </MapContainer>

        {/* Floating control panel: Layers | Safe route */}
        <motion.div layout transition={{ type: 'spring', stiffness: 360, damping: 34 }}
          className={`glass-solid absolute left-3 top-3 z-[500] max-w-[calc(100%-1.5rem)] overflow-hidden rounded-3xl ${tab === 'route' && panelOpen ? 'w-[23rem]' : 'w-72'}`}>
          <div className="flex items-center gap-1 border-b border-stone-900/10 p-1.5 text-sm font-semibold">
            {(['layers', 'route'] as const).map((t) => (
              <button key={t} onClick={() => { setTab(t); setPanelOpen(true) }} className={`relative flex flex-1 items-center justify-center gap-1.5 rounded-2xl py-2 transition ${tab === t && panelOpen ? 'text-white' : 'text-stone-600 hover:bg-white/60'}`}>
                {tab === t && panelOpen && <motion.span layoutId="map-tab" className="absolute inset-0 rounded-2xl bg-gradient-to-br from-cardinal to-cardinal-dark shadow-md shadow-cardinal/30" transition={{ type: 'spring', stiffness: 420, damping: 34 }} />}
                <span className="relative flex items-center gap-1.5">{t === 'layers' ? <><Layers size={15} />Layers</> : <><ShieldCheck size={15} />Safe route</>}</span>
              </button>
            ))}
            <button onClick={() => setPanelOpen(!panelOpen)} className="grid h-8 w-8 place-items-center rounded-full text-stone-500 hover:bg-white/60" aria-label="Collapse">{panelOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}</button>
          </div>
          {panelOpen && (
            <div className="max-h-[calc(100vh-11rem)] overflow-y-auto p-4">
              {tab === 'layers' ? (
                <div className="space-y-3 text-sm">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-xs text-stone-500">{shown.length} of {listings.data?.length ?? 0} listings</span>
                    <span className="flex gap-1 text-[11px] font-semibold">
                      <button onClick={() => setLayers(Object.fromEntries(Object.keys(layers).map((k) => [k, true])) as typeof layers)} className="rounded-full px-2 py-0.5 text-cardinal ring-1 ring-cardinal/30 hover:bg-cardinal/5">Select all</button>
                      <button onClick={() => setLayers(Object.fromEntries(Object.keys(layers).map((k) => [k, false])) as typeof layers)} className="rounded-full px-2 py-0.5 text-stone-500 ring-1 ring-stone-300 hover:bg-stone-50">Unselect all</button>
                    </span>
                  </div>
                  <label className="flex cursor-pointer items-center gap-2"><input type="checkbox" checked={layers.zone} onChange={() => toggle('zone')} className="accent-cardinal" />
                    <span className="inline-block h-3 w-5 rounded-sm border-2 border-cardinal" />DPS patrol zones <InfoTip>{EXPLAIN.dps}</InfoTip></label>
                  <div className="flex items-center gap-2">
                    <label className="flex cursor-pointer items-center gap-2"><input type="checkbox" checked={layers.lyft} onChange={() => toggle('lyft')} className="accent-cardinal" />
                      <span className="inline-block h-3 w-5 rounded-sm border-2 border-pink-600 bg-pink-200" />Free USC Lyft zones <InfoTip>{EXPLAIN.fryft}</InfoTip></label>
                    <span className="ml-auto flex gap-1 text-[11px] font-semibold">
                      {(['upc', 'hsc'] as const).map((z) => <button key={z} onClick={() => { setLayers({ ...layers, lyft: true }); setZoneFocus(null); setTimeout(() => setZoneFocus(z), 0) }} className="rounded-full px-2 py-0.5 text-pink-700 ring-1 ring-pink-300 hover:bg-pink-50">{z.toUpperCase()}</button>)}
                    </span>
                  </div>
                  <label className="flex cursor-pointer items-center gap-2"><input type="checkbox" checked={layers.units} onChange={() => toggle('units')} className="accent-cardinal" />
                    <span className="inline-block h-3 w-3 rounded-sm" style={{ background: COLORS.dps }} />DPS units, live <span className="text-[10px] text-stone-400">(simulated)</span></label>
                  <label className="flex cursor-pointer items-center gap-2"><input type="checkbox" checked={layers.incidents} onChange={() => toggle('incidents')} className="accent-cardinal" />
                    <span className="inline-block h-3 w-3 rounded-full bg-orange-500" />LAPD incidents (6 mo) <InfoTip>{EXPLAIN.incidents} Bigger, darker dots = more reports at that block; red = includes violent/weapon incidents.</InfoTip></label>
                  <label className="flex cursor-pointer items-center gap-2"><input type="checkbox" checked={layers.recent} onChange={() => toggle('recent')} className="accent-cardinal" />
                    <span className="inline-block h-3 w-3 rounded-full bg-red-700 ring-2 ring-white" />DPS alerts (30 days) & student reports <InfoTip>Crime alerts USC DPS posted on dps.usc.edu, placed from the location in the alert (intersection, block or building). Dashed pink dots are unverified student reports from the last 72 hours.</InfoTip></label>
                  <label className="flex cursor-pointer items-center gap-2"><input type="checkbox" checked={layers.police} onChange={() => toggle('police')} className="accent-cardinal" />
                    <span className="rounded bg-blue-900 px-1 text-[9px] font-bold text-white">LAPD</span>Police & DPS stations</label>
                  <label className="flex cursor-pointer items-center gap-2"><input type="checkbox" checked={layers.phones} onChange={() => toggle('phones')} className="accent-cardinal" />
                    <span className="inline-block h-3 w-3 rounded-full bg-blue-600" />Blue-light emergency phones</label>
                  <label className="flex cursor-pointer items-center gap-2"><input type="checkbox" checked={layers.medical} onChange={() => toggle('medical')} className="accent-cardinal" />
                    <span className="rounded bg-emerald-600 px-1 text-[9px] font-bold text-white">✚</span>Clinics & 💊 health vending</label>
                  {reporting === 'off' && <button onClick={() => setReporting('pick')} className="w-full rounded-lg py-1.5 text-xs font-semibold text-cardinal ring-1 ring-cardinal/40 hover:bg-cardinal/5">⚠ Report something on the map</button>}
                  {reporting === 'pick' && <p className="rounded-lg bg-amber-50 p-2 text-xs text-amber-800">Click the spot on the map. <button onClick={() => setReporting('off')} className="font-semibold underline">Cancel</button></p>}
                  {Array.isArray(reporting) && <ReportForm at={reporting} onDone={() => setReporting('off')} />}
                  <hr className="border-stone-200" />
                  <div>
                    <div className="flex justify-between text-xs"><span className="font-medium">Max price</span><span>{maxRent >= 4000 ? 'Any' : money(maxRent)}</span></div>
                    <input type="range" min={600} max={4000} step={50} value={maxRent} onChange={(e) => setMaxRent(+e.target.value)} className="w-full accent-cardinal" />
                  </div>
                  <label className="flex cursor-pointer items-center gap-2"><input type="checkbox" checked={insideOnly} onChange={(e) => setInsideOnly(e.target.checked)} className="accent-cardinal" />Only inside the zone</label>
                  <div className="space-y-1 text-xs text-stone-500">
                    <div><span className="mr-1.5 inline-block h-2.5 w-2.5 rounded-full align-middle" style={{ background: COLORS.inside }} />Inside zone <span className="ml-3 mr-1.5 inline-block h-2.5 w-2.5 rounded-full align-middle" style={{ background: COLORS.outside }} />Outside zone</div>
                  </div>
                  {params.get('ids') && <button onClick={() => { params.delete('ids'); setParams(params) }} className="text-xs font-medium text-cardinal">Clear highlighted results</button>}
                </div>
              ) : (
                <RoutePanel buildings={buildings.data ?? []} start={start} setStart={setStart} destId={destId} setDestId={(id) => { setCustomDest(null); setDestId(id) }}
                  customDest={customDest} setCustomDest={setCustomDest} end={dest ? [dest.lat, dest.lng] : null}
                  leaving={leaving} setLeaving={setLeaving} weights={weights} setWeights={setWeights}
                  picking={picking} setPicking={setPicking} onPreview={setPreview}
                  result={start ? route.data : undefined} loading={route.isFetching} error={route.error ? (route.error as Error).message : null} />
              )}
            </div>
          )}
        </motion.div>

        {/* below 1024px: bottom-left, so they never cover the Layers / Safe route panel */}
        <div className="absolute bottom-8 left-3 z-[500] flex gap-2 lg:bottom-auto lg:left-auto lg:right-3 lg:top-3">
          <button onClick={() => setNight(!night)} title={night ? 'Switch to the day map' : 'Switch to the night map'}
            className={`glass-solid flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-semibold transition ${night ? '!bg-[#1b1b2b]/80 text-gold' : 'text-stone-700'}`}>
            {night ? <Moon size={15} /> : <Sun size={15} />}{night ? 'Night' : 'Day'}
          </button>
          <button onClick={() => setSidebarOpen(!sidebarOpen)} className="glass-solid flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-semibold text-stone-700">
            <Scale size={15} /><span className="sm:hidden">{sidebarOpen ? 'Hide' : compareIds.length}</span><span className="hidden sm:inline">{sidebarOpen ? 'Hide compare' : `Compare (${compareIds.length})`}</span>
          </button>
        </div>
      </div>

      {sidebarOpen && (
        <aside className="absolute inset-x-0 bottom-0 z-[600] h-[55%] overflow-hidden rounded-t-3xl border-t border-stone-200 bg-white/90 shadow-[0_-20px_60px_-20px_rgba(0,0,0,.35)] backdrop-blur-xl md:relative md:h-auto md:rounded-none md:border-l md:border-t-0 md:bg-white/80 md:shadow-none"
          style={{ width: window.innerWidth >= 768 ? (dragW ?? compareWidth) : undefined, transition: dragW ? 'none' : 'width 180ms ease' }}>
          <div onPointerDown={onDrag} onDoubleClick={() => setCompareWidth(COMPARE_SIZES[0])} title="Drag to resize (snaps to S / M / L) · double-click to reset"
            className="group absolute -left-2 top-0 z-10 hidden h-full w-4 cursor-col-resize md:block">
            <div className={`mx-auto h-full w-px ${dragW ? 'bg-cardinal' : 'bg-stone-200 group-hover:bg-cardinal'}`} />
            <div className={`absolute left-1/2 top-1/2 grid h-12 w-4 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border bg-white text-[9px] leading-none shadow-sm ${dragW ? 'border-cardinal text-cardinal' : 'border-stone-300 text-stone-400 group-hover:border-cardinal group-hover:text-cardinal'}`}>⋮</div>
            {dragW && <div className="absolute left-5 top-1/2 rounded bg-ink px-1.5 py-0.5 text-[10px] text-white">{Math.round(dragW)}px</div>}
          </div>
          <div className="mx-auto mt-2 h-1.5 w-10 rounded-full bg-stone-300 md:hidden" aria-hidden />
          <CompareSidebar onFocus={(id) => setParams({ focus: id })} />
        </aside>
      )}
    </div>
  )
}
