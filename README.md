# TrojanScout — HackSC 2026

Map + chat housing copilot for USC students: DPS patrol zones, USC's free Lyft boundaries, door-to-desk commute, cited block summaries, True Trojan Cost, fit score.

```
React (Vite) :5173 ──REST+SSE──► Node+Express :4000 ──► OpenRouteService
                                   │ /api/*  public       ▲
                                   │ /internal/* agent    │ tool calls (X-Internal-Key)
                                   ▼ /api/chat proxy      │
                                 FastAPI :8000 ──► LLM (LangGraph agent + RAG)
                     both ──► Supabase Postgres (PostGIS + pgvector)
```

## Layout (each person owns a folder)

| Folder        | Owner              | Stack |
|---------------|--------------------|-------|
| `frontend/`   | Aanchal            | Vite + React + TS, Tailwind v4, react-leaflet, TanStack Query, Zustand, fetch-event-source |
| `node-api/`   | Prasham            | Express, zod, Turf.js, pg / supabase-js, axios, node-cache, http-proxy-middleware |
| `ai-service/` | Yash (agent), Dhruv (`app/rag`) | FastAPI, LangGraph, LangChain, langchain-anthropic, sentence-transformers (bge-small), psycopg + pgvector |
| `data/`       | Prasham / Dhruv    | `zones.geojson` (DPS patrol zones, UPC + HSC), `usc_ride_zones.geojson` (official USC Lyft boundaries), `incidents.json`, `streets.json`, `safety_resources.json`, `buildings.json`, `listings.json` (live, scraped), `listings.csv` (seed fallback) |
| `contracts/`  | Yash               | Report JSON example, SSE events, internal API |
| `supabase/`   | Prasham / Dhruv    | `schema.sql` — tables + `match_chunks` RPC |

## Pages (frontend)

| Route | Page |
|---|---|
| `/` | Landing: live stats, tap-to-check DPS zone map, search box |
| `/map` | Explore Map: DPS/Fryft layers, live listing dots → popup report next to the dot, compare sidebar (up to 3) |
| `/search` | Hybrid search over live listings |
| `/ask` | Ask Scout (LangGraph agent, streamed steps + result cards) |
| `/true-cost` | True Trojan Cost calculator (live listing or custom numbers) |
| `/preferences` | Budget, class buildings, late nights, priority weights (saved in the browser) |
| `/rides` | Book Ride: real-time shared rides with live matching and fare savings |
| `/free` | Free & Safe: search free rides, escorts, apps and programs by situation, with live status |

## LLM (local by default)

The AI service uses a **local model through Ollama**: free, private, no API key.
1. Install Ollama (ollama.com) and start it.
2. `ollama pull qwen2.5:7b` (~4.7 GB; good structured output + tool calling on a 16 GB Mac).
3. `LLM_PROVIDER=ollama` in `ai-service/.env` (the default). `/health` shows `"llm": true` once the model is reachable.

Alternatives via `LLM_PROVIDER`: `google` (free AI Studio key), `anthropic`, `groq`. If no model is reachable the app runs in mock mode.

## Free & Safe directory (`/free`)

- `data/free_programs.json`: 26 free or low-cost safety and mobility programs (USC, LA Metro/LADOT, LA County, California, national
  app features), each with eligibility, cost, a schedule (daily hours or yearly windows like Dec 24/Dec 31), coverage area, how to
  use it, official sources, the date it was checked, and `confidence: "check"` where sources disagree.
- `ai-service/app/free/search.py`: meaning + keyword search, situation rules ("I've been drinking", "someone is following me",
  "can't afford the bus"…), live status in LA time ("Available now, until 2 AM", "Next: New Year's Eve"), and area checks
  (Fryft/DPS polygons, the South LA mobility pilot). Edits to the JSON are picked up automatically.
- **Little-known USC transport, confirmed from transnet.usc.edu / dps.usc.edu:** USC Lyft Rides with its official boundary
  (`data/usc_ride_zones.geojson`: east of Normandie, south of Washington, west of Main, north of MLK; 7 PM–2 AM, Shared only),
  HSC Lyft incl. Union Station, the UPC ↔ Union Station shuttle (37 weekday departures), the weekend intercampus shuttle,
  the Thanksgiving LAX shuttle (reserve by Nov 20), and free first-year Zipcar.
- **Alerts** (`/api/free/alerts`): reservation deadlines, free days, service gaps and rides starting tonight → 🔔 bell, a top
  banner for urgent ones, and optional browser notifications (sent once each while the site is open).
