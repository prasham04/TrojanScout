import { useState } from 'react'
import { motion } from 'motion/react'
import { GripVertical } from 'lucide-react'
import { Ring } from '../components/ui/fx'
import { Link } from 'react-router'
import { meApi, signIn, signOut, token, useMe, useSetMe, type FriendList, type Me } from '../lib/auth'
import PlaceInput from '../components/rides/PlaceInput'
import { QUICK_PICKUPS } from '../lib/rides'

const card = 'card p-5'
const input = 'w-full rounded-lg border border-stone-300 px-3 py-2 text-sm'

function Section({ icon, title, hint, children }: { icon: string; title: string; hint: string; children: React.ReactNode }) {
  return (
    <section className={card}>
      <div className="mb-3 flex items-start gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-cardinal-50 to-gold-50 text-base ring-1 ring-cardinal/10">{icon}</span>
        <div><h2 className="font-bold leading-tight">{title}</h2><p className="text-xs text-stone-500">{hint}</p></div>
      </div>
      {children}
    </section>
  )
}
const Avatar = ({ name }: { name: string }) => <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-cardinal text-sm font-bold text-gold">{name[0]?.toUpperCase()}</span>

function ListEditor({ me, list, onSave, onCancel }: { me: Me; list?: FriendList; onSave: (l: { id?: string; name: string; members: string[] }) => void; onCancel: () => void }) {
  const [name, setName] = useState(list?.name ?? '')
  const [members, setMembers] = useState<string[]>(list?.members ?? [])
  const toggle = (id: string) => setMembers(members.includes(id) ? members.filter((m) => m !== id) : [...members, id])
  return (
    <div className="space-y-2 rounded-xl bg-stone-50 p-3 ring-1 ring-stone-200">
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="List name, e.g. Roommates" maxLength={30} className={input} autoFocus />
      <div className="flex flex-wrap gap-1.5">
        {me.friends.map((f) => (
          <button key={f.id} onClick={() => toggle(f.id)} className={`rounded-full px-3 py-1 text-xs font-semibold ring-1 ${members.includes(f.id) ? 'bg-cardinal text-white ring-cardinal' : 'bg-white ring-stone-300'}`}>
            {members.includes(f.id) ? '✓ ' : ''}{f.name}
          </button>
        ))}
        {!me.friends.length && <span className="text-xs text-stone-500">Add friends first; lists are made of friends.</span>}
      </div>
      <div className="flex gap-2">
        <button disabled={!name.trim()} onClick={() => onSave({ id: list?.id, name: name.trim(), members })} className="rounded-lg bg-ink px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40">Save list</button>
        <button onClick={onCancel} className="rounded-lg px-3 py-1.5 text-xs font-semibold text-stone-600 ring-1 ring-stone-300">Cancel</button>
      </div>
    </div>
  )
}

