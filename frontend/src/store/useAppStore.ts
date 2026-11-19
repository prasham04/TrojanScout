import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Profile } from '../api/types'

export const COMPARE_ROWS = ['price', 'trueCost', 'perPerson', 'rideshare', 'longestWalk', 'incidents', 'dps', 'fryft', 'floorplans', 'fit'] as const
export type CompareRow = (typeof COMPARE_ROWS)[number]

interface AppState {
  profile: Profile
  compareIds: string[]
  highlightedIds: string[]
  compareWidth: number
  compareRows: CompareRow[]
  setProfile: (p: Partial<Profile>) => void
  toggleCompare: (id: string) => void
  clearCompare: () => void
  highlight: (ids: string[]) => void
  setCompareWidth: (w: number) => void
  toggleCompareRow: (r: CompareRow) => void
  costListingId: string | null
  openCost: (id: string | null) => void
}

export const MAX_COMPARE = 3

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      profile: { budget: 1500, buildingIds: [1, 3], lateNights: 2, priorities: { cost: 0.4, commute: 0.3, zone: 0.2, incidents: 0.1 } },
      compareIds: [],
      highlightedIds: [],
      compareWidth: 400,
      compareRows: ['price', 'trueCost', 'perPerson', 'longestWalk', 'incidents', 'dps', 'floorplans', 'fit'],
      setProfile: (p) => set((s) => ({ profile: { ...s.profile, ...p } })),
      toggleCompare: (id) =>
        set((s) => ({ compareIds: s.compareIds.includes(id) ? s.compareIds.filter((x) => x !== id) : [...s.compareIds, id].slice(-MAX_COMPARE) })),
      clearCompare: () => set({ compareIds: [] }),
      highlight: (ids) => set({ highlightedIds: ids }),
      setCompareWidth: (w) => set({ compareWidth: Math.round(Math.min(760, Math.max(300, w))) }),
      costListingId: null,
      openCost: (id) => set({ costListingId: id }),
      toggleCompareRow: (r) => set((s) => ({ compareRows: s.compareRows.includes(r) ? s.compareRows.filter((x) => x !== r) : COMPARE_ROWS.filter((x) => x === r || s.compareRows.includes(x)) })),
    }),
    { name: 'trojanscout', partialize: (s) => ({ profile: s.profile, compareIds: s.compareIds, compareWidth: s.compareWidth, compareRows: s.compareRows }) },
  ),
)
