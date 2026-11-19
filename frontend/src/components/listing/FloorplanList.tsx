import type { Unit } from '../../api/types'
import { money, peopleFor } from '../../lib/format'
import { useAppStore } from '../../store/useAppStore'

const ICON = { entire: '🏠', private_room: '🚪', shared_room: '👥' }

// Floorplans / room types offered at a listing. `highlight` marks the ones that matched a search.
export default function FloorplanList({ units, highlight = [], compact = false }: { units: Unit[]; highlight?: Unit[]; compact?: boolean }) {
  const sharing = useAppStore((s) => s.profile.sharing ?? 'private')
  const hl = new Set(highlight.map((u) => u.label))
  const sorted = [...units].sort((a, b) => (hl.has(b.label) ? 1 : 0) - (hl.has(a.label) ? 1 : 0))
  const shown = compact ? sorted.slice(0, 5) : sorted
  return (
    <div>
      <div className="mb-1 text-xs font-semibold text-stone-500">Floorplans & room types</div>
      <div className="flex flex-wrap gap-1.5">
        {shown.map((u) => (
          <span key={u.label} title={[u.privateBath === false ? 'Shared bathroom' : u.privateBath ? 'Private bathroom' : '',
              u.rent && peopleFor(u, sharing) > 1 ? `Whole unit ${money(u.rent)} ÷ ${peopleFor(u, sharing)} people` : ''].filter(Boolean).join(' · ')}
            className={`inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] ring-1 ring-inset ${hl.has(u.label) ? 'bg-emerald-50 font-semibold text-emerald-800 ring-emerald-300' : 'bg-white text-stone-700 ring-stone-200'}`}>
            {ICON[u.roomType]} {u.label}{u.count > 1 ? ` ×${u.count}` : ''}
            <span className="text-stone-400">{u.rent ? `${money(u.rent / peopleFor(u, sharing))}${peopleFor(u, sharing) > 1 ? '/pp' : ''}` : 'call'}</span>
          </span>
        ))}
        {compact && units.length > 5 && <span className="px-1 py-1 text-[11px] text-stone-400">+{units.length - 5} more</span>}
      </div>
    </div>
  )
}
