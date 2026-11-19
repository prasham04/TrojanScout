"""Normalized listing record. camelCase on purpose: written to data/listings.json and read by Node + React."""
from pydantic import BaseModel, Field

ROOM_TYPES = {"entire": "Entire unit", "private_room": "Private room", "shared_room": "Shared room"}


class Unit(BaseModel):
    """One floorplan / room type offered at a listing."""
    label: str                         # "2B2B", "Studio", "Private room · private bath", "Shared room (2 per room)"
    roomType: str = "entire"           # entire | private_room | shared_room
    beds: int | None = None            # bedrooms in the whole unit (for rooms: bedrooms in the home)
    baths: float | None = None
    privateBath: bool | None = None    # rooms: own bathroom? entire units: baths >= beds
    rent: int | None = None            # per unit (entire) or per person (rooms)
    count: int = 1                     # how many of these are listed


def unit_label(room_type: str, beds: int | None, baths: float | None, private_bath: bool | None) -> str:
    if room_type == "shared_room":
        return "Shared room" + (" · private bath" if private_bath else "")
    if room_type == "private_room":
        bath = " · private bath" if private_bath else " · shared bath" if private_bath is False else ""
        home = f" in {beds}B{_b(baths)}" if beds else ""
        return f"Private room{bath}{home}"
    if beds == 0:
        return "Studio"
    return f"{beds}B{_b(baths)}" if beds is not None else "Unit"


def _b(baths: float | None) -> str:
    return "" if baths is None else f"{int(baths) if float(baths).is_integer() else baths}B"


def make_unit(room_type: str, beds: int | None, baths: float | None = None, private_bath: bool | None = None,
              rent: int | None = None, count: int = 1) -> Unit:
    if private_bath is None and room_type == "entire" and beds is not None and baths is not None:
        private_bath = baths >= max(beds, 1)
    return Unit(label=unit_label(room_type, beds, baths, private_bath), roomType=room_type, beds=beds, baths=baths,
                privateBath=private_bath, rent=rent, count=count)


class Listing(BaseModel):
    id: str                                  # "<source>:<native id>" — stable across refreshes
    source: str
    url: str
    name: str
    address: str
    lat: float
    lng: float
    rent: int | None = None                  # lowest advertised price
    rentMax: int | None = None
    priceUnit: str = "per unit"              # "per unit" | "per room" | "per person"
    callForPricing: bool = False
    beds: int | None = None
    bedsMax: int | None = None
    baths: float | None = None
    units: list[Unit] = Field(default_factory=list)
    roomTypes: list[str] = Field(default_factory=list)   # derived from units
    availability: str | None = None
    propertyTypes: list[str] = Field(default_factory=list)
    amenities: list[str] = Field(default_factory=list)
    photos: list[str] = Field(default_factory=list)
    photoCredit: str = ""                    # attribution, e.g. "Representative photo · Jane Doe, CC BY-SA 4.0 (Wikimedia Commons)"
    description: str = ""
    sampleData: bool = False                 # True = curated demo record, prices are illustrative
    utilitiesEst: int = 90                   # estimate, shown as such in the UI
    distanceToCampusMi: float | None = None
    inDps: bool | None = None                # filled from Node /internal/zone-check
    inFryft: bool | None = None
    scrapedAt: str = ""

    def finalize(self) -> "Listing":
        if not self.units:  # fall back to one unit describing the whole listing
            self.units = [make_unit("entire", self.beds, self.baths, rent=self.rent)]
        self.roomTypes = sorted({u.roomType for u in self.units})
        rents = [u.rent for u in self.units if u.rent]
        if rents and self.rent is None:
            self.rent, self.rentMax = min(rents), max(rents)
        beds = [u.beds for u in self.units if u.beds is not None and u.roomType == "entire"]
        if beds and self.beds is None:
            self.beds, self.bedsMax = min(beds), max(beds)
        return self


def doc_text(l: Listing) -> str:
    """Text indexed by both BM25 and the dense retriever."""
    price = "call for pricing" if l.rent is None else f"${l.rent}" + (f"-${l.rentMax}" if l.rentMax and l.rentMax != l.rent else "") + f" {l.priceUnit}"
    zones = []
    if l.inDps: zones.append("inside DPS patrol zone, patrolled, safe area")
    if l.inDps is False: zones.append("outside DPS patrol zone")
    if l.inFryft: zones.append("inside Fryft free Lyft zone")
    units = "; ".join(sorted({_unit_words(u) for u in l.units}))
    parts = [l.name, l.address, units, price, ", ".join(l.propertyTypes), ", ".join(l.amenities),
             l.availability or "", ", ".join(zones),
             f"{l.distanceToCampusMi:.1f} miles from USC" if l.distanceToCampusMi is not None else "", l.description]
    return ". ".join(p for p in parts if p)


def _unit_words(u: Unit) -> str:
    w = [u.label, ROOM_TYPES.get(u.roomType, "")]
    if u.beds == 0: w.append("studio apartment")
    elif u.beds: w.append(f"{u.beds} bedroom")
    if u.baths: w.append(f"{_b(u.baths)[:-1]} bathroom")
    if u.privateBath: w.append("private bathroom ensuite")
    if u.privateBath is False: w.append("shared bathroom")
    if u.roomType == "shared_room": w.append("roommate shared room double")
    return " ".join(x for x in w if x)
