import { useState } from 'react'
import { useLocation } from 'react-router'
import { AnimatePresence, motion } from 'motion/react'
import { MessageCircle, Minus, X } from 'lucide-react'
import ChatPage from '../../pages/ChatPage'

/** Ask Scout on every page: a floating button that opens the chat. The conversation stays while you browse. */
export default function ScoutWidget() {
  const [open, setOpen] = useState(false)
  const [started, setStarted] = useState(false)
  const { pathname } = useLocation()
  if (pathname === '/ask') return null  // the full-page chat is already open
  return (
    <>
      {started && (
        <AnimatePresence>
          <motion.div key="scout" initial={false} animate={open ? { opacity: 1, y: 0, scale: 1 } : { opacity: 0, y: 16, scale: 0.97 }}
            transition={{ type: 'spring', stiffness: 380, damping: 32 }} style={{ pointerEvents: open ? 'auto' : 'none' }}
            className="glass fixed bottom-20 right-4 z-[2600] flex h-[min(620px,calc(100vh-7rem))] w-[min(420px,calc(100vw-2rem))] origin-bottom-right flex-col overflow-hidden rounded-3xl">
            <div className="relative flex items-center justify-between overflow-hidden bg-gradient-to-r from-cardinal to-cardinal-dark px-4 py-3 text-white">
              <div className="pointer-events-none absolute -right-10 -top-10 h-32 w-32 rounded-full bg-gold/30 blur-2xl" />
              <div className="relative flex items-center gap-2.5 font-bold"><span className="grid h-8 w-8 place-items-center rounded-xl bg-white/15 ring-1 ring-white/20">🐴</span>
                <span>Ask Scout<span className="block text-[11px] font-medium text-white/70">AI assistant · shows its work</span></span></div>
              <div className="relative flex gap-1">
                <button onClick={() => setOpen(false)} aria-label="Minimize" className="grid h-8 w-8 place-items-center rounded-full hover:bg-white/15"><Minus size={16} /></button>
                <button onClick={() => { setOpen(false); setStarted(false) }} aria-label="Close and clear" className="grid h-8 w-8 place-items-center rounded-full hover:bg-white/15"><X size={16} /></button>
              </div>
            </div>
            <div className="min-h-0 flex-1 bg-white/40"><ChatPage embedded /></div>
          </motion.div>
        </AnimatePresence>
      )}
      <motion.button data-tour="scout" whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.96 }} onClick={() => { setStarted(true); setOpen(!open) }}
        className="btn-glow fixed bottom-4 right-4 z-[2600] flex items-center gap-2 rounded-full bg-gradient-to-r from-cardinal to-cardinal-dark py-2.5 pl-2.5 pr-4 font-semibold text-white ring-2 ring-white/80">
        <span className="grid h-8 w-8 place-items-center rounded-full bg-gold text-ink"><MessageCircle size={16} /></span>{open ? 'Close Scout' : 'Ask Scout'}
      </motion.button>
    </>
  )
}
