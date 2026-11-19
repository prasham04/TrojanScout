"""Hybrid retriever over listings — all free, all local.

  query ─┬─ metadata pre-filter (rent, beds, DPS/Fryft, source) ── hard constraints are filters, not "similarity"
         ├─ dense:  bge-small-en-v1.5 → FAISS IndexFlatIP (exact cosine; N is small, so exact beats ANN)
         ├─ sparse: BM25 via bm25s (+ Snowball stemming) ── exact terms: street names, "Figueroa", "furnished"
         └─ Reciprocal Rank Fusion (k=60) → cross-encoder rerank of the top 20 → results
"""
import json
import threading
import time
from pathlib import Path

import bm25s
import faiss
import numpy as np
import Stemmer

from app import embeddings
from app.config import settings
from app.listings.models import Listing, doc_text
from app.listings.query import SmartQuery, parse_rules, walk_minutes

EMBED_MODEL = embeddings.EMBED_MODEL
BGE_QUERY_PREFIX = "Represent this sentence for searching relevant passages: "
RRF_K = 60
CANDIDATES = 50
RERANK_TOP = 20

_stemmer = Stemmer.Stemmer("english")


def _embed(texts: list[str], query: bool = False) -> np.ndarray:
    if query:
        texts = [BGE_QUERY_PREFIX + t for t in texts]
    return embeddings.embed(texts)


# Back-compat for callers that build filters directly (agent tools, tests)
def Filters(**kw) -> SmartQuery:  # noqa: N802
    return SmartQuery(**{k: v for k, v in kw.items() if v is not None and k in SmartQuery.__dataclass_fields__})


def parse_query(q: str) -> tuple[str, SmartQuery]:
    sq = parse_rules(q)
    return sq.text, sq


