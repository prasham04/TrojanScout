"""START → parse_intent ─┬ search  → understand → search_listings → enrich → rank → explain → END
                         └ general → explain → END
Every node emits SSE events through config["configurable"]["emit"]:
  step (progress) · understood (what we read from the question) · listings (ids + per-listing reasons) · token (answer text).
The answer text is a short summary; the reasons shown on each card are computed from data, never written by the model."""
import asyncio
import re
from typing import Any

from langchain_core.messages import HumanMessage, SystemMessage
from langchain_core.runnables import RunnableConfig
from langgraph.graph import END, START, StateGraph

from app.agent import prompts
from app.agent.state import AgentState
from app.agent.tools import listing_report, search_listings
from app.listings.index import INDEX
from app.listings.query import SmartQuery, buildings, parse as query_parse, parse_rules
from app.llm import get_llm

# What to give up first when nothing matches (chip key, plain-English name)
RELAX_ORDER = [("near", "walk time"), ("amenity", "amenities"), ("baths", "bathrooms"), ("beds", "bedrooms"),
               ("privateBath", "private bathroom"), ("roomType", "room type"), ("maxRent", "price"), ("price", "price")]


async def _emit(config: RunnableConfig, event: str, data: dict):
    emit = config["configurable"].get("emit")
    if emit:
        await emit(event, data)


async def _step(config: RunnableConfig, label: str, status: str):
    await _emit(config, "step", {"label": label, "status": status})


async def _say(config: RunnableConfig, text: str):
    for word in text.split(" "):
        await _emit(config, "token", {"text": word + " "})


def _last_user_text(state: AgentState) -> str:
    return state["messages"][-1].content if state.get("messages") else ""


_GENERIC = {"the", "series", "st", "street", "ave", "avenue", "w", "west", "s", "south", "pl", "place", "blvd", "dr", "apartments",
            "apts", "apt", "and", "amp", "at", "on", "of"}


def _alt_tokens(name: str) -> list[set[str]]:
    """Ways a student might name a building: 'The Series - The Dime' → {series}, {dime}; '2335 Portland St.' → {2335, portland}."""
    import html
    alts = []
    for part in re.split(r"\(|\)|\s-\s|-\s|\s-", html.unescape(name).lower()):
        toks = {t for t in re.findall(r"[a-z]+|\d+", part) if t not in _GENERIC}
        if toks and not all(t.isdigit() and len(t) < 3 for t in toks):
            alts.append(toks)
    return alts


def named_listings(text: str) -> list[dict]:
    """Listings the question names outright ("how's the Lorenzo?"); every distinctive word of a name must appear."""
    words = set(re.findall(r"[a-z]+|\d+", text.lower()))
    scored = []
    for l in INDEX.listings:
        best = max((len(a) for a in _alt_tokens(l.name) if a <= words), default=0)
        if best:
            scored.append((best, l))
    if not scored:
        return []
    top = max(b for b, _ in scored)
    out = []
    for _, l in [x for x in scored if x[0] == top][:5]:
        d = l.model_dump()
        d["matchedUnits"] = d.get("units") or []
        d["walkToAnchor"] = None
        out.append(d)
    return out


async def parse_intent(state: AgentState, config: RunnableConfig):
    await _step(config, "Understanding your question", "running")
    text = _last_user_text(state).lower()
    named = named_listings(text)
    if named:  # a question about specific buildings: answer from their own reports, not a search
        await _step(config, f"Looking up {', '.join(l['name'].strip() for l in named)}", "done")
        return {"intent": "named", "candidates": named, "query": parse_rules(text), "understood": []}
    housing = re.search(r"\$|\d|under|fryft|dps|bed|bath|room|studio|apartment|apt|place|house|home|unit|rent|lease|live|stay|"
                        r"move|cheap|find|near|close to|walk|furnish|roommate|housing|listing", text)
    intent = "search" if housing or parse_rules(text).chips() else "general"
    await _step(config, "Understanding your question", "done")
    return {"intent": intent}


