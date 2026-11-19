import { GeoJSON } from 'react-leaflet'

export const ZONE_STYLE: Record<string, { color: string; fill: number; dash?: string }> = {
  DPS: { color: '#990000', fill: 0.1 },
  DPS_HSC: { color: '#990000', fill: 0.1 },
}

export default function ZoneLayer({ data, visible }: { data: GeoJSON.FeatureCollection; visible: Record<string, boolean> }) {
  const features = data.features.filter((f) => visible[f.properties?.name] !== false)
  return (
    <GeoJSON
      key={features.map((f) => f.properties?.name).join(',')}
      data={{ ...data, features } as GeoJSON.FeatureCollection}
      style={(f) => {
        const s = ZONE_STYLE[f?.properties?.name] ?? { color: '#666', fill: 0.05 }
        return { color: s.color, weight: 2.5, fillOpacity: s.fill, dashArray: s.dash, className: 'zone-glow' }
      }}
      interactive={false}
    />
  )
}
