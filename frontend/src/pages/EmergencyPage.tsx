import { useMemo, useState } from 'react'
import { Link } from 'react-router'
import { Check, Copy, MessageSquare, Phone, Search, ShieldAlert, Siren, UserPlus } from 'lucide-react'
import { token, useMe } from '../lib/auth'
import StickyBar from '../components/ui/StickyBar'

interface Line { name: string; detail: string; call?: string; text?: { to: string; body?: string; label: string }; hours?: string }
interface Group { title: string; icon: string; tone: string; lines: Line[] }

// Numbers checked against official / provider pages (Nov 2026). Tap to call or text on a phone.
const GROUPS: Group[] = [
  { title: 'Emergency right now', icon: '🚨', tone: 'bg-red-700 text-white', lines: [
    { name: 'Police, fire, medical', detail: 'Call if you can. In LA County you can text 911 if you can’t speak safely (English only; turn on location).', call: '911', text: { to: '911', label: 'Text 911' }, hours: '24/7' },
    { name: 'USC DPS: University Park Campus', detail: 'USC Department of Public Safety, emergency line for UPC and the patrol area around it.', call: '213-740-4321', hours: '24/7' },
    { name: 'USC DPS: Health Sciences Campus', detail: 'Emergency line for HSC and its patrol area.', call: '323-442-1000', hours: '24/7' },
  ] },
  { title: 'Crisis & mental health', icon: '💬', tone: 'bg-violet-700 text-white', lines: [
    { name: '988 Suicide & Crisis Lifeline', detail: 'Free, confidential support by call or text. In LA County, calls go to a local crisis center. Veterans press 1.', call: '988', text: { to: '988', label: 'Text 988' }, hours: '24/7' },
    { name: 'LA County Mental Health 24/7 Help Line', detail: 'Crisis support, referrals and a mobile team that can come to someone in a mental-health crisis. Press 1 for mental health, 2 for substance use.', call: '800-854-7771', hours: '24/7' },
    { name: 'USC Counseling and Mental Health', detail: 'Talk to a USC counselor any time, including after hours.', call: '213-740-9355', hours: '24/7' },
    { name: 'Crisis Text Line', detail: 'Text with a trained crisis counselor.', text: { to: '741741', body: 'HOME', label: 'Text HOME to 741741' }, hours: '24/7' },
    { name: 'California Youth Crisis Line', detail: 'For ages 12–24 and adults supporting them. Call, text or chat.', call: '800-843-5200', hours: '24/7' },
    { name: 'The Trevor Project', detail: 'Crisis support for LGBTQ+ young people.', call: '866-488-7386', hours: '24/7' },
  ] },
  { title: 'Sexual assault & relationship violence', icon: '🤝', tone: 'bg-pink-700 text-white', lines: [
    { name: 'Peace Over Violence: LA Rape & Battering Hotline', detail: 'Central LA line. Support, accompaniment and advocacy in English, Spanish and ASL. South LA: 310-392-8381.', call: '213-626-3393', hours: '24/7' },
    { name: 'National Domestic Violence Hotline', detail: 'Safety planning and local shelters.', call: '800-799-7233', text: { to: '88788', body: 'START', label: 'Text START to 88788' }, hours: '24/7' },
    { name: 'RAINN National Sexual Assault Hotline', detail: 'Connects you to a local sexual assault service provider.', call: '800-656-4673', hours: '24/7' },
    { name: 'National Human Trafficking Hotline', detail: 'Report or get help, confidentially.', call: '888-373-7888', text: { to: '233733', label: 'Text 233733' }, hours: '24/7' },
  ] },
  { title: 'Health', icon: '🩺', tone: 'bg-emerald-700 text-white', lines: [
    { name: 'Poison Control (California Poison Control System)', detail: 'Overdoses, swallowed chemicals, bites and medication mistakes. Free and confidential.', call: '800-222-1222', hours: '24/7' },
  ] },
  { title: 'Non-emergency', icon: '📞', tone: 'bg-stone-700 text-white', lines: [
    { name: 'USC DPS non-emergency: UPC', detail: 'Report something that already happened, or ask for help that isn’t urgent.', call: '213-740-6000' },
    { name: 'USC DPS non-emergency: HSC', detail: 'Non-urgent help at the Health Sciences Campus.', call: '323-442-1200' },
    { name: 'LAPD non-emergency', detail: '1-877-ASK-LAPD, for incidents in the City of Los Angeles that aren’t emergencies.', call: '877-275-5273' },
    { name: '211 LA County', detail: 'Shelters, food, housing help and other local services.', call: '211', hours: '24/7' },
    { name: 'MyLA311', detail: 'City services: broken streetlights, graffiti, illegal dumping.', call: '311' },
  ] },
]

