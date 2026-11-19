import { useState } from 'react'
import { TileLayer } from 'react-leaflet'

// Keyless basemaps that work on any domain (localhost and the deployed site alike):
//   day   → OpenStreetMap standard (colorful, detailed)
//   night → Esri "World Dark Gray" (street names included)
// Stadia and CARTO now return an "API key required" image on non-localhost domains, which Leaflet
// can't detect as a failure, so they're not used. Set VITE_TILE_URL to use your own tiles.
// If day tiles keep failing we fall back to Esri's street map automatically.
const PRIMARY = import.meta.env.VITE_TILE_URL ?? 'https://tile.openstreetmap.org/{z}/{x}/{y}.png'
const PRIMARY_ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
const NIGHT = 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}'
const NIGHT_ATTR = 'Tiles &copy; <a href="https://www.esri.com/">Esri</a>, HERE, Garmin, &copy; OpenStreetMap contributors'
const FALLBACK = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}'
const FALLBACK_ATTR = 'Tiles &copy; <a href="https://www.esri.com/">Esri</a>, HERE, Garmin, &copy; OpenStreetMap contributors'

let failedOnce = false  // remember across maps in this session

export default function Basemap({ extraAttribution = '', night = false }: { extraAttribution?: string; night?: boolean }) {
  const [fallback, setFallback] = useState(failedOnce)
  const [errors, setErrors] = useState(0)
  const useFallback = fallback && !night
  return (
    <TileLayer
      key={night ? 'night' : useFallback ? 'fallback' : 'primary'}
      url={night ? NIGHT : useFallback ? FALLBACK : PRIMARY}
      attribution={(night ? NIGHT_ATTR : useFallback ? FALLBACK_ATTR : PRIMARY_ATTR) + extraAttribution}
      maxNativeZoom={night ? 16 : 19}
      maxZoom={19}
      eventHandlers={{
        tileerror: () => {
          if (night || fallback) return
          const n = errors + 1
          setErrors(n)
          if (n >= 4) { failedOnce = true; setFallback(true) }
        },
      }}
    />
  )
}
