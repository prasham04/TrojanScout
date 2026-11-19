import { CircleMarker, Tooltip } from 'react-leaflet'
import type { Building } from '../../api/types'

export default function BuildingMarker({ building, chosen }: { building: Building; chosen: boolean }) {
  return (
    <CircleMarker center={[building.lat, building.lng]} radius={chosen ? 6 : 4}
      pathOptions={{ color: '#ffc72c', weight: 2, fillColor: chosen ? '#990000' : '#ffffff', fillOpacity: 1 }}>
      <Tooltip direction="top">🎓 {building.name}{chosen ? ' (your building)' : ''}</Tooltip>
    </CircleMarker>
  )
}
