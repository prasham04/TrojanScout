import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router'
import { AnimatePresence, motion } from 'motion/react'
import { Route as RouteIcon, Users } from 'lucide-react'
import { signIn, token, useMe } from '../lib/auth'
import RecentCheck from '../components/safety/RecentCheck'
import { CircleMarker, MapContainer, Polyline, Tooltip, useMap, useMapEvents } from 'react-leaflet'
import Basemap from '../components/map/Basemap'
import L from 'leaflet'
import { API_URL } from '../api/client'
import InfoTip from '../components/ui/InfoTip'
import PlaceInput from '../components/rides/PlaceInput'
import FreeNow from '../components/free/FreeNow'
import TripOptions from '../components/free/TripOptions'
import { googleMapsStops, uberLink } from '../lib/directions'
import {
  ago, inMin, QUICK_DROPS, QUICK_PICKUPS, rides, subscribeRides,
  type Match, type MyRide, type Place, type Quote, type RidesState, type Share,
} from '../lib/rides'

const usd = (n: number) => `$${n.toFixed(2)}`
const PRICING_NOTE = 'Fares are UberX-style estimates for LA: $1.25 base + $3.10 booking fee + $1.15/mile + $0.30/min (min $8.50), with road distance ≈ 1.35× straight-line at ~18 mph. A shared car takes the best pickup/drop order; the single fare is split in proportion to each rider’s solo fare, so everyone saves. A match is shown only if everyone saves and nobody’s detour is more than ~6 min (or 40% of their trip).'

/** Alone vs shared, as two bars. */
function SavingsBar({ solo, share }: { solo: number; share: number }) {
  return (
    <div className="space-y-1 text-[10px] font-semibold text-stone-500">
      <div className="flex items-center gap-2"><span className="w-12">Alone</span><div className="h-1.5 flex-1 rounded-full bg-stone-300" /><span className="num w-12 text-right">{usd(solo)}</span></div>
      <div className="flex items-center gap-2"><span className="w-12 text-emerald-700">Shared</span>
        <div className="h-1.5 flex-1 rounded-full bg-stone-100"><motion.div className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-emerald-400" initial={{ width: '100%' }} animate={{ width: `${Math.max(8, (share / Math.max(solo, 0.01)) * 100)}%` }} transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }} /></div>
        <span className="num w-12 text-right text-emerald-700">{usd(share)}</span></div>
    </div>
  )
}

/** Overlapping avatar circles. */
function Avatars({ names }: { names: { name: string; friend?: boolean }[] }) {
  return (
    <span className="flex -space-x-2">
      {names.slice(0, 4).map((n, i) => (
        <span key={i} className={`grid h-7 w-7 place-items-center rounded-full text-[11px] font-bold ring-2 ring-white ${n.friend ? 'bg-pink-600 text-white' : 'bg-gradient-to-br from-cardinal to-cardinal-dark text-gold'}`}>{n.name[0]}</span>
      ))}
    </span>
  )
}

