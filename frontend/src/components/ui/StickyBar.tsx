import type { ReactNode } from 'react'

/** Search bar that stays at the top of the page while you scroll.
 *  It sits on a full-width band in the page colour, so cards scrolling underneath are hidden
 *  instead of showing through the bar or peeking out above it. The page container must have px-4. */
export default function StickyBar({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className="sticky top-0 z-[60] -mx-4 bg-paper/95 px-4 py-3 backdrop-blur-md">
      <div className={`rounded-2xl bg-white shadow-[0_8px_24px_-12px_rgba(0,0,0,.18)] ring-1 ring-stone-200 ${className}`}>{children}</div>
    </div>
  )
}
