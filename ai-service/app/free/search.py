"""Free & Safe directory search: data/free_programs.json → hybrid search (meaning + keywords) + time and place awareness.

  "I've been drinking and can't drive"  → AAA Tow to Go (meaning), with "Next: Dec 31, 6 PM" (time)
  "free ride home tonight" at 1 AM       → USC Lyft "Available now, until 2 AM" ranked first
Statuses are computed in America/Los_Angeles. Area checks use the DPS patrol areas, USC's official Lyft boundaries and the South LA pilot bounds."""
import datetime as dt
import json
import re
from functools import lru_cache
from pathlib import Path
from zoneinfo import ZoneInfo

import bm25s
import numpy as np
import Stemmer

from app.config import settings
from app.listings.index import _embed

LA = ZoneInfo("America/Los_Angeles")
_stem = Stemmer.Stemmer("english")
# South LA Universal Basic Mobility pilot: 10 Fwy (N), Alameda (E), Crenshaw (W), Florence (S); approximate box
UBM_BOX = (33.9745, -118.3350, 34.0340, -118.2390)


def _programs() -> list[dict]:
    return json.loads((Path(settings.data_dir) / "free_programs.json").read_text())["programs"]


def _doc(p: dict) -> str:
    return ". ".join([p["name"], p["provider"], p["category"], p["summary"], p.get("tags", ""), " ".join(p.get("eligibility", []))])


@lru_cache
def _index(mtime: float):
    ps = _programs()
    docs = [_doc(p) for p in ps]
    vecs = _embed(docs)
    bm = bm25s.BM25()
    bm.index(bm25s.tokenize(docs, stopwords="en", stemmer=_stem, show_progress=False), show_progress=False)
    return ps, vecs, bm


def index():
    f = Path(settings.data_dir) / "free_programs.json"
    return _index(f.stat().st_mtime)  # rebuilds automatically when the file is edited


# ---------- place ----------
@lru_cache
def _zone(name: str):
    z = json.loads((Path(settings.data_dir) / "zones.geojson").read_text())
    f = next((x for x in z["features"] if x["properties"]["name"] == name), None)
    return f["geometry"]["coordinates"][0] if f else None


def _inside(ring, lat, lng) -> bool:
    inside, j = False, len(ring) - 1
    for i in range(len(ring)):
        xi, yi = ring[i]; xj, yj = ring[j]
        if (yi > lat) != (yj > lat) and lng < (xj - xi) * (lat - yi) / ((yj - yi) or 1e-12) + xi:
            inside = not inside
        j = i
    return inside


@lru_cache
def _ride_zone(name: str):
    f = Path(settings.data_dir) / "usc_ride_zones.geojson"
    if not f.exists():
        return None
    z = json.loads(f.read_text())
    g = next((x for x in z["features"] if x["properties"]["name"] == name), None)
    return g["geometry"]["coordinates"][0] if g else None


def area_ok(area: str, lat: float | None, lng: float | None) -> bool | None:
    if lat is None or lng is None:
        return None
    if area in ("usc_lyft_upc", "usc_lyft_hsc"):
        ring = _ride_zone(area)
        if area == "usc_lyft_hsc":  # the HSC program also covers Union Station
            u = _ride_zone("usc_lyft_union_station")
            if u and _inside(u, lat, lng):
                return True
        return _inside(ring, lat, lng) if ring else None
    if area == "fryft":  # official USC Lyft boundaries (UPC, or HSC incl. Union Station)
        return bool(area_ok("usc_lyft_upc", lat, lng) or area_ok("usc_lyft_hsc", lat, lng))
    if area == "dps":
        ring = _zone("DPS")
        if area == "dps" and (hsc := _zone("DPS_HSC")) and _inside(hsc, lat, lng):
            return True
        return _inside(ring, lat, lng) if ring else None
    if area == "lanow_south_la":  # Figueroa St / Slauson Ave / Long Beach Ave / Washington Blvd
        return 33.9890 <= lat <= 34.0335 and -118.2830 <= lng <= -118.2425
    if area == "leimert":  # Leimert Park / Baldwin Hills Crenshaw (approximate; the official map isn't published as data)
        return 33.990 <= lat <= 34.020 and -118.350 <= lng <= -118.300
    if area == "ubm":
        s, w, n, e = UBM_BOX
        return s <= lat <= n and w <= lng <= e
    if area == "la_county":
        return 33.70 <= lat <= 34.82 and -118.95 <= lng <= -117.65
    return True  # socal / california / us: anywhere in LA


