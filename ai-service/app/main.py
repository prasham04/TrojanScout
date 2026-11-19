import asyncio
import json
import logging
import time
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Header, HTTPException, Query
from langchain_core.messages import AIMessage, HumanMessage
from sse_starlette.sse import EventSourceResponse

from app.agent.graph import graph
from app.config import settings
from app.rag.summarize import neighborhood_summary
from app.listings import pipeline
from app.listings.index import INDEX, warm
from app.listings.query import parse as query_parse
from app.schemas import BlockSummary, ChatRequest

log = logging.getLogger("uvicorn.error")


async def _refresh_loop():
    """'Real-time': re-scrape on a schedule. Refresh right away if data is missing or stale."""
    listings_file = Path(settings.data_dir) / "listings.json"
    while True:
        age_min = (time.time() - listings_file.stat().st_mtime) / 60 if listings_file.exists() else 1e9
        if not INDEX.listings or age_min >= settings.refresh_minutes:
            try:
                log.info("listings refresh: %s", await pipeline.refresh())
            except Exception as e:
                log.warning("listings refresh failed: %s", e)
        await asyncio.sleep(max(settings.refresh_minutes, 1) * 60)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    if not INDEX.load():  # fresh deploy: build the search index from the committed data/listings.json (no scraping needed)
        listings_file = Path(settings.data_dir) / "listings.json"
        if listings_file.exists():
            from app.listings.models import Listing
            rows = json.loads(listings_file.read_text()).get("listings", [])
            await asyncio.to_thread(INDEX.build, [Listing(**x) for x in rows])
            log.info("built search index from listings.json (%d listings)", len(rows))
    await asyncio.to_thread(warm)
    from app.free.search import index as free_index
    await asyncio.to_thread(free_index)  # embed the Free & Safe programs now, not on the first visitor's request
    task = asyncio.create_task(_refresh_loop()) if settings.refresh_minutes > 0 else None
    yield
    if task:
        task.cancel()


app = FastAPI(title="TrojanScout AI service", lifespan=lifespan)
_summary_cache: dict[tuple[float, float], BlockSummary] = {}


def _check_key(key: str | None):
    if key != settings.internal_key:
        raise HTTPException(401, "bad internal key")


@app.get("/health")
async def health():
    from app.llm import get_llm, model_name, provider
    return {"ok": True, "service": "ai-service", "llm": get_llm() is not None, "provider": provider(), "model": model_name()}


@app.get("/ai/listings/search")
async def listings_search(
    q: str = "", k: int = Query(20, le=100), maxRent: int | None = None, minBeds: int | None = None,
    beds: int | None = None, baths: float | None = None, roomType: str | None = None, privateBath: bool | None = None,
    inDps: bool | None = None, inFryft: bool | None = None, source: str | None = None,
    ignore: str = "", x_internal_key: str | None = Header(None),
):
    """Smart search: plain English → structured filters (rules, + LLM when configured) → hybrid retrieval.
    Explicit query params override what was parsed; `ignore` drops parsed constraints by chip key."""
    _check_key(x_internal_key)
    t0 = time.perf_counter()
    sq, parser = await query_parse(q)
    for key, val in dict(maxRent=maxRent, minBeds=minBeds, beds=beds, baths=baths, roomType=roomType,
                         privateBath=privateBath, inDps=inDps, inFryft=inFryft, source=source).items():
        if val is not None:
            setattr(sq, key, val)
    sq.drop([x for x in ignore.split(",") if x])
    hits = await asyncio.to_thread(INDEX.search, sq.text, sq, k)
    return {
        "query": q, "parser": parser, "understood": sq.chips(), "semanticText": sq.text, "filters": sq.as_dict(),
        "count": len(hits), "tookMs": round((time.perf_counter() - t0) * 1000),
        "results": [{**h["listing"].model_dump(), "matchedUnits": [u.model_dump() for u in h["matchedUnits"]],
                     "walkMin": h["walkMin"], "score": h["score"], "denseRank": h["denseRank"], "bm25Rank": h["bm25Rank"], "cosine": h.get("cosine")} for h in hits],
    }


@app.get("/ai/listings/status")
async def listings_status():
    return {"count": len(INDEX.listings), "indexedAt": INDEX.built_at, "refreshMinutes": settings.refresh_minutes}


@app.post("/ai/listings/refresh")
async def listings_refresh(x_internal_key: str | None = Header(None)):
    _check_key(x_internal_key)
    return await pipeline.refresh()


@app.get("/ai/free/search")
async def free_search(q: str = "", lat: float | None = None, lng: float | None = None, usc: bool = True,
                      category: str | None = None, availableNow: bool = False, k: int = Query(30, le=60)):
    """Free & Safe directory: hybrid search + situation rules + live status (LA time) + area check."""
    from app.free.search import search as free
    return await asyncio.to_thread(free, q, lat=lat, lng=lng, usc=usc, category=category, available_now=availableNow, k=k)


@app.get("/ai/free/alerts")
async def free_alerts(days: int = Query(10, le=60)):
    """Reservation deadlines, free days, service gaps and tonight's free rides, soonest/most urgent first."""
    from app.free.search import alerts
    return await asyncio.to_thread(alerts, None, days)


@app.get("/ai/free/trip")
async def free_trip(fromLat: float, fromLng: float, toLat: float, toLng: float, usc: bool = True):
    """Little-known free/cheap ways to make this specific trip right now (USC Lyft boundary, shuttles + next departure, escorts)."""
    from app.free.search import trip_options
    return await asyncio.to_thread(trip_options, (fromLat, fromLng), (toLat, toLng), None, usc)


@app.get("/ai/free/upcoming")
async def free_upcoming(days: int = Query(120, le=366)):
    from app.free.search import upcoming
    return await asyncio.to_thread(upcoming, days)


@app.post("/ai/report/check")
async def report_check(body: dict, x_internal_key: str | None = Header(None)):
    _check_key(x_internal_key)
    from app.safety.report_check import check_report
    return await check_report(str(body.get("description", "")), str(body.get("category", "")), str(body.get("where", "")), str(body.get("when", "")))


@app.get("/ai/neighborhood", response_model=BlockSummary)
async def neighborhood(lat: float, lng: float, x_internal_key: str | None = Header(None)):
    _check_key(x_internal_key)
    key = (round(lat, 5), round(lng, 5))
    if key not in _summary_cache:
        _summary_cache[key] = await neighborhood_summary(lat, lng)
    return _summary_cache[key]


@app.post("/ai/chat")
async def chat(req: ChatRequest, x_internal_key: str | None = Header(None)):
    _check_key(x_internal_key)
    queue: asyncio.Queue = asyncio.Queue()

    async def emit(event: str, data: dict):
        await queue.put({"event": event, "data": json.dumps(data)})

    async def run():
        history = [HumanMessage(t.content) if t.role == "user" else AIMessage(t.content) for t in req.history]
        try:
            await graph.ainvoke({"messages": [*history, HumanMessage(req.message)], "profile": req.profile},
                                config={"configurable": {"emit": emit}})
        except Exception as e:
            await emit("error", {"message": f"Agent failed: {e}"})
        finally:
            await emit("done", {})
            await queue.put(None)

    async def stream():
        task = asyncio.create_task(run())
        while (item := await queue.get()) is not None:
            yield item
        await task

    return EventSourceResponse(stream(), headers={"X-Accel-Buffering": "no"})
