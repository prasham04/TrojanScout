import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router'
import { useQueryClient } from '@tanstack/react-query'
import { meApi, saveSession, signIn } from '../lib/auth'
import { useAppStore } from '../store/useAppStore'
import type { Profile } from '../api/types'

/** Landing spot after the identity provider: the session token arrives in the URL fragment (never sent to a server log). */
export default function AuthDonePage() {
  const nav = useNavigate()
  const qc = useQueryClient()
  const setProfile = useAppStore((s) => s.setProfile)
  const [error, setError] = useState('')
  useEffect(() => {
    const h = new URLSearchParams(window.location.hash.slice(1))
    history.replaceState(null, '', '/auth/done')
    if (h.get('error')) { setError(h.get('error')!); return }
    const t = h.get('token')
    if (!t) { setError('No sign-in token received'); return }
    meApi.get(t).then((me) => {
      saveSession(t, me); qc.setQueryData(['me'], me); qc.invalidateQueries()
      if (me.preferences) setProfile(me.preferences as unknown as Partial<Profile>)  // your saved preferences, on any device
      nav(h.get('return') || '/', { replace: true })
    }).catch(() => setError('Could not load your profile'))
  }, [nav, qc, setProfile])
  return (
    <div className="grid h-full place-items-center p-6 text-center">
      {error ? (
        <div className="space-y-3">
          <p className="font-semibold text-red-700">{error}</p>
          <button onClick={() => signIn('/profile')} className="rounded-xl bg-cardinal px-4 py-2 font-semibold text-white">Try again</button>
        </div>
      ) : <p className="text-stone-500">Signing you in…</p>}
    </div>
  )
}
