"""Smart search: turn plain English into structured filters + a semantic remainder.

  "2b2b under $3k with in-unit laundry, 10 min walk to Viterbi, inside DPS"
    → beds=2 baths=2 maxRent=3000 amenities=[laundry] near=Viterbi(SAL) maxWalkMin=10 inDps=True

Rules handle the common phrasings with no API calls. If an LLM key is configured, the LLM also reads the
query (structured output) and fills anything the rules missed. Every understood constraint is returned as a
human-readable chip so the UI can show (and remove) it."""
import json
import math
import re
from dataclasses import asdict, dataclass, field, fields
from functools import lru_cache
from pathlib import Path

from app.config import settings
from app.listings.models import Listing, Unit

NUM_WORDS = {"zero": 0, "one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "single": 1, "double": 2}
AMENITIES = {
    "furnished": r"(?<!un)\bfurnish(?:ed)?\b",
    "laundry": r"\b(?:laundry|washer|dryer|w/d|in[- ]unit laundry)\b",
    "parking": r"\b(?:parking|garage|car space)\b",
    "pets": r"\b(?:pet[- ]friendly|pets? (?:allowed|ok)|pets?|dogs?|cats?)\b",
    "ac": r"\b(?:a/?c|air[- ]?con(?:ditioning)?)\b",
    "gym": r"\b(?:gym|fitness)\b",
    "pool": r"\bpool\b",
    "utilities included": r"\butilities included\b",
}
AMENITY_MATCH = {  # how each amenity is recognized in listing text
    "furnished": r"furnish|\bbed\b", "laundry": r"laundry|washer|dryer", "parking": r"parking|garage",
    "pets": r"pet", "ac": r"\bac\b|a/c|air con", "gym": r"gym|fitness", "pool": r"pool",
    "utilities included": r"utilities included",
}


@dataclass
class SmartQuery:
    text: str = ""                      # what's left for semantic/keyword ranking
    maxRent: int | None = None
    minRent: int | None = None
    beds: int | None = None             # exact bedrooms (0 = studio)
    minBeds: int | None = None
    baths: float | None = None
    roomType: str | None = None         # entire | private_room | shared_room
    privateBath: bool | None = None
    inDps: bool | None = None
    inFryft: bool | None = None
    amenities: list[str] = field(default_factory=list)
    nearBuildingId: int | None = None
    maxWalkMin: int | None = None
    source: str | None = None
    sort: str | None = None             # price | walk
    nearText: str | None = None         # "near ralphs" before it is resolved to a place
    nearLat: float | None = None
    nearLng: float | None = None
    nearLabel: str | None = None
    perPerson: bool = False             # "each" / "per person": whole units are compared at rent ÷ bedrooms

    # ---- matching ----
    def unit_ok(self, u: Unit) -> bool:
        if self.roomType and u.roomType != self.roomType: return False
        # "2b2b" / "3 bed" without saying "room" means the whole unit, not a room inside a 3-bed house
        if not self.roomType and (self.beds is not None or self.minBeds is not None or self.baths is not None) and u.roomType != "entire":
            return False
        if self.beds is not None and u.beds != self.beds: return False
        if self.minBeds is not None and (u.beds or 0) < self.minBeds: return False
        if self.baths is not None and (u.baths is None or u.baths != self.baths): return False
        if self.privateBath is not None and u.privateBath is not self.privateBath: return False
        rent = u.rent
        if rent is not None and self.perPerson and u.roomType == "entire" and (u.beds or 0) >= 2:
            rent = rent / u.beds
        if self.maxRent is not None and (rent is None or rent > self.maxRent): return False
        if self.minRent is not None and (rent is None or rent < self.minRent): return False
        return True

    def walk_to(self, l: Listing) -> float:
        if self.nearLat is not None:
            return walk_minutes_to(l, self.nearLat, self.nearLng)
        return walk_minutes(l, self.nearBuildingId or 9)

    def has_unit_filters(self) -> bool:
        return any(v is not None for v in (self.roomType, self.beds, self.minBeds, self.baths, self.privateBath, self.maxRent, self.minRent))

    def match(self, l: Listing) -> list[Unit] | None:
        """Matching units (possibly empty list if no unit filters), or None if the listing is excluded."""
        if self.inDps is not None and l.inDps is not self.inDps: return None
        if self.inFryft is not None and l.inFryft is not self.inFryft: return None
        if self.source and self.source.lower() not in l.source.lower(): return None
        if self.amenities:
            blob = " ".join(l.amenities + [l.description, l.name]).lower()
            if not all(re.search(AMENITY_MATCH[a], blob) for a in self.amenities if a in AMENITY_MATCH): return None
        if self.maxWalkMin is not None and (self.nearBuildingId is not None or self.nearLat is not None):
            if self.walk_to(l) > self.maxWalkMin: return None
        if not self.has_unit_filters():
            return []
        units = [u for u in l.units if self.unit_ok(u)]
        return units or None

    def chips(self) -> list[dict]:
        b = {x["id"]: x["name"] for x in buildings()}
        out = []
        add = lambda key, label: out.append({"key": key, "label": label})
        if self.maxRent is not None and self.minRent is not None: add("price", f"${self.minRent:,}–${self.maxRent:,}")
        elif self.maxRent is not None: add("maxRent", f"Under ${self.maxRent:,}" + (" per person" if self.perPerson else ""))
        elif self.minRent is not None: add("minRent", f"Over ${self.minRent:,}")
        if self.beds == 0: add("beds", "Studio")
        elif self.beds is not None: add("beds", f"{self.beds} bed" + ("" if self.baths is not None else ""))
        if self.minBeds is not None: add("minBeds", f"{self.minBeds}+ beds")
        if self.baths is not None: add("baths", f"{self.baths:g} bath")
        if self.roomType: add("roomType", {"entire": "Entire unit", "private_room": "Private room", "shared_room": "Shared room"}[self.roomType])
        if self.privateBath is not None: add("privateBath", "Private bathroom" if self.privateBath else "Shared bathroom")
        if self.inDps: add("inDps", "Inside DPS zone")
        if self.inDps is False: add("inDps", "Outside DPS zone")
        if self.inFryft: add("inFryft", "Inside Fryft")
        for a in self.amenities: add(f"amenity:{a}", a.title() if a != "ac" else "A/C")
        if self.nearLat is not None: add("near", f"≤{self.maxWalkMin} min walk to {self.nearLabel}")
        elif self.nearBuildingId is not None: add("near", f"≤{self.maxWalkMin} min walk to {b.get(self.nearBuildingId, 'campus')}")
        if self.sort == "price": add("sort", "Cheapest first")
        if self.sort == "walk": add("sort", "Closest first")
        if self.source: add("source", f"From {self.source}")
        return out

    def drop(self, keys: list[str]):
        for k in keys:
            if k == "price": self.maxRent = self.minRent = None; self.perPerson = False
            elif k == "near": self.nearBuildingId = self.maxWalkMin = self.nearLat = self.nearLng = self.nearLabel = self.nearText = None
            elif k.startswith("amenity:"): self.amenities = [a for a in self.amenities if a != k.split(":", 1)[1]]
            elif k in {f.name for f in fields(self)}: setattr(self, k, [] if k == "amenities" else None)

    def as_dict(self) -> dict:
        return {k: v for k, v in asdict(self).items() if v not in (None, [], "")}


# ---------- buildings / walking ----------
@lru_cache
def buildings() -> list[dict]:
    return json.loads((Path(settings.data_dir) / "buildings.json").read_text())


BUILDING_ALIASES = {
    1: ["viterbi", "sal", "engineering", "salvatori"], 2: ["rth", "ronald tutor hall"], 3: ["marshall", "jkp", "business school"],
    4: ["leavey"], 5: ["doheny"], 6: ["vkc", "von kleinsmid"], 7: ["annenberg", "ann "], 8: ["lyon", "gym on campus"],
    9: ["tommy trojan", "tommy", "main campus", "upc"], 10: ["usc village", "village"],
}


def walk_minutes(l: Listing, building_id: int) -> float:
    b = next((x for x in buildings() if x["id"] == building_id), None)
    return walk_minutes_to(l, b["lat"], b["lng"]) if b else 0


def walk_minutes_to(l: Listing, lat: float, lng: float) -> float:
    la1, lo1, la2, lo2 = map(math.radians, (l.lat, l.lng, lat, lng))
    m = 6371000 * 2 * math.asin(math.sqrt(math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2))
    return m * 1.3 / 80  # 1.3 street-grid detour factor, 80 m/min walking


# ---------- rule-based parser ----------
def _money(s: str) -> int:
    s = s.lower().replace(",", "").replace("$", "").strip()
    thousands = s.endswith("k") or s.endswith("grand")
    v = float(s.replace("grand", "").replace("k", "").strip())
    if thousands or v < 10:  # "3k", "3 grand", "under 3" all mean $3,000
        v *= 1000
    return int(v)


MONEY = r"\$?\s*(\d+(?:[.,]\d+)?\s*(?:k|grand)?)"


def parse_rules(q: str) -> SmartQuery:
    t = " " + q.lower() + " "
    for w, n in NUM_WORDS.items():
        t = re.sub(rf"\b{w}(?=[\s-]*(?:bed|br|bd|bath|ba|bedroom|bathroom))", str(n), t)
    sq = SmartQuery()
    spans: list[tuple[int, int]] = []
    def take(m):
        spans.append(m.span()); return m

    # price
    if m := re.search(rf"(?:between|from)\s+{MONEY}\s*(?:and|to|-)\s*{MONEY}", t) or re.search(rf"{MONEY}\s*(?:-|–|to)\s*{MONEY}\b(?!\s*(?:min|bed|bath|br|ba))", t):
        take(m); sq.minRent, sq.maxRent = _money(m.group(1)), _money(m.group(2))
    elif m := re.search(rf"(?:under|below|less than|cheaper than|max(?:imum)?|up to|at most|<=?|budget(?: of)?|(?:can|could|want to|willing to)\s+(?:spend|pay|afford)(?:\s+(?:up to|about|around))?)\s*{MONEY}", t):
        take(m); sq.maxRent = _money(m.group(1))
    elif m := re.search(rf"(?:over|above|more than|at least|min(?:imum)?|>=?)\s*{MONEY}", t):
        take(m); sq.minRent = _money(m.group(1))
    elif m := re.search(rf"(?:around|about|~)\s*{MONEY}", t):
        take(m); v = _money(m.group(1)); sq.minRent, sq.maxRent = int(v * 0.85), int(v * 1.15)
    if m := re.search(r"\b(?:each|per person|per head|apiece|split \w+ ways|my share|per roommate)\b", t):
        take(m); sq.perPerson = True
    if m := re.search(r"\b(?:cheapest|cheap|affordable|lowest price|least expensive)\b", t):
        take(m); sq.sort = "price"

    # bed/bath combos: 2b2b, 2b/1b, 2bd 2ba, 3 bed 2 bath, 2br/2ba, 2x2
    if m := re.search(r"\b(\d)\s*(?:b|bd|br|bed(?:room)?s?)\s*[/,&+ -]*\s*(\d(?:\.5)?)\s*(?:b|ba|bth|bath(?:room)?s?)\b", t) or re.search(r"\b(\d)\s*x\s*(\d(?:\.5)?)\b", t):
        take(m); sq.beds, sq.baths = int(m.group(1)), float(m.group(2))
    else:
        if m := re.search(r"\b(\d)\s*\+\s*(?:b|bd|br|bed(?:room)?s?)\b", t) or re.search(r"\bat least\s*(\d)\s*(?:bd|br|bed(?:room)?s?)\b", t):
            take(m); sq.minBeds = int(m.group(1))
        elif m := re.search(r"\b(\d)\s*[- ]?(?:bd|br|bed(?:room)?s?)\b", t):
            take(m); sq.beds = int(m.group(1))
        if m := re.search(r"\b(\d(?:\.5)?)\s*[- ]?(?:ba|bath(?:room)?s?)\b", t):
            take(m); sq.baths = float(m.group(1))
    if m := re.search(r"\bstudios?\b", t):
        take(m); sq.beds, sq.roomType = 0, "entire"

    # room type + bathroom
    if m := re.search(r"\b(?:shared room|share a room|roommate in (?:the )?same room|double room|split room)\b", t):
        take(m); sq.roomType = "shared_room"
    elif m := re.search(r"\b(?:private room|own room|single room|room in (?:a )?(?:house|apartment|shared)|co-?living|a room)\b", t):
        take(m); sq.roomType = "private_room"
    elif m := re.search(r"\b(?:entire|whole|full)\s+(?:unit|apartment|apt|place|house)|\bmy own (?:place|apartment)\b", t):
        take(m); sq.roomType = "entire"
    elif m := re.search(r"\b(?:a |one |quiet |cheap |single )?room\b(?!\s*(?:for|mate))", t):
        take(m); sq.roomType = "private_room"
    if m := re.search(r"\b(?:private|own|ensuite|en-suite)\s+(?:bath(?:room)?|toilet)\b|\bensuite\b", t):
        take(m); sq.privateBath = True
    elif m := re.search(r"\b(?:don'?t|do not|never|no|not|won'?t)\s+(?:want to\s+|have to\s+|need to\s+|wanna\s+)?shar(?:e|ing)\s+(?:a|the|my)?\s*(?:bath(?:room)?|toilet|restroom)\b|\bno shared bath(?:room)?\b", t):
        take(m); sq.privateBath = True
    elif m := re.search(r"\bshared\s+bath(?:room)?s?\s+(?:is|are)\s+(?:fine|ok(?:ay)?|good|cool)\b|\b(?:fine|ok(?:ay)?)\s+(?:with|sharing)\s+(?:a\s+)?(?:shared\s+)?bath(?:room)?\b", t):
        take(m)  # acceptable either way → no constraint
    elif m := re.search(r"\bshared\s+bath(?:room)?\b", t):
        take(m); sq.privateBath = False

    # zones
    if m := re.search(r"\b(?:inside|in|within)\s+(?:the\s+)?dps\b|\bdps[- ]patrolled\b|\bpatrolled\b|\bsafe(?:st)?\s+(?:area|block|neighbou?rhood|zone)\b", t):
        take(m); sq.inDps = True
    elif m := re.search(r"\boutside\s+(?:the\s+)?dps\b", t):
        take(m); sq.inDps = False
    if m := re.search(r"\b(?:inside|in|within)\s+(?:the\s+)?(?:fryft|free lyft)\b|\b(?:fryft|free lyft)(?: zone| area)?\b|\bfree (?:late[- ]?night |night )?rides?\b", t):
        take(m); sq.inFryft = True

    # amenities
    for name, pat in AMENITIES.items():
        if m := re.search(pat, t):
            take(m); sq.amenities.append(name)

    # near a building / walk time
    walk = re.search(r"(\d+)\s*(?:-|\s)?min(?:ute)?s?(?:\s+walk(?:ing)?)?\s*(?:to|from|of)\s+", t)
    for bid, names in BUILDING_ALIASES.items():
        for n in names:
            if (m := re.search(rf"\b{re.escape(n.strip())}\b", t)) and not (n.strip() == "usc" and "usc village" in t):
                sq.nearBuildingId = bid
                sq.maxWalkMin = int(walk.group(1)) if walk else 15
                take(m)
                if walk: take(walk)
                break
        if sq.nearBuildingId is not None:
            break
    if sq.nearBuildingId is None and (m := re.search(
            r"\b(?:near|close to|next to|by|walking distance (?:to|from|of)|walkable to|around the corner from)\s+(?:a\s+)?"
            r"([a-z0-9'&.\- ]{3,40}?)(?=\s*(?:,|\.|;|$|\bunder\b|\bbelow\b|\bwith\b|\band\b|\bfor\b|\binside\b|\bin\b|\bmax\b|\bbudget\b|\baround\b|\$))", t)):
        place = m.group(1).strip()
        if place and not re.fullmatch(r"(?:the )?(?:campus|usc|here|me|school|class)", place):
            sq.nearText = place
            sq.maxWalkMin = int(walk.group(1)) if walk else 15
            take(m)
            if walk: take(walk)
    if m := re.search(r"\b(?:closest|nearest|shortest walk)\b", t):
        take(m); sq.sort = "walk"
        if sq.nearBuildingId is None: sq.nearBuildingId, sq.maxWalkMin = 9, 60

    # remainder → semantic text (drop filler)
    keep = list(t)
    for a, b in spans:
        for i in range(a, b): keep[i] = " "
    rest = re.sub(r"\b(?:i want|i need|i'?m|looking for|show me|find|need|with|and|a|an|the|near|close to|to|in|for|me|my|our|we|at|of|on|by|is|it|please|"
                  r"apartments?|place|housing|listings?|walk|walking|something|somewhere|some|that|which|where|i|own)\b", " ", "".join(keep))
    if sq.nearBuildingId is not None or sq.nearText:  # words naming the anchor place were already used for the walk filter
        rest = re.sub(r"\b(?:target|ralphs|trader joe'?s|whole foods|store|mall|station)\b", " ", rest)
    sq.text = re.sub(r"[^\w\s'-]", " ", rest)
    sq.text = re.sub(r"\s+", " ", sq.text).strip()
    return sq


# ---------- "near <place>" → coordinates (node-api /api/places, all of LA County) ----------
_place_cache: dict[str, dict | None] = {}


async def resolve_place(sq: SmartQuery):
    import httpx
    key = sq.nearText.lower()
    if key not in _place_cache:
        try:
            async with httpx.AsyncClient(timeout=6) as c:
                hits = (await c.get(f"{settings.node_internal_url}/api/places", params={"q": sq.nearText})).json()
            _place_cache[key] = hits[0] if hits else None
        except Exception:
            _place_cache[key] = None
    hit = _place_cache[key]
    if hit:
        sq.nearLat, sq.nearLng = hit["lat"], hit["lng"]
        sq.nearLabel = f"{hit['label']}" + (f" ({hit['detail'].split(',')[0]})" if hit.get("detail") else "")
    else:  # couldn't place it: don't filter, keep the words for ranking
        sq.text = f"{sq.text} {sq.nearText}".strip()
        sq.maxWalkMin = None


# ---------- optional LLM parser ----------
async def parse(q: str) -> tuple[SmartQuery, str]:
    """Returns (query, parser) where parser is 'rules' or 'rules+llm'."""
    sq = parse_rules(q)
    if sq.nearText and sq.nearLat is None:
        await resolve_place(sq)
    try:
        from app.llm import get_llm
        llm = get_llm()
    except Exception:
        llm = None
    if not llm or not q.strip():
        return sq, "rules"
    try:
        from pydantic import BaseModel

        class LLMQuery(BaseModel):
            maxRent: int | None = None
            minRent: int | None = None
            beds: int | None = None
            baths: float | None = None
            roomType: str | None = None   # entire | private_room | shared_room
            privateBath: bool | None = None
            inDps: bool | None = None
            amenities: list[str] = []
            nearBuilding: str | None = None
            maxWalkMin: int | None = None

        got = await llm.with_structured_output(LLMQuery).ainvoke(
            "Extract USC housing search constraints. Only set what the user stated. roomType is one of entire, private_room, "
            f"shared_room. Amenities from: {list(AMENITIES)}. Query: {q}")
        tq = q.lower()
        evidence = {  # the query must mention something related before we accept an LLM-extracted value
            "maxRent": r"\$|\d|budget|grand|k\b|cheap|afford", "minRent": r"\$|\d", "beds": r"bed|br\b|bd\b|studio|\db|room for|friends|roommates?",
            "baths": r"bath|toilet|restroom|\db\d", "roomType": r"\broom\b|share|shared|own place|entire|whole|studio|co-?living",
            "privateBath": r"bath|toilet|restroom|ensuite", "inDps": r"dps|patrol|safe|secure", "maxWalkMin": r"min|walk|close|near",
        }
        for k in ("maxRent", "minRent", "beds", "baths", "roomType", "privateBath", "inDps", "maxWalkMin"):
            if k == "roomType" and got.roomType == "entire" and re.search(r"\broom\b(?!mate)", tq):
                continue
            if k == "roomType" and (sq.beds is not None or sq.baths is not None or sq.minBeds is not None):
                continue  # a bed/bath layout already says what kind of place it is
            if getattr(sq, k) in (None, []) and getattr(got, k) is not None and re.search(evidence[k], tq):
                setattr(sq, k, getattr(got, k))
        amenity_words = {"furnished": r"furnish|furniture", "laundry": r"laundry|wash|dryer|w/d", "parking": r"park|garage|car",
                         "pets": r"pet|dog|cat", "ac": r"a/?c\b|air|cool", "gym": r"gym|fitness|work ?out", "pool": r"pool|swim",
                         "utilities included": r"utilit"}
        sq.amenities = sorted(set(sq.amenities) | {a for a in got.amenities if a in AMENITIES and re.search(amenity_words[a], tq)
                                                   and not re.search(rf"\bun{a}|\bno {a}|without {a}", tq)})
        if sq.nearBuildingId is None and got.nearBuilding:
            for bid, names in BUILDING_ALIASES.items():
                if any(n.strip() in got.nearBuilding.lower() for n in names):
                    sq.nearBuildingId, sq.maxWalkMin = bid, sq.maxWalkMin or 15
                    break
        return sq, "rules+llm"
    except Exception:
        return sq, "rules"