function MatchCard({ m, now, onJoin }: { m: Match; now: number; onJoin: () => void }) {
  return (
    <motion.div layout initial={{ opacity: 0, x: -24, scale: 0.98 }} animate={{ opacity: 1, x: 0, scale: 1 }} exit={{ opacity: 0, x: 24 }} transition={{ type: 'spring', stiffness: 320, damping: 30 }}
      className={`rounded-2xl bg-white p-3.5 shadow-sm ring-1 transition hover:shadow-md ${m.friend ? 'ring-2 ring-pink-300' : 'ring-stone-200'}`}>
      <div className="flex items-start gap-3">
        <Avatars names={[{ name: m.name, friend: m.friend }, ...Array.from({ length: Math.max(0, m.groupSize - 1) }, () => ({ name: '+' }))]} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="font-semibold">{m.name}</span>
            {m.friend && <span className="rounded bg-pink-100 px-1 text-[10px] font-semibold text-pink-700">👋 Friend</span>}
            {m.groupSize > 1 && <span className="rounded bg-gold-50 px-1 text-[10px] text-amber-800">+{m.groupSize - 1} already sharing</span>}
            <span className="ml-auto text-xs text-stone-500">leaves {inMin(m.departAt, now)}</span>
          </div>
          <div className="mt-1 inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-800 ring-1 ring-emerald-200"><RouteIcon size={11} />Travelling on your route</div>
        </div>
      </div>
      <div className="mt-3"><SavingsBar solo={m.you.solo.fare} share={m.you.share} /></div>
      <div className="mt-2 flex items-end justify-between gap-2">
        <div className="text-sm">
          You pay <b className="num text-cardinal">{usd(m.you.share)}</b>
          <div className="text-xs font-semibold text-emerald-700">save <span className="num">{usd(m.you.saves)}</span> ({m.you.savesPct}%){m.you.detourMin > 0 ? ` · +${m.you.detourMin} min detour` : ' · no detour'}</div>
        </div>
        <button onClick={onJoin} disabled={m.pendingJoin}
          className="btn-glow shrink-0 rounded-xl bg-gradient-to-r from-cardinal to-cardinal-dark px-3 py-2 text-xs font-semibold text-white disabled:bg-none disabled:bg-stone-300 disabled:text-stone-600 disabled:shadow-none">
          {m.pendingJoin ? 'Request sent…' : 'Request to share'}
        </button>
      </div>
    </motion.div>
  )
}