async def understand(state: AgentState, config: RunnableConfig):
    """Same guarded smart parser as the Search page: rules first, the LLM only adds what the user actually mentioned."""
    await _step(config, "Reading your requirements", "running")
    sq, parser = await query_parse(_last_user_text(state))
    await _step(config, "Reading your requirements", "done")
    return {"query": sq, "parser": parser, "understood": [c["label"] for c in sq.chips()]}


def _run_search(sq: SmartQuery) -> list[dict]:
    out = []
    for h in INDEX.search(sq.text, sq, 8):
        d = h["listing"].model_dump()
        d["matchedUnits"] = [u.model_dump() for u in h["matchedUnits"]]
        d["walkToAnchor"] = h["walkMin"]
        out.append(d)
    return out


async def search(state: AgentState, config: RunnableConfig):
    await _step(config, "Searching live listings", "running")
    sq: SmartQuery = state["query"]
    relaxed: list[str] = []
    if INDEX.listings:
        res = await asyncio.to_thread(_run_search, sq)
        for key, label in RELAX_ORDER:  # nothing matched everything → give up the least important constraint, and say so
            if res:
                break
            chips = [c for c in sq.chips() if c["key"] == key or c["key"].startswith(key)]
            if not chips:
                continue
            sq.drop([c["key"] for c in chips])
            relaxed.append(f"{label} ({chips[0]['label']})")
            res = await asyncio.to_thread(_run_search, sq)
    else:
        res = await search_listings.ainvoke({"maxRent": sq.maxRent, "inDps": sq.inDps})
    await _emit(config, "understood", {
        "chips": state.get("understood", []), "relaxed": relaxed, "rankedBy": sq.text or None,
        "parser": state.get("parser"), "anchor": sq.nearLabel,
    })
    await _step(config, f"Searching live listings · {len(res)} found" + (f" after relaxing {len(relaxed)}" if relaxed else ""), "done")
    return {"candidates": res if isinstance(res, list) else [], "relaxed": relaxed}


async def enrich(state: AgentState, config: RunnableConfig):
    await _step(config, "Checking zones, walks, cost & LAPD data", "running")
    profile = state["profile"].model_dump()
    reports = await asyncio.gather(*(listing_report.ainvoke({"listingId": l["id"], "profile": profile}) for l in state.get("candidates", [])))
    enriched = [{**l, "report": r if isinstance(r, dict) and "error" not in r else None} for l, r in zip(state.get("candidates", []), reports)]
    await _step(config, "Checking zones, walks, cost & LAPD data", "done")
    return {"enriched": enriched}


def _money(n: Any) -> str:
    return "—" if n is None else f"${round(n):,}"


