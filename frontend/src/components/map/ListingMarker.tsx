import { useAppStore } from '../../store/useAppStore'
import { useCallback, useEffect, useRef } from 'react'
import { CircleMarker, Popup, Tooltip } from 'react-leaflet'
import type L from 'leaflet'
import type { ListingV2 } from '../../api/types'
import { priceLabel } from '../../lib/format'
import ListingPopup from './ListingPopup'
import { COLORS } from './layers'

interface Props { listing: ListingV2; highlighted: boolean; comparing: boolean; focused: boolean; onSafeRoute: (l: ListingV2) => void }

export default function ListingMarker({ listing, highlighted, comparing, focused, onSafeRoute }: Props) {
  const sharing = useAppStore((s) => s.profile.sharing)
  const markerRef = useRef<L.CircleMarker>(null)
  const popupRef = useRef<L.Popup>(null)
  const resize = useCallback(() => popupRef.current?.update(), [])
  useEffect(() => { if (focused) setTimeout(() => markerRef.current?.openPopup(), 300) }, [focused])

  // Inside the DPS patrol zone → green. Outside → violet (red is reserved for DPS units).
  const color = listing.inDps === false ? COLORS.outside : COLORS.inside
  return (
    <CircleMarker ref={markerRef} center={[listing.lat, listing.lng]} radius={highlighted || comparing ? 10 : 7}
      pathOptions={{ color: comparing ? '#ffc72c' : '#ffffff', weight: comparing ? 4 : 2, fillColor: color, fillOpacity: highlighted ? 1 : 0.9 }}>
      <Tooltip direction="top" offset={[0, -8]}>{listing.name} · {priceLabel(listing, sharing)}</Tooltip>
      <Popup ref={popupRef} className="ts-popup" maxWidth={320} minWidth={320} offset={[0, -6]} autoPanPaddingTopLeft={[300, 70]} autoPanPaddingBottomRight={[24, 24]}>
        <ListingPopup listing={listing} onResize={resize} onSafeRoute={(l) => { markerRef.current?.closePopup(); onSafeRoute(l) }} />
      </Popup>
    </CircleMarker>
  )
}