function GroupCard({ ride, now, onCancel }: { ride: MyRide; now: number; onCancel: () => void }) {
  const g = ride.group!
  const me = g.plan.riders.find((r) => r.requestId === ride.id)!
  const totalSaved = g.plan.riders.reduce((s, r) => s + r.saves, 0)
  const first = g.plan.stops[0], last = g.plan.stops[g.plan.stops.length - 1]
  // same place twice in a row (e.g. both riders get off at Union Station) is one stop
  const stops = g.plan.stops.filter((s, i, a) => i === 0 || s.label !== a[i - 1].label)
  const middle = stops.slice(1, -1)
  const iBook = first.requestId === ride.id
  const booker = iBook ? 'You' : first.name
  return (
    <motion.div initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} className="space-y-3 rounded-3xl bg-white p-4 shadow-[0_0_0_2px_#34d399,0_20px_50px_-20px_rgba(5,150,105,.45)]">
      <div>
        <div className="text-lg font-extrabold">🎉 You’re sharing a ride</div>
        <div className="text-sm text-stone-500">with {g.members.filter((m) => m.requestId !== ride.id).map((m) => m.name).join(', ')} · leaves {inMin(ride.departAt, now)}</div>
      </div>
      <ol className="space-y-1.5 text-sm">
        {g.plan.stops.map((s, i) => (
          <li key={i} className="flex items-center gap-2">
            <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-full text-[11px] font-bold text-white ${s.kind === 'pickup' ? 'bg-emerald-600' : 'bg-cardinal'}`}>{i + 1}</span>
            <span className="truncate">{s.kind === 'pickup' ? 'Pick up' : 'Drop'} <b>{s.requestId === ride.id ? 'you' : s.name}</b> · {s.label}</span>
          </li>
        ))}
      </ol>
      <table className="w-full text-xs">
        <thead><tr className="text-stone-500"><th className="text-left font-medium">Rider</th><th className="font-medium">Alone</th><th className="font-medium">Shared</th><th className="font-medium">Saves</th></tr></thead>
        <tbody>
          {g.plan.riders.map((r) => (
            <tr key={r.requestId} className={`border-t border-stone-100 ${r.requestId === ride.id ? 'font-semibold' : ''}`}>
              <td className="py-1">{r.requestId === ride.id ? 'You' : g.members.find((m) => m.requestId === r.requestId)?.name}</td>
              <td className="text-center">{usd(r.solo.fare)}</td><td className="text-center">{usd(r.share)}</td>
              <td className="text-center text-emerald-700">{usd(r.saves)} ({r.savesPct}%)</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="rounded-xl bg-emerald-50 p-3 text-sm">
        One car, {g.plan.miles} mi, ~{g.plan.minutes} min, {usd(g.plan.totalFare)} total. You save <b>{usd(me.saves)}</b>; the group saves <b>{usd(totalSaved)}</b> vs everyone riding alone.
      </div>
      <div className="rounded-xl bg-stone-50 p-3 text-xs text-stone-600">
        <b className="text-ink">{booker} book{iBook ? '' : 's'} the car</b> (first pickup). Uber opens with <b>{first.label.split(',')[0]} → {last.label.split(',')[0]}</b>
        {middle.length > 0 && <>; then tap <b>Add stop</b> for: {middle.map((s, i) => <span key={i}>{i ? ', ' : ''}{s.label.split(',')[0]}</span>)}</>}.
      </div>
      <div className="grid grid-cols-2 gap-2">
        <a href={uberLink(first, last)} target="_blank" rel="noreferrer"
          className="rounded-lg bg-ink px-3 py-2 text-center text-sm font-semibold !text-white">Book in Uber ↗</a>
        <a href={googleMapsStops(stops)} target="_blank" rel="noreferrer"
          className="rounded-lg px-3 py-2 text-center text-sm font-semibold !text-stone-700 ring-1 ring-stone-300">🧭 Route in Maps ↗</a>
      </div>
      <p className="text-[11px] text-stone-400">One rider books the whole car and the others pay them back their share as shown. Uber’s link can only fill in one destination, so add the middle stops in the Uber app.</p>
      <button onClick={onCancel} className="text-xs font-medium text-stone-500 hover:text-cardinal">Leave this ride</button>
    </motion.div>
  )
}

function PanTo({ p }: { p: [number, number] }) {
  const map = useMap()
  useEffect(() => { if (!map.getBounds().pad(-0.1).contains(p)) map.panTo(p, { animate: true }) }, [p[0], p[1]]) // eslint-disable-line react-hooks/exhaustive-deps
  return null
}

function ClickPick({ onPick }: { onPick: ((p: [number, number]) => void) | null }) {
  useMapEvents({ click: (e) => onPick?.([e.latlng.lat, e.latlng.lng]) })
  return null
}
function Fit({ pts }: { pts: [number, number][] }) {
  const map = useMap()
  const key = pts.map((p) => p.join()).join('|')
  useEffect(() => { if (pts.length >= 2) map.fitBounds(L.latLngBounds(pts), { padding: [50, 50], maxZoom: 15 }) }, [key]) // eslint-disable-line react-hooks/exhaustive-deps
  return null
}

export default function RidesPage() {
  const [params] = useSearchParams()
  const account = useMe()
  const signedIn = !!token()
  const [state, setState] = useState<RidesState | null>(null)
  const [live, setLive] = useState(false)
  const [now, setNow] = useState(Date.now())
  // prefilled from the safe-route planner (/rides?from=lat,lng&to=lat,lng&toLabel=…)
  const fromParam = (k: string, label: string): Place | null => { const v = params.get(k)?.split(',').map(Number); return v?.length === 2 && v.every(Number.isFinite) ? { lat: v[0], lng: v[1], label } : null }
  const [pickup, setPickup] = useState<Place | null>(() => fromParam('from', params.get('fromLabel') || 'Your start'))
  const [drop, setDrop] = useState<Place | null>(() => fromParam('to', params.get('toLabel') || 'Destination'))
  const [picking, setPicking] = useState<'pickup' | 'drop' | null>(null)
  // phones: the map is below the form, so bring it into view when you choose "Pick on map"
  const mapBox = useRef<HTMLDivElement>(null)
  useEffect(() => { if (picking && window.innerWidth < 768) mapBox.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }) }, [picking])
  const [leaveIn, setLeaveIn] = useState(0)
  const [seats, setSeats] = useState(1)
  const [quote, setQuote] = useState<Quote | null>(null)
  const [share, setShare] = useState<Share>({ mode: 'friends', lists: [] })
  const [preview, setPreview] = useState<Place | null>(null)
  const [err, setErr] = useState('')

  // rides are friends-only, so the live feed exists only for a signed-in rider (it connects with a rides-only pass)
  const accountId = account.data?.id
  useEffect(() => {
    if (!signedIn || !accountId) return
    let stop = () => {}, cancelled = false
    rides.pass().then(({ pass }) => { if (!cancelled) stop = subscribeRides(pass, setState, setLive) }).catch(() => setLive(false))
    return () => { cancelled = true; stop() }
  }, [signedIn, accountId])
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t) }, [])
  useEffect(() => { if (pickup && drop) rides.quote(pickup, drop).then(setQuote).catch(() => setQuote(null)); else setQuote(null) }, [pickup, drop])

  useEffect(() => { if (!pickup && account.data?.home) setPickup(account.data.home) }, [account.data?.home]) // eslint-disable-line react-hooks/exhaustive-deps
  const hasFriends = !!account.data?.friends.length
  const ride = state?.mine.find((r) => r.status === 'open' || r.status === 'matched') ?? null
  const book = async () => {
    if (!pickup || !drop) return
    setErr('')
    try { await rides.book({ pickup, drop, departAt: Date.now() + leaveIn * 60e3, seats, share }) } catch (e) { setErr((e as Error).message) }
  }
  const myPts: [number, number][] = ride ? [[ride.pickup.lat, ride.pickup.lng], [ride.drop.lat, ride.drop.lng]] : [pickup, drop].filter(Boolean).map((p) => [p!.lat, p!.lng])
  const plan = ride?.group?.plan  // other riders' stops appear only once you're both in the car

  return (
    <div className="flex h-full flex-col">
      {/* live strip */}
      <div className="flex items-center gap-4 overflow-hidden border-b border-white/10 bg-gradient-to-r from-[#1a0a0a] via-ink to-[#1a0a0a] px-4 py-2 text-xs text-white">
        <span className="flex shrink-0 items-center gap-1.5 rounded-full bg-white/10 px-2 py-0.5 font-bold tracking-wider">
          <span className={`h-2 w-2 rounded-full ${live ? 'live-dot bg-red-500' : 'bg-stone-500'}`} />{live ? 'LIVE' : signedIn ? 'connecting…' : 'OFFLINE'}
        </span>
        {state ? <span className="flex shrink-0 items-center gap-1.5"><Users size={13} /><b className="num">{state.stats.live}</b> rides with friends now · <b className="num">{state.stats.sharing}</b> shared</span>
          : !signedIn && <span className="shrink-0 text-white/70">Sign in to see rides from your friends</span>}
        <div className="flex min-w-0 gap-6 truncate text-white/70">
          <AnimatePresence initial={false}>
            {state?.activity.slice(0, 3).map((a) => <motion.span key={a.at + a.text} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="truncate">{a.text} <span className="text-white/40">{ago(a.at, now)}</span></motion.span>)}
          </AnimatePresence>
        </div>
      </div>

      {/* phones: the whole page scrolls (full form, then the map below); md+: form and map side by side */}
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto md:flex-row md:overflow-hidden">
        <aside className="w-full shrink-0 space-y-4 border-r border-stone-200/70 bg-white/70 p-4 backdrop-blur-xl md:w-[440px] md:shrink md:overflow-y-auto">
          <div>
            <p className="eyebrow">Real-time · private until you both accept</p>
            <h1 className="mt-1 text-3xl font-extrabold tracking-tight">Share a <span className="font-display font-normal italic text-cardinal">ride</span></h1>
            <p className="text-sm text-stone-500">Book where you’re going. Only your friends heading the same way show up here, live; strangers never see you and you never see them. Split the fare and save. Nobody sees your pickup or drop-off until you both accept. <InfoTip>{PRICING_NOTE}</InfoTip></p>
          </div>

          {!signedIn && (
            <div className="card space-y-2 p-4 text-sm">
              <div className="font-semibold">Rides are shared only with your friends</div>
              <p className="text-stone-500">Sign in with your USC email, add friends, and you’ll see when one of them is heading your way.</p>
              <button onClick={() => signIn('/rides')} className="w-full rounded-xl bg-cardinal py-2.5 font-semibold text-white hover:bg-cardinal-dark">Sign in to share rides</button>
            </div>
          )}

          {signedIn && !ride && account.data && !hasFriends && (
            <div className="card space-y-2 p-4 text-sm">
              <div className="font-semibold">Add a friend first</div>
              <p className="text-stone-500">Shared rides are only between friends. Add friends (and optional lists like “Roommates”) in your profile, then book here.</p>
              <a href="/profile" className="block w-full rounded-xl bg-cardinal py-2.5 text-center font-semibold text-white hover:bg-cardinal-dark">Add friends →</a>
            </div>
          )}

          {signedIn && hasFriends && !ride && (
            <div className="card space-y-4 p-4">
              {account.data && (
                <div className="flex items-center gap-2 text-sm"><span className="grid h-7 w-7 place-items-center rounded-full bg-cardinal text-xs font-bold text-gold">{account.data.name[0]}</span>Riding as <b>{account.data.name}</b><span className="ml-auto text-xs text-stone-500">{account.data.friends.length} friend{account.data.friends.length === 1 ? "" : "s"}</span></div>
              )}
              <PlaceInput label="Pickup" value={pickup} onChange={setPickup} quick={QUICK_PICKUPS} picking={picking === 'pickup'} onPickMap={() => setPicking(picking === 'pickup' ? null : 'pickup')} onPreview={setPreview} />
              <PlaceInput label="Drop-off" value={drop} onChange={setDrop} quick={QUICK_DROPS} picking={picking === 'drop'} onPickMap={() => setPicking(picking === 'drop' ? null : 'drop')} onPreview={setPreview} />
              <div className="flex gap-4">
                <div className="flex-1">
                  <div className="mb-1 text-xs font-semibold text-stone-500">Leaving</div>
                  <div className="grid grid-cols-4 overflow-hidden rounded-lg text-xs font-semibold ring-1 ring-stone-300">
                    {[0, 15, 30, 60].map((m) => <button key={m} onClick={() => setLeaveIn(m)} className={`py-1.5 ${leaveIn === m ? 'bg-cardinal text-white' : 'bg-white'}`}>{m ? `${m}m` : 'Now'}</button>)}
                  </div>
                </div>
                <div>
                  <div className="mb-1 text-xs font-semibold text-stone-500">Seats</div>
                  <div className="grid grid-cols-2 overflow-hidden rounded-lg text-xs font-semibold ring-1 ring-stone-300">
                    {[1, 2].map((s) => <button key={s} onClick={() => setSeats(s)} className={`px-3 py-1.5 ${seats === s ? 'bg-cardinal text-white' : 'bg-white'}`}>{s}</button>)}
                  </div>
                </div>
              </div>
              {quote && <div className="rounded-lg bg-stone-50 p-2 text-sm">Riding alone: about <b>{usd(quote.fare)}</b> · {quote.miles} mi · {quote.minutes} min</div>}
              {drop && <RecentCheck at={[drop.lat, drop.lng]} label={drop.label.split(',')[0]} compact />}
              {pickup && drop && <TripOptions from={[pickup.lat, pickup.lng]} to={[drop.lat, drop.lng]} compact />}
              {pickup && !drop && <FreeNow at={[pickup.lat, pickup.lng]} title="Free rides from here" query="free ride home tonight" />}
              <div>
                <div className="mb-1 text-xs font-semibold text-stone-500">Which friends can see you’re on their route</div>
                <div className="flex flex-wrap gap-1.5 text-xs font-semibold">
                  {([['friends', 'All friends'], ['lists', 'Chosen lists']] as const).map(([k, l]) => (
                    <button key={k} onClick={() => setShare({ mode: k, lists: k === 'lists' ? share.lists : [] })}
                      className={`rounded-full px-3 py-1 ring-1 disabled:opacity-40 ${share.mode === k ? 'bg-ink text-white ring-ink' : 'bg-white ring-stone-300'}`}>{l}</button>
                  ))}
                </div>
                {share.mode === 'lists' && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {account.data?.lists.map((l) => (
                      <button key={l.id} onClick={() => setShare({ mode: 'lists', lists: share.lists.includes(l.id) ? share.lists.filter((x) => x !== l.id) : [...share.lists, l.id] })}
                        className={`rounded-full px-3 py-1 text-xs font-semibold ring-1 ${share.lists.includes(l.id) ? 'bg-pink-600 text-white ring-pink-600' : 'bg-white ring-stone-300'}`}>
                        {share.lists.includes(l.id) ? '✓ ' : ''}{l.name} ({l.members.length})
                      </button>
                    ))}
                    {!account.data?.lists.length && <a href="/profile" className="text-xs font-semibold text-cardinal">Create a list in your profile →</a>}
                  </div>
                )}
                <p className="mt-1 text-[11px] text-stone-500">
                  {share.mode === 'friends' ? 'Only your friends booking the same route will see you.' : 'Only friends in the lists you pick will see you.'}
                  {' '}They never see where you’re picked up or dropped off until you both accept.
                </p>
              </div>
              {err && <p className="text-xs text-red-600">{err}</p>}
              <button onClick={book} disabled={!pickup || !drop} className="w-full rounded-xl bg-cardinal py-2.5 font-semibold text-white hover:bg-cardinal-dark disabled:opacity-40">Find riders on my route</button>
            </div>
          )}

          {ride && !!state?.incoming.length && (
            <div className="space-y-2">
              <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-amber-700"><span className="h-2 w-2 animate-pulse rounded-full bg-amber-500" />Wants to share with you</div>
              {state.incoming.map((j) => (
                <div key={j.joinId} className="rounded-xl bg-gold-50 p-3 text-sm ring-1 ring-gold">
                  <b>{j.from.name}</b>{j.from.friend ? ' 👋' : ''} is travelling on your route · leaves {inMin(j.from.departAt, now)}
                  <div className="text-xs text-emerald-700">You’d pay {usd(j.you.share)} instead of {usd(j.you.solo.fare)} (save {usd(j.you.saves)}, {j.you.savesPct}%)</div>
                  <div className="mt-2 flex gap-2">
                    <button onClick={() => rides.respond(j.joinId, true)} className="rounded-lg bg-emerald-600 px-3 py-1 text-xs font-semibold text-white">Accept</button>
                    <button onClick={() => rides.respond(j.joinId, false)} className="rounded-lg px-3 py-1 text-xs font-semibold ring-1 ring-stone-300">Decline</button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {ride?.status === 'matched' && ride.group && <GroupCard ride={ride} now={now} onCancel={() => rides.cancel(ride.id)} />}

          {ride?.status === 'open' && (
            <>
              <div className="rounded-2xl bg-white p-4 ring-1 ring-stone-200">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 font-semibold"><span className="h-2.5 w-2.5 animate-pulse rounded-full bg-emerald-500" />Finding riders on your route</div>
                  <button onClick={() => rides.cancel(ride.id)} className="text-xs text-stone-500 hover:text-cardinal">Cancel</button>
                </div>
                <div className="mt-1 truncate text-sm">{ride.pickup.label} → {ride.drop.label}</div>
                <div className="text-xs text-stone-500">booked {ago(ride.createdAt, now)} · leaves {inMin(ride.departAt, now)} · alone ≈ {usd(ride.solo.fare)}</div>
                <div className="mt-1 text-xs text-stone-500">Visible to: <b>{ride.share.mode === 'friends' ? 'friends on your route' : `lists: ${account.data?.lists.filter((l) => ride.share.lists.includes(l.id)).map((l) => l.name).join(', ') || '…'}`}</b></div>
                <a href={uberLink(ride.pickup, ride.drop)} target="_blank" rel="noreferrer" className="mt-2 inline-block text-xs font-semibold text-stone-500 hover:text-ink">Or ride alone now in Uber (prefilled) ↗</a>
              </div>

              <div className="flex items-center justify-between">
                <div className="text-xs font-bold uppercase tracking-wide text-stone-500">Friends on your route ({ride.matches.length})</div>
              </div>
              {ride.matches.length === 0 && <p className="rounded-xl bg-white p-4 text-sm text-stone-500 ring-1 ring-stone-200">None of your friends are on your route yet. If a friend books a similar trip, they’ll appear here live.</p>}
              <div className="space-y-2">
                <AnimatePresence>{ride.matches.map((m) => (
                  <MatchCard key={m.requestId} m={m} now={now}
                    onJoin={() => rides.join(m.requestId, ride.id).catch((e) => setErr((e as Error).message))} />
                ))}</AnimatePresence>
              </div>
              {err && <p className="text-xs text-red-600">{err}</p>}
            </>
          )}
          <p className="text-[11px] text-stone-400">Only friends can see each other here. Pickups, drop-offs and the stop order are shared only after both riders accept.</p>
        </aside>

        <div ref={mapBox} className={`relative h-[65vh] min-h-[320px] shrink-0 md:h-auto md:flex-1 md:shrink ${picking ? 'cursor-crosshair' : ''}`}>
          <MapContainer center={[34.04, -118.29]} zoom={12} className="h-full w-full">
            <Basemap />
            <ClickPick onPick={picking ? async (p) => {
              const which = picking; setPicking(null)
              const set = which === 'pickup' ? setPickup : setDrop
              set({ lat: p[0], lng: p[1], label: 'Dropped pin…' })
              try {  // show the real address of the spot you clicked
                const r = await (await fetch(`${API_URL}/api/places/reverse?lat=${p[0]}&lng=${p[1]}`)).json()
                set({ lat: p[0], lng: p[1], label: [r.label, (r.detail || '').split(',')[0]].filter(Boolean).join(', ') })
              } catch { set({ lat: p[0], lng: p[1], label: `Pin ${p[0].toFixed(4)}, ${p[1].toFixed(4)}` }) }
            } : null} />
            {preview && (
              <CircleMarker center={[preview.lat, preview.lng]} radius={10} pathOptions={{ color: '#990000', weight: 3, fillColor: '#ffc72c', fillOpacity: 1 }}>
                <Tooltip permanent direction="top" offset={[0, -8]}>{preview.label}</Tooltip>
              </CircleMarker>
            )}
            {preview && <PanTo p={[preview.lat, preview.lng]} />}
            {plan && <Polyline positions={plan.stops.map((s) => [s.lat, s.lng] as [number, number])} pathOptions={{ color: '#059669', weight: 5, opacity: 0.9 }} />}
            {plan?.stops.map((s, i) => (
              <CircleMarker key={`s${i}`} center={[s.lat, s.lng]} radius={8} pathOptions={{ color: '#fff', weight: 2, fillColor: s.kind === 'pickup' ? '#059669' : '#990000', fillOpacity: 1 }}>
                <Tooltip permanent direction="top" offset={[0, -6]}>{i + 1}. {s.kind === 'pickup' ? 'Pickup' : 'Drop'} {s.requestId === ride?.id ? 'you' : s.name}</Tooltip>
              </CircleMarker>
            ))}
            {!plan && myPts.length === 2 && <Polyline positions={myPts} pathOptions={{ color: '#990000', weight: 4, dashArray: '8 8' }} />}
            {!plan && myPts.map((p, i) => <CircleMarker key={`m${i}`} center={p} radius={9} pathOptions={{ color: '#fff', weight: 3, fillColor: i ? '#990000' : '#059669', fillOpacity: 1 }}><Tooltip permanent direction="top" offset={[0, -6]}>{i ? 'Your drop' : 'Your pickup'}</Tooltip></CircleMarker>)}
            <Fit pts={plan ? plan.stops.map((s) => [s.lat, s.lng]) : myPts} />
          </MapContainer>
          {picking && <div className="absolute left-1/2 top-3 z-[500] -translate-x-1/2 rounded-full bg-ink px-4 py-1.5 text-sm font-medium text-white">Click the map to set your {picking}</div>}
          <div className="pointer-events-none absolute bottom-6 right-3 z-[500] space-y-1 rounded-xl bg-white/95 px-3 py-2 text-[11px] shadow ring-1 ring-stone-200">
            <div><span className="mr-1.5 inline-block h-2.5 w-2.5 rounded-full bg-emerald-600 align-middle" />Your pickup <span className="ml-2 mr-1.5 inline-block h-2.5 w-2.5 rounded-full bg-cardinal align-middle" />Your drop</div>
            <div className="text-stone-500">Other riders’ stops appear after you both accept</div>
          </div>
        </div>
      </div>
    </div>
  )
}
