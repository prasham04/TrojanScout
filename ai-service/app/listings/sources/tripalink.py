"""Tripalink USC off-campus section. robots.txt allows these pages (it disallows /_next/data/, which we don't use)."""
import re

from app.listings.http import PoliteClient, next_data
from app.listings.models import Listing, make_unit

BASE = "https://tripalink.com/usc-off-campus-student-housing"
KINDS = ["homes", "houses", "apartments", "duplexes"]
MAX_PAGES = 60


def _price(x):
    try:
        v = float(x)
        return int(v) if v > 0 else None
    except (TypeError, ValueError):
        return None


async def _page_urls(client: PoliteClient) -> list[str]:
    """Server-rendered pages show 20 results each; page 2+ loads via a private API we don't call.
    So we crawl the filtered views Tripalink itself publishes in its sitemap (by beds, price, amenity)."""
    try:
        sm = await client.get_text("https://tripalink.com/sitemap.xml")
        urls = [u for u in re.findall(r"<loc>([^<]+)</loc>", sm)
                if "/usc-off-campus-student-housing/" in u and not re.search(r"/\d{6,}", u)]
    except Exception:
        urls = []
    base = [f"{BASE}/{k}-for-rent" for k in KINDS]
    return list(dict.fromkeys(base + urls))[:MAX_PAGES]


async def fetch(client: PoliteClient) -> list[Listing]:
    seen: dict[str, Listing] = {}
    for url in await _page_urls(client):
        try:
            es = next_data(await client.get_text(url))["props"]["pageProps"]["data"]["ESProperties"]
        except Exception:
            continue
        for p in es.get("data") or []:
            if p["id"] in seen or not (p.get("latitude") and p.get("longitude")):
                continue
            kind = url.split("/usc-off-campus-student-housing/")[1].split("-for-rent")[0]
            walk = (p.get("routes") or {}).get("walking") or {}
            amen = p.get("formattedAmenities") or []
            beds, baths, price = p.get("minBd"), p.get("minBa"), _price(p.get("minPrice"))
            if p.get("coLiving"):  # rooms in a shared house; own bathroom if the amenity says so or baths >= beds
                pb = "Private Bathroom" in amen or (beds and baths and baths >= beds)
                units = [make_unit("private_room", beds, baths, bool(pb), rent=price, count=p.get("lastRoomNum") or 1)]
            else:
                units = [make_unit("entire", beds, baths, rent=price)]
            seen[p["id"]] = Listing(
                id=f"tripalink:{p['id']}", source="Tripalink",
                url=f"https://tripalink.com/apartments/los-angeles/usc-off-campus-student-housing/{p['id']}",
                name=p.get("name") or p["address"], address=p.get("shortFullAddress") or p["address"],
                lat=float(p["latitude"]), lng=float(p["longitude"]),
                rent=_price(p.get("minPrice")), priceUnit="per room" if p.get("coLiving") else "per unit",
                beds=p.get("minBd"), bedsMax=p.get("maxBd"), baths=p.get("minBa"),
                units=units,
                availability="Available now" if p.get("availableStatus") == 1 else None,
                propertyTypes=[kind.rstrip("s").title()] + (["Co-living"] if p.get("coLiving") else []),
                amenities=amen,
                photos=[x["url"] for x in (p.get("picList") or [])[:5]],
                description=(f"{walk.get('duration')} walk ({walk.get('distance')}) to {p['routes'].get('toward')}"
                             if walk.get("duration") else "") + (f". {p['sellingHeadline']}" if p.get("sellingHeadline") else ""),
            ).finalize()
    return list(seen.values())
