"""AppFolio-hosted landlord listing pages (public, robots.txt allows /listings).
The page embeds its own map markers as JSON: address, lat/lng, rent, unit specs ("Room in 3 bd, 3 ba")."""
import json
import re
from collections import defaultdict

from app.listings.http import PoliteClient
from app.listings.models import Listing, make_unit

# USC-area operators that publish on AppFolio. Add more subdomains here.
PORTALS = {"mosaicstudent": "Mosaic Student Communities"}

SPEC = re.compile(r"(?P<room>Room in )?(?:(?P<beds>\d+) bd|(?P<studio>Studio)),?\s*(?P<baths>[\d.]+) ba", re.I)


def _rent(s: str) -> int | None:
    v = int(re.sub(r"[^\d]", "", s.split("-")[0]) or 0)
    return v or None


async def _portal(client: PoliteClient, sub: str, label: str) -> list[Listing]:
    base = f"https://{sub}.appfolio.com"
    html = await client.get_text(f"{base}/listings/listings")
    m = re.search(r"markers:\s*(\[.*?\])\s*,\s*\n", html, re.S)
    if not m:
        return []
    by_building: dict[str, list[dict]] = defaultdict(list)
    for x in json.loads(m.group(1)):
        if x.get("latitude") and x.get("longitude"):
            by_building[x["address"].split(" #")[0].split(" Unit")[0].strip()].append(x)
    out = []
    for addr, items in by_building.items():
        units = []
        for x in items:
            s = SPEC.search(x.get("unit_specs", ""))
            if not s:
                continue
            beds = 0 if s["studio"] else int(s["beds"])
            baths = float(s["baths"])
            room = "private_room" if s["room"] else "entire"
            pb = (baths >= beds) if room == "private_room" else None
            units.append(make_unit(room, beds, baths, pb, rent=_rent(x.get("rent_range", ""))))
        first = items[0]
        out.append(Listing(
            id=f"{sub}:{first.get('listing_id')}", source=label,
            url=base + first.get("detail_page_url", "/listings/listings"),
            name=addr.split(",")[0], address=addr, lat=first["latitude"], lng=first["longitude"],
            units=units, callForPricing=all(u.rent is None for u in units),
            priceUnit="per room" if all(u.roomType == "private_room" for u in units) else "per unit",
            photos=[first["default_photo_url"]] if first.get("default_photo_url") else [],
            propertyTypes=["Student Housing"],
            description=f"{len(items)} listing(s) on {label}'s AppFolio page",
        ).finalize())
    return out


async def fetch(client: PoliteClient) -> list[Listing]:
    out = []
    for sub, label in PORTALS.items():
        out += await _portal(client, sub, label)
    return out
