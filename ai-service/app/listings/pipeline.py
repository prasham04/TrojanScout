"""Scrape → normalize → dedupe → keep within radius of USC → zone flags (Node) → data/listings.json → rebuild index.

Run once:   python -m app.listings.pipeline
Scheduled:  FastAPI lifespan refreshes every REFRESH_MINUTES (see app/main.py)."""
import asyncio
import json
import logging
import math
import re
import time
from pathlib import Path

import httpx

from app.config import settings
from app.listings import sources
from app.listings.http import PoliteClient
from app.listings.index import INDEX
from app.listings.models import Listing

log = logging.getLogger("listings")
USC = (34.0206, -118.2854)  # Tommy Trojan
MAX_MILES = 3.0
_refresh_lock = asyncio.Lock()


def miles(a: tuple[float, float], b: tuple[float, float]) -> float:
    la1, lo1, la2, lo2 = map(math.radians, (*a, *b))
    h = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    return 3958.8 * 2 * math.asin(math.sqrt(h))


def _addr_key(addr: str) -> str:
    a = re.sub(r"[.,#]|\bunit\b.*|\bapt\b.*", " ", addr.lower())
    return re.sub(r"\s+", " ", a).strip()[:40]


def _utilities(l: Listing) -> int:
    """Monthly utilities estimate (electric + gas + internet + water/trash share).
    Rooms: one person's share (~$75). Whole units: $60 base + $30 per bedroom."""
    if l.priceUnit == "per room":
        return 75
    return 60 + 30 * max(l.beds or 1, 1)


async def _zone_flags(listings: list[Listing]):
    """Zone logic lives in Node (single source of truth). Best effort: skip if Node is down."""
    async with httpx.AsyncClient(base_url=settings.node_internal_url, timeout=5,
                                 headers={"X-Internal-Key": settings.internal_key}) as c:
        sem = asyncio.Semaphore(10)

        async def one(l: Listing):
            async with sem:
                try:
                    z = (await c.post("/internal/zone-check", json={"lat": l.lat, "lng": l.lng})).json()
                    l.inDps, l.inFryft = z.get("inDps"), z.get("inFryft")
                except Exception:
                    pass
        await asyncio.gather(*(one(l) for l in listings))


async def refresh() -> dict:
    async with _refresh_lock:
        t0 = time.time()
        client = PoliteClient(min_interval_s=1.0)
        enabled = sources.enabled()
        try:
            results = await asyncio.gather(*(fn(client) for fn in enabled.values()), return_exceptions=True)
        finally:
            await client.aclose()

        report, merged, seen = {}, [], set()
        stamp = time.strftime("%Y-%m-%dT%H:%M:%S")
        prev_file = Path(settings.data_dir) / "listings.json"
        previous = json.loads(prev_file.read_text()).get("listings", []) if prev_file.exists() else []
        for name, res in zip(enabled, results):
            if isinstance(res, Exception):
                # a site being down shouldn't make its listings vanish: keep the last good copy from that source
                old = [Listing(**x) for x in previous if str(x.get("id", "")).startswith(f"{name}:")]
                report[name] = f"error: {type(res).__name__}; kept {len(old)} from the last successful scrape"
                log.warning("source %s failed: %s (keeping %d previous listings)", name, res, len(old))
                for l in old:
                    key = _addr_key(l.address)
                    if key not in seen:
                        seen.add(key); merged.append(l)
                continue
            kept = 0
            for l in res:
                d = miles(USC, (l.lat, l.lng))
                key = _addr_key(l.address)
                if d > MAX_MILES or key in seen:
                    continue
                seen.add(key)
                l.distanceToCampusMi, l.utilitiesEst, l.scrapedAt = round(d, 2), _utilities(l), stamp
                merged.append(l)
                kept += 1
            report[name] = kept

        if not merged:  # never wipe good data because every source failed
            return {"ok": False, "sources": report, "count": len(INDEX.listings), "tookS": round(time.time() - t0, 1)}

        await _zone_flags(merged)
        out = Path(settings.data_dir) / "listings.json"
        out.write_text(json.dumps({"scrapedAt": stamp, "sources": report,
                                   "listings": [l.model_dump() for l in merged]}, indent=1))
        await asyncio.to_thread(INDEX.build, merged)
        summary = {"ok": True, "sources": report, "count": len(merged), "scrapedAt": stamp, "tookS": round(time.time() - t0, 1)}
        log.info("listings refreshed: %s", summary)
        return summary


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    print(json.dumps(asyncio.run(refresh()), indent=1))
