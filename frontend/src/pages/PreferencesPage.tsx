import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { meApi, token, useMe } from '../lib/auth'
import { keepPreviousData } from '@tanstack/react-query'
import { AnimatePresence, motion } from 'motion/react'
import { Sparkles } from 'lucide-react'
import { Ring } from '../components/ui/fx'
import { useQuery } from '@tanstack/react-query'
import { api } from '../api/client'
import type { Priorities } from '../api/types'
import { money } from '../lib/format'
import { useAppStore } from '../store/useAppStore'
import StickyBar from '../components/ui/StickyBar'

const PRIORITY: Record<keyof Priorities, { label: string; how: string }> = {
  cost: { label: 'Low total cost', how: 'True Cost vs your budget: full points at half your budget or less, half at exactly budget, none at 1.5×.' },
  commute: { label: 'Short commute', how: 'Your longest walk to the buildings below: full points at 0 min, none at 30+ min.' },
  zone: { label: 'DPS & free Lyft coverage', how: 'Half a point for inside the DPS patrol zone, half for inside USC’s free Lyft boundary.' },
  incidents: { label: 'Fewer reported incidents', how: 'LAPD-reported incidents within 150 m in the last 6 months, compared with the other listings.' },
}

function Used({ children }: { children: React.ReactNode }) {
  return <p className="rounded-lg bg-stone-50 px-3 py-2 text-xs text-stone-600"><b className="text-ink">Where it’s used:</b> {children}</p>
}

