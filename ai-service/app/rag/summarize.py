"""neighborhood_rag(lat, lng, radius): geo filter → similarity → (rerank) → cited LLM summary.
TODO(Dhruv): rerank, recency weighting, precompute + cache for all listings."""
from langchain_core.messages import HumanMessage, SystemMessage

from app.llm import get_llm
from app.rag.retriever import incident_counts, match_chunks
from app.schemas import BlockSummary, Citation

MIN_SOURCES = 3
SYSTEM = """Summarize block-level conditions in 3-4 sentences. Cite every claim as [n] using the numbered sources.
Never use labels like "safe", "unsafe", "sketchy". Use only the sources and incident counts given."""


async def neighborhood_summary(lat: float, lng: float, radius: int = 150) -> BlockSummary:
    chunks = await match_chunks("living conditions, theft, noise, landlord, transit", lat, lng, radius)
    counts = await incident_counts(lat, lng, radius)
    citations = [Citation(n=i + 1, source=c["source"] or "", date=str(c["date"] or ""), url=c["url"] or "")
                 for i, c in enumerate(chunks)]
    if len(chunks) < MIN_SOURCES:
        return BlockSummary(summary="Insufficient data for this block.", incidents6mo=counts, citations=citations)
    llm = get_llm()
    if not llm:
        return BlockSummary(summary="[mock] LLM disabled.", incidents6mo=counts, citations=citations)
    sources = "\n".join(f"[{i + 1}] ({c['source']}, {c['date']}) {c['text']}" for i, c in enumerate(chunks))
    msg = await llm.ainvoke([SystemMessage(SYSTEM), HumanMessage(f"Incidents (6 mo): {counts}\nSources:\n{sources}")])
    return BlockSummary(summary=msg.text, incidents6mo=counts, citations=citations)
