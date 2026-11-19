import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { freeAlerts } from '../../lib/free'
import { appAlerts, token } from '../../lib/auth'

const ICON: Record<string, string> = { deadline: '⏰', 'free-day': '🎉', 'service-gap': '🚫', tonight: '🌙', safety: '⚠️', friend: '👋', ride: '🚗' }
interface Alert { id: string; kind: string; priority: number; title: string; body: string; url?: string | null; phone?: string | null; link?: string }
const read = (k: string): string[] => { try { return JSON.parse(localStorage.getItem(k) ?? '[]') } catch { return [] } }
const write = (k: string, v: string[]) => { try { localStorage.setItem(k, JSON.stringify(v.slice(-200))) } catch { /* ignore */ } }

/** One feed for the whole app: safety (DPS alerts / student reports near home + campus), friends, rides, and free-program alerts. */
function useAlerts() {
  const free = useQuery({ queryKey: ['free-alerts'], queryFn: freeAlerts, refetchInterval: 5 * 60_000 })
  const app = useQuery({ queryKey: ['app-alerts', !!token()], queryFn: appAlerts, refetchInterval: 30_000 })
  const data: Alert[] = [...(app.data?.alerts ?? []), ...((free.data ?? []) as Alert[])].sort((a, b) => a.priority - b.priority)
  return { data, signedIn: !!app.data?.signedIn, watching: app.data?.watching ?? [] }
}

/** Browser notifications: each alert is sent once, while TrojanScout is open in a tab. */
function useNotify(alerts: Alert[] | undefined) {
  useEffect(() => {
    if (!alerts?.length || typeof Notification === 'undefined' || Notification.permission !== 'granted') return
    const sent = read('ts-alerts-notified')
    for (const a of alerts) {
      if (sent.includes(a.id)) continue
      try { new Notification(`${ICON[a.kind]} ${a.title}`, { body: a.body.slice(0, 180), tag: a.id }) } catch { /* ignore */ }
      sent.push(a.id)
    }
    write('ts-alerts-notified', sent)
  }, [alerts])
}

export function AlertBell() {
  const q = useAlerts()
  const nav = useNavigate()
  const [open, setOpen] = useState(false)
  const [perm, setPerm] = useState(typeof Notification === 'undefined' ? 'unsupported' : Notification.permission)
  const [seen, setSeen] = useState(() => read('ts-alerts-seen'))
  const box = useRef<HTMLDivElement>(null)
  useNotify(q.data)
  useEffect(() => {
    const close = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', close); return () => document.removeEventListener('mousedown', close)
  }, [])
  const alerts = q.data ?? []
  const unseen = alerts.filter((a) => !seen.includes(a.id)).length
  const toggle = () => {
    setOpen(!open)
    if (!open) { const s = [...new Set([...seen, ...alerts.map((a) => a.id)])]; setSeen(s); write('ts-alerts-seen', s) }
  }
  return (
    <div ref={box} className="relative">
      <button onClick={toggle} aria-label="Alerts" className="relative grid h-9 w-9 place-items-center rounded-full bg-cardinal-50 ring-1 ring-red-100 hover:bg-red-100">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-cardinal"><path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" /></svg>
        {unseen > 0 && <span className="absolute -right-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-cardinal px-1 text-[10px] font-bold text-white">{unseen}</span>}
      </button>
      {open && (
        <div className="glass absolute right-0 z-[2000] mt-2 w-96 max-w-[calc(100vw-24px)] overflow-hidden rounded-3xl">
          <div className="flex items-center justify-between border-b border-stone-100 px-4 py-3">
            <span className="font-bold">Alerts</span>
            {perm === 'default' && (
              <button onClick={async () => setPerm(await Notification.requestPermission())} className="rounded-lg bg-cardinal px-2.5 py-1 text-xs font-semibold text-white">Turn on notifications</button>
            )}
            {perm === 'granted' && <span className="text-xs text-emerald-700">✓ Notifications on</span>}
          </div>
          <ul className="max-h-[60vh] divide-y divide-stone-100 overflow-y-auto">
            {alerts.map((a) => (
              <li key={a.id} className="px-4 py-3">
                <div className="flex gap-2">
                  <span>{ICON[a.kind]}</span>
                  <div className="min-w-0">
                    <div className="text-sm font-semibold leading-tight">{a.link ? <button onClick={() => { setOpen(false); nav(a.link!) }} className="text-left hover:text-cardinal">{a.title}</button> : a.title}</div>
                    <div className="mt-0.5 text-xs text-stone-600">{a.body}</div>
                    <div className="mt-1 flex gap-3 text-xs font-semibold">
                      {a.url && <a href={a.url} target="_blank" rel="noreferrer" className="text-cardinal">Open ↗</a>}
                      {a.phone && <a href={`tel:${a.phone.replace(/[^\d+]/g, '')}`} className="text-cardinal">📞 {a.phone}</a>}
                    </div>
                  </div>
                </div>
              </li>
            ))}
            {!alerts.length && <li className="px-4 py-6 text-center text-sm text-stone-500">Nothing coming up right now.</li>}
          </ul>
          <div className="border-t border-stone-100 px-4 py-2 text-center text-[11px] text-stone-500">
            {q.signedIn ? `Watching USC DPS alerts near ${q.watching.join(', ')} · friends · rides` : 'Sign in to get alerts near your home and when friends ride.'}
          </div>
          <Link to="/free" onClick={() => setOpen(false)} className="block border-t border-stone-100 px-4 py-2.5 text-center text-xs font-semibold text-cardinal">See all free & safe options →</Link>
        </div>
      )}
    </div>
  )
}

/** One urgent alert (e.g. a reservation deadline) shown across the top until dismissed. */
export function AlertBanner() {
  const q = useAlerts()
  const [dismissed, setDismissed] = useState(() => read('ts-alerts-dismissed'))
  const a = (q.data ?? []).find((x) => x.priority === 0 && !dismissed.includes(x.id))
  if (!a) return null
  return (
    <div className="flex items-center gap-3 bg-gold px-4 py-2 text-sm text-ink">
      <span>{ICON[a.kind]}</span>
      <span className="min-w-0 flex-1 truncate"><b>{a.title}.</b> {a.body.split('. ')[0]}.</span>
      {a.link ? <Link to={a.link} className="shrink-0 rounded-lg bg-ink px-3 py-1 text-xs font-semibold !text-white">{a.kind === 'safety' ? 'Plan a safe route' : 'Open'}</Link>
        : a.url && <a href={a.url} target="_blank" rel="noreferrer" className="shrink-0 rounded-lg bg-ink px-3 py-1 text-xs font-semibold !text-white">{a.kind === 'deadline' ? 'Reserve ↗' : 'Open ↗'}</a>}
      <button onClick={() => { const d = [...dismissed, a.id]; setDismissed(d); write('ts-alerts-dismissed', d) }} aria-label="Dismiss" className="shrink-0 text-ink/60 hover:text-ink">✕</button>
    </div>
  )
}
