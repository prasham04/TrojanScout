import Badge from '../ui/Badge'

export default function ZoneBadges({ inDps, inFryft }: { inDps?: boolean; inFryft?: boolean }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {inDps !== undefined && <Badge tone={inDps ? 'green' : 'red'}>{inDps ? '🛡 Inside DPS' : '⚠ Outside DPS'}</Badge>}
      {inFryft !== undefined && <Badge tone={inFryft ? 'green' : 'amber'}>{inFryft ? '🚗 Free USC Lyft' : 'No free USC Lyft'}</Badge>}
    </div>
  )
}
