import { useEffect, useRef, useState } from 'react'
import { motion } from 'motion/react'
import { Check, Loader2 } from 'lucide-react'
import { Link } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { api, streamChat } from '../api/client'
import type { ListingV2 } from '../api/types'
import { priceLabel } from '../lib/format'
import { useAppStore } from '../store/useAppStore'

type Step = { label: string; status: 'running' | 'done' }
type Understood = { chips: string[]; relaxed: string[]; rankedBy: string | null; parser: string | null }
type Msg = {
  role: 'user' | 'assistant'; content: string; steps?: Step[]
  ids?: string[]; reasons?: Record<string, string[]>; fit?: Record<string, number | null>; understood?: Understood
}
const SUGGESTIONS = [
  'Private room with my own bathroom under $1,200 inside DPS',
  'Something cozy for me and a roommate, each with our own bathroom, near the business school, under 3 grand',
  'Budget studio around $1.8k near the Village',
  '3 bed 2 bath for friends with in-unit laundry',
]

function UnderstoodCard({ u }: { u: Understood }) {
  return (
    <div className="rounded-xl bg-white p-3 text-xs ring-1 ring-stone-200">
      <div className="mb-1.5 font-semibold text-stone-500">What I understood</div>
      <div className="flex flex-wrap gap-1.5">
        {u.chips.length === 0 && <span className="text-stone-500">No hard requirements, so I ranked everything by how well it fits you.</span>}
        {u.chips.map((c) => {
          const dropped = u.relaxed.some((r) => r.includes(c))
          return (
            <span key={c} className={`rounded-full px-2.5 py-0.5 font-medium ring-1 ${dropped ? 'bg-amber-50 text-amber-800 line-through decoration-amber-500 ring-amber-200' : 'bg-cardinal-50 text-cardinal ring-red-200'}`}>{c}</span>
          )
        })}
      </div>
      {u.relaxed.length > 0 && <p className="mt-1.5 text-amber-800">Nothing matched all of that, so I relaxed: {u.relaxed.join(', ')}.</p>}
      {u.rankedBy && <p className="mt-1 text-stone-500">Also ranked by meaning: “{u.rankedBy}”</p>}
      <p className="mt-1 text-[10px] text-stone-400">Read by {u.parser === 'rules+llm' ? 'language rules + local LLM' : 'language rules'} · then ranked by your Preferences</p>
    </div>
  )
}

function WhyCard({ l, reasons, fit, rank }: { l: ListingV2; reasons: string[]; fit: number | null | undefined; rank: number }) {
  const { compareIds, toggleCompare } = useAppStore()
  const comparing = compareIds.includes(l.id)
  return (
    <article className="flex gap-3 rounded-2xl bg-white p-3 shadow-sm ring-1 ring-stone-200">
      <div className="relative h-24 w-28 shrink-0 overflow-hidden rounded-xl bg-stone-100">
        {l.photos?.[0] ? <img src={l.photos[0]} alt="" className="h-full w-full object-cover" /> : <div className="grid h-full place-items-center text-2xl">🏢</div>}
        <span className="absolute left-1 top-1 grid h-6 w-6 place-items-center rounded-full bg-cardinal text-xs font-bold text-white">{rank}</span>
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="truncate font-semibold">{l.name}</h3>
            <p className="truncate text-xs text-stone-500">{priceLabel(l)} · {l.source}</p>
          </div>
          {fit != null && <span className="shrink-0 rounded-full bg-gold-50 px-2 py-0.5 text-xs font-bold ring-1 ring-gold">Fit {Math.round(fit * 100)}</span>}
        </div>
        <div className="mt-1.5 text-[11px] font-semibold uppercase tracking-wide text-stone-400">Why this place</div>
        <ul className="mt-0.5 space-y-0.5 text-xs text-stone-700">
          {reasons.map((r) => <li key={r} className="flex gap-1.5"><span className="text-emerald-600">✓</span><span>{r}</span></li>)}
        </ul>
        <div className="mt-2 flex gap-2">
          <Link to={`/map?focus=${encodeURIComponent(l.id)}`} className="rounded-lg bg-cardinal px-3 py-1 text-xs font-semibold !text-white">Show on map</Link>
          <button onClick={() => toggleCompare(l.id)} className={`rounded-lg px-3 py-1 text-xs font-semibold ring-1 ${comparing ? 'bg-gold ring-gold' : 'ring-stone-300'}`}>{comparing ? '✓ Comparing' : '+ Compare'}</button>
        </div>
      </div>
    </article>
  )
}

