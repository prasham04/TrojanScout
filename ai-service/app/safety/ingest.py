"""Safety data for routing + the map. Writes three files into /data:

  incidents.json         LAPD NIBRS offenses (data.lacity.org, dataset k7nn-b2ep), last 6 months, around USC.
                         Block-level (hundred-block) coordinates, as published by LAPD. Falls back to clearly
                         labelled synthetic data if the API is unreachable.
  streets.json           Walkable street network from OpenStreetMap (Overpass API), with `lit` tags.
  (safety_resources.json is not written here: see ingest_extra.py.)

Run:  python -m app.safety.ingest
"""
import datetime as dt
import json
import random
import re
import sys
from pathlib import Path

import httpx

from app.config import settings

DATA = Path(settings.data_dir)
UA = {"User-Agent": "TrojanScout/0.1 (USC student hackathon project)"}
BBOX = (34.0070, -118.3080, 34.0430, -118.2640)  # s, w, n, e — DPS zone + margin
LAPD = "https://data.lacity.org/resource/k7nn-b2ep.json"
OVERPASS = ["https://overpass-api.de/api/interpreter", "https://overpass.private.coffee/api/interpreter"]

CATEGORIES = [  # (category, regex on NIBRS description, severity weight for routing)
    ("robbery", r"robbery", 5.0), ("sexual offense", r"rape|sodomy|fondling|sexual", 5.0),
    ("aggravated assault", r"aggravated assault|shots fired|homicide|murder", 5.0),
    ("threats / weapons", r"criminal threats|brandish|weapon", 3.5),
    ("assault", r"simple assault|intimidation|battery|assault", 3.0), ("burglary", r"burglary|breaking", 2.0),
    ("vehicle crime", r"motor vehicle|from motor vehicle|vehicle parts", 1.5), ("theft", r"theft|larceny|shoplift|pocket|purse", 1.0),
    ("vandalism", r"vandal|destruction|damage", 0.7), ("trespass", r"trespass", 0.5),
    # not a street risk to pedestrians: kept for counts, nearly ignored by routing
    ("non-street", r"warrant|failure to appear|court order|dui|paraphernalia|controlled substance|drunk|license", 0.1),
]


def categorize(desc: str) -> tuple[str, float]:
    d = desc.lower()
    for name, pat, w in CATEGORIES:
        if re.search(pat, d):
            return name, w
    return "other", 0.5


def fetch_incidents(months: int = 6) -> dict:
    since = (dt.date.today() - dt.timedelta(days=30 * months)).isoformat()
    s, w, n, e = BBOX
    where = (f"hndrdth_lat::number between {s} and {n} AND hndrdth_lon::number between {w} and {e} "
             f"AND date_occ > '{since}'")
    rows = httpx.get(LAPD, params={"$where": where, "$limit": 50000, "$order": "date_occ DESC",
                                   "$select": "uniquenibrno,date_occ,time_occ,nibr_description,crime_against,premis_desc,hndrdth_lat,hndrdth_lon,hndrdth_loc_chk"},
                     headers=UA, timeout=120).json()
    out = []
    for r in rows:
        try:
            lat, lng = float(r["hndrdth_lat"]), float(r["hndrdth_lon"])
        except (KeyError, ValueError, TypeError):
            continue
        if lat == 0:
            continue
        cat, weight = categorize(r.get("nibr_description", ""))
        t = r.get("time_occ", "1200")
        hour = int(t[:2]) if t[:2].isdigit() else 12
        out.append({"id": r.get("uniquenibrno"), "lat": lat, "lng": lng, "date": r.get("date_occ", "")[:10], "hour": hour,
                    "night": hour >= 19 or hour < 6, "category": cat, "severity": weight,
                    "against": r.get("crime_against", ""), "description": re.sub(r"\s+", " ", r.get("nibr_description", "")).strip(),
                    "premise": r.get("premis_desc", ""), "block": r.get("hndrdth_loc_chk", "")})
    return {"source": "LAPD NIBRS Offenses (data.lacity.org k7nn-b2ep)", "synthetic": False, "since": since,
            "fetchedAt": dt.datetime.now().isoformat(timespec="seconds"), "count": len(out), "incidents": out}


def synthetic_incidents(n: int = 1500) -> dict:
    """Fallback only. Realistic shape: denser along commercial corridors (Figueroa, Vermont, Jefferson), more theft than violence."""
    rnd = random.Random(42)
    corridors = [(-118.2780, None), (-118.2915, None), (None, 34.0255), (None, 34.0183)]
    weights = [("theft", 1.0, 40), ("vehicle crime", 1.5, 22), ("burglary", 2.0, 12), ("vandalism", 0.7, 10), ("assault", 3.0, 9), ("robbery", 5.0, 5), ("aggravated assault", 5.0, 2)]
    out = []
    for i in range(n):
        s, w, nn, e = BBOX
        lat, lng = rnd.uniform(s, nn), rnd.uniform(w, e)
        if rnd.random() < 0.55:
            clng, clat = rnd.choice(corridors)
            lng = clng + rnd.gauss(0, 0.0006) if clng else lng
            lat = clat + rnd.gauss(0, 0.0005) if clat else lat
        cat, sev, _ = rnd.choices(weights, [x[2] for x in weights])[0]
        hour = rnd.choice(list(range(24)))
        out.append({"id": f"syn-{i}", "lat": round(lat, 4), "lng": round(lng, 4), "date": (dt.date.today() - dt.timedelta(days=rnd.randint(0, 180))).isoformat(),
                    "hour": hour, "night": hour >= 19 or hour < 6, "category": cat, "severity": sev, "against": "",
                    "description": f"Synthetic {cat}", "premise": "", "block": ""})
    return {"source": "SYNTHETIC (LAPD API unreachable)", "synthetic": True, "count": len(out), "incidents": out}


