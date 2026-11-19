"""One LLM client, used everywhere. Returns None in mock mode (no LLM_API_KEY).

Pick the provider with LLM_PROVIDER in ai-service/.env:
  ollama     → local, free, private: runs on this Mac via Ollama (ollama.com). Default model qwen2.5:7b. No key needed.
  google     → free tier via Google AI Studio (aistudio.google.com/apikey). Default model gemini-2.5-flash.
  anthropic  → Claude (paid API, console.anthropic.com). Default model claude-opus-5-5.
  groq       → free tier (console.groq.com). Picks an available model itself (see GROQ_PREFERRED), or set LLM_MODEL.
All four support structured output (filter extraction) and streaming (the chat answer)."""
from app.config import settings

DEFAULT_MODELS = {"ollama": "qwen2.5:7b", "google": "gemini-2.5-flash", "anthropic": "claude-opus-5-5", "groq": "qwen/qwen3.8-27b"}

# Groq retires models (llama-3.3-70b-versatile was shut down for free keys on 2026-08-16), so with no
# LLM_MODEL set we ask Groq which models this key can use and take the first of these that is offered.
GROQ_PREFERRED = ["qwen/qwen3.8-27b", "openai/gpt-oss-120b", "openai/gpt-oss-20b"]  # all free on Groq's free plan
_groq_pick: str | None = None


def provider() -> str:
    return (settings.llm_provider or "google").lower()


def _groq_model() -> str:
    global _groq_pick
    if _groq_pick:
        return _groq_pick
    import httpx
    try:
        r = httpx.get("https://api.groq.com/openai/v1/models", headers={"Authorization": f"Bearer {settings.llm_api_key}"}, timeout=8)
        ids = {m["id"] for m in r.json().get("data", []) if m.get("active", True)}
        _groq_pick = next((m for m in GROQ_PREFERRED if m in ids), None) or DEFAULT_MODELS["groq"]
    except (httpx.HTTPError, ValueError, KeyError, TypeError):  # offline or bad reply: default now, retry next time
        return DEFAULT_MODELS["groq"]
    return _groq_pick


def model_name() -> str:
    if settings.llm_model:
        return settings.llm_model
    if provider() == "groq" and settings.llm_api_key:
        return _groq_model()
    return DEFAULT_MODELS.get(provider(), "")


_client = None


def get_llm():
    """Cached once a model is available. While unavailable (e.g. Ollama still pulling), re-checks on each call."""
    global _client
    if _client is None:
        _client = _make()
    return _client


def _make():
    p, m = provider(), model_name()
    if p == "ollama":  # local model: no key; None (mock mode) if the Ollama server isn't reachable
        import httpx
        try:
            tags = httpx.get(f"{settings.ollama_url}/api/tags", timeout=2).json().get("models", [])
        except Exception:
            return None
        if not any(t.get("name", "").startswith(m) for t in tags):
            return None
        from langchain_ollama import ChatOllama
        return ChatOllama(model=m, base_url=settings.ollama_url, temperature=0.2, num_ctx=8192)
    if not settings.llm_api_key:
        return None
    if p == "google":
        from langchain_google_genai import ChatGoogleGenerativeAI
        return ChatGoogleGenerativeAI(model=m, google_api_key=settings.llm_api_key, temperature=0.2)
    if p == "anthropic":
        from langchain_anthropic import ChatAnthropic
        return ChatAnthropic(model=m, api_key=settings.llm_api_key, max_tokens=16000)
    if p == "groq":
        from langchain_groq import ChatGroq
        return ChatGroq(model=m, api_key=settings.llm_api_key, temperature=0.2)
    raise ValueError(f"Unknown LLM_PROVIDER {p!r} (use ollama, google, anthropic or groq)")
