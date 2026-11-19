"""Local embedding + rerank models, run with ONNX Runtime via fastembed (no PyTorch).

Same weights as the sentence-transformers versions (bge-small-en-v1.5, ms-marco-MiniLM-L-6-v2):
vectors and rerank scores match to 4 decimals, but it needs ~1.5 GB less disk and fits a 512 MB server."""
import threading
from functools import lru_cache

import numpy as np

from app.config import settings

EMBED_MODEL = "BAAI/bge-small-en-v1.5"  # 384-dim

# One ONNX run at a time: parallel runs each hold their own peak buffers (4 at once ≈ +250 MB),
# and small hosts have a fraction of a CPU, so serialising costs no speed there.
_LOCK = threading.Lock()

# sentence-transformers names → the ONNX export of the same model
_RERANK_ALIASES = {"cross-encoder/ms-marco-MiniLM-L-6-v2": "Xenova/ms-marco-MiniLM-L-6-v2",
                   "cross-encoder/ms-marco-MiniLM-L-12-v2": "Xenova/ms-marco-MiniLM-L-12-v2"}


@lru_cache
def _embedder():
    from fastembed import TextEmbedding
    return TextEmbedding(EMBED_MODEL, threads=settings.onnx_threads or None)


@lru_cache
def _reranker(name: str):
    from fastembed.rerank.cross_encoder import TextCrossEncoder
    return TextCrossEncoder(_RERANK_ALIASES.get(name, name), threads=settings.onnx_threads or None)


def embed(texts: list[str]) -> np.ndarray:
    """L2-normalised float32 vectors, so a dot product is cosine similarity."""
    if not texts:
        return np.zeros((0, 384), dtype="float32")
    # small batches: ONNX Runtime keeps its peak buffer, so batch 32 costs ~200 MB more than batch 4 for the same vectors
    with _LOCK:
        v = np.asarray(list(_embedder().embed(texts, batch_size=settings.embed_batch)), dtype="float32")
    return v / np.clip(np.linalg.norm(v, axis=1, keepdims=True), 1e-12, None)


def rerank(model: str, query: str, docs: list[str]) -> list[float]:
    with _LOCK:
        return [float(s) for s in _reranker(model).rerank(query, docs, batch_size=settings.embed_batch)]
