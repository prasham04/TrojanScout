"""Offline ingest: clean → split ~300 tokens → extract street mentions → geocode (Nominatim, cached)
→ LLM category label → embed (bge-small) → insert into `chunks`. Crime rows go to `incidents` (not embedded).

Run: python -m app.rag.ingest
TODO(Dhruv): implement loaders for data/raw/{reddit,daily_trojan,lapd}."""

if __name__ == "__main__":
    print("ingest: not implemented yet — see docstring")
