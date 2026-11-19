import { useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

// "?" that explains a metric. The note renders in a portal at the top of the page (position: fixed),
// so no scroll container, map pane or popup can clip it; it flips/clamps to stay inside the viewport.
export default function InfoTip({ children }: { children: React.ReactNode; side?: 'bottom' | 'left' }) {
  const [open, setOpen] = useState(false)
  const btn = useRef<HTMLButtonElement>(null)
  const tip = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)

  useLayoutEffect(() => {
    if (!open || !btn.current || !tip.current) return
    const b = btn.current.getBoundingClientRect()
    const t = tip.current.getBoundingClientRect()
    const pad = 8
    let left = b.left + b.width / 2 - t.width / 2
    left = Math.max(pad, Math.min(left, window.innerWidth - t.width - pad))
    let top = b.bottom + 8
    if (top + t.height > window.innerHeight - pad) top = b.top - t.height - 8   // flip above
    setPos({ left, top: Math.max(pad, top) })
  }, [open])

  return (
    <>
      <button ref={btn} type="button" aria-label="Explain"
        onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)} onFocus={() => setOpen(true)} onBlur={() => setOpen(false)}
        onClick={(e) => { e.stopPropagation(); setOpen((o) => !o) }}
        className="inline-grid h-4 w-4 place-items-center rounded-full bg-stone-200 align-middle text-[10px] font-bold text-stone-600 hover:bg-cardinal hover:text-white">?</button>
      {open && createPortal(
        <div ref={tip} role="tooltip"
          style={{ position: 'fixed', left: pos?.left ?? -9999, top: pos?.top ?? -9999, zIndex: 5000 }}
          className="pointer-events-none w-72 max-w-[calc(100vw-16px)] rounded-xl bg-ink p-3 text-left text-xs font-normal normal-case leading-relaxed tracking-normal text-white shadow-2xl">
          {children}
        </div>,
        document.body,
      )}
    </>
  )
}
