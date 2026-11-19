// Fit score (0–1) = weighted average of four 0–1 sub-scores. Weights come from the student's Preferences.
//   cost      = how far the True Cost is under budget: 1 at ≤50% of budget, 0.5 at exactly budget, 0 at ≥150%
//   commute   = 1 − longestWalk / 30 min   (longest walk = the furthest of your class buildings; 0 at 30+ min)
//   zone      = (inside DPS + inside Fryft) / 2
//   incidents = 1 − (weighted LAPD incidents within 150 m, last 6 months) / (90th percentile across all listings)
export interface Weights { cost: number; commute: number; zone: number; incidents: number }
export interface ScoreInput { total: number | null; budget: number; longestWalkMin: number; inFryft: boolean; inDps: boolean; incidentsNorm: number }
export const DEFAULT_WEIGHTS: Weights = { cost: 0.4, commute: 0.3, zone: 0.2, incidents: 0.1 }
const clamp = (x: number) => Math.max(0, Math.min(1, x))

export function fitBreakdown(i: ScoreInput, w: Weights = DEFAULT_WEIGHTS) {
  const parts = {
    cost: i.total == null
      ? { value: 0.5, explain: 'Price not published (call for pricing): scored neutral' }
      : { value: clamp((i.budget - i.total) / i.budget + 0.5), explain: `Your share of True Cost $${Math.round(i.total)} vs budget $${i.budget}` },
    commute: { value: clamp(1 - i.longestWalkMin / 30), explain: `Longest walk ${i.longestWalkMin} min (0 points at 30+ min)` },
    zone: { value: (+i.inFryft + +i.inDps) / 2, explain: `${i.inDps ? 'Inside' : 'Outside'} DPS, ${i.inFryft ? 'inside' : 'outside'} Fryft` },
    incidents: { value: clamp(1 - i.incidentsNorm), explain: 'Reported incidents within 150 m vs other listings' },
  }
  const sum = w.cost + w.commute + w.zone + w.incidents || 1
  const score = (w.cost * parts.cost.value + w.commute * parts.commute.value + w.zone * parts.zone.value + w.incidents * parts.incidents.value) / sum
  return {
    score: Math.round(score * 100) / 100,
    parts: Object.fromEntries(Object.entries(parts).map(([k, v]) => [k, { ...v, value: Math.round(v.value * 100) / 100, weight: Math.round((w[k as keyof Weights] / sum) * 100) / 100 }])),
  }
}

export const fitScore = (i: ScoreInput, w?: Weights) => fitBreakdown(i, w).score
