import { useCallback, useEffect, useState } from 'react'
import { useLocation } from 'react-router'
import { AnimatePresence, motion } from 'motion/react'
import {
  ArrowDown, ArrowUp, Bell, Car, Map, MapPinned, MessageCircle, Search, ShieldAlert, Sparkles, TriangleAlert, UserRound, X,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

/** First-visit onboarding tour: a side panel lists every feature and explains the current one, while a
 *  spotlight and a bouncing arrow point at the real button on the page. Opens once after the intro on the
 *  home page; "Take the tour" (any element that calls openTour) replays it. */

interface Step { target: string; icon: LucideIcon; title: string; body: string }

const STEPS: Step[] = [
  { target: 'home-search', icon: Search, title: 'Search in plain English',
    body: 'Type it the way you’d say it, e.g. “2B2B under $1,500 each near Leavey, inside DPS”. We turn it into filters and rank the listings for you.' },
  { target: 'zone-check', icon: MapPinned, title: 'Check any address',
    body: 'Type an address or tap the map: see if DPS patrols it and if it’s inside the free USC Lyft zone, before you sign anything.' },
  { target: 'nav-map', icon: Map, title: 'Explore Map',
    body: 'Every listing with DPS patrol zones, free Lyft zones, live DPS units, recent incidents, blue-light phones and clinics. Plan the safest walk home by time of day.' },
  { target: 'nav-search', icon: Search, title: 'Smart Search + True Cost',
    body: 'Your top 6 matches with the reasons they ranked, prices per person, and the True Cost: rent plus utilities and the rides you’ll really need.' },
  { target: 'nav-rides', icon: Car, title: 'Book Ride',
    body: 'Share a ride with students going your way and split the fare. Nobody sees your pickup or drop-off until you both accept.' },
  { target: 'nav-free', icon: Sparkles, title: 'Free & Safe',
    body: 'Free rides, escorts, safety apps and money help from USC, LA and California. Describe your situation, e.g. “someone is following me”.' },
  { target: 'nav-report', icon: TriangleAlert, title: 'Report suspicious activity',
    body: 'Tell other students what you saw. An AI check keeps reports factual and blocks profiling before they appear on the map.' },
  { target: 'nav-emergency', icon: ShieldAlert, title: 'Emergency contacts',
    body: '911, USC DPS for both campuses, the 988 crisis line and more, as big tap-to-call buttons.' },
  { target: 'nav-alerts', icon: Bell, title: 'Alerts',
    body: 'DPS alerts and verified reports near your home and campus, friend requests, and friends travelling on your route.' },
  { target: 'scout', icon: MessageCircle, title: 'Ask Scout',
    body: 'Our AI assistant on every page. Ask about housing, safety, rides or free programs; it only answers from real listings and data.' },
  { target: 'nav-account', icon: UserRound, title: 'Sign in with your USC email',
    body: 'Save your preferences, add friends and friend lists, and keep emergency contacts. No password: we email you a one-time code.' },
]

const DONE_KEY = 'ts-tour-done'
const OPEN_EVENT = 'ts:open-tour'
const PAD = 8

export function openTour() { window.dispatchEvent(new Event(OPEN_EVENT)) }

function seen() { try { return localStorage.getItem(DONE_KEY) === '1' } catch { return false } }
function markSeen() { try { localStorage.setItem(DONE_KEY, '1') } catch { /* private mode: it just shows again */ } }

/** The element for a step, or the phone menu button when the step's button is folded into the menu. */
function findTarget(name: string): HTMLElement | null {
  const visible = (el: Element | null): el is HTMLElement => !!el && (el as HTMLElement).getBoundingClientRect().width > 0
  const el = document.querySelector(`[data-tour="${name}"]`)
  if (visible(el)) return el
  const menu = name.startsWith('nav-') ? document.querySelector('[data-tour="menu"]') : null
  return visible(menu) ? menu : null
}

export default function Tour() {
  const { pathname } = useLocation()
  const [open, setOpen] = useState(false)
  const [i, setI] = useState(0)
  const [rect, setRect] = useState<DOMRect | null>(null)
  const [vw, setVw] = useState(window.innerWidth)

  // first visit: open right after the 3-second intro on the home page
  useEffect(() => {
    if (pathname !== '/' || seen()) return
    const t = setTimeout(() => { setI(0); setOpen(true) }, 3600)
    return () => clearTimeout(t)
  }, [pathname])

  useEffect(() => {
    const show = () => { setI(0); setOpen(true) }
    window.addEventListener(OPEN_EVENT, show)
    return () => window.removeEventListener(OPEN_EVENT, show)
  }, [])

  const close = useCallback(() => { setOpen(false); markSeen() }, [])

  // follow the target while it moves (scrolling, animations, resizing), and bring it back into view if it
  // scrolls off screen (at most once every 1.5 s, so the visitor can still scroll around)
  useEffect(() => {
    if (!open) return
    let lastScroll = 0
    const tick = () => {
      const el = findTarget(STEPS[i].target)
      const r = el?.getBoundingClientRect() ?? null
      // page content hidden under the 64px sticky header or below the fold (header buttons and the floating Scout button never are)
      const inPage = !!el && !el.closest('header') && getComputedStyle(el).position !== 'fixed'
      if (el && r && inPage && (r.top < 72 || r.bottom > window.innerHeight) && Date.now() - lastScroll > 1500) {
        lastScroll = Date.now()
        el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      }
      setRect(r)
      setVw(window.innerWidth)
    }
    tick()
    const t = setInterval(tick, 200)
    return () => clearInterval(t)
  }, [open, i])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
      if (e.key === 'ArrowRight') setI((n) => Math.min(n + 1, STEPS.length - 1))
      if (e.key === 'ArrowLeft') setI((n) => Math.max(n - 1, 0))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, close])

  if (!open) return null
  const step = STEPS[i]
  const last = i === STEPS.length - 1
  const phone = vw < 640
  const lowTarget = !!rect && rect.top > window.innerHeight / 2        // target in the bottom half → arrow above it
  const rightTarget = !!rect && rect.left + rect.width / 2 > vw * 0.5  // panel goes on the other side
  const Icon = step.icon
  // on phones most of these buttons live in the ☰ menu, so the arrow points there
  const viaMenu = !!rect && step.target.startsWith('nav-') && !(document.querySelector(`[data-tour="${step.target}"]`)?.getBoundingClientRect().width)

  const panelPos = phone
    ? (lowTarget ? 'left-3 right-3 top-20' : 'left-3 right-3 bottom-3')
    : `top-1/2 -translate-y-1/2 ${rightTarget ? 'left-5' : 'right-5'}`

  return (
    <div className="fixed inset-0 z-[3000]" role="dialog" aria-modal="true" aria-label="Welcome tour">
      {/* dim everything except the spotlighted button */}
      {rect ? (
        <motion.div className="pointer-events-none fixed rounded-2xl ring-4 ring-gold"
          animate={{ left: rect.left - PAD, top: rect.top - PAD, width: rect.width + PAD * 2, height: rect.height + PAD * 2 }}
          transition={{ type: 'spring', stiffness: 260, damping: 30 }}
          style={{ boxShadow: '0 0 0 9999px rgba(18, 8, 8, 0.58), 0 0 30px 6px rgba(255, 199, 44, .55)' }} />
      ) : <div className="fixed inset-0 bg-[#120808]/60" />}

      {/* bouncing arrow pointing at the button */}
      {rect && (
        <motion.div key={`arrow${i}`} className="pointer-events-none fixed z-[3001] text-gold drop-shadow-[0_2px_6px_rgba(0,0,0,.6)]"
          style={{ left: rect.left + rect.width / 2 - 20, top: Math.min(Math.max(lowTarget ? rect.top - PAD - 52 : rect.bottom + PAD + 6, 70), window.innerHeight - 56) }}
          initial={{ opacity: 0 }} animate={{ opacity: 1, y: lowTarget ? [0, 8, 0] : [0, -8, 0] }}
          transition={{ y: { repeat: Infinity, duration: 1.1, ease: 'easeInOut' }, opacity: { duration: 0.2 } }}>
          {lowTarget ? <ArrowDown size={40} strokeWidth={3} /> : <ArrowUp size={40} strokeWidth={3} />}
        </motion.div>
      )}

      {/* side panel: all features, with the current one explained */}
      <motion.aside layout className={`glass-solid fixed z-[3002] flex max-h-[calc(100vh-6rem)] flex-col overflow-hidden rounded-3xl sm:w-[22rem] ${panelPos}`}
        transition={{ type: 'spring', stiffness: 300, damping: 32 }}>
        <div className="flex items-center gap-2 border-b border-stone-200/80 px-5 py-3">
          <span className="eyebrow">Welcome tour</span>
          <span className="ml-auto text-xs font-semibold text-stone-500">{i + 1} / {STEPS.length}</span>
          <button onClick={close} aria-label="Close tour" className="grid h-8 w-8 place-items-center rounded-full text-stone-500 hover:bg-stone-100"><X size={16} /></button>
        </div>

        <AnimatePresence mode="wait">
          <motion.div key={i} initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -12 }} transition={{ duration: 0.2 }} className="px-5 pb-3 pt-4">
            <div className="flex items-center gap-3">
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-cardinal to-cardinal-dark text-gold shadow-md shadow-cardinal/30"><Icon size={20} /></span>
              <h2 className="text-lg font-extrabold leading-tight">{step.title}</h2>
            </div>
            <p className="mt-2 text-sm leading-relaxed text-stone-600">{step.body}</p>
            {!rect && <p className="mt-2 text-xs text-stone-400">This one lives on the home page.</p>}
            {viaMenu && <p className="mt-2 text-xs font-semibold text-cardinal">Find it in the ☰ menu at the top.</p>}
          </motion.div>
        </AnimatePresence>

        {/* every feature at a glance: jump to any of them */}
        {!phone && (
          <ol className="min-h-0 flex-1 space-y-0.5 overflow-y-auto border-t border-stone-200/80 px-3 py-2">
            {STEPS.map((s, n) => (
              <li key={s.target}>
                <button onClick={() => setI(n)} className={`flex w-full items-center gap-2.5 rounded-xl px-2 py-1.5 text-left text-[13px] transition ${n === i ? 'bg-cardinal-50 font-bold text-cardinal' : n < i ? 'text-stone-500 hover:bg-stone-100' : 'text-stone-700 hover:bg-stone-100'}`}>
                  <span className={`grid h-5 w-5 shrink-0 place-items-center rounded-full text-[10px] font-bold ${n === i ? 'bg-cardinal text-white' : n < i ? 'bg-emerald-500 text-white' : 'bg-stone-200 text-stone-600'}`}>{n < i ? '✓' : n + 1}</span>
                  {s.title}
                </button>
              </li>
            ))}
          </ol>
        )}

        <div className="flex items-center gap-2 border-t border-stone-200/80 px-5 py-3">
          {phone && <div className="flex gap-1">{STEPS.map((s, n) => <span key={s.target} className={`h-1.5 rounded-full transition-all ${n === i ? 'w-4 bg-cardinal' : 'w-1.5 bg-stone-300'}`} />)}</div>}
          {!phone && <button onClick={close} className="text-xs font-semibold text-stone-500 hover:text-cardinal">Skip tour</button>}
          <div className="ml-auto flex gap-2">
            {i > 0 && <button onClick={() => setI(i - 1)} className="rounded-xl px-3 py-2 text-sm font-semibold text-stone-600 ring-1 ring-stone-300 hover:bg-stone-50">Back</button>}
            <button onClick={() => (last ? close() : setI(i + 1))}
              className="btn-glow rounded-xl bg-gradient-to-r from-cardinal to-cardinal-dark px-4 py-2 text-sm font-semibold text-white">
              {last ? 'Start exploring' : 'Next'}
            </button>
          </div>
        </div>
      </motion.aside>
    </div>
  )
}