def reasons_for(l: dict, sq: SmartQuery) -> list[str]:
    """Plain-English, data-backed reasons for recommending one listing."""
    r, out = l.get("report") or {}, []
    units = l.get("matchedUnits") or []
    priced = [u for u in units if u.get("rent")]
    if priced:
        u = min(priced, key=lambda x: x["rent"])
        each = sq.perPerson and u["roomType"] == "entire" and (u.get("beds") or 0) >= 2
        line = f"Has a {u['label']} for {_money(u['rent'])}" + (f" ({_money(u['rent'] / u['beds'])} each)" if each else "")
        if sq.maxRent is not None:
            line += f", under your {_money(sq.maxRent)}" + (" per person" if sq.perPerson else "") + " limit"
        out.append(line)
    elif units:
        out.append(f"Has a {units[0]['label']} (price not published, call to confirm)")
    elif l.get("rent") is not None:
        out.append(f"From {_money(l['rent'])} {l.get('priceUnit', '')}")
    if l.get("walkToAnchor") is not None and (sq.nearLabel or sq.nearBuildingId):
        place = sq.nearLabel or next((b["name"] for b in buildings() if b["id"] == sq.nearBuildingId), "your building")
        out.append(f"{l['walkToAnchor']} min walk to {place}")
    elif r.get("longestWalkMin") is not None:
        out.append(f"Longest walk to your class buildings: {r['longestWalkMin']} min (real streets)")
    z = r.get("zones") or {}
    if z:
        out.append("Inside the DPS patrol zone, with free Fryft rides home" if z.get("inDps")
                   else "Outside the DPS patrol zone: no DPS patrols or free Fryft rides")
    facts = r.get("incidentFacts") or {}
    if facts:
        top = sorted((facts.get("byCategory") or {}).items(), key=lambda kv: -kv[1])[:2]
        out.append(f"{facts.get('total', 0)} LAPD-reported incidents within 150 m in 6 months" + (f" (mostly {', '.join(k for k, _ in top)})" if top else ""))
    if sq.amenities:
        out.append("Has " + ", ".join(a if a != "ac" else "A/C" for a in sq.amenities))
    # True Cost for the floorplan that actually matched (not the building's cheapest room)
    rides = (r.get("cost") or {}).get("rideshare") or 0
    if priced:
        u = min(priced, key=lambda x: x["rent"])
        people = (u.get("beds") or 1) if u["roomType"] == "entire" and (u.get("beds") or 0) >= 2 else 1
        utilities = (60 + 30 * max(u.get("beds") or 1, 1)) if u["roomType"] == "entire" else 75
        share = (u["rent"] + utilities) / people + rides
        out.append(f"True Trojan Cost about {_money(share)}/mo" + (f" each, split {people} ways" if people > 1 else "")
                   + f" (rent + ~{_money(utilities)} utilities" + (f" + {_money(rides)} late rides" if rides else "") + ")")
    elif (r.get("perPerson") or {}).get("total") is not None:
        out.append(f"True Trojan Cost about {_money(r['perPerson']['total'])}/mo for your share")
    fit = r.get("fit") or {}
    parts = fit.get("parts") or {}
    if parts:
        best = max(parts.items(), key=lambda kv: kv[1]["value"])
        worst = min(parts.items(), key=lambda kv: kv[1]["value"])
        out.append(f"Fit {round(fit.get('score', 0) * 100)}/100: strongest on {best[0]}, weakest on {worst[0]}")
    if l.get("sampleData"):
        out.append("Sample data: real building, illustrative prices")
    return out


async def rank(state: AgentState, config: RunnableConfig):
    await _step(config, "Ranking by your priorities", "running")
    sq: SmartQuery = state["query"]
    enriched = state.get("enriched", [])
    for l in enriched:
        l["fitScore"] = ((l.get("report") or {}).get("fit") or {}).get("score")
        l["reasons"] = reasons_for(l, sq)
    # The user's explicit sort wins; otherwise their Preference-weighted fit score.
    if sq.sort == "price":
        ranked = sorted(enriched, key=lambda l: (l.get("rent") is None, l.get("rent") or 0))
    elif sq.sort == "walk":
        ranked = sorted(enriched, key=lambda l: l.get("walkToAnchor") or 99)
    else:
        ranked = sorted(enriched, key=lambda l: l.get("fitScore") or 0, reverse=True)
    await _emit(config, "listings", {
        "ids": [l["id"] for l in ranked],
        "reasons": {l["id"]: l["reasons"] for l in ranked},
        "fit": {l["id"]: l["fitScore"] for l in ranked},
    })
    await _step(config, "Ranking by your priorities", "done")
    return {"ranked": ranked}


