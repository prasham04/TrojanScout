import { useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { ArrowLeft, ArrowRight, BadgeCheck, Clock, MapPin, MessageSquareText, ScanSearch, ShieldAlert, TriangleAlert } from 'lucide-react'
import { CircleMarker, MapContainer, Tooltip, useMapEvents } from 'react-leaflet'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import Basemap from '../components/map/Basemap'
import PlaceInput from '../components/rides/PlaceInput'
import { API_URL } from '../api/client'
import { report, ReportRejected, REPORT_CATEGORIES } from '../lib/recent'
import { identity, type Place } from '../lib/rides'

const WHEN = [
  { label: 'Just now', min: 0 }, { label: '15 min ago', min: 15 }, { label: '1 hour ago', min: 60 }, { label: 'Earlier today', min: 240 },
]
const SEVERITY_STYLE: Record<string, string> = { danger: 'bg-red-700 text-white', caution: 'bg-amber-500 text-white', low: 'bg-stone-300 text-stone-800' }

function Pick({ onPick }: { onPick: (p: [number, number]) => void }) {
  useMapEvents({ click: (e) => onPick([e.latlng.lat, e.latlng.lng]) })
  return null
}
const ago = (iso: string) => { const m = Math.round((Date.now() - Date.parse(iso)) / 60000); return m < 60 ? `${m} min ago` : m < 2880 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago` }

const STEPS = [{ label: 'What happened' }, { label: 'Where' }, { label: 'When' }, { label: 'Review & submit' }]

export default function ReportPage() {
  const qc = useQueryClient()
  const [category, setCategory] = useState(REPORT_CATEGORIES[0])
  const [text, setText] = useState('')
  const [where, setWhere] = useState<Place | null>(null)
  const [when, setWhen] = useState(0)
  const [busy, setBusy] = useState(false)
  const [step, setStep] = useState(0)
  const [result, setResult] = useState<{ ok: true; summary: string; severity: string; checkedBy: string } | { ok: false; reasons: string[] } | null>(null)
  const recent = useQuery({ queryKey: ['reports'], queryFn: async () => (await fetch(`${API_URL}/api/reports?hours=72`)).json() as Promise<{ id: string; category: string; description: string; createdAt: string; severity?: string; where?: string }[]>, refetchInterval: 60_000 })

  const maxStep = text.trim().length < 5 ? 0 : !where ? 1 : 3
  const canNext = step === 0 ? text.trim().length >= 5 : step === 1 ? !!where : true
  const pickMap = async (p: [number, number]) => {
    setWhere({ lat: p[0], lng: p[1], label: 'Dropped pin' })
    try { const r = await (await fetch(`${API_URL}/api/places/reverse?lat=${p[0]}&lng=${p[1]}`)).json(); if (r.label) setWhere({ lat: p[0], lng: p[1], label: [r.label, (r.detail || '').split(',')[0]].filter(Boolean).join(', ') }) } catch { /* keep pin */ }
  }
  const submit = async () => {
    if (!where) return
    setBusy(true); setResult(null)
    try {
      const r = await report({ lat: where.lat, lng: where.lng, category, description: text, userId: identity().id, where: where.label, occurredAt: new Date(Date.now() - WHEN[when].min * 60e3).toISOString() })
      setResult({ ok: true, summary: r.description, severity: r.severity ?? 'danger', checkedBy: r.check?.checkedBy ?? 'ai' })
      qc.invalidateQueries({ queryKey: ['reports'] }); qc.invalidateQueries({ queryKey: ['recent'] }); qc.invalidateQueries({ queryKey: ['app-alerts'] })
    } catch (e) {
      setResult({ ok: false, reasons: e instanceof ReportRejected ? e.reasons : [(e as Error).message] })
    } finally { setBusy(false) }
  }

  return (
    <div className="mx-auto grid max-w-6xl gap-6 px-4 py-8 lg:grid-cols-[1fr_380px]">
      <div className="space-y-4">
        <div>
          <p className="eyebrow">Reviewed by AI before anyone sees it</p>
          <h1 className="mt-1 text-4xl font-extrabold tracking-tight">Report <span className="font-display font-normal italic text-red-700">suspicious</span> activity</h1>
          <p className="mt-1 text-stone-500">Tell other students what you saw. An AI check makes sure it’s a specific, factual report about behaviour before it’s shown on the map and sent as an alert nearby.</p>
        </div>
        {/* calm, high-contrast emergency band: no animation here */}
        <div className="flex flex-wrap items-center gap-3 rounded-3xl bg-red-700 p-4 text-white shadow-[0_16px_40px_-20px_rgba(185,28,28,.8)]">
          <ShieldAlert size={26} className="shrink-0" />
          <div className="min-w-[14rem] flex-1 text-sm"><b>In danger right now?</b> Don’t fill out a form. Call for help first.</div>
          <a href="tel:911" className="rounded-xl bg-white px-3.5 py-1.5 text-sm font-bold !text-red-700">911</a>
          <a href="tel:2137404321" className="rounded-xl bg-white/15 px-3 py-1.5 text-sm font-bold !text-white ring-1 ring-white/40">DPS UPC 213-740-4321</a>
          <a href="tel:3234421000" className="rounded-xl bg-white/15 px-3 py-1.5 text-sm font-bold !text-white ring-1 ring-white/40">DPS HSC 323-442-1000</a>
          <a href="/emergency" className="text-sm font-semibold !text-white underline">All emergency contacts →</a>
        </div>

        <section className="card overflow-hidden">
          {/* progress */}
          <div className="border-b border-stone-100 px-5 pt-4">
            <div className="flex justify-between text-xs font-semibold">
              {STEPS.map((st, i) => (
                <button key={st.label} onClick={() => i <= maxStep && setStep(i)} disabled={i > maxStep}
                  className={`flex items-center gap-1.5 pb-3 transition ${i === step ? 'text-cardinal' : i < step ? 'text-ink' : 'text-stone-400'}`}>
                  <span className={`grid h-6 w-6 place-items-center rounded-full text-[11px] ${i < step ? 'bg-emerald-500 text-white' : i === step ? 'bg-cardinal text-white shadow-md shadow-cardinal/30' : 'bg-stone-100'}`}>{i < step ? '✓' : i + 1}</span>
                  <span className="hidden sm:inline">{st.label}</span>
                </button>
              ))}
            </div>
            <div className="-mx-5 h-1 bg-stone-100"><motion.div className="h-full bg-gradient-to-r from-cardinal to-red-500" animate={{ width: `${((step + 1) / STEPS.length) * 100}%` }} transition={{ type: 'spring', stiffness: 200, damping: 30 }} /></div>
          </div>

          <div className="min-h-[22rem] p-5">
            <AnimatePresence mode="wait">
              <motion.div key={step} initial={{ opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -24 }} transition={{ duration: 0.25 }} className="space-y-4">
                {step === 0 && <>
                  <div>
                    <div className="mb-1.5 text-xs font-semibold text-stone-500">What kind of activity?</div>
                    <div className="flex flex-wrap gap-1.5">
                      {REPORT_CATEGORIES.map((c) => <button key={c} onClick={() => setCategory(c)} className={`rounded-full px-3 py-1.5 text-xs font-semibold ring-1 transition ${category === c ? 'bg-cardinal text-white ring-cardinal shadow-md shadow-cardinal/25' : 'bg-white ring-stone-300 hover:ring-cardinal'}`}>{c}</button>)}
                    </div>
                  </div>
                  <label className="block">
                    <span className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-stone-500"><MessageSquareText size={13} />What happened?</span>
                    <textarea value={text} onChange={(e) => setText(e.target.value)} rows={5} maxLength={1000} autoFocus={window.innerWidth >= 768}
                      placeholder="Describe what the person did, e.g. “Someone was trying car door handles along the block and walked toward Hoover.”"
                      className="w-full rounded-2xl border border-stone-300 px-4 py-3 text-sm outline-none focus:border-cardinal focus:ring-2 focus:ring-cardinal/15" />
                    <span className="text-[11px] text-stone-400">Describe behaviour, not race, appearance or who someone is. No names or phone numbers.</span>
                  </label>
                </>}
                {step === 1 && <>
                  <PlaceInput label="Where?" dot="📍" value={where} onChange={setWhere} myLocation picking={false} onPickMap={() => {}} onPreview={() => {}}
                    quick={[{ lat: 34.0256, lng: -118.2853, label: 'USC Village' }, { lat: 34.0287, lng: -118.2726, label: 'The Lorenzo' }, { lat: 34.0622, lng: -118.2035, label: 'HSC (Keck)' }]} />
                  <div className="h-64 overflow-hidden rounded-2xl ring-1 ring-stone-200">
                    <MapContainer center={where ? [where.lat, where.lng] : [34.0224, -118.2851]} zoom={15} className="h-full w-full cursor-crosshair">
                      <Basemap />
                      <Pick onPick={pickMap} />
                      {where && <CircleMarker center={[where.lat, where.lng]} radius={9} pathOptions={{ color: '#fff', weight: 3, fillColor: '#b91c1c', fillOpacity: 1 }}><Tooltip permanent direction="top" offset={[0, -8]}>{where.label}</Tooltip></CircleMarker>}
                    </MapContainer>
                  </div>
                  <p className="-mt-2 text-[11px] text-stone-400">Or tap the map to drop the exact spot.</p>
                </>}
                {step === 2 && (
                  <div>
                    <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-stone-500"><Clock size={13} />When did it happen?</div>
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                      {WHEN.map((w, i) => <button key={w.label} onClick={() => setWhen(i)} className={`rounded-2xl py-4 text-sm font-semibold ring-1 transition ${when === i ? 'bg-cardinal text-white ring-cardinal shadow-md shadow-cardinal/30' : 'bg-white ring-stone-200 hover:ring-cardinal'}`}>{w.label}</button>)}
                    </div>
                  </div>
                )}
                {step === 3 && (
                  <div className="space-y-3">
                    <div className="relative overflow-hidden rounded-2xl bg-stone-50 p-4 ring-1 ring-stone-200">
                      {busy && <motion.div className="pointer-events-none absolute inset-x-0 h-16 bg-gradient-to-b from-transparent via-cardinal/15 to-transparent" initial={{ y: '-100%' }} animate={{ y: '300%' }} transition={{ duration: 1.2, repeat: Infinity, ease: 'linear' }} />}
                      <div className="text-xs font-semibold text-stone-500">{category}</div>
                      <p className="mt-1 text-[15px]">{text || <span className="text-stone-400">No description yet</span>}</p>
                      <div className="mt-2 flex flex-wrap gap-3 text-xs text-stone-500"><span className="flex items-center gap-1"><MapPin size={12} />{where?.label ?? 'No place yet'}</span><span className="flex items-center gap-1"><Clock size={12} />{WHEN[when].label}</span></div>
                    </div>
                    <AnimatePresence>
                      {result?.ok === true && (
                        <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} transition={{ type: 'spring', stiffness: 300, damping: 20 }} className="rounded-2xl bg-emerald-50 p-4 text-sm ring-1 ring-emerald-200">
                          <div className="flex items-center gap-2 font-bold text-emerald-800"><BadgeCheck size={20} />Verified and posted <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${SEVERITY_STYLE[result.severity]}`}>{result.severity}</span></div>
                          <p className="mt-1 text-stone-700">“{result.summary}”</p>
                          <p className="mt-1 text-[11px] text-stone-500">Checked by {result.checkedBy === 'ai' ? 'the AI model' : 'built-in rules (AI unavailable)'}. Students nearby now see it on the map and in their alerts. It does not reach DPS or LAPD; call them to file an official report.</p>
                        </motion.div>
                      )}
                      {result?.ok === false && (
                        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="rounded-2xl bg-amber-50 p-4 text-sm ring-1 ring-amber-200">
                          <div className="flex items-center gap-2 font-bold text-amber-900"><TriangleAlert size={18} />Not posted yet</div>
                          <ul className="mt-1 list-disc pl-5 text-amber-900">{result.reasons.map((r) => <li key={r}>{r}</li>)}</ul>
                          <button onClick={() => setStep(0)} className="mt-2 text-xs font-semibold text-amber-900 underline">Edit the description</button>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                )}
              </motion.div>
            </AnimatePresence>
          </div>

          <div className="flex items-center justify-between gap-2 border-t border-stone-100 px-5 py-4">
            <button onClick={() => setStep(Math.max(0, step - 1))} disabled={step === 0} className="flex items-center gap-1 rounded-xl px-3 py-2 text-sm font-semibold text-stone-600 disabled:opacity-30"><ArrowLeft size={15} />Back</button>
            {step < 3
              ? <button onClick={() => setStep(step + 1)} disabled={!canNext} className="btn-glow flex items-center gap-1 rounded-xl bg-gradient-to-r from-cardinal to-cardinal-dark px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-40">Next<ArrowRight size={15} /></button>
              : <button onClick={submit} disabled={busy || !where || text.trim().length < 5 || result?.ok === true} className="flex items-center gap-2 rounded-xl bg-red-700 px-5 py-2.5 text-sm font-semibold text-white shadow-[0_10px_30px_-10px_rgba(185,28,28,.8)] hover:bg-red-800 disabled:opacity-40">
                  <ScanSearch size={16} className={busy ? 'animate-pulse' : ''} />{busy ? 'AI is checking your report…' : result?.ok ? 'Posted' : 'Submit for AI check'}</button>}
          </div>
        </section>
      </div>

      <aside className="space-y-3 lg:sticky lg:top-4 lg:self-start">
        <h2 className="flex items-center gap-2 font-bold"><BadgeCheck size={18} className="text-emerald-600" />Verified reports, last 72 hours</h2>
        {recent.data?.length === 0 && <p className="card p-4 text-sm text-stone-500">No student reports in the last 3 days.</p>}
        {recent.data?.map((r) => (
          <motion.div key={r.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="card p-4 text-sm">
            <div className="flex items-center justify-between gap-2">
              <b>{r.category}</b>
              <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${SEVERITY_STYLE[r.severity ?? 'danger']}`}>{r.severity ?? 'danger'}</span>
            </div>
            <p className="mt-0.5 text-stone-700">{r.description}</p>
            <p className="mt-1 text-[11px] text-stone-400">{r.where ? `${r.where} · ` : ''}{ago(r.createdAt)} · student report, AI-checked</p>
          </motion.div>
        ))}
      </aside>
    </div>
  )
}