export default function PreferencesPage() {
  const { profile, setProfile } = useAppStore()
  const [params] = useSearchParams()
  const nav = useNavigate()
  const me = useMe()
  const onboarding = params.get('onboarding') === '1'
  const signedIn = !!token()
  const [busy, setBusy] = useState(false)
  // signed in: keep the account copy in sync (debounced), so preferences follow you to other devices
  const first = useRef(true)
  useEffect(() => {
    if (first.current) { first.current = false; return }
    if (!signedIn || onboarding) return
    const t = setTimeout(() => { meApi.patch({ preferences: profile as unknown as Record<string, unknown> }).catch(() => {}) }, 800)
    return () => clearTimeout(t)
  }, [profile, signedIn, onboarding])
  const finish = async (save: boolean) => {
    setBusy(true)
    try { await meApi.patch({ onboarded: true, ...(save ? { preferences: profile as unknown as Record<string, unknown> } : {}) }) } catch { /* still continue */ }
    nav('/?welcome=1', { replace: true })
  }
  const buildings = useQuery({ queryKey: ['buildings'], queryFn: api.buildings })
  const toggleBuilding = (id: number) =>
    setProfile({ buildingIds: profile.buildingIds.includes(id) ? profile.buildingIds.filter((x) => x !== id) : [...profile.buildingIds, id] })
  const sum = Object.values(profile.priorities).reduce((a, b) => a + b, 0) || 1
  // live preview: your #1 match among all listings, recomputed as you move any slider
  const all = useQuery({ queryKey: ['listings'], queryFn: () => api.listings() })
  const allIds = (all.data ?? []).map((l) => l.id)
  const rank = useQuery({ queryKey: ['fit-rank', allIds, [], profile], queryFn: () => api.fitRank(allIds, profile), enabled: allIds.length > 0, placeholderData: keepPreviousData })
  const top = rank.data ? Object.entries(rank.data).sort((a, b) => b[1].match - a[1].match)[0] : undefined
  const topListing = top ? all.data?.find((l) => l.id === top[0]) : undefined
  const pct = (k: keyof Priorities) => Math.round((profile.priorities[k] / sum) * 100)

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 py-8">
      {topListing && top && (
        <StickyBar className="flex items-center gap-3 px-4 py-3">
          <Sparkles size={18} className="shrink-0 text-cardinal" />
          <div className="min-w-0 flex-1 text-sm">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-stone-400">Your #1 match right now</div>
            <AnimatePresence mode="wait">
              <motion.div key={topListing.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} className="truncate font-bold">{topListing.name}
                <span className="font-normal text-stone-500"> · {top[1].why.slice(0, 2).join(', ') || 'best balance of your priorities'}</span></motion.div>
            </AnimatePresence>
          </div>
          <Ring value={top[1].match} size={44} label={<span className="text-[11px]">{top[1].match}<span className="text-[8px]">%</span></span>} />
          <Link to="/search" className="hidden rounded-xl bg-cardinal px-3 py-1.5 text-xs font-semibold !text-white sm:block">See top 6</Link>
        </StickyBar>
      )}
      {onboarding && (
        <div className="rounded-2xl bg-emerald-50 p-4 ring-1 ring-emerald-200">
          {params.get('registered') === '1' && <div className="font-bold text-emerald-800">✓ Registered successfully{me.data ? ` as ${me.data.email}` : ''}</div>}
          <p className="text-sm text-emerald-900">Tell TrojanScout what you’re looking for, or skip and do it later from the Preferences tab.</p>
          <div className="mt-3 flex gap-2">
            <button onClick={() => finish(true)} disabled={busy} className="rounded-xl bg-cardinal px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">Save and continue</button>
            <button onClick={() => finish(false)} disabled={busy} className="rounded-xl bg-white px-4 py-2 text-sm font-semibold text-stone-600 ring-1 ring-stone-300">Skip for now</button>
          </div>
        </div>
      )}
      <div>
        <h1 className="text-4xl font-extrabold tracking-tight">Your <span className="font-display font-normal italic text-cardinal">preferences</span></h1>
        <p className="mt-1 text-stone-500">
          TrojanScout doesn’t rank listings the same way for everyone. These four settings describe <i>your</i> situation, and every
          page uses them: the commute times in map popups, the compare table, True Cost, the fit score, and Scout’s answers.{' '}
          {signedIn ? 'They’re saved to your account.' : 'They’re saved in this browser; sign in to keep them on your account.'}
        </p>
      </div>

      <section className="space-y-3 card p-6">
        <div className="flex justify-between"><h2 className="font-bold">💰 Monthly budget</h2><span className="text-xl font-extrabold text-cardinal">{money(profile.budget)}</span></div>
        <input type="range" min={600} max={4000} step={50} value={profile.budget} onChange={(e) => setProfile({ budget: +e.target.value })} className="w-full accent-cardinal" />
        <p className="text-sm text-stone-500">The most you want to spend each month on everything (rent plus the hidden costs), not just rent.</p>
        <Used>the <b>cost</b> part of the fit score, and the “vs your budget” bar on <Link to="/true-cost" className="text-cardinal">True Cost</Link>.</Used>
      </section>

      <section className="space-y-3 card p-6">
        <h2 className="font-bold">🎓 Buildings you have class in</h2>
        <p className="text-sm text-stone-500">USC is big: 10 minutes from one edge can be 25 from another. Pick where you actually go.</p>
        <div className="flex flex-wrap gap-2">
          {buildings.data?.map((b) => {
            const on = profile.buildingIds.includes(b.id)
            return (
              <button key={b.id} onClick={() => toggleBuilding(b.id)}
                className={`rounded-full px-3 py-1.5 text-sm font-medium ring-1 ring-inset transition ${on ? 'bg-cardinal text-white ring-cardinal' : 'bg-white ring-stone-300 hover:ring-cardinal'}`}>
                {on ? '✓ ' : ''}{b.name}
              </button>
            )
          })}
        </div>
        <Used>door-to-desk walk/bike times in map popups; <b>longest walk</b> (your furthest building) in Compare and in the commute part of the fit score; the default destination for the 🛡 safest route.</Used>
      </section>

      <section className="space-y-3 card p-6">
        <div className="flex justify-between"><h2 className="font-bold">🌙 Late nights out per week</h2><span className="text-xl font-extrabold">{profile.lateNights}</span></div>
        <input type="range" min={0} max={7} value={profile.lateNights} onChange={(e) => setProfile({ lateNights: +e.target.value })} className="w-full accent-cardinal" />
        <p className="text-sm text-stone-500">Nights you’re on campus after dark (labs, library, work). Outside USC’s free Lyft boundary each one is a ride home you pay for.</p>
        <Used>the “late-night rides” line of True Cost (nights × 4.3 weeks × ~$6.50), which feeds the cost part of the fit score.</Used>
      </section>

      <section className="space-y-4 card p-6">
        <h2 className="font-bold">⚖️ What matters most</h2>
        <p className="text-sm text-stone-500">
          These sliders set how much each factor counts in a listing’s <b>fit score</b> (0–100). Each factor gets a 0–1 sub-score; the fit score is
          the weighted average. The bar shows each weight’s share after normalizing.
        </p>
        <div className="flex h-3 overflow-hidden rounded-full">
          {(Object.keys(PRIORITY) as (keyof Priorities)[]).map((k, i) => (
            <div key={k} className={['bg-cardinal', 'bg-amber-500', 'bg-emerald-600', 'bg-sky-600'][i]} style={{ width: `${pct(k)}%` }} title={`${PRIORITY[k].label} ${pct(k)}%`} />
          ))}
        </div>
        {(Object.keys(PRIORITY) as (keyof Priorities)[]).map((k, i) => (
          <div key={k}>
            <div className="flex items-center justify-between text-sm">
              <span className="flex items-center gap-2"><span className={`h-2.5 w-2.5 rounded-full ${['bg-cardinal', 'bg-amber-500', 'bg-emerald-600', 'bg-sky-600'][i]}`} />{PRIORITY[k].label}</span>
              <span className="font-semibold">{pct(k)}%</span>
            </div>
            <input type="range" min={0} max={1} step={0.05} value={profile.priorities[k]}
              onChange={(e) => setProfile({ priorities: { ...profile.priorities, [k]: +e.target.value } })} className="w-full accent-cardinal" />
            <p className="text-xs text-stone-500">{PRIORITY[k].how}</p>
          </div>
        ))}
        <div className="rounded-lg bg-ink p-3 font-mono text-xs text-white">
          fit = {pct('cost')}% × cost + {pct('commute')}% × commute + {pct('zone')}% × zone + {pct('incidents')}% × incidents
        </div>
      </section>
      {onboarding ? (
        <div className="flex justify-end gap-2">
          <button onClick={() => finish(false)} disabled={busy} className="rounded-xl px-4 py-2 text-sm font-semibold text-stone-600 ring-1 ring-stone-300">Skip for now</button>
          <button onClick={() => finish(true)} disabled={busy} className="rounded-xl bg-cardinal px-5 py-2 text-sm font-semibold text-white disabled:opacity-50">Save and continue →</button>
        </div>
      ) : <p className="text-center text-xs text-stone-400">✓ Changes save automatically and apply everywhere right away.</p>}
    </div>
  )
}
