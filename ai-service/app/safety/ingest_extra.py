"""Extra safety data, merged into the existing files in data/:

  HSC (Health Sciences Campus) parity — streets, LAPD incidents, named places, police / blue phones / clinics,
  the DPS HSC station — so everything that works around UPC also works around HSC.

  Lit & Alive routing:
    streetlight_outages.json  open "Streetlight Repair Services" cases from MyLA311 (data.lacity.org, 2cy6-i7zn,
                              refreshed daily): reported dark streetlights that haven't been fixed yet.
    open_places.json          named shops/cafés/restaurants/pharmacies etc. with OpenStreetMap opening_hours,
                              so the router can prefer streets where something is open right now.

Run:  cd ai-service && .venv/bin/python -m app.safety.ingest_extra
"""
from __future__ import annotations

import datetime as dt
import json
import sys
import time

import httpx

from app.safety import ingest
from app.safety.ingest import DATA, OVERPASS, UA, campus_places_from

UPC = (34.0070, -118.3080, 34.0430, -118.2640)
HSC = (34.0480, -118.2220, 34.0720, -118.1860)  # Valley Blvd / Soto St / Marengo St / I-5, plus margin
MYLA311 = "https://data.lacity.org/resource/2cy6-i7zn.json"


def overpass(q: str) -> list[dict]:
    last = None
    for attempt, url in enumerate(OVERPASS * 3):
        try:
            r = httpx.post(url, data={"data": q}, headers={**UA, "Accept": "application/json"}, timeout=180)
            r.raise_for_status()
            return r.json()["elements"]
        except Exception as e:  # public servers are often busy
            last = e
            time.sleep(6 * (attempt + 1))
    raise RuntimeError(f"Overpass failed: {last}")


def hsc_streets():
    ingest.BBOX = HSC
    st = ingest.fetch_streets()
    f = DATA / "streets.json"
    cur = json.loads(f.read_text())
    have = {w["id"] for w in cur["ways"] if "id" in w}
    cur["nodes"].update(st["nodes"])
    cur["ways"] += [w for w in st["ways"] if w["id"] not in have]
    cur["areas"] = ["UPC", "HSC"]
    f.write_text(json.dumps(cur))
    print(f"streets: +{len(st['ways'])} HSC ways (now {len(cur['ways'])})")


def hsc_incidents():
    ingest.BBOX = HSC
    inc = ingest.fetch_incidents()
    f = DATA / "incidents.json"
    cur = json.loads(f.read_text())
    ids = {i["id"] for i in cur["incidents"]}
    new = [i for i in inc["incidents"] if i["id"] not in ids]
    cur["incidents"] += new
    cur["count"] = len(cur["incidents"])
    cur["areas"] = ["UPC", "HSC"]
    f.write_text(json.dumps(cur))
    print(f"incidents: +{len(new)} around HSC (now {cur['count']})")


def hsc_places():
    s, w, n, e = HSC
    sel = "".join(f'nwr["name"]({s},{w},{n},{e})["{k}"];' for k in ("amenity", "shop", "building", "leisure", "tourism", "healthcare"))
    els = overpass(f"[out:json][timeout:90];({sel});out center tags;")
    rows = campus_places_from(els)
    for r in rows:
        r["campus"] = "HSC"
    f = DATA / "campus_places.json"
    cur = json.loads(f.read_text())
    keys = {(p["name"].lower(), round(p["lat"], 4)) for p in cur["places"]}
    add = [r for r in rows if (r["name"].lower(), round(r["lat"], 4)) not in keys]
    cur["places"] += add
    f.write_text(json.dumps(cur))
    print(f"campus places: +{len(add)} around HSC")


