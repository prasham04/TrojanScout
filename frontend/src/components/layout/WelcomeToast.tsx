import { useEffect } from 'react'
import { Link, useSearchParams } from 'react-router'
import { useMe } from '../../lib/auth'

/** After sign-up + preferences: a short "you're in" note on the landing page with the next useful steps. */
export default function WelcomeToast() {
  const [params, setParams] = useSearchParams()
  const me = useMe()
  const show = params.get('welcome') === '1'
  useEffect(() => {
    if (!show) return
    const t = setTimeout(() => { params.delete('welcome'); setParams(params, { replace: true }) }, 9000)
    return () => clearTimeout(t)
  }, [show, params, setParams])
  if (!show) return null
  return (
    <div className="fixed bottom-5 left-1/2 z-[3000] w-[min(460px,calc(100vw-32px))] -translate-x-1/2 rounded-2xl bg-ink p-4 text-sm text-white shadow-2xl">
      <div className="font-bold">✓ You’re signed in{me.data ? `, ${me.data.name}` : ''}</div>
      <div className="mt-1 text-white/70">Next: add your home and emergency contacts, and invite friends to ride with.</div>
      <div className="mt-2 flex gap-3 text-xs font-semibold">
        <Link to="/profile" className="!text-gold">Set up profile →</Link>
        <Link to="/rides" className="!text-white/80">Book a ride</Link>
      </div>
    </div>
  )
}
