from pathlib import Path

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = ""
    llm_provider: str = "ollama"       # ollama (local) | google (free tier) | anthropic | groq
    ollama_url: str = "http://localhost:11434"
    llm_api_key: str = ""
    llm_model: str = ""                 # empty = provider default (see app/llm.py)
    node_internal_url: str = "http://localhost:4000"
    internal_key: str = "change-me"

    # Listings pipeline
    data_dir: str = str(Path(__file__).resolve().parents[2] / "data")
    index_dir: str = str(Path(__file__).resolve().parents[1] / ".index")
    refresh_minutes: int = 60          # 0 = only refresh on demand
    rentcast_api_key: str = ""
    reranker_model: str = "cross-encoder/ms-marco-MiniLM-L-6-v2"   # "" or "off" disables reranking (saves ~140 MB RAM)
    embed_batch: int = 4               # ONNX batch size: small keeps peak memory low (vectors are identical)
    onnx_threads: int = 0              # 0 = all cores; 1 on small hosts like Render free

    @field_validator("reranker_model")
    @classmethod
    def _off(cls, v: str) -> str:
        return "" if v.strip().lower() in ("", "off", "none", "false", "0") else v.strip()


settings = Settings()
