# Sarthi

Voice co-pilot for delivery riders. The app helps riders review a delivery run, handle exceptions, verify completion, and keep a persistent activity timeline.

## Project layout

- `frontend/` — mobile-friendly React and TypeScript app
- `backend/` — FastAPI API and Gnani integrations

## Run locally

Backend, from `backend/`:

```powershell
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements.txt
Copy-Item .env.example .env
uvicorn app.main:app --host 127.0.0.1 --port 8001 --reload
```

Frontend, from `frontend/`:

```powershell
npm install
npm run dev
```

The backend seeds a sample rider run in local SQLite on first launch. The OTPs in that local seed are test values, not production credentials. Set `GNANI_API_KEY` in `backend/.env`; never put it in frontend variables or commit it. The local `.env` is ignored by Git. To use Supabase Postgres, set `DATABASE_URL` to its connection string; plain `postgresql://` URLs are adapted to the installed psycopg driver.

Sarthi's decision model is a hosted LLM, with Groq selected by default. Add `GROQ_API_KEY` to `backend/.env`; you can switch to Gemini by setting `DECISION_PROVIDER=gemini` and adding `GEMINI_API_KEY`. If the selected key is missing or its provider is unavailable, Sarthi reports the problem instead of silently using rule-based replies. Keep all provider keys in the backend environment only.

Never put API keys in frontend code. Configure secrets in the backend environment.