def fetch_streets() -> dict:
    s, w, n, e = BBOX
    q = f"""[out:json][timeout:60];
way["highway"~"^(primary|secondary|tertiary|unclassified|residential|living_street|service|pedestrian|footway|path|steps|cycleway|crossing|primary_link|secondary_link|tertiary_link)$"]["foot"!="no"]["access"!="private"]({s},{w},{n},{e});
out body; >; out skel qt;"""
    import time
    last = None
    for attempt, url in enumerate(OVERPASS * 2):
        try:
            r = httpx.post(url, data={"data": q}, headers={**UA, "Accept": "application/json"}, timeout=180)
            r.raise_for_status()
            els = r.json()["elements"]
            break
        except Exception as e:  # public Overpass servers are often busy: back off and try a mirror
            last = e
            time.sleep(5 * (attempt + 1))
    else:
        raise RuntimeError(f"all Overpass mirrors failed: {last}")
    nodes = {str(x["id"]): [round(x["lat"], 6), round(x["lon"], 6)] for x in els if x["type"] == "node"}
    ways = [{"id": x["id"], "nodes": [str(i) for i in x["nodes"]], "highway": x["tags"].get("highway"),
             "lit": x["tags"].get("lit"), "name": x["tags"].get("name", "")} for x in els if x["type"] == "way"]
    return {"source": "© OpenStreetMap contributors (ODbL), via Overpass API", "fetchedAt": dt.datetime.now().isoformat(timespec="seconds"),
            "nodes": nodes, "ways": ways}


def main():
    DATA.mkdir(exist_ok=True)
    try:
        inc = fetch_incidents()
        if not inc["count"]:
            raise RuntimeError("no rows")
    except Exception as e:
        print("LAPD fetch failed, writing synthetic incidents:", e, file=sys.stderr)
        inc = synthetic_incidents()
    (DATA / "incidents.json").write_text(json.dumps(inc))
    print(f"incidents: {inc['count']} ({inc['source']})")
    try:
        st = fetch_streets()
        (DATA / "streets.json").write_text(json.dumps(st))
        print(f"streets: {len(st['ways'])} ways, {len(st['nodes'])} nodes")
    except Exception as e:
        print("Overpass fetch failed (keeping previous streets.json if any):", e, file=sys.stderr)
    # safety_resources.json (police, blue-light phones, clinics, DPS stations, vending) is maintained from OpenStreetMap
    # and USC pages; refresh the HSC part with `python -m app.safety.ingest_extra hsc_resources`. Not overwritten here.
    try:
        campus_places_only()
    except Exception as e:
        print("campus places fetch failed (keeping previous file):", e, file=sys.stderr)


if __name__ == "__main__":
    main()


def streets_only():
    st = fetch_streets()
    (DATA / "streets.json").write_text(json.dumps(st))
    print(f"streets: {len(st['ways'])} ways, {len(st['nodes'])} nodes")


def campus_places_from(elements: list[dict]) -> list[dict]:
    """Named OSM places around campus → compact gazetteer rows used by node-api place search."""
    out, seen = [], set()
    for e in elements:
        t = e.get("tags", {})
        name = t.get("name")
        lat = e.get("lat") or (e.get("center") or {}).get("lat")
        lon = e.get("lon") or (e.get("center") or {}).get("lon")
        if not name or lat is None:
            continue
        key = (name.lower(), round(lat, 4), round(lon, 4))
        if key in seen:
            continue
        seen.add(key)
        alt = [v for k in ("short_name", "alt_name", "old_name", "official_name") if (v := t.get(k))]
        if (ref := t.get("ref")) and re.fullmatch(r"[A-Za-z]{2,5}", ref):
            alt.append(ref)
        street = " ".join(x for x in (t.get("addr:housenumber"), t.get("addr:street")) if x)
        kind = t.get("amenity") or t.get("shop") or t.get("tourism") or t.get("leisure") or t.get("building") or "place"
        out.append({"name": name, "alt": alt, "lat": round(lat, 6), "lng": round(lon, 6), "kind": kind, "address": street})
    return out


def fetch_campus_places() -> dict:
    s, w, n, e = 34.0080, -118.3060, 34.0420, -118.2650
    sel = "".join(f'nwr["name"]({s},{w},{n},{e})["{k}"];' for k in ("amenity", "shop", "building", "leisure", "tourism"))
    q = f"[out:json][timeout:60];({sel}nwr[\"name\"]({s},{w},{n},{e})[\"public_transport\"=\"station\"];);out center tags;"
    import time
    for attempt, url in enumerate(OVERPASS * 2):
        try:
            r = httpx.post(url, data={"data": q}, headers={**UA, "Accept": "application/json"}, timeout=180)
            r.raise_for_status()
            return {"source": "© OpenStreetMap contributors (ODbL), via Overpass API", "places": campus_places_from(r.json()["elements"])}
        except Exception:
            time.sleep(5 * (attempt + 1))
    raise RuntimeError("Overpass unavailable")


def campus_places_only():
    d = fetch_campus_places()
    (DATA / "campus_places.json").write_text(json.dumps(d))
    print(f"campus places: {len(d['places'])}")
