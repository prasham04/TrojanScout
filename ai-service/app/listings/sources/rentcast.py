"""RentCast API — licensed, real-time active rental listings (free tier: 50 calls/month; one call returns ≤500).
Enabled only when RENTCAST_API_KEY is set. Docs: https://developers.rentcast.io/reference/rental-listings-long-term"""
from app.config import settings
from app.listings.http import PoliteClient
from app.listings.models import Listing, make_unit

USC = (34.0206, -118.2854)


async def fetch(client: PoliteClient) -> list[Listing]:
    r = await client.client.get(
        "https://api.rentcast.io/v1/listings/rental/long-term",
        params={"latitude": USC[0], "longitude": USC[1], "radius": 2.5, "status": "Active", "limit": 500},
        headers={"X-Api-Key": settings.rentcast_api_key, "Accept": "application/json"},
    )
    r.raise_for_status()
    out = []
    for p in r.json():
        if not (p.get("latitude") and p.get("longitude")):
            continue
        out.append(Listing(
            id=f"rentcast:{p['id']}", source="RentCast", url=p.get("listingUrl") or "",
            name=p.get("addressLine1") or p.get("formattedAddress", ""), address=p.get("formattedAddress", ""),
            lat=p["latitude"], lng=p["longitude"], rent=p.get("price"),
            beds=p.get("bedrooms"), baths=p.get("bathrooms"),
            units=[make_unit("entire", p.get("bedrooms"), p.get("bathrooms"), rent=p.get("price"))],
            propertyTypes=[p["propertyType"]] if p.get("propertyType") else [],
            availability=f"Listed {p['listedDate'][:10]}" if p.get("listedDate") else None,
        ).finalize())
    return out