def hsc_resources():
    s, w, n, e = HSC
    q = (f"[out:json][timeout:90];(nwr[\"amenity\"=\"police\"]({s - 0.02},{w - 0.03},{n + 0.02},{e + 0.03});"
         f"nwr[\"emergency\"=\"phone\"]({s},{w},{n},{e});"
         f"nwr[\"amenity\"~\"^(clinic|hospital|pharmacy|doctors)$\"][\"name\"]({s},{w},{n},{e});"
         f"nwr[\"healthcare\"~\"^(clinic|hospital|pharmacy)$\"][\"name\"]({s},{w},{n},{e}););out center tags;")
    els = overpass(q)
    f = DATA / "safety_resources.json"
    cur = json.loads(f.read_text())
    have = {(r["type"], round(r["lat"], 4), round(r["lng"], 4)) for r in cur["resources"]}
    added = 0
    for x in els:
        t = x.get("tags", {})
        lat = x.get("lat") or (x.get("center") or {}).get("lat")
        lng = x.get("lon") or (x.get("center") or {}).get("lon")
        if lat is None:
            continue
        if t.get("amenity") == "police":
            r = {"type": "police", "name": t.get("name", "Police station"), "operator": t.get("operator", ""),
                 "address": " ".join(v for v in (t.get("addr:housenumber"), t.get("addr:street")) if v), "phone": t.get("phone", "")}
        elif t.get("emergency") == "phone":
            r = {"type": "blue_phone", "name": "Emergency phone (blue light)", "phone": "connects to DPS"}
        else:
            r = {"type": "medical", "name": t["name"], "kind": t.get("amenity") or t.get("healthcare"),
                 "address": " ".join(v for v in (t.get("addr:housenumber"), t.get("addr:street")) if v)}
        r.update(lat=round(lat, 6), lng=round(lng, 6), precision="exact", source="OpenStreetMap", campus="HSC")
        key = (r["type"], round(r["lat"], 4), round(r["lng"], 4))
        if key not in have:
            cur["resources"].append(r); have.add(key); added += 1
    if not any(r["type"] == "dps_station" and "Health Sciences" in r["name"] for r in cur["resources"]):
        cur["resources"].append({"type": "dps_station", "name": "USC DPS Health Sciences Campus station (24/7)", "address": "2001 N Soto St",
                                 "lat": 34.06178, "lng": -118.19934, "phone": "323-442-1000", "precision": "approximate",
                                 "source": "https://dps.usc.edu/contact/ (address); position approximate", "campus": "HSC"})
        added += 1
    cur["phones"]["dpsHscEmergency"] = "323-442-1000"
    cur["phones"]["dpsHscNonEmergency"] = "323-442-1200"
    f.write_text(json.dumps(cur, indent=1))
    print(f"safety resources: +{added} around HSC")


def open_places():
    out = []
    for s, w, n, e in (UPC, HSC):
        sel = "".join(f'nwr["name"]["opening_hours"]({s},{w},{n},{e})["{k}"];' for k in ("amenity", "shop", "leisure", "tourism"))
        for x in overpass(f"[out:json][timeout:90];({sel});out center tags;"):
            t = x.get("tags", {})
            lat = x.get("lat") or (x.get("center") or {}).get("lat")
            lng = x.get("lon") or (x.get("center") or {}).get("lon")
            if lat is None:
                continue
            out.append({"name": t["name"], "kind": t.get("amenity") or t.get("shop") or t.get("leisure") or t.get("tourism"),
                        "hours": t["opening_hours"], "lat": round(lat, 6), "lng": round(lng, 6)})
    seen, rows = set(), []
    for r in out:
        k = (r["name"], r["lat"], r["lng"])
        if k not in seen:
            seen.add(k); rows.append(r)
    (DATA / "open_places.json").write_text(json.dumps({"source": "© OpenStreetMap contributors (ODbL): places with opening_hours",
                                                       "fetchedAt": dt.datetime.now().isoformat(timespec="seconds"), "places": rows}))
    print(f"open places: {len(rows)}")


def streetlights(days: int = 180):
    since = (dt.date.today() - dt.timedelta(days=days)).isoformat()
    rows = []
    for s, w, n, e in (UPC, HSC):
        where = (f"type='Streetlight Repair Services' AND createddate >= '{since}' AND status not in ('Closed','Cancelled','Closed Ext-Referred') "
                 f"AND geolocation__latitude__s between {s} and {n} AND geolocation__longitude__s between {w} and {e}")
        r = httpx.get(MYLA311, params={"$where": where, "$limit": 20000, "$order": "createddate desc",
                                       "$select": "casenumber,createddate,status,locator_gis_returned_address,geolocation__latitude__s,geolocation__longitude__s"},
                      headers=UA, timeout=120)
        r.raise_for_status()
        for x in r.json():
            try:
                lat, lng = float(x["geolocation__latitude__s"]), float(x["geolocation__longitude__s"])
            except (KeyError, ValueError):
                continue
            rows.append({"id": x["casenumber"], "lat": round(lat, 6), "lng": round(lng, 6), "reported": x["createddate"][:10],
                         "status": x["status"], "address": (x.get("locator_gis_returned_address") or "").split(", LOS ANGELES")[0].title()})
    (DATA / "streetlight_outages.json").write_text(json.dumps({
        "source": "MyLA311 Cases 2026 (data.lacity.org 2cy6-i7zn): open 'Streetlight Repair Services' requests",
        "since": since, "fetchedAt": dt.datetime.now().isoformat(timespec="seconds"), "count": len(rows), "outages": rows}))
    print(f"streetlight outages (open, last {days} days): {len(rows)}")


STEPS = {"streetlights": streetlights, "open_places": open_places, "hsc_streets": hsc_streets, "hsc_incidents": hsc_incidents,
         "hsc_places": hsc_places, "hsc_resources": hsc_resources}

if __name__ == "__main__":
    for name in sys.argv[1:] or STEPS:
        try:
            STEPS[name]()
        except Exception as e:
            print(f"{name} failed: {e}", file=sys.stderr)
