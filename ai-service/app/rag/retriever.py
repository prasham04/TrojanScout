"""Geo-filtered vector search via Supabase RPC match_chunks (see supabase/schema.sql).
psycopg/pgvector are imported only when DATABASE_URL is set, so the hosted service runs without them."""
from app.config import settings
from app.embeddings import EMBED_MODEL, embed  # noqa: F401  (re-exported)


async def match_chunks(query: str, lat: float, lng: float, radius_m: int = 150, k: int = 8) -> list[dict]:
    if not settings.database_url:
        return []
    import psycopg
    from pgvector.psycopg import register_vector_async
    q = embed([query])[0]
    async with await psycopg.AsyncConnection.connect(settings.database_url) as conn:
        await register_vector_async(conn)
        cur = await conn.execute("select * from match_chunks(%s, %s, %s, %s, %s)", (q, lat, lng, radius_m, k))
        cols = [c.name for c in cur.description]
        return [dict(zip(cols, row)) for row in await cur.fetchall()]


async def incident_counts(lat: float, lng: float, radius_m: int = 150) -> dict[str, int]:
    """Exact counts from SQL — never from the LLM."""
    if not settings.database_url:
        return {}
    import psycopg
    async with await psycopg.AsyncConnection.connect(settings.database_url) as conn:
        cur = await conn.execute(
            """select category, count(*) from incidents
               where date > current_date - interval '6 months'
                 and st_dwithin(geog, st_setsrid(st_makepoint(%s, %s), 4326)::geography, %s)
               group by category""", (lng, lat, radius_m))
        return {cat: n for cat, n in await cur.fetchall()}
