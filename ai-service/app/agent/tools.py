"""LangChain tools wrapping Node /internal/* + local RAG. Failures return {"error": ...}, never raise."""
from typing import Any

import httpx
from langchain_core.tools import tool

from app.config import settings
from app.rag.summarize import neighborhood_summary

_client = httpx.AsyncClient(
    base_url=settings.node_internal_url, headers={"X-Internal-Key": settings.internal_key}, timeout=15
)


async def _post(path: str, body: dict) -> Any:
    try:
        r = await _client.post(path, json=body)
        r.raise_for_status()
        return r.json()
    except Exception as e:  # graceful fallback
        return {"error": f"{path}: {e}"}


@tool
async def search_listings(maxRent: int | None = None, beds: int | None = None,
                          inFryft: bool | None = None, inDps: bool | None = None) -> list[dict]:
    """Find candidate listings matching hard filters."""
    body = {k: v for k, v in dict(maxRent=maxRent, beds=beds, inFryft=inFryft, inDps=inDps).items() if v is not None}
    return await _post("/internal/search", body)


@tool
async def hybrid_search(query: str, maxRent: int | None = None, minBeds: int | None = None,
                        inDps: bool | None = None, inFryft: bool | None = None, k: int = 10) -> list[dict]:
    """Smart search over live listings: parses room/bath types, price, zones, amenities and walk time from the
    query, applies them as hard filters, then ranks with hybrid (FAISS + BM25) retrieval."""
    import asyncio
    from app.listings.index import INDEX
    from app.listings.query import parse
    sq, _ = await parse(query)
    for key, val in dict(maxRent=maxRent, minBeds=minBeds, inDps=inDps, inFryft=inFryft).items():
        if val is not None and getattr(sq, key) is None:
            setattr(sq, key, val)
    hits = await asyncio.to_thread(INDEX.search, sq.text, sq, k)
    return [h["listing"].model_dump() for h in hits]


@tool
async def listing_report(listingId: str, profile: dict) -> dict:
    """Full report for one listing from node-api: zones, real-street walks, True Cost, per-person share,
    LAPD incident facts and the Preference-weighted fit score breakdown."""
    pr = profile.get("priorities") or {}
    params = {"buildings": ",".join(str(b) for b in (profile.get("buildingIds") or [1])), "lateNights": profile.get("lateNights", 2),
              "budget": profile.get("budget", 1500), **{f"w_{k}": v for k, v in pr.items()}}
    try:
        r = await _client.get(f"/api/listings/{listingId}/report", params=params)
        r.raise_for_status()
        return r.json()
    except Exception as e:
        return {"error": f"report {listingId}: {e}"}


@tool
async def zone_check(lat: float, lng: float) -> dict:
    """Inside/outside DPS and Fryft + meters to the Fryft edge."""
    return await _post("/internal/zone-check", {"lat": lat, "lng": lng})


@tool
async def commute(listingId: str, buildingIds: list[int]) -> list[dict]:
    """Walk/bike/tram minutes from a listing to each building."""
    return await _post("/internal/commute", {"listingId": listingId, "buildingIds": buildingIds})


@tool
async def true_cost(listingId: str, profile: dict) -> dict:
    """Rent + utilities + transit + rideshare with assumptions."""
    return await _post("/internal/true-cost", {"listingId": listingId, "profile": profile})


@tool
async def score(listingIds: list[str], profile: dict) -> list[dict]:
    """Deterministic fit scores. The LLM never invents the ranking."""
    return await _post("/internal/score", {"listingIds": listingIds, "profile": profile})


@tool
async def neighborhood_rag(lat: float, lng: float, radius: int = 150) -> dict:
    """Cited block summary + incident counts around a point."""
    try:
        return (await neighborhood_summary(lat, lng, radius)).model_dump()
    except Exception as e:
        return {"error": str(e)}


ALL_TOOLS = [listing_report, hybrid_search, search_listings, zone_check, commute, true_cost, score, neighborhood_rag]
