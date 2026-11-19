const TONES = {
  green: 'bg-emerald-50 text-emerald-800 ring-emerald-200',
  red: 'bg-red-50 text-red-800 ring-red-200',
  amber: 'bg-amber-50 text-amber-900 ring-amber-200',
  gray: 'bg-stone-100 text-stone-700 ring-stone-200',
  cardinal: 'bg-cardinal-50 text-cardinal ring-red-200',
}
export default function Badge({ tone = 'gray', children }: { tone?: keyof typeof TONES; children: React.ReactNode }) {
  return <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${TONES[tone]}`}>{children}</span>
}
