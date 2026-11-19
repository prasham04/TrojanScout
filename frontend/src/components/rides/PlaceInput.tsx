import { useEffect, useRef, useState } from 'react'
import { API_URL } from '../../api/client'
import type { Place } from '../../lib/rides'

interface Suggestion { label: string; detail: string; lat: number; lng: number; kind: string; inDps: boolean }

const ICON: Record<string, string> = {
  university: '🎓', college: '🎓', hospital: '🏥', clinic: '🏥', supermarket: '🛒', retail: '🛍', aerodrome: '✈️', station: '🚉',
  train_station: '🚉', restaurant: '🍽', cafe: '☕', house: '🏠', apartments: '🏢', residential: '🛣', primary: '🛣', secondary: '🛣',
  tertiary: '🛣', pier: '🌊', park: '🌳', townhall: '🏛',
}

/** Address box with live suggestions from all of LA County (OpenStreetMap via Photon). Hovering a suggestion previews it on the map. */
export default function PlaceInput({ label, value, onChange, quick, onPickMap, picking, onPreview, dot, myLocation }: {
  label: string; value: Place | null; onChange: (p: Place | null) => void; quick: Place[]
  onPickMap: () => void; picking: boolean; onPreview: (p: Place | null) => void; dot?: string; myLocation?: boolean
}) {
  const showHere = myLocation ?? label === 'Pickup'
  const icon = dot ?? (label === 'Pickup' ? '🟢' : '🔴')
  const [text, setText] = useState('')
  const [hits, setHits] = useState<Suggestion[]>([])
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')
  const timer = useRef<number | undefined>(undefined)

  useEffect(() => {
    window.clearTimeout(timer.current)
    if (text.trim().length < 2) { setHits([]); return }
    timer.current = window.setTimeout(async () => {  // debounce: one request after you pause typing
      setLoading(true)
      try {
        const r = await fetch(`${API_URL}/api/places?q=${encodeURIComponent(text)}`)
        const j: Suggestion[] = await r.json()
        setHits(j); setActive(0); setOpen(true); setErr(j.length ? '' : 'No matching place in the LA area')
      } catch { setErr('Place search unavailable') } finally { setLoading(false) }
    }, 280)
  }, [text])

  const choose = (s: Suggestion) => {
    onChange({ lat: s.lat, lng: s.lng, label: [s.label, s.detail.split(',')[0]].filter(Boolean).join(', ') })
    setText(''); setHits([]); setOpen(false); onPreview(null)
  }
  const here = () => navigator.geolocation?.getCurrentPosition(
    (p) => onChange({ lat: p.coords.latitude, lng: p.coords.longitude, label: 'My location' }), () => setErr('Location not available'))

  return (
    <div>
      <div className="mb-1 text-xs font-semibold text-stone-500">{label}</div>
      {value ? (
        <div className="flex items-center justify-between rounded-lg bg-stone-50 px-3 py-2 text-sm ring-1 ring-stone-200">
          <span className="truncate font-medium">{icon} {value.label}</span>
          <button onClick={() => onChange(null)} className="ml-2 text-xs text-stone-500 hover:text-cardinal">change</button>
        </div>
      ) : (
        <>
          <div className="relative">
            <input value={text} onChange={(e) => setText(e.target.value)} onFocus={() => hits.length && setOpen(true)}
              onBlur={() => window.setTimeout(() => { setOpen(false); onPreview(null) }, 150)}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, hits.length - 1)) }
                else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)) }
                else if (e.key === 'Enter' && hits[active]) { e.preventDefault(); choose(hits[active]) }
                else if (e.key === 'Enter' && text.trim().length >= 2) {  // no suggestion yet: one full lookup
                  e.preventDefault(); setLoading(true)
                  fetch(`${API_URL}/api/places?final=1&q=${encodeURIComponent(text)}`).then((r) => r.json())
                    .then((j: Suggestion[]) => (j[0] ? choose(j[0]) : setErr('No matching place in the LA area')))
                    .catch(() => setErr('Place search unavailable')).finally(() => setLoading(false))
                }
                else if (e.key === 'Escape') setOpen(false)
              }}
              placeholder="Search anywhere in LA: address, place, landmark…" className="w-full rounded-lg border border-stone-300 px-3 py-2 pr-8 text-sm" />
            {loading && <span className="absolute right-2.5 top-2.5 h-3.5 w-3.5 animate-spin rounded-full border-2 border-stone-300 border-t-cardinal" />}
            {open && hits.length > 0 && (
              <ul className="absolute left-0 z-[1000] mt-1 max-h-80 w-full min-w-[17rem] overflow-y-auto rounded-xl bg-white py-1 shadow-2xl ring-1 ring-stone-300">
                {hits.map((s, i) => (
                  <li key={`${s.label}${s.lat}`}>
                    <button onMouseDown={(e) => { e.preventDefault(); choose(s) }}
                      onMouseEnter={() => { setActive(i); onPreview({ lat: s.lat, lng: s.lng, label: s.label }) }}
                      className={`flex w-full items-start gap-2 px-3 py-2 text-left ${i === active ? 'bg-cardinal-50' : ''}`}>
                      <span className="mt-0.5 text-base leading-none">{ICON[s.kind] ?? '📍'}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium leading-snug">{s.label}</span>
                        <span className="line-clamp-2 block text-xs leading-snug text-stone-500">{s.detail}</span>
                      </span>
                      {s.inDps && <span className="shrink-0 rounded bg-emerald-50 px-1 text-[10px] font-semibold text-emerald-700">DPS</span>}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="mt-1.5 flex flex-wrap gap-1">
            {showHere && <button onClick={here} className="rounded-full bg-white px-2 py-0.5 text-[11px] ring-1 ring-stone-300 hover:ring-cardinal">📍 My location</button>}
            <button onClick={onPickMap} className={`rounded-full px-2 py-0.5 text-[11px] ring-1 ${picking ? 'bg-gold ring-gold' : 'bg-white ring-stone-300 hover:ring-cardinal'}`}>🗺 {picking ? 'Click the map…' : 'Pick on map'}</button>
            {quick.map((q) => <button key={q.label} onClick={() => onChange(q)} className="rounded-full bg-white px-2 py-0.5 text-[11px] ring-1 ring-stone-300 hover:ring-cardinal">{q.label}</button>)}
          </div>
          {err && <p className="mt-1 text-xs text-red-600">{err}</p>}
        </>
      )}
    </div>
  )
}