- **Trip options** (`/api/free/trip`): for a from/to it lists the free ways that apply to that exact trip and why (both ends in
  the Lyft boundary, next shuttle departure, etc.). "Safest walk to the stop" routes the safe walk to the shuttle stop.
  Shown in the safe-route planner and in Book Ride before you pay.

## Shared rides (Book Ride page)

- Rides are **friends only**: you must be signed in and have at least one friend. Your trip is shown only to your friends (or the
  friend lists you pick), and you only see friends who shared with you. There are no simulated riders.
- `POST /api/rides` books a trip as the signed-in account; `POST /api/rides/pass` gives a rides-only pass, and
  `GET /api/rides/stream?pass=…` (SSE) pushes that rider their matches, incoming share requests and their friends' activity. State is in memory in node-api (`src/services/rides.ts`).
- Matching: departures within 20 min; best pickup/drop order for up to 3 riders; shown only if every rider saves money and nobody's
  detour exceeds ~6 min (or 40% of their trip). Tags explain the fit: pickup near yours / on your way, drop near yours / on your way.
- Pricing (estimate): $1.25 base + $3.10 fee + $1.15/mi + $0.30/min (min $8.50); the shared fare is split in proportion to each rider's
  solo fare. Matched groups get "Book in Uber" (pickup → final drop deep link) and a Google Maps route with all stops.
- Privacy: friends see only your name, that you're on their route and when you leave; pickup, drop-off and stop order are revealed
  only after both riders accept. To try it, sign in with two accounts in two browsers and add each other as friends.

## Safety: incidents, safest route, DPS units

- `python -m app.safety.ingest` (in ai-service) writes `data/incidents.json` (LAPD NIBRS offenses, data.lacity.org `k7nn-b2ep`,
  last 6 months, block-level), `data/streets.json` (OpenStreetMap walk network via Overpass) and `data/safety_resources.json`
  Falls back to labelled synthetic incidents if LAPD is down. Safety places (police, blue-light phones, clinics, DPS stations) come from OpenStreetMap; see `ingest_extra.py`.
- `GET /api/route?from=lat,lng&to=lat,lng&night=true` → fastest vs safest walk. Safest = shortest path where each street costs
  length × (1 + 2·√(nearby incident severity × recency / p90)), ×1.6 outside DPS, −10% if lit, small bonus for busy streets;
  never returned if it's riskier than the fastest.
- DPS units on the map are **simulated** (USC publishes no live feed): 7 units patrol real streets inside the zone, streamed over SSE.
- `npm run data:refresh` re-scrapes listings and refreshes safety data.

## Live listings + retrieval (ai-service/app/listings)

- **Sources** (robots.txt respected, 1 req/s per host): Stuho (all buildings + units), Tripalink USC section (filtered views from
  its sitemap), Mosaic Student Communities (AppFolio page), Featured (The Lorenzo, Menlo, Ellendale, Palisades, City Park — real
  locations, **sample prices**), RentCast API (licensed; only when `RENTCAST_API_KEY` is set).
- **Floorplans**: every listing has `units` (Studio, 1B1B, 2B1B, 2B2B, 3B2B, 3B3B, private room ± private bath, shared room).
- **Smart search** (`app/listings/query.py`): plain English → price, room type, bed/bath, private bath, amenities, zones, walk time
  to a building, sort. Rules first, LLM fills gaps when configured; every constraint comes back as a removable chip.
  Zillow / Apartments.com / Craigslist are deliberately excluded (their terms forbid scraping).
- **Pipeline**: scrape → normalize → dedupe by address → keep ≤3 mi of campus → DPS/Fryft flags from Node → `data/listings.json` → index.
  Refreshes every `REFRESH_MINUTES` (default 60) in the FastAPI lifespan; `python -m app.listings.pipeline` or `POST /api/refresh` forces one.
- **Retriever**: hard filters parsed from the query (price, beds, studio, "inside DPS") → dense `bge-small-en-v1.5` in FAISS (exact
  inner product) + sparse BM25 (`bm25s`, stemmed) → Reciprocal Rank Fusion → cross-encoder rerank (`ms-marco-MiniLM-L-6-v2`) of the top 20.
  All local and free. ~40 ms warm.
- **Possible upgrade**: replace BM25 with SPLADE++ (learned sparse, e.g. `prithivida/Splade_PP_en_v1` via fastembed); it matches synonyms
  ("furnished" ≈ "comes with furniture") that BM25 misses, at the cost of slower indexing.

## Run locally

```bash
npm run setup     # first time only (already done on this machine)
npm run dev       # web :5173, node :4000, ai :8000
```

