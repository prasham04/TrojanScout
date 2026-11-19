import { useEffect } from 'react'
import { useMap } from 'react-leaflet'

export default function FlyTo({ target }: { target: [number, number] | null }) {
  const map = useMap()
  const lat = target?.[0], lng = target?.[1]
  // Depend on the numbers, not the array, so re-renders don't re-trigger the flight
  useEffect(() => { if (lat != null && lng != null) map.setView([lat, lng], Math.max(map.getZoom(), 16), { animate: false }) }, [lat, lng, map])
  return null
}
