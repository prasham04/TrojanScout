"""Curated well-known USC-area buildings. SAMPLE DATA: real names/locations, illustrative floorplans and prices
(marked sampleData=True and labeled in the UI). Replace with real numbers from each property when available."""
import re

from app.listings.http import PoliteClient
from app.listings.models import Listing, make_unit

# Representative photos (freely licensed, Wikimedia Commons) for the sample buildings. NOT photos of those buildings.
COMMONS_PHOTOS = {
    "menlo": "File:1060 S. Bronson LA.jpg",
    "ellendale": "File:1281 S Dunsmuir, LA.jpg",
    "palisades": "File:1516 N. Hobart Blvd, Los Angeles (cropped).jpg",
    "citypark": "File:2013, An Early Los Angeles Apartment Building - panoramio.jpg",
}


async def _lorenzo_photos(client: PoliteClient) -> list[str]:
    """Official site thelorenzo.com (robots.txt allows / and /gallery/). Keep only images that exist at 1024 px."""
    ids: list[str] = []
    for path in ("/gallery/", "/"):
        html = await client.get_text(f"https://www.thelorenzo.com{path}")
        ids += re.findall(r"https://images\.apts247\.info/(\d+)/\d+x\d+\.(?:jpe?g|webp)", html)
    out = []
    for i in dict.fromkeys(ids):
        url = f"https://images.apts247.info/{i}/1024x1024.jpeg"
        r = await client.client.head(url)
        if r.status_code == 200 and int(r.headers.get("content-length", "99999")) > 15000:
            out.append(url)
        if len(out) == 6:
            break
    return out


async def _commons(client: PoliteClient, title: str) -> tuple[str, str] | None:
    r = await client.client.get("https://commons.wikimedia.org/w/api.php", params={
        "action": "query", "titles": title, "prop": "imageinfo", "iiprop": "url|extmetadata", "iiurlwidth": 1024, "format": "json"})
    page = next(iter(r.json()["query"]["pages"].values()))
    ii = page["imageinfo"][0]; md = ii.get("extmetadata", {})
    artist = re.sub(r"<[^>]+>", "", md.get("Artist", {}).get("value", "")).strip() or "Unknown"
    lic = md.get("LicenseShortName", {}).get("value", "")
    return ii["thumburl"], f"Representative photo (not this building) · {artist}, {lic}, Wikimedia Commons"

# typical USC-area pricing (per unit for entire, per person for rooms)
FULL = [
    ("entire", 0, 1, None, 1795), ("entire", 1, 1, None, 2150), ("entire", 2, 1, None, 2750),
    ("entire", 2, 2, None, 3150), ("entire", 3, 2, None, 3850), ("entire", 3, 3, None, 4350),
    ("private_room", 4, 4, True, 1450), ("private_room", 4, 2, False, 1150), ("shared_room", 2, 2, True, 899),
]

BUILDINGS = [
    dict(key="lorenzo", name="The Lorenzo", address="325 W Adams Blvd, Los Angeles, CA 90007", lat=34.02868, lng=-118.27262,
         url="", amenities=["Furnished", "Gym", "Pool", "Shuttle to USC", "Study rooms", "Parking", "In-unit laundry"],
         plans=FULL, desc="Large furnished student community with a free shuttle to campus."),
    dict(key="menlo", name="Menlo (2678 Menlo Ave)", address="2678 Menlo Ave, Los Angeles, CA 90007", lat=34.03046, lng=-118.29003,
         url="", amenities=["Furnished", "Laundry", "AC"],
         plans=[p for p in FULL if p[1] in (1, 2, 4)], desc="Smaller walk-up building north of campus."),
    dict(key="ellendale", name="Ellendale (2666 Ellendale Pl)", address="2666 Ellendale Pl, Los Angeles, CA 90007", lat=34.03079, lng=-118.28832,
         url="", amenities=["Furnished", "Private bathroom", "Laundry", "Bike storage"],
         plans=[p for p in FULL if p[0] != "entire" or p[1] in (3,)], desc="Co-living rooms and 3-bedroom units on a quiet residential block."),
    dict(key="palisades", name="The Palisades (sample)", address="W 29th St, Los Angeles, CA 90007", lat=34.02905, lng=-118.28650,
         url="", amenities=["Furnished", "Gym", "Parking", "In-unit laundry", "Pet friendly"],
         plans=[p for p in FULL if p[0] == "entire"], desc="Apartment building with studios through 3-bedroom units."),
    dict(key="citypark", name="City Park (sample)", address="1640 W 36th Pl, Los Angeles, CA 90018", lat=34.02180, lng=-118.30715,
         url="", amenities=["Parking", "Laundry", "Pet friendly"],
         plans=[("entire", 1, 1, None, 1750), ("entire", 2, 1, None, 2350), ("entire", 3, 2, None, 3200), ("private_room", 3, 2, False, 995)],
         desc="Lower-priced units west of Normandie, outside the DPS patrol zone."),
]


async def fetch(client: PoliteClient) -> list[Listing]:
    out = []
    for b in BUILDINGS:
        units = [make_unit(rt, beds, baths, pb, rent=rent) for rt, beds, baths, pb, rent in b["plans"]]
        photos, credit = [], ""
        try:
            if b["key"] == "lorenzo":
                photos, credit = await _lorenzo_photos(client), "Photos: thelorenzo.com"
            elif b["key"] in COMMONS_PHOTOS and (got := await _commons(client, COMMONS_PHOTOS[b["key"]])):
                photos, credit = [got[0]], got[1]
        except Exception:
            pass
        out.append(Listing(
            id=f"featured:{b['key']}", source="Featured", url=b["url"], name=b["name"].replace(" (sample)", ""), address=b["address"],
            lat=b["lat"], lng=b["lng"], units=units, priceUnit="per unit / per person",
            amenities=b["amenities"], propertyTypes=["Apartments", "Student Housing"],
            description=b["desc"] + " (Floorplans and prices are illustrative.)",
            availability="Fall 2027", sampleData=True, photos=photos, photoCredit=credit,
        ).finalize())
    return out