const tel = (n: string) => `tel:${n.replace(/[^\d+]/g, '')}`
const sms = (t: NonNullable<Line['text']>) => `sms:${t.to}${t.body ? `?&body=${encodeURIComponent(t.body)}` : ''}`
/** A .vcf card so the number can be saved in the phone's contacts. */
const vcard = (l: Line) => `data:text/vcard;charset=utf-8,${encodeURIComponent(`BEGIN:VCARD\nVERSION:3.0\nFN:${l.name}\nTEL;TYPE=VOICE:${l.call}\nNOTE:${l.detail}\nEND:VCARD\n`)}`
const FILTERS = [{ k: '', label: 'All' }, { k: 'Crisis', label: 'Crisis & mental health' }, { k: 'Sexual', label: 'Violence' }, { k: 'Health', label: 'Health' }, { k: 'Non-emergency', label: 'Non-emergency' }]

function CopyBtn({ n }: { n: string }) {
  const [done, setDone] = useState(false)
  return (
    <button onClick={() => { navigator.clipboard?.writeText(n); setDone(true); setTimeout(() => setDone(false), 1500) }} title="Copy number"
      className="grid h-8 w-8 place-items-center rounded-lg text-stone-500 ring-1 ring-stone-200 transition hover:bg-stone-50 hover:text-ink">{done ? <Check size={14} className="text-emerald-600" /> : <Copy size={14} />}</button>
  )
}

