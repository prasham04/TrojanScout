import { useEffect, useState } from 'react'
import { API_URL } from '../../api/client'

/** Wake the backend as soon as the site opens. On Render's free plan both services sleep after 15 idle
 *  minutes; this starts them booting while the visitor is still on the landing page. Fire-and-forget. */
export function wakeBackend() {
  fetch(`${API_URL}/api/warm`).catch(() => { /* nothing to do: the next real request wakes it too */ })
}

/** Shown only if a load takes longer than a few seconds, i.e. the free servers are waking up. */
export default function WakingNote({ active, after = 4000 }: { active: boolean; after?: number }) {
  const [slow, setSlow] = useState(false)
  useEffect(() => {
    if (!active) { setSlow(false); return }
    const t = setTimeout(() => setSlow(true), after)
    return () => clearTimeout(t)
  }, [active, after])
  if (!slow) return null
  return (
    <div role="status" className="flex items-center gap-2 rounded-2xl bg-gold-50 px-4 py-3 text-sm text-stone-700 ring-1 ring-gold/40 sm:col-span-2">
      <span className="live-dot h-2 w-2 shrink-0 rounded-full bg-gold" />
      Waking up the server. The first load after a quiet period can take up to a minute; after that it's instant.
    </div>
  )
}