export default function ChatPage({ embedded = false }: { embedded?: boolean } = {}) {
  const { profile, highlight } = useAppStore()
  const listings = useQuery({ queryKey: ['listings'], queryFn: () => api.listings() })
  const [messages, setMessages] = useState<Msg[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [showAll, setShowAll] = useState<Record<number, boolean>>({})
  const end = useRef<HTMLDivElement>(null)
  useEffect(() => { end.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages])

  const patchLast = (fn: (m: Msg) => Msg) => setMessages((ms) => [...ms.slice(0, -1), fn(ms[ms.length - 1])])

  async function send(text = input) {
    const message = text.trim()
    if (!message || busy) return
    const history = messages.map(({ role, content }) => ({ role, content }))
    setMessages((m) => [...m, { role: 'user', content: message }, { role: 'assistant', content: '', steps: [] }])
    setInput(''); setBusy(true)
    try {
      await streamChat({ message, profile, history }, (e) => {
        if (e.event === 'step') patchLast((m) => {
          const steps = m.steps ?? []
          const base = e.data.label.split(' · ')[0]
          const i = steps.findIndex((s) => s.label.split(' · ')[0] === base)
          return { ...m, steps: i < 0 ? [...steps, e.data] : steps.map((s, j) => (j === i ? e.data : s)) }
        })
        else if (e.event === 'understood') patchLast((m) => ({ ...m, understood: e.data }))
        else if (e.event === 'listings') { highlight(e.data.ids); patchLast((m) => ({ ...m, ids: e.data.ids, reasons: e.data.reasons, fit: e.data.fit })) }
        else if (e.event === 'token') patchLast((m) => ({ ...m, content: m.content + e.data.text }))
        else if (e.event === 'error') patchLast((m) => ({ ...m, content: m.content + `\n⚠️ ${e.data.message}` }))
      })
    } catch { patchLast((m) => ({ ...m, content: m.content + '\n⚠️ Connection lost. Try again.' })) }
    finally { setBusy(false) }
  }

  return (
    <div className={`mx-auto flex h-full flex-col ${embedded ? 'px-3' : 'max-w-4xl px-4'}`}>
      <div className={`flex-1 overflow-y-auto ${embedded ? 'space-y-4 py-3' : 'space-y-6 py-8'}`}>
        {!messages.length && (
          <div className={embedded ? 'pt-2 text-center' : 'pt-10 text-center'}>
            {!embedded && <div className="mx-auto mb-4 grid h-16 w-16 place-items-center rounded-2xl bg-cardinal text-3xl">🐴</div>}
            {!embedded && <h1 className="text-3xl font-extrabold tracking-tight">Ask Scout</h1>}
            <p className={`mx-auto mt-2 max-w-lg text-stone-500 ${embedded ? 'text-sm' : ''}`}>
              Describe what you want in your own words. Scout shows what it understood, searches live listings, checks zones, walks, cost and
              LAPD data, and explains why each place made the list. It runs on a local model, so nothing leaves your machine.
            </p>
            <div className="mt-6 flex flex-wrap justify-center gap-2">
              {SUGGESTIONS.slice(0, embedded ? 3 : 4).map((s) => <button key={s} onClick={() => send(s)} className={`rounded-full bg-white ring-1 ring-stone-200 hover:ring-cardinal ${embedded ? 'px-3 py-1.5 text-left text-xs' : 'px-4 py-2 text-sm'}`}>{s}</button>)}
            </div>
          </div>
        )}
        {messages.map((m, i) => m.role === 'user' ? (
          <motion.div key={i} initial={{ opacity: 0, y: 8, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} className="ml-auto w-fit max-w-[80%] rounded-2xl rounded-br-md bg-gradient-to-br from-cardinal to-cardinal-dark px-4 py-2.5 text-white shadow-md shadow-cardinal/20">{m.content}</motion.div>
        ) : (
          <div key={i} className="space-y-3">
            {!!m.steps?.length && (
              <ul className="w-fit space-y-1.5 rounded-2xl bg-white/80 p-3 text-xs text-stone-600 shadow-sm ring-1 ring-stone-200 backdrop-blur">
                {m.steps.map((s) => (
                  <motion.li key={s.label} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} className="flex items-center gap-2">
                    {s.status === 'done' ? <span className="grid h-4 w-4 place-items-center rounded-full bg-emerald-500 text-white"><Check size={11} strokeWidth={3} /></span> : <Loader2 size={15} className="animate-spin text-cardinal" />}
                    <span className={s.status === 'done' ? '' : 'shimmer rounded bg-clip-text text-transparent [background-image:linear-gradient(90deg,#78716c,#1c1917,#78716c)]'}>{s.label}</span>
                  </motion.li>
                ))}
              </ul>
            )}
            {m.understood && <UnderstoodCard u={m.understood} />}
            {m.content && <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="max-w-[90%] whitespace-pre-wrap rounded-2xl rounded-bl-md bg-white px-4 py-3 shadow-sm ring-1 ring-stone-200">{m.content}</motion.div>}
            {!!m.ids?.length && (
              <div className="space-y-2">
                {m.ids.slice(0, showAll[i] ? 8 : 3).map((id, k) => {
                  const l = listings.data?.find((x) => x.id === id)
                  return l ? <WhyCard key={id} l={l} rank={k + 1} reasons={m.reasons?.[id] ?? []} fit={m.fit?.[id]} /> : null
                })}
                <div className="flex gap-4 text-sm font-semibold">
                  {m.ids.length > 3 && <button onClick={() => setShowAll({ ...showAll, [i]: !showAll[i] })} className="text-cardinal">{showAll[i] ? 'Show fewer' : `Show all ${m.ids.length}`}</button>}
                  <Link to={`/map?ids=${m.ids.join(',')}`} className="text-cardinal">See them on the map →</Link>
                </div>
              </div>
            )}
          </div>
        ))}
        <div ref={end} />
      </div>
      <form onSubmit={(e) => { e.preventDefault(); send() }} className={`sticky bottom-0 flex gap-2 ${embedded ? 'py-3' : 'bg-paper py-4'}`}>
        <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="e.g. a quiet room near Leavey, own bathroom, under $1,300…"
          className="min-w-0 flex-1 rounded-xl border border-stone-300 bg-white px-4 py-3 outline-none focus:border-cardinal focus:ring-2 focus:ring-cardinal/20" />
        <button disabled={busy} className="btn-glow rounded-xl bg-cardinal px-6 font-semibold text-white disabled:opacity-50">{busy ? <Loader2 size={18} className="animate-spin" /> : 'Ask'}</button>
      </form>
    </div>
  )
}
