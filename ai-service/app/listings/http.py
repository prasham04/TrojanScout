"""Polite async HTTP client: obeys robots.txt, rate-limits per host, retries 429/5xx."""
import asyncio
import json
import re
import time
from urllib.parse import urlparse
from urllib.robotparser import RobotFileParser

import httpx

USER_AGENT = "Mozilla/5.0 (compatible; TrojanScoutBot/0.1; USC student housing research)"


class RobotsDisallowed(Exception):
    pass


class PoliteClient:
    def __init__(self, min_interval_s: float = 1.0, timeout_s: float = 25):
        self.client = httpx.AsyncClient(headers={"User-Agent": USER_AGENT}, timeout=timeout_s, follow_redirects=True)
        self.min_interval_s = min_interval_s
        self._robots: dict[str, RobotFileParser] = {}
        self._last: dict[str, float] = {}
        self._locks: dict[str, asyncio.Lock] = {}

    async def _robots_for(self, origin: str) -> RobotFileParser:
        if origin not in self._robots:
            rp = RobotFileParser()
            try:
                r = await self.client.get(f"{origin}/robots.txt")
                rp.parse(r.text.splitlines() if r.status_code == 200 else [])
            except httpx.HTTPError:
                rp.parse([])
            self._robots[origin] = rp
        return self._robots[origin]

    async def get_text(self, url: str) -> str:
        u = urlparse(url)
        origin = f"{u.scheme}://{u.netloc}"
        if not (await self._robots_for(origin)).can_fetch(USER_AGENT, url):
            raise RobotsDisallowed(url)
        lock = self._locks.setdefault(u.netloc, asyncio.Lock())
        async with lock:  # one request at a time per host, spaced out
            wait = self.min_interval_s - (time.monotonic() - self._last.get(u.netloc, 0))
            if wait > 0:
                await asyncio.sleep(wait)
            for attempt in range(3):
                r = await self.client.get(url)
                self._last[u.netloc] = time.monotonic()
                if r.status_code in (429, 500, 502, 503, 504) and attempt < 2:
                    await asyncio.sleep(2 ** (attempt + 1))
                    continue
                r.raise_for_status()
                return r.text
        raise RuntimeError("unreachable")

    async def aclose(self):
        await self.client.aclose()


def next_data(html: str) -> dict:
    """Extract the JSON a Next.js page embeds for its own render (public page content, not a private API)."""
    m = re.search(r'<script id="__NEXT_DATA__" type="application/json">(.*?)</script>', html, re.S)
    if not m:
        raise ValueError("no __NEXT_DATA__ on page")
    return json.loads(m.group(1))