export default function EmergencyPage() {
  const me = useMe()
  const mine = token() ? me.data?.contacts ?? [] : []
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState('')
  const [primary, ...rest] = GROUPS
  const groups = useMemo(() => rest
    .filter((g) => !filter || g.title.startsWith(filter))
    .map((g) => ({ ...g, lines: g.lines.filter((l) => !q || `${l.name} ${l.detail} ${l.call ?? ''}`.toLowerCase().includes(q.toLowerCase())) }))
    .filter((g) => g.lines.length), [rest, filter, q])

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-8">
      <div>
        <p className="eyebrow">Los Angeles · USC</p>
        <h1 className="mt-1 text-4xl font-extrabold tracking-tight">Emergency <span className="font-display font-normal italic text-red-700">contacts</span></h1>
        <p className="mt-1 text-stone-500">Every number a student in Los Angeles might need, in one place. On a phone, tap to call or text.</p>
      </div>

      {/* the three that matter most, as big tap tiles */}
      <div className="grid gap-3 md:grid-cols-[1.3fr_1fr_1fr]">
        {primary.lines.map((l, i) => (
          <a key={l.name} href={tel(l.call!)} className={`group relative flex min-h-40 flex-col justify-between overflow-hidden rounded-3xl p-5 !text-white transition hover:-translate-y-0.5 ${i === 0 ? 'bg-gradient-to-br from-red-600 to-red-800 shadow-[0_24px_50px_-20px_rgba(185,28,28,.8)]' : 'bg-gradient-to-br from-cardinal to-[#4a0000] shadow-[0_20px_40px_-22px_rgba(153,0,0,.8)]'}`}>
            <div className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full bg-white/10 blur-2xl" />
            <span className="relative flex items-center gap-2 text-sm font-semibold text-white/85">{i === 0 ? <Siren size={18} /> : <ShieldAlert size={18} />}{l.name}</span>
            <span className={`relative num whitespace-nowrap font-bold tracking-tight ${i === 0 ? 'text-5xl sm:text-6xl' : 'text-2xl sm:text-3xl'}`}>{l.call}</span>
            <span className="relative flex items-center justify-between gap-2 text-xs text-white/75"><span className="line-clamp-2">{l.detail}</span><span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-white/15 ring-1 ring-white/25 transition group-hover:bg-white group-hover:text-red-700"><Phone size={18} /></span></span>
          </a>
        ))}
      </div>
      {primary.lines[0].text && <p className="-mt-3 text-xs text-stone-500">Can’t speak safely? <a href={sms(primary.lines[0].text)} className="font-semibold text-red-700 underline">Text 911</a> (LA County; English only; turn on location).</p>}

      <section className="card p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 font-bold"><UserPlus size={17} className="text-cardinal" />Your emergency contacts</h2>
          <Link to="/profile" className="text-sm font-semibold text-cardinal">{mine.length ? 'Edit in profile →' : 'Add them in your profile →'}</Link>
        </div>
        {mine.length > 0 ? (
          <div className="mt-3 flex flex-wrap gap-2">
            {mine.map((c) => (
              <a key={c.id} href={tel(c.phone)} className="flex items-center gap-2 rounded-2xl bg-stone-50 px-3 py-2 text-sm !text-ink ring-1 ring-stone-200 hover:ring-cardinal">
                <span className="grid h-8 w-8 place-items-center rounded-full bg-gradient-to-br from-cardinal to-cardinal-dark text-xs font-bold text-gold">{c.name[0]?.toUpperCase()}</span>
                <span><b>{c.name}</b><span className="block text-xs text-stone-500">{c.relation} · <span className="num">{c.phone}</span></span></span>
              </a>
            ))}
          </div>
        ) : <p className="mt-1 text-sm text-stone-500">{token() ? 'You haven’t added any yet.' : 'Sign in to keep your own emergency contacts here too.'}</p>}
      </section>

      <StickyBar className="flex flex-wrap items-center gap-2 p-2">
        <div className="flex min-w-[14rem] flex-1 items-center gap-2 px-2"><Search size={16} className="text-stone-400" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search: crisis, poison, LAPD, 988…" className="min-w-0 flex-1 bg-transparent py-1.5 text-sm outline-none" /></div>
        <div className="flex flex-wrap gap-1">
          {FILTERS.map((f) => <button key={f.k} onClick={() => setFilter(f.k)} className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${filter === f.k ? 'bg-ink text-white' : 'text-stone-600 hover:bg-stone-100'}`}>{f.label}</button>)}
        </div>
      </StickyBar>

      <div className="grid gap-4 lg:grid-cols-2">
        {groups.map((g) => (
          <section key={g.title} className="card overflow-hidden">
            <div className={`flex items-center gap-2 px-4 py-3 font-bold ${g.tone}`}><span>{g.icon}</span>{g.title}</div>
            <ul className="divide-y divide-stone-100">
              {g.lines.map((l) => (
                <li key={l.name} className="px-4 py-3">
                  <div className="flex items-start gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="font-semibold leading-snug">{l.name}{l.hours && <span className="ml-2 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700 ring-1 ring-emerald-200">{l.hours}</span>}</div>
                      <p className="text-sm text-stone-600">{l.detail}</p>
                    </div>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    {l.call && <a href={tel(l.call)} className="flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-cardinal to-cardinal-dark px-3 py-1.5 text-sm font-bold !text-white shadow-md shadow-cardinal/20"><Phone size={14} /><span className="num">{l.call}</span></a>}
                    {l.text && <a href={sms(l.text)} className="flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-sm font-semibold !text-stone-700 ring-1 ring-stone-300 hover:bg-stone-50"><MessageSquare size={14} />{l.text.label}</a>}
                    {l.call && <CopyBtn n={l.call} />}
                    {l.call && <a href={vcard(l)} download={`${l.name.replace(/[^\w ]+/g, '').slice(0, 40)}.vcf`} title="Save to your phone's contacts" className="grid h-8 w-8 place-items-center rounded-lg text-stone-500 ring-1 ring-stone-200 hover:bg-stone-50 hover:text-ink"><UserPlus size={14} /></a>}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ))}
        {!groups.length && <p className="text-sm text-stone-500">No number matches “{q}”.</p>}
      </div>
      <p className="text-center text-xs text-stone-400">Checked November 2026. If a number has changed, the official site of that service is the final word. In an emergency, always call 911.</p>
    </div>
  )
}
