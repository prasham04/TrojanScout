"""Stuho (USC student housing operator). robots.txt: Allow /. One public search page lists every building + its units."""
from collections import Counter

from app.listings.http import PoliteClient, next_data
from app.listings.models import Listing, make_unit

SEARCH = "https://stuho.com/search?minBeds=Any&maxBeds=Any&minRent=Any&maxRent=Any&moveDate=All+Available+Properties"


def _int(x):
    return int(x) if isinstance(x, (int, float)) and x > 0 else None


async def fetch(client: PoliteClient) -> list[Listing]:
    props = next_data(await client.get_text(SEARCH))["props"]["pageProps"]["properties"]
    out = []
    for p in props.get("data", []):
        if not (p.get("BLatitude") and p.get("BLongitude")):
            continue
        city = (p.get("BCity") or {}).get("Name", "Los Angeles")
        # Stuho publishes bedrooms per unit (not baths or per-unit rent) → one floorplan per bedroom count
        by_beds = Counter(u.get("UBeds") for u in p.get("BUnits") or [] if u.get("UBeds") is not None)
        units = [make_unit("entire", b, None, rent=None, count=n) for b, n in sorted(by_beds.items())]
        out.append(Listing(
            id=f"stuho:{p['_id']}", source="Stuho",
            url=f"https://stuho.com/for-rent-building/{p['BSlug']}",
            name=p.get("BName") or p["BAddress"],
            address=f"{p['BAddress']}, {city}, {p.get('BState', 'CA')} {p.get('BZipCode', '')}".strip(),
            lat=p["BLatitude"], lng=p["BLongitude"],
            rent=_int(p.get("MinRent")), rentMax=_int(p.get("MaxRent")),
            callForPricing=bool(p.get("BCallForPricing")),
            beds=p.get("MinBeds"), bedsMax=p.get("MaxBeds"), baths=p.get("MinBaths"),
            units=units,
            availability=p.get("BCustomMessage") or None,
            propertyTypes=p.get("BFullPropertyTypes") or [],
            photos=(p.get("BPhotosGeneral") or [])[:5],
            description=f"{p.get('BUnitsCount') or len(p.get('BUnits') or [])} units managed by Stuho",
        ).finalize())
    return out
