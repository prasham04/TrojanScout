# SSE events — `POST /api/chat` (proxied to FastAPI `POST /ai/chat`)

Request body: `{ "message": string, "profile": Profile, "history": [{role, content}] }`

| event      | data                                              | UI action                          |
|------------|---------------------------------------------------|------------------------------------|
| `step`     | `{"label": "Checking Fryft zone", "status": "running" \| "done"}` | Render as checklist        |
| `listings` | `{"ids": [12, 4, 27]}`                            | Highlight markers, show result cards |
| `token`    | `{"text": "…"}`                                   | Append to streaming answer         |
| `error`    | `{"message": "…"}`                                | Friendly fallback                  |
| `done`     | `{}`                                              | Stop spinner                       |