Each service has a `.env` (copied from `.env.example`). Everything runs in **mock mode** with no keys:
Node reads `/data`, commute falls back to straight-line estimates, and the agent streams a mock answer.
Fill in `LLM_API_KEY`, `ORS_API_KEY`, `DATABASE_URL` to go real. `INTERNAL_KEY` must match in node-api and ai-service.

## Deploy

| Service  | Host   | How |
|----------|--------|-----|
| frontend | Vercel | root `frontend`, env `VITE_API_URL` |
| node-api | Render (free) | `render.yaml` Blueprint |
| ai-service | Render (free) | `render.yaml` Blueprint; installs `requirements-deploy.txt` (no PyTorch: ONNX models fit 512 MB), LLM via Groq |

Step-by-step: [DEPLOY.md](DEPLOY.md). Render free instances sleep: hit both `/health` endpoints 5 min before the demo.

## Sign-in, friends and ride sharing

**Flow:** Sign in → TrojanScout sign-in page → enter your @usc.edu email → 6-digit code by email → verified and registered →
Preferences (save, or skip) → landing page. Returning users go straight back to where they were.

- It is OpenID Connect (authorization code + PKCE, id_token verified against JWKS). The built-in identity provider at `/idp`
  proves you own a university email with a one-time code (10-minute expiry, 5 tries, 30 s resend cooldown). It never asks for a password.
- **Email delivery:** set `BREVO_API_KEY` (free, 300/day; verify a sender address) or `RESEND_API_KEY`, plus `MAIL_FROM`, in `node-api/.env`.
  Without them (local dev) the code is printed in the node-api terminal.
- **Real USC SSO:** USC's NetID login can only be used after TrojanScout is registered with USC ITS as an application. Then set
  `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET` and the same flow redirects to USC's real sign-in page. We don't copy USC's login page.
- `ALLOWED_EMAIL_DOMAINS` (default `usc.edu`) limits who can register.
- **Friends:** send a request by email; the other person must accept (profile page or alerts). Requests to emails without an account wait until they sign up.
- **Lists:** group friends (e.g. Roommates). When booking a ride you choose Everyone / All friends / chosen lists.
  Matching is mutual: two rides match only if each rider shared with the other.
- **Privacy:** until both riders accept, a match shows only the name, "travelling on your route", departure time and savings.
  Pickups, drop-offs and stop order are sent only to a formed group; the live feed never names people or places.
- Uber's link fills one destination, so the booker gets pickup → final destination and a list of middle stops to add.
  Google Maps gets every stop by name.

## Recent-incident check and safety places

- `GET /api/recent?lat&lng&hours=24` returns USC DPS crime alerts (from the dps.usc.edu feed, refreshed every 20 min, placed by intersection, block or building, with honest precision) plus student reports. LAPD data lags about 2 weeks, so it is shown separately.
- `GET /api/alerts` is one feed for the bell: DPS alerts near home or campus, student reports, friend requests, friends' rides and ride-share requests. Free-program alerts are merged in by the frontend.
- The map shows USC Lyft zones (UPC official boundary; HSC traced from USC's official map; Union Station), police stations (LAPD and others), DPS stations, blue-light phones, clinics and USC health vending machines (OpenStreetMap plus USC pages; vending positions are approximate).

## Lit & Alive routing, and HSC

The safest route minimizes **meters × multipliers**, and the route panel shows every multiplier, its data source and its value for both routes.
You can change how much each one counts:

| Factor | Effect on a block | Data |
|---|---|---|
| Reported crime | × (1 + 2 × √risk) | LAPD NIBRS, last 6 months, severity × recency, night ×1.5 |
| Outside DPS patrol | × 1.6 | USC DPS patrol areas, UPC and HSC |
| Dark streets | × (1 + 0.35 per broken streetlight, up to 3) after dark; OSM `lit=yes` −10% | Open "Streetlight Repair Services" cases, MyLA311 Cases 2026 (data.lacity.org `2cy6-i7zn`, updated daily) |
| People around | −6% per place open at your departure time (up to 5), busy streets −15% (smaller effect in daytime) | OpenStreetMap `opening_hours` |

Safest is drawn in green, fastest in blue (dashed). Broken streetlights and open places on the route are marked on the map.

**Health Sciences Campus:** the same street graph, LAPD incidents, places, police / blue phones / clinics, DPS patrol area (from DPS's written boundary),
DPS HSC station (2001 N Soto St), Lyft zone, HSC buildings as destinations, DPS alerts placed at HSC, and the intercampus shuttle stop.
Refresh this data with:

```bash
cd ai-service && .venv/bin/python -m app.safety.ingest_extra
```