export default function ProfilePage() {
  const q = useMe()
  const setMe = useSetMe()
  const [msg, setMsg] = useState('')
  const [contact, setContact] = useState({ name: '', phone: '', email: '', relation: 'Roommate' })
  const [friendEmail, setFriendEmail] = useState('')
  const [editing, setEditing] = useState<string | 'new' | null>(null)

  if (!token()) return (
    <div className="mx-auto max-w-md p-8 text-center">
      <h1 className="text-2xl font-extrabold">Your profile</h1>
      <p className="mt-2 text-sm text-stone-500">Sign in with your USC email to save your home, add emergency contacts and ride with friends.</p>
      <button onClick={() => signIn('/profile')} className="mt-5 rounded-xl bg-cardinal px-5 py-2.5 font-semibold text-white">Sign in</button>
    </div>
  )
  const me = q.data
  if (!me) return <div className="p-8 text-stone-500">{q.isError ? <>Session expired. <button onClick={() => signIn('/profile')} className="font-semibold text-cardinal">Sign in again</button></> : 'Loading…'}</div>

  const run = async (p: Promise<Me | { profile: Me; status: string }>) => {
    setMsg('')
    try {
      const r = await p
      if ('profile' in r) {
        setMe(r.profile)
        setMsg({ sent: 'Friend request sent. They’ll see it in their profile and alerts.', invited: 'No account with that email yet. They’ll see your request as soon as they sign up.', friends: 'You’re already friends.', accepted: 'They had already asked you, so you’re now friends.', self: 'That’s your own email.' }[r.status] ?? '')
      } else setMe(r)
    } catch (e) { setMsg((e as Error).message) }
  }
  const host = (() => { try { return new URL(me.issuer).host } catch { return me.issuer } })()
  const nameOf = (id: string) => me.friends.find((f) => f.id === id)?.name ?? '…'
  const done = [!!me.home, me.contacts.length > 0, me.friends.length > 0, me.lists.length > 0].filter(Boolean).length
  // drag a friend onto a list to add them
  const dropOn = (l: FriendList, id: string) => { if (id && !l.members.includes(id)) run(meApi.saveList({ id: l.id, name: l.name, members: [...l.members, id] })) }

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4 md:p-6">
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="relative flex flex-wrap items-center gap-4 overflow-hidden rounded-3xl bg-gradient-to-br from-cardinal via-[#7a0000] to-[#2a0000] p-5 text-white shadow-[0_24px_60px_-24px_rgba(153,0,0,.7)]">
        <div className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full bg-gold/25 blur-3xl" />
        <span className="relative grid h-16 w-16 place-items-center rounded-2xl bg-gold text-3xl font-extrabold text-cardinal shadow-lg">{me.name[0]?.toUpperCase()}</span>
        <div className="min-w-0 flex-1">
          <input defaultValue={me.name} onBlur={(e) => e.target.value.trim() && e.target.value !== me.name && run(meApi.patch({ name: e.target.value.trim() }))}
            className="relative w-full rounded-lg bg-transparent px-1 text-2xl font-extrabold text-white hover:bg-white/10 focus:bg-white/10 focus:outline-none" aria-label="Your name" />
          <div className="relative px-1 text-sm text-white/75">{me.email} <span className="text-emerald-300">· verified</span></div>
          <div className="relative px-1 text-[11px] text-white/50">Signed in with OpenID Connect via {host}</div>
        </div>
        <div className="relative flex items-center gap-3">
          <span title={`Profile ${done}/4 done: home, emergency contacts, friends, lists`} className="flex items-center gap-2 rounded-2xl bg-white/10 px-3 py-2 ring-1 ring-white/15">
            <Ring value={(done / 4) * 100} size={42} color="#ffc72c" track="rgb(255 255 255 / .2)" label={<span className="text-white">{done}/4</span>} />
            <span className="text-xs leading-tight text-white/80">Profile<br /><b className="text-white">{done === 4 ? 'complete' : 'in progress'}</b></span>
          </span>
          <div className="flex flex-col gap-1.5">
            <Link to="/preferences" className="rounded-xl bg-white/15 px-3 py-1.5 text-center text-sm font-semibold !text-white ring-1 ring-white/20 hover:bg-white/25">Preferences</Link>
            <button onClick={signOut} className="rounded-xl px-3 py-1.5 text-sm font-semibold text-white/80 ring-1 ring-white/20 hover:bg-white/10">Sign out</button>
          </div>
        </div>
      </motion.div>

      {msg && <p className="rounded-lg bg-stone-100 px-3 py-2 text-sm">{msg}</p>}

      <Section icon="🏠" title="Home" hint="You get an alert when USC DPS reports an incident within 600 m of home. It’s also the default pickup for rides.">
        {me.home ? (
          <div className="flex items-center justify-between rounded-lg bg-stone-50 px-3 py-2 text-sm"><span>{me.home.label}</span><button onClick={() => run(meApi.patch({ home: null }))} className="text-xs text-stone-500 hover:text-cardinal">change</button></div>
        ) : <PlaceInput label="Home" value={null} onChange={(p) => p && run(meApi.patch({ home: p }))} quick={QUICK_PICKUPS} picking={false} onPickMap={() => {}} onPreview={() => {}} />}
      </Section>

      <Section icon="🆘" title="Emergency contacts" hint="One tap from a safe route texts them your route and ETA. TrojanScout never messages anyone without you pressing send.">
        <ul className="mb-3 space-y-2">
          {me.contacts.map((c) => (
            <li key={c.id} className="flex items-center gap-3 rounded-lg bg-stone-50 px-3 py-2 text-sm">
              <Avatar name={c.name} />
              <div className="min-w-0 flex-1"><b>{c.name}</b> <span className="text-xs text-stone-500">· {c.relation}</span><div className="text-xs text-stone-500">{c.phone}{c.email ? ` · ${c.email}` : ''}</div></div>
              <a href={`tel:${c.phone.replace(/[^\d+]/g, '')}`} className="text-xs font-semibold text-cardinal">Call</a>
              <button onClick={() => run(meApi.removeContact(c.id))} className="text-xs text-stone-400 hover:text-cardinal">Remove</button>
            </li>
          ))}
        </ul>
        <form onSubmit={(e) => { e.preventDefault(); run(meApi.addContact({ ...contact, emergency: true })).then(() => setContact({ name: '', phone: '', email: '', relation: 'Roommate' })) }} className="grid gap-2 sm:grid-cols-2">
          <input required placeholder="Name" value={contact.name} onChange={(e) => setContact({ ...contact, name: e.target.value })} className={input} />
          <input required placeholder="Phone" value={contact.phone} onChange={(e) => setContact({ ...contact, phone: e.target.value })} className={input} />
          <input type="email" placeholder="Email (optional)" value={contact.email} onChange={(e) => setContact({ ...contact, email: e.target.value })} className={input} />
          <select value={contact.relation} onChange={(e) => setContact({ ...contact, relation: e.target.value })} className={input}>
            {['Roommate', 'Friend', 'Parent', 'Partner', 'RA', 'Other'].map((r) => <option key={r}>{r}</option>)}
          </select>
          <button className="rounded-lg bg-ink py-2 text-sm font-semibold text-white sm:col-span-2">Add contact</button>
        </form>
      </Section>

      <Section icon="👋" title="Friends" hint="Send a request by email; they accept it from their profile or alerts. Friends can see that you’re on their route only if you choose to share with them.">
        {me.incoming.length > 0 && (
          <div className="mb-3 space-y-2">
            <div className="text-xs font-bold uppercase tracking-wide text-amber-700">Requests for you</div>
            {me.incoming.map((u) => (
              <div key={u.id} className="flex items-center gap-3 rounded-lg bg-gold-50 px-3 py-2 text-sm ring-1 ring-gold">
                <Avatar name={u.name} /><div className="flex-1"><b>{u.name}</b><div className="text-xs text-stone-500">{u.email}</div></div>
                <button onClick={() => run(meApi.respond(u.id, true))} className="rounded-lg bg-emerald-600 px-3 py-1 text-xs font-semibold text-white">Accept</button>
                <button onClick={() => run(meApi.respond(u.id, false))} className="text-xs text-stone-500">Decline</button>
              </div>
            ))}
          </div>
        )}
        <form onSubmit={(e) => { e.preventDefault(); if (friendEmail.trim()) run(meApi.addFriend(friendEmail.trim())).then(() => setFriendEmail('')) }} className="mb-3 flex gap-2">
          <input type="email" required placeholder="Friend’s USC email" value={friendEmail} onChange={(e) => setFriendEmail(e.target.value)} className={input} />
          <button className="shrink-0 rounded-lg bg-cardinal px-4 text-sm font-semibold text-white">Send request</button>
        </form>
        <ul className="space-y-2">
          {me.friends.map((u) => (
            <li key={u.id} draggable onDragStart={(e) => { e.dataTransfer.setData('text/friend', u.id); e.dataTransfer.effectAllowed = 'copy' }}
              title={me.lists.length ? 'Drag onto a list below to add them' : undefined}
              className="flex cursor-grab items-center gap-3 rounded-xl bg-stone-50 px-3 py-2 text-sm ring-1 ring-transparent transition hover:ring-cardinal/30 active:cursor-grabbing">
              {me.lists.length > 0 && <GripVertical size={14} className="text-stone-300" />}
              <Avatar name={u.name} />
              <div className="min-w-0 flex-1"><b>{u.name}</b><div className="text-xs text-stone-500">{u.email}{me.lists.some((l) => l.members.includes(u.id)) ? ` · in ${me.lists.filter((l) => l.members.includes(u.id)).map((l) => l.name).join(', ')}` : ''}</div></div>
              <button onClick={() => run(meApi.removeFriend(u.id))} className="text-xs text-stone-400 hover:text-cardinal">Remove</button>
            </li>
          ))}
          {me.outgoing.map((u) => (
            <li key={u.id} className="flex items-center gap-3 px-3 py-1 text-sm text-stone-500"><Avatar name={u.name} /><span className="flex-1">{u.name} · waiting for them to accept</span>
              <button onClick={() => run(meApi.cancelRequest(u.id))} className="text-xs hover:text-cardinal">Cancel</button></li>
          ))}
          {me.invited.map((e) => (
            <li key={e} className="flex items-center gap-3 px-3 py-1 text-sm text-stone-500"><span className="grid h-9 w-9 place-items-center rounded-full bg-stone-200">✉</span><span className="flex-1">{e} · invited, no account yet</span>
              <button onClick={() => run(meApi.cancelRequest(e))} className="text-xs hover:text-cardinal">Cancel</button></li>
          ))}
          {!me.friends.length && !me.outgoing.length && !me.invited.length && <li className="text-sm text-stone-500">No friends yet.</li>}
        </ul>
        {me.suggestions.length > 0 && (
          <div className="mt-4">
            <div className="mb-2 text-xs font-bold uppercase tracking-wide text-stone-500">From your contacts</div>
            <div className="flex flex-wrap gap-2">
              {me.suggestions.map((s) => (
                <button key={s.id} onClick={() => run(meApi.addFriend(s.email))} className="flex items-center gap-2 rounded-full bg-white py-1 pl-1 pr-3 text-sm ring-1 ring-stone-200 hover:ring-cardinal">
                  <Avatar name={s.name} />{s.name}<span className="font-bold text-cardinal">+</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </Section>

      <Section icon="🗂" title="Ride-sharing lists" hint="Group friends (e.g. Roommates, Lab group). When you book a ride you choose which lists may see it. They only learn that you’re on their route, never your pickup or drop-off, until you both accept.">
        <div className="space-y-2">
          {me.lists.map((l) => editing === l.id
            ? <ListEditor key={l.id} me={me} list={l} onCancel={() => setEditing(null)} onSave={(x) => run(meApi.saveList(x)).then(() => setEditing(null))} />
            : (
              <div key={l.id} onDragOver={(e) => { e.preventDefault(); e.currentTarget.dataset.over = '1' }} onDragLeave={(e) => { delete e.currentTarget.dataset.over }}
                onDrop={(e) => { e.preventDefault(); delete e.currentTarget.dataset.over; dropOn(l, e.dataTransfer.getData('text/friend')) }}
                className="flex items-center gap-3 rounded-2xl bg-stone-50 px-3 py-2.5 text-sm ring-1 ring-stone-200 transition data-[over]:bg-cardinal-50 data-[over]:ring-2 data-[over]:ring-cardinal">
                <div className="min-w-0 flex-1"><b>{l.name}</b> <span className="text-xs text-stone-500">· {l.members.length} {l.members.length === 1 ? 'friend' : 'friends'}</span>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {l.members.map((m) => (
                      <span key={m} className="flex items-center gap-1 rounded-full bg-white px-2 py-0.5 text-xs ring-1 ring-stone-200">{nameOf(m)}
                        <button onClick={() => run(meApi.saveList({ id: l.id, name: l.name, members: l.members.filter((x) => x !== m) }))} aria-label={`Remove ${nameOf(m)}`} className="text-stone-400 hover:text-cardinal">×</button></span>
                    ))}
                    {!l.members.length && <span className="text-xs text-stone-400">Drag friends here</span>}
                  </div></div>
                <button onClick={() => setEditing(l.id)} className="text-xs font-semibold text-cardinal">Edit</button>
                <button onClick={() => run(meApi.deleteList(l.id))} className="text-xs text-stone-400 hover:text-cardinal">Delete</button>
              </div>
            ))}
          {editing === 'new'
            ? <ListEditor me={me} onCancel={() => setEditing(null)} onSave={(x) => run(meApi.saveList(x)).then(() => setEditing(null))} />
            : <button onClick={() => setEditing('new')} className="w-full rounded-lg py-2 text-sm font-semibold text-cardinal ring-1 ring-cardinal/40 hover:bg-cardinal/5">+ New list</button>}
        </div>
      </Section>
    </div>
  )
}