async def explain(state: AgentState, config: RunnableConfig):
    await _step(config, "Writing the answer", "running")
    ranked, relaxed, understood = state.get("ranked", []), state.get("relaxed") or [], state.get("understood") or []
    llm = get_llm()

    if state.get("intent") == "search" and not ranked:  # never let the model improvise listings
        await _say(config, "I couldn't find any live listings that match" + (f" ({', '.join(understood)})" if understood else "") +
                   ", even after relaxing the walk time, amenities, layout and price. Try a higher budget, a room instead of a whole "
                   "unit, or a different area. On the Search page you can remove filters one by one.")
        await _step(config, "Writing the answer", "done")
        return {}

    if not ranked:  # general question
        if llm:
            msgs = [SystemMessage(prompts.EXPLAIN + " This is a general question, not a search. Answer briefly about USC off-campus "
                                  "housing. Do NOT name, number or price any specific listing."), HumanMessage(_last_user_text(state))]
            async for chunk in llm.astream(msgs):
                if chunk.text:
                    await _emit(config, "token", {"text": chunk.text})
        else:
            await _say(config, "Ask me about places to live near USC: a budget, a room type, a building you walk to, or “inside DPS”.")
        await _step(config, "Writing the answer", "done")
        return {}

    top = ranked[:3]
    if relaxed:  # stated by code, not left to the model
        await _say(config, f"Nothing matched everything you asked for, so I relaxed {', '.join(relaxed)}.")
    if llm and state.get("intent") == "named":
        facts = "\n".join(f"- {l['name'].strip()} ({l.get('address', '')}): " + "; ".join(l["reasons"]) for l in top)
        msgs = [SystemMessage(
                    "You are TrojanScout, a USC off-campus housing assistant, talking directly to the student (use 'you'). "
                    "The student asked about a specific building. Answer their question in 2-4 short sentences using ONLY the facts "
                    "given (price, walk, DPS/Fryft zone, nearby LAPD incidents, True Trojan Cost, fit). If the facts don't cover what "
                    "they asked, say so. Never invent numbers; never call an area safe or unsafe. No lists, no headings."),
                HumanMessage(f"Student asked: {_last_user_text(state)}\nFacts:\n{facts}")]
        async for chunk in llm.astream(msgs):
            if chunk.text:
                await _emit(config, "token", {"text": chunk.text})
    elif llm:
        facts = "\n".join(f"- {l['name']}: " + "; ".join(l["reasons"]) for l in top)
        msgs = [SystemMessage(
                    "You are TrojanScout, a USC off-campus housing assistant, talking directly to the student (use 'you'). "
                    "Write 2-3 short sentences: recommend the FIRST listing by name and say why using its reasons, then mention one "
                    "trade-off or an alternative from the others. Use only the facts given; never invent numbers or listings; never "
                    "claim a relaxed requirement is met; never call an area safe or unsafe. No lists, no headings."),
                HumanMessage(f"Student asked: {_last_user_text(state)}\nStill required: {', '.join(c for c in understood if not any(c in x for x in relaxed)) or 'nothing specific'}\n"
                             + (f"NOT met (relaxed): {', '.join(relaxed)}\n" if relaxed else "")
                             + f"Ranked listings (best first) with reasons:\n{facts}")]
        async for chunk in llm.astream(msgs):
            if chunk.text:
                await _emit(config, "token", {"text": chunk.text})
    else:  # deterministic summary when no model is available
        lead = top[0]
        await _say(config, (f"Nothing matched everything, so I relaxed {', '.join(relaxed)}. " if relaxed else "") +
                   f"Top pick: {lead['name']}, because " + "; ".join(lead["reasons"][:3]).lower() + ". See the cards for the rest.")
    await _step(config, "Writing the answer", "done")
    return {}


def build_graph():
    g = StateGraph(AgentState)
    for name, fn in [("parse_intent", parse_intent), ("understand", understand), ("search_listings", search),
                     ("enrich", enrich), ("rank", rank), ("explain", explain)]:
        g.add_node(name, fn)
    g.add_edge(START, "parse_intent")
    g.add_conditional_edges("parse_intent", lambda s: s["intent"], {"search": "understand", "general": "explain", "named": "enrich"})
    g.add_edge("understand", "search_listings")
    g.add_edge("search_listings", "enrich")
    g.add_edge("enrich", "rank")
    g.add_edge("rank", "explain")
    g.add_edge("explain", END)
    return g.compile()


graph = build_graph()
