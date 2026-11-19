import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Aurora } from '../ui/fx'

/** "TrojanScout" loader shown for 3 seconds when the site is opened or reloaded on the landing page. */
export default function Splash({ ms = 3000 }: { ms?: number }) {
  const [show, setShow] = useState(() => window.location.pathname === '/')
  useEffect(() => {
    if (!show) return
    const t = setTimeout(() => setShow(false), ms)
    return () => clearTimeout(t)
  }, [show, ms])

  return (
    <AnimatePresence>
      {show && (
        <motion.div key="splash" role="status" aria-label="Loading TrojanScout"
          initial={{ opacity: 1 }} exit={{ opacity: 0, scale: 1.04 }} transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
          className="fixed inset-0 z-[5000] grid place-items-center overflow-hidden bg-[#2a0000] text-white">
          <div className="absolute inset-0 bg-gradient-to-br from-cardinal via-[#7a0000] to-[#1a0000]" />
          <Aurora />
          <div className="absolute inset-0 opacity-[0.07] [background-image:radial-gradient(rgb(255_255_255)_1px,transparent_1px)] [background-size:22px_22px]" />

          <div className="relative flex flex-col items-center">
            <motion.span initial={{ scale: 0.6, rotate: -12, opacity: 0 }} animate={{ scale: 1, rotate: 0, opacity: 1 }}
              transition={{ type: 'spring', stiffness: 220, damping: 16 }}
              className="relative grid h-20 w-20 place-items-center rounded-3xl bg-gradient-to-br from-gold to-[#ffb000] text-3xl font-extrabold text-cardinal shadow-[0_0_60px_-6px_rgba(255,199,44,.8)]">
              TS
              <motion.span className="absolute inset-0 rounded-3xl ring-2 ring-gold/70" animate={{ scale: [1, 1.35], opacity: [0.8, 0] }} transition={{ duration: 1.4, repeat: Infinity, ease: 'easeOut' }} />
            </motion.span>

            <motion.h1 initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25, duration: 0.6 }}
              className="mt-6 text-4xl font-extrabold tracking-tight sm:text-5xl">
              Trojan<span className="font-display text-5xl font-normal italic text-gold sm:text-6xl">Scout</span>
            </motion.h1>
            <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.55, duration: 0.6 }} className="mt-2 text-sm text-white/70">
              Find a home where USC has your back.
            </motion.p>

            <div className="mt-8 h-1 w-48 overflow-hidden rounded-full bg-white/15">
              <motion.div className="h-full rounded-full bg-gradient-to-r from-gold to-white shadow-[0_0_12px_rgba(255,199,44,.9)]"
                initial={{ width: '0%' }} animate={{ width: '100%' }} transition={{ duration: ms / 1000 - 0.2, ease: [0.4, 0, 0.2, 1] }} />
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
