// Small motion + light primitives shared by every page.
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { animate, motion, useInView, useReducedMotion } from 'motion/react'

/** A container whose background light follows the cursor (pair with the .spotlight / .spotlight-border classes). */
export function Spotlight({ className = '', children, style, as: As = 'div', ...rest }: { className?: string; children: ReactNode; style?: CSSProperties; as?: 'div' | 'section' | 'article' } & Record<string, unknown>) {
  const ref = useRef<HTMLElement>(null)
  return (
    <As ref={ref as never} style={style} className={`spotlight spotlight-border ${className}`}
      onMouseMove={(e: React.MouseEvent) => {
        const r = ref.current!.getBoundingClientRect()
        ref.current!.style.setProperty('--mx', `${e.clientX - r.left}px`); ref.current!.style.setProperty('--my', `${e.clientY - r.top}px`)
      }} {...rest}>
      {children}
    </As>
  )
}

/** Fades and lifts in when scrolled into view; `i` staggers siblings. */
export function Reveal({ children, i = 0, className = '', y = 14 }: { children: ReactNode; i?: number; className?: string; y?: number }) {
  const reduce = useReducedMotion()
  return (
    <motion.div className={className} initial={reduce ? false : { opacity: 0, y }} whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-40px' }} transition={{ duration: 0.5, delay: Math.min(i, 8) * 0.06, ease: [0.22, 1, 0.36, 1] }}>
      {children}
    </motion.div>
  )
}

/** A number that counts up to its value (once visible), e.g. prices, scores, stats. */
export function CountUp({ value, format = (n: number) => Math.round(n).toLocaleString(), className = '', duration = 0.9 }: { value: number; format?: (n: number) => string; className?: string; duration?: number }) {
  const ref = useRef<HTMLSpanElement>(null)
  const inView = useInView(ref, { once: true })
  const reduce = useReducedMotion()
  const last = useRef(0)
  const [shown, setShown] = useState(reduce ? value : 0)
  useEffect(() => {
    if (!inView) return
    if (reduce) { setShown(value); return }
    const c = animate(last.current, value, { duration, ease: [0.22, 1, 0.36, 1], onUpdate: setShown })
    last.current = value
    return () => c.stop()
  }, [value, inView, reduce, duration])
  return <span ref={ref} className={`num ${className}`}>{format(shown)}</span>
}

/** Circular match / score ring (0–100). */
export function Ring({ value, size = 44, stroke = 5, color = '#990000', track = 'rgb(28 25 23 / .1)', label }: { value: number; size?: number; stroke?: number; color?: string; track?: string; label?: ReactNode }) {
  const r = (size - stroke) / 2, c = 2 * Math.PI * r
  return (
    <span className="relative inline-grid place-items-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={track} strokeWidth={stroke} />
        <motion.circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round"
          strokeDasharray={c} initial={{ strokeDashoffset: c }} animate={{ strokeDashoffset: c * (1 - Math.max(0, Math.min(100, value)) / 100) }}
          transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }} />
      </svg>
      <span className="absolute text-[11px] font-bold num">{label ?? Math.round(value)}</span>
    </span>
  )
}

/** Slowly drifting colored light, for heroes. */
export function Aurora({ className = '' }: { className?: string }) {
  return (
    <div aria-hidden className={`pointer-events-none absolute inset-0 overflow-hidden ${className}`}>
      <div className="absolute -left-24 -top-24 h-[28rem] w-[28rem] rounded-full bg-[#ff3b3b]/25 blur-3xl animate-aurora" />
      <div className="absolute -right-20 top-10 h-[24rem] w-[24rem] rounded-full bg-gold/30 blur-3xl animate-aurora [animation-delay:-6s]" />
      <div className="absolute bottom-[-10rem] left-1/3 h-[26rem] w-[26rem] rounded-full bg-[#ff7a00]/15 blur-3xl animate-aurora [animation-delay:-11s]" />
    </div>
  )
}

/** Loading placeholder block. */
export const Skeleton = ({ className = '' }: { className?: string }) => <div className={`shimmer rounded-xl ${className}`} />