class HybridIndex:
    def __init__(self, directory: Path):
        self.dir = directory
        self.listings: list[Listing] = []
        self.faiss: faiss.Index | None = None
        self.bm25: bm25s.BM25 | None = None
        self.built_at: str | None = None
        self._lock = threading.RLock()

    # ---------- build / persist ----------
    def build(self, listings: list[Listing]):
        texts = [doc_text(l) for l in listings]
        vecs = _embed(texts) if texts else np.zeros((0, 384), dtype="float32")
        fi = faiss.IndexFlatIP(vecs.shape[1])
        fi.add(vecs)
        bm = bm25s.BM25()
        if texts:
            bm.index(bm25s.tokenize(texts, stopwords="en", stemmer=_stemmer, show_progress=False), show_progress=False)
        with self._lock:
            self.listings, self.faiss, self.bm25 = listings, fi, bm
            self.built_at = time.strftime("%Y-%m-%dT%H:%M:%S")
        self.save()

    def save(self):
        self.dir.mkdir(parents=True, exist_ok=True)
        with self._lock:
            faiss.write_index(self.faiss, str(self.dir / "listings.faiss"))
            if self.listings:
                self.bm25.save(str(self.dir / "bm25"))
            (self.dir / "meta.json").write_text(json.dumps(
                {"builtAt": self.built_at, "listings": [l.model_dump() for l in self.listings]}))

    def load(self) -> bool:
        meta = self.dir / "meta.json"
        if not meta.exists():
            return False
        m = json.loads(meta.read_text())
        with self._lock:
            self.listings = [Listing(**x) for x in m["listings"]]
            self.faiss = faiss.read_index(str(self.dir / "listings.faiss"))
            self.bm25 = bm25s.BM25.load(str(self.dir / "bm25")) if self.listings else bm25s.BM25()
            self.built_at = m["builtAt"]
        return True

    # ---------- search ----------
    def search(self, query: str, filters: SmartQuery | None = None, k: int = 10, rerank: bool = True) -> list[dict]:
        filters = filters or SmartQuery()
        with self._lock:
            listings, fi, bm = self.listings, self.faiss, self.bm25
        matched: dict[int, list] = {}
        for i, l in enumerate(listings):
            m = filters.match(l)
            if m is not None:
                matched[i] = m
        allowed = np.array(sorted(matched), dtype="int64")
        if not len(allowed):
            return []

        def price(i):
            units = matched[i] or listings[i].units
            rents = [u.rent for u in units if u.rent] or ([listings[i].rent] if listings[i].rent else [])
            return min(rents) if rents else 10**9

        def walk(i):
            return filters.walk_to(listings[i])

        def hit(i, score=None, d=None, b=None, c=None):
            return {"listing": listings[i], "matchedUnits": matched[i], "score": score, "denseRank": d, "bm25Rank": b, "cosine": c,
                    "walkMin": round(walk(i)) if (filters.nearBuildingId is not None or filters.nearLat is not None) else None}

        query = query.strip()
        if not query or filters.sort:  # browse / explicit sort: filters decide membership, sort decides order
            idx = allowed.tolist()
            if query:  # keep relevance as a tiebreak by only sorting the relevant ones
                idx = [h["_i"] for h in self._ranked(query, allowed, listings, fi, bm, rerank=False)] or idx
            key = walk if filters.sort == "walk" else price
            return [hit(i) for i in sorted(idx, key=key)[:k]]
        return [hit(h["_i"], h["score"], h["d"], h["b"], h["c"]) for h in self._ranked(query, allowed, listings, fi, bm, rerank)[:k]]

    def _ranked(self, query, allowed, listings, fi, bm, rerank=True) -> list[dict]:

        n = min(CANDIDATES, len(allowed))
        # Dense: FAISS restricted to the pre-filtered ids
        params = faiss.SearchParameters(sel=faiss.IDSelectorBatch(allowed))
        d_sims, d_ids = fi.search(_embed([query], query=True), n, params=params)
        dense = [int(i) for i in d_ids[0] if i >= 0]
        # vectors are L2-normalized, so the inner product IS the cosine similarity between query and listing
        cos = {int(i): round(float(s), 4) for i, s in zip(d_ids[0], d_sims[0]) if i >= 0}
        # Sparse: BM25 over everything, then keep allowed ids
        q_tokens = bm25s.tokenize([query], stopwords="en", stemmer=_stemmer, show_progress=False)
        allowed_set = set(allowed.tolist())
        sparse: list[int] = []
        if q_tokens.vocab:
            b_ids, b_scores = bm.retrieve(q_tokens, k=len(listings), show_progress=False)
            sparse = [int(i) for i, s in zip(b_ids[0], b_scores[0]) if s > 0 and int(i) in allowed_set][:n]

        # Reciprocal Rank Fusion
        fused: dict[int, float] = {}
        for ranks in (dense, sparse):
            for r, i in enumerate(ranks):
                fused[i] = fused.get(i, 0.0) + 1.0 / (RRF_K + r + 1)
        order = sorted(fused, key=fused.get, reverse=True)
        d_rank = {i: r + 1 for r, i in enumerate(dense)}
        s_rank = {i: r + 1 for r, i in enumerate(sparse)}

        scores = {i: fused[i] for i in order}
        if rerank and settings.reranker_model and len(order) > 1:
            top = order[:RERANK_TOP]
            ce = embeddings.rerank(settings.reranker_model, query, [doc_text(listings[i]) for i in top])
            top = [i for _, i in sorted(zip(ce, top), key=lambda x: -x[0])]
            scores.update({i: float(s) for i, s in zip(top, sorted(ce, reverse=True))})
            order = top + order[RERANK_TOP:]

        return [{"_i": i, "score": round(scores[i], 4), "d": d_rank.get(i), "b": s_rank.get(i), "c": cos.get(i)} for i in order]


INDEX = HybridIndex(Path(settings.index_dir))


def warm():
    """Load models once at startup so the first real query isn't a 10 s cold start."""
    _embed(["warm up"], query=True)
    if settings.reranker_model:
        embeddings.rerank(settings.reranker_model, "warm", ["up"])
