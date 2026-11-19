# Deploying TrojanScout

| Part | Host | Cost |
|---|---|---|
| Frontend (React/Vite) | **Vercel** | Free |
| Node API (Express) | **Render** web service `trojanscout-api` | Free, no card |
| AI service (FastAPI: search, Scout, report checks) | **Render** web service `trojanscout-ai` | Free, no card |
| LLM | **Groq** (replaces Ollama, which can't run on free hosts) | Free tier |

Both Render services come from one file, `render.yaml`. Vercel and Render watch GitHub, so every push to `main` redeploys.

Order: **1 Groq → 2 Render → 3 Vercel → 4 connect the URLs.** About 20 minutes plus build time.

## 1. Groq key (2 min)
console.groq.com → sign in → **API Keys → Create API Key** → copy it (shown once).

## 2. Both backends on Render (5 min + ~10 min build)
1. render.com → sign up **with GitHub** → allow access to the `HackSC_Winners` repo.
2. **New + → Blueprint** → pick `HackSC_Winners` → Render reads `render.yaml` and lists two services.
3. Fill the prompted values. The URLs follow the pattern `https://<service-name>.onrender.com`:

   | Service | Key | Value |
   |---|---|---|
   | trojanscout-api | `CORS_ORIGIN` | `https://placeholder.vercel.app` (fixed in step 4) |
   | trojanscout-api | `AI_SERVICE_URL` | `https://trojanscout-ai.onrender.com` |
   | trojanscout-api | `BREVO_API_KEY`, `MAIL_FROM` | leave blank |
   | trojanscout-ai | `LLM_API_KEY` | your Groq key |
   | trojanscout-ai | `NODE_INTERNAL_URL` | `https://trojanscout-api.onrender.com` |

4. **Apply.** Wait until both show **Live**; the AI service's first build takes about 10 minutes.
5. Open each service and check the URL at the top. If Render added a suffix (name taken), fix `AI_SERVICE_URL` / `NODE_INTERNAL_URL` to the real URLs.
6. Check: `https://trojanscout-api.onrender.com/health` → `{"ok":true,...}` and
   `https://trojanscout-ai.onrender.com/health` → `"llm": true, "provider": "groq"`.

`INTERNAL_KEY` (the secret the two services share) is generated and copied between them automatically.

## 3. Frontend on Vercel (5 min)
1. vercel.com → sign up **with GitHub** → **Add New… → Project** → import `HackSC_Winners`.
2. **Root Directory → Edit → `frontend`** (framework: Vite).
3. **Environment Variables:** `VITE_API_URL` = `https://trojanscout-api.onrender.com` (no trailing slash).
4. **Deploy** and copy the site URL.

## 4. Connect the site to the API (2 min)
Render → trojanscout-api → **Environment** → set `CORS_ORIGIN` to the Vercel URL (no trailing slash) → **Save, rebuild, and deploy**.
Without this the site loads but shows no data.

## 5. Check it
Open the Vercel URL: Search shows matches, Map draws a safe route, Scout answers, Free & Safe loads, sign-in works
(the 6-digit code appears in Render → trojanscout-api → **Logs** unless Brevo is set up).

## Free-tier limits to know
- **Render free services sleep after 15 min idle**; the first visit then takes ~1 min while both wake. Open the site and run one search a couple of minutes before a demo.
- The free plan has **512 MB RAM** per service. To fit, the AI service runs its models on ONNX instead of PyTorch (identical vectors)
  and turns the cross-encoder re-ranker off (`RERANKER_MODEL=off`): search is hybrid meaning + keyword ranking without the final re-sort.
  On a paid instance (1 GB+), delete that variable to turn re-ranking back on.
- **Files written at runtime reset on restart** (accounts, reports, friends). Fine for a demo; for real use, move them to Supabase (schema in `supabase/`).
- 750 free instance-hours a month are shared across your Render services; sleeping services don't use them.
- Groq's free tier has per-minute and per-day limits; when it's unavailable the app falls back to rules-only answers.