# ---------- time ----------
def _hm(s: str) -> dt.time:
    h, m = map(int, s.split(":"))
    return dt.time(h, m)


def _fmt(t: dt.datetime) -> str:
    return t.strftime("%-I:%M %p").replace(":00", "")


def status(p: dict, now: dt.datetime) -> dict:
    s = p["schedule"]
    kind = s["type"]
    if kind == "always":
        return {"state": "open", "label": "Available 24/7", "next": None}
    if kind == "varies":
        return {"state": "info", "label": "Hours vary: check details", "next": None}
    if kind in ("daily", "weekly"):
        start, end = _hm(s["start"]), _hm(s["end"])
        days = set(s.get("days", range(7)))  # 0 = Monday
        skip = {e["date"]: e["label"] for e in p.get("exceptions", [])}
        windows = []
        for k in range(-1, 8):
            d = now.date() + dt.timedelta(days=k)
            if d.weekday() not in days:
                continue
            a = dt.datetime.combine(d, start, LA)
            b = dt.datetime.combine(d + dt.timedelta(days=1) if end <= start else d, end, LA)
            windows.append((a, b, skip.get(d.isoformat())))
        for a, b, off in windows:
            if a <= now < b and not off:
                left = int((b - now).total_seconds() // 60)
                return {"state": "open", "label": f"Available now, until {_fmt(b)}" + (f" ({left} min left)" if left < 90 else ""), "next": b.isoformat()}
        today_off = next((off for a, b, off in windows if a.date() == now.date() and off), None)
        upcoming_w = [(a, off) for a, b, off in windows if a > now and not off]
        if not upcoming_w:
            return {"state": "info", "label": "Not running this week", "next": None}
        a = upcoming_w[0][0]
        when = "today" if a.date() == now.date() else "tomorrow" if a.date() == now.date() + dt.timedelta(days=1) else a.strftime("%a %b %-d")
        return {"state": "closed", "label": (f"No service today ({today_off}). " if today_off else "") + f"Next: {when} at {_fmt(a)}", "next": a.isoformat()}
    if kind == "dates":
        wins = [(dt.datetime.fromisoformat(w["start"]).replace(tzinfo=LA), dt.datetime.fromisoformat(w["end"]).replace(tzinfo=LA), w["label"]) for w in s["windows"]]
        for a, b, label in wins:
            if a <= now < b:
                return {"state": "open", "label": f"Running now ({label}), until {_fmt(b)}", "next": b.isoformat(), "occasion": label}
        future = sorted((a, label) for a, b, label in wins if a > now)
        if not future:
            return {"state": "ended", "label": "Ended for this year", "next": None}
        a, label = future[0]
        days_ = (a.date() - now.date()).days
        return {"state": "upcoming", "label": f"{label}: {a.strftime('%a %b %-d')} from {_fmt(a)}" + (f" (in {days_} days)" if days_ > 1 else " (tomorrow)" if days_ == 1 else ""),
                "next": a.isoformat(), "occasion": label}
    if kind == "annual":
        best = None
        for w in s["windows"]:
            for year in (now.year - 1, now.year, now.year + 1):
                try:
                    a = dt.datetime.combine(dt.date(year, w["month"], w["day"]), _hm(w["start"]), LA)
                except ValueError:
                    continue
                b = a + dt.timedelta(hours=w["hours"])
                if a <= now < b:
                    return {"state": "open", "label": f"On now for {w['label']}, until {b.strftime('%b %-d')} {_fmt(b)}", "next": b.isoformat(), "occasion": w["label"]}
                if a > now and (best is None or a < best[0]):
                    best = (a, w["label"])
        a, label = best
        days = (a.date() - now.date()).days
        when = "tomorrow" if days == 1 else f"in {days} days" if days < 60 else a.strftime("%b %-d")
        return {"state": "upcoming", "label": f"Next: {label}, {a.strftime('%b %-d')} at {_fmt(a)} ({when})", "next": a.isoformat(), "occasion": label}
    return {"state": "info", "label": "", "next": None}


# ---------- search ----------
NOW_WORDS = re.compile(r"\b(right now|now|currently|at the moment|asap|immediately)\b", re.I)
TONIGHT = re.compile(r"\b(tonight|this evening|later today|after class)\b", re.I)

# Situations people actually type → the programs that help, most useful first (deterministic, explainable)
SITUATIONS: list[tuple[str, str, list[str]]] = [
    (r"drunk|drinking|been drinking|tipsy|can'?t drive|cannot drive|sober|buzzed|designated", "You've been drinking", ["fryft", "tipsy-tow", "metro-nye", "share-trip"]),
    (r"follow(ed|ing)|scared|unsafe|creep|being watched|someone behind|harass(ed|ing)? (me|on the street)", "You feel unsafe right now", ["dps-escort", "livesafe", "security-ambassadors", "check-in", "transit-watch"]),
    (r"spiked|roofie|drugged|my drink", "Your drink may be spiked", ["drink-test-kits", "dps-escort", "share-trip", "988"]),
    (r"overdos|narcan|naloxone|fentanyl|opioid", "Overdose risk", ["narcan", "dps-escort", "988"]),
    (r"bike|scooter|skateboard", "Bike or scooter", ["bike-registration", "power-up", "bike-share-reduced"]),
    (r"afford|money|broke|cheap|low income|fare|expensive", "Money is tight", ["metro-life", "mobility-wallet", "dash-students", "upass", "bike-share-reduced"]),
    (r"stalk|address|abuse|domestic|ex |survivor|assault", "Someone may know where you live", ["safe-at-home", "csi", "dps-escort", "livesafe"]),
    (r"dark|streetlight|street light|no lights|unlit", "Dark streets", ["streetlight", "dps-escort", "check-in"]),
    (r"bus|train|metro|subway|transit", "On transit", ["transit-watch", "upass", "metro-life", "dash-students"]),
    (r"new year|nye|dec(ember)? 31", "New Year's Eve", ["metro-nye", "tipsy-tow"]),
    (r"christmas|dec(ember)? 24|holiday", "Holidays", ["metro-christmas-eve", "metro-nye", "tipsy-tow"]),
    (r"july 4|fourth of july|4th of july|independence", "Fourth of July", ["tipsy-tow"]),
    (r"vote|election", "Election day", ["ladot-free-days"]),
    (r"ride home|get home|late night|walk home|way home|night|late", "Getting home at night", ["fryft", "lyft-hsc", "dps-escort", "livesafe", "check-in"]),
    (r"crisis|panic|anxious|anxiety|depress|suicid|talk to someone", "You need to talk to someone", ["988", "csi"]),
    (r"women|female|woman driver", "Women riders", ["uber-women", "share-trip"]),
]


def situations(q: str) -> list[tuple[str, list[str]]]:
    return [(label, ids) for pat, label, ids in SITUATIONS if re.search(pat, q, re.I)]


def search(q: str = "", *, lat: float | None = None, lng: float | None = None, usc: bool = True,
           category: str | None = None, available_now: bool = False, now: dt.datetime | None = None, k: int = 30) -> dict:
    ps, vecs, bm = index()
    now = (now or dt.datetime.now(LA)).astimezone(LA)
    if NOW_WORDS.search(q or ""):
        available_now = True
    tonight = bool(TONIGHT.search(q or ""))
    matched = situations(q or "")
    order = list(range(len(ps)))
    scores = {i: 0.0 for i in order}
    by_id = {p["id"]: i for i, p in enumerate(ps)}
    for _, ids in matched:  # situation rules dominate: earlier in the list = more useful
        for r, pid in enumerate(ids):
            if pid in by_id:
                scores[by_id[pid]] += 0.06 - r * 0.006
    if q.strip():
        dense = (vecs @ _embed([q], query=True)[0]).tolist()
        dense_rank = sorted(order, key=lambda i: -dense[i])
        toks = bm25s.tokenize([q], stopwords="en", stemmer=_stem, show_progress=False)
        sparse_rank: list[int] = []
        if toks.vocab:
            ids, sc = bm.retrieve(toks, k=len(ps), show_progress=False)
            sparse_rank = [int(i) for i, s in zip(ids[0], sc[0]) if s > 0]
        for r, i in enumerate(dense_rank):
            scores[i] += 1 / (60 + r + 1)
        for r, i in enumerate(sparse_rank):
            scores[i] += 1 / (60 + r + 1)
        floor = sorted(dense)[len(dense) // 2]  # drop clearly unrelated programs (below the median similarity, no keyword hit)
        situational = {by_id[pid] for _, ids in matched for pid in ids if pid in by_id}
        order = [i for i in order if dense[i] >= floor or i in sparse_rank or i in situational]
    out = []
    for i in order:
        p = ps[i]
        st = status(p, now)
        ok = area_ok(p["area"], lat, lng)
        eligible = (usc or "usc" not in p["eligibility"]) and "usc_employee" not in p["eligibility"]
        if category and p["category"] != category:
            continue
        if available_now and st["state"] not in ("open",):
            continue
        if tonight and st["state"] == "closed" and st["next"] and \
                dt.datetime.fromisoformat(st["next"]).date() != now.date() and now.hour < 20:
            continue  # "tonight": keep things open now or opening later today
        boost = (0.004 if st["state"] == "open" else 0) + (0.002 if ok else -0.004 if ok is False else 0) + (0 if eligible else -0.01)
        holiday_asked = any(lbl in ("New Year's Eve", "Holidays", "Fourth of July", "Election day") for lbl, _ in matched)
        if st["state"] == "upcoming" and not holiday_asked and st["next"] and \
                (dt.datetime.fromisoformat(st["next"]) - now).total_seconds() > 86400:
            boost -= 0.03  # a holiday-only offer isn't the answer on an ordinary night
        if st["state"] == "closed" and st["next"] and dt.datetime.fromisoformat(st["next"]).date() == now.date():
            boost += 0.002  # opens later today
        out.append({**p, "status": st, "areaOk": ok, "eligible": eligible, "score": round(scores[i] + boost, 5)})
    out.sort(key=lambda x: -x["score"] if q.strip() else (x["status"]["state"] != "open", x["name"]))
    return {"query": q, "now": now.isoformat(), "availableNow": available_now, "tonight": tonight,
            "understood": [label for label, _ in matched], "count": len(out), "results": out[:k],
            "categories": sorted({p["category"] for p in ps})}


def upcoming(days: int = 120, now: dt.datetime | None = None) -> list[dict]:
    """Dated free offers in the next N days (holiday rides, free-fare days), soonest first."""
    now = (now or dt.datetime.now(LA)).astimezone(LA)
    items = []
    for p in _programs():
        if p["schedule"]["type"] != "annual":
            continue
        st = status(p, now)
        if st["next"] and (dt.datetime.fromisoformat(st["next"]) - now).days <= days:
            items.append({"id": p["id"], "name": p["name"], "provider": p["provider"], "status": st, "summary": p["summary"], "how": p["how"], "confidence": p["confidence"]})
    return sorted(items, key=lambda x: (x["status"]["state"] != "open", x["status"]["next"]))


# ---------- alerts ----------
def alerts(now: dt.datetime | None = None, horizon_days: int = 10) -> list[dict]:
    """Things students should hear about before they miss them: reservation deadlines, upcoming free days,
    service gaps, and tonight's free rides starting soon. Each alert has a stable id for de-duplication."""
    now = (now or dt.datetime.now(LA)).astimezone(LA)
    out: list[dict] = []
    for p in _programs():
        if p.get("confidence") == "check" and p["schedule"]["type"] == "varies":
            continue
        for dl in p.get("deadlines", []):
            at = dt.datetime.fromisoformat(dl["at"]).replace(tzinfo=LA)
            if now <= at <= now + dt.timedelta(days=horizon_days):
                left = at - now
                when = f"{left.days} days" if left.days >= 1 else f"{int(left.total_seconds() // 3600)} hours"
                out.append({"id": f"{p['id']}:deadline:{dl['at']}", "kind": "deadline", "priority": 0 if left.days < 3 else 1,
                            "title": dl["label"], "body": f"Closes {at.strftime('%a %b %-d, %-I:%M %p')} ({when} left). {p['summary']}",
                            "programId": p["id"], "url": p["how"].get("url"), "at": at.isoformat()})
        st = status(p, now)
        if p["schedule"]["type"] in ("annual", "dates") and st["state"] in ("open", "upcoming") and st["next"]:
            nxt = dt.datetime.fromisoformat(st["next"])
            if st["state"] == "open" or nxt <= now + dt.timedelta(days=horizon_days):
                out.append({"id": f"{p['id']}:{st['state']}:{st['next'][:10]}", "kind": "free-day", "priority": 0 if st["state"] == "open" else 2,
                            "title": p["name"], "body": st["label"] + ". " + p["summary"], "programId": p["id"], "url": p["how"].get("url"),
                            "phone": p["how"].get("phone"), "at": st["next"]})
        for ex in p.get("exceptions", []):
            d = dt.date.fromisoformat(ex["date"])
            if now.date() <= d <= (now + dt.timedelta(days=horizon_days)).date():
                out.append({"id": f"{p['id']}:gap:{ex['date']}", "kind": "service-gap", "priority": 2,
                            "title": f"No {p['name'].split(':')[0]} on {d.strftime('%a %b %-d')}", "body": f"{ex['label']}: plan another way.",
                            "programId": p["id"], "url": p["how"].get("url"), "at": d.isoformat()})
        if p["schedule"]["type"] in ("daily", "weekly") and p["category"] == "night ride" and st["state"] == "closed" and st["next"]:
            nxt = dt.datetime.fromisoformat(st["next"])
            if dt.timedelta(0) < nxt - now <= dt.timedelta(hours=3):
                out.append({"id": f"{p['id']}:starts:{st['next'][:16]}", "kind": "tonight", "priority": 3,
                            "title": f"{p['name'].split(':')[0]} starts at {_fmt(nxt)}", "body": p["summary"], "programId": p["id"],
                            "url": p["how"].get("url"), "at": st["next"]})
    return sorted(out, key=lambda a: (a["priority"], a["at"]))


# ---------- trip options (used by the safe-route planner) ----------
def _meters(a: tuple[float, float], b: tuple[float, float]) -> float:
    import math
    la1, lo1, la2, lo2 = map(math.radians, (*a, *b))
    h = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    return 6371000 * 2 * math.asin(math.sqrt(h))


def next_departure(p: dict, now: dt.datetime, after_min: float = 0) -> dt.datetime | None:
    """Next scheduled departure on a running day, at least `after_min` minutes from now (time to walk to the stop)."""
    deps = p.get("departures") or []
    days = set(p["schedule"].get("days", range(7)))
    skip = {e["date"] for e in p.get("exceptions", [])}
    earliest = now + dt.timedelta(minutes=after_min)
    for k in range(0, 8):
        d = now.date() + dt.timedelta(days=k)
        if p["schedule"]["type"] in ("weekly", "daily") and d.weekday() not in days or d.isoformat() in skip:
            continue
        if p["schedule"]["type"] == "dates":
            wins = [dt.datetime.fromisoformat(w["start"]).date() for w in p["schedule"]["windows"]]
            if d not in wins:
                continue
        for t in deps:
            at = dt.datetime.combine(d, _hm(t), LA)
            if at >= earliest:
                return at
    return None


def trip_options(frm: tuple[float, float], to: tuple[float, float], now: dt.datetime | None = None, usc: bool = True) -> list[dict]:
    """Little-known free or cheap ways to make THIS trip, right now, with the condition that makes each one apply."""
    now = (now or dt.datetime.now(LA)).astimezone(LA)
    ps = {p["id"]: p for p in _programs()}
    trip_m = _meters(frm, to)
    out: list[dict] = []

    def add(pid: str, why: str, *, steps: list[str], cost: str, minutes: int | None = None, when: str | None = None,
            walk_to: tuple[float, float] | None = None, rank: int = 50):
        p = ps.get(pid)
        if not p or (not usc and "usc" in p["eligibility"]):
            return
        st = status(p, now)
        out.append({"id": pid, "name": p["name"], "provider": p["provider"], "why": why, "steps": steps, "cost": cost,
                    "minutes": minutes, "when": when or st["label"], "state": st["state"], "how": p["how"], "tips": p.get("tips", []),
                    "caveats": p["caveats"], "confidence": p["confidence"], "source": (p.get("sources") or [None])[0],
                    "walkTo": walk_to, "rank": rank + (0 if st["state"] == "open" else 20)})

    # USC Lyft Rides: both ends inside the official boundary
    upc_a, upc_b = area_ok("usc_lyft_upc", *frm), area_ok("usc_lyft_upc", *to)
    ride_min = max(4, round(trip_m * 1.35 / 1609 / 18 * 60) + 6)
    if upc_a and upc_b:
        add("fryft", "Both ends are inside USC's free Lyft boundary (Normandie–Main, Washington–MLK).",
            steps=["Open Lyft, choose SHARED", "Check the fare says FREE (“USC Lyft Rides”)", "Wait inside until the car is close"],
            cost="Free", minutes=ride_min, rank=0)
    elif upc_a != upc_b and (upc_a or upc_b):
        add("fryft", "Only one end is inside the free Lyft boundary, so this exact trip isn't covered.",
            steps=["Free only if both pickup and drop-off are inside Normandie–Main / Washington–MLK"], cost="Not covered", rank=90)
    hsc = ps.get("lyft-hsc")
    us = (34.0562, -118.2365)
    if hsc and ((area_ok("usc_lyft_hsc", *frm) and (area_ok("usc_lyft_hsc", *to) or _meters(to, us) < 600)) or
                (area_ok("usc_lyft_hsc", *to) and _meters(frm, us) < 600)):
        add("lyft-hsc", "This trip is inside the HSC free-Lyft area (or HSC ↔ Union Station).",
            steps=["Open Lyft, choose SHARED", "Needs the HSC Lyft Invite form once"], cost="Free", minutes=ride_min, rank=1)

    # USC shuttles with real departure times
    legs_of = lambda p: p.get("legs") or ([{"from": p["points"][0], "to": p["destination"]}] if p.get("destination") and p.get("points") else [])
    for pid, leg in [(pid, leg) for pid in ("union-station-shuttle", "weekend-shuttle", "lax-shuttle") if ps.get(pid) for leg in legs_of(ps[pid])]:
        p = ps[pid]
        dest, stop = leg["to"], leg["from"]
        if _meters(to, (dest["lat"], dest["lng"])) > dest["radiusM"] or _meters(frm, (dest["lat"], dest["lng"])) < dest["radiusM"]:
            continue
        walk_m = _meters(frm, (stop["lat"], stop["lng"])) * 1.3
        walk_min = round(walk_m / 80)
        if walk_min > 25:
            continue
        stop_name = stop['label'].split('(')[0].strip()
        if p.get("departures") and stop is (p.get("legs") or [{}])[0].get("from", stop):  # published times are for the first stop
            dep = next_departure(p, now, after_min=walk_min + 2)
            when = f"Next shuttle {dep.strftime('%a %-I:%M %p') if dep.date() != now.date() else _fmt(dep)} from {stop_name}" if dep else "No departures in the next week"
        else:  # runs continuously in its window (no published timetable)
            st_ = status(p, now)
            dep = dt.datetime.fromisoformat(st_["next"]) if st_["state"] == "closed" and st_["next"] else (now if st_["state"] == "open" else None)
            when = f"Running now from {stop_name}" if st_["state"] == "open" else st_["label"]
        steps = [f"Walk {walk_min} min to {stop['label']}", f"Ride to {dest['label']}"]
        if pid == "lax-shuttle":
            steps.insert(0, "Reserve a seat first (deadline Nov 20, 11:59 PM)")
        if any(o["id"] == pid for o in out):
            continue
        add(pid, f"USC runs a shuttle to {dest['label']}, and most students don't know it.", steps=steps,
            cost=p["cost"], minutes=walk_min + 25, when=when, walk_to=(stop["lat"], stop["lng"]), rank=5 if dep and dep.date() == now.date() else 30)

    upc_ring = _zone("DPS")
    # DPS escort is always an option on foot inside the patrol zone
    if area_ok("dps", *frm) and trip_m < 2500:  # escorts are for walks near campus, not cross-town trips
        at_hsc = not (upc_ring and _inside(upc_ring, *frm))
        add("dps-escort", "You're inside the DPS patrol zone; an escort is available 24/7.", steps=[f"Call DPS {'323-442-1000 (HSC)' if at_hsc else '213-740-4321'} and ask for an escort", "Or use any blue-light phone"],
            cost="Free", rank=20)
    # Holiday free transit happening now
    for pid in ("metro-nye", "metro-christmas-eve"):
        p = ps.get(pid)
        if p and status(p, now)["state"] == "open" and trip_m > 1500:
            add(pid, "Metro is fare-free right now.", steps=["Take Metro bus or rail, no fare needed"], cost="Free", rank=3)
    # U-Pass for longer trips
    if trip_m > 2000:
        add("upass", "Longer trip: Metro is already paid for by your U-Pass.", steps=["Tap your U-Pass on Metro bus or rail", "Use Transit Watch to text security if needed"],
            cost="Prepaid", rank=40)
    return sorted(out, key=lambda o: o["rank"])
