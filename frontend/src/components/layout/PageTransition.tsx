import type { ReactNode } from 'react'
import { motion, useReducedMotion } from 'motion/react'

/** Gentle fade/slide between pages. */
export default function PageTransition({ children, k }: { children: ReactNode; k: string }) {
  const reduce = useReducedMotion()
  return (
    <motion.div key={k} className="h-full" initial={reduce ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}>
      {children}
    </motion.div>
  )
}
