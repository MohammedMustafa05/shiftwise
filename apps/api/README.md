# ShiftAgent API (Plan 1)

Express REST API with **Clearview mock mode** by default (`CLEARVIEW_MODE=mock`).

## Quick start

```bash
cp .env.example .env
# Set SUPABASE_DB_PASSWORD in .env (Dashboard → Project Settings → Database)
npm install
supabase link --project-ref qfjanmkxtdtezgpunrhn
supabase db push
npm run db:seed    # optional demo data
npm run dev:api
```

Or use local Docker: `docker compose up -d` and `DATABASE_URL=postgresql://postgres:postgres@localhost:5432/shiftagent`.

API: http://localhost:3001  
Health: `GET /health`

## Clearview mock mode

Until the manager provides real Partner Connect credentials:

- Set `CLEARVIEW_MODE=mock` (default in `.env.example`)
- Dummy `CLEARVIEW_CLIENT_ID` / `SECRET` are safe placeholders
- OAuth and sales sync use local fixtures (`fixtures/clearview_sales_response.json`)
- Payroll CSV export on publish is **real** (generated locally for manager upload)

Switch to production: `CLEARVIEW_MODE=live` + real secrets in `.env.local` (gitignored).

## Endpoints

| Method | Path | Role |
|--------|------|------|
| POST | `/api/auth/signup` | Public (employer) |
| POST | `/api/auth/login` | Public |
| POST | `/api/auth/join/:slug` | Public (employee) |
| GET | `/api/clearview/connect` | Employer |
| GET | `/api/clearview/callback` | Public |
| GET | `/api/workplace/:id/clearview/status` | Employer |
| POST | `/api/workplace/:id/sales-data` | Employer (CSV) |
| PUT | `/api/workplace/:id/preferences` | Employer |
| GET | `/api/workplace/:id/employees` | Employer |
| PUT | `/api/employees/:id/profile` | Employer |
| PUT | `/api/employees/:id/availability` | Employee |
| GET | `/api/employees/me/schedule` | Employee |
| POST | `/api/schedules/generate` | Employer |
| GET | `/api/schedules/:id` | Employer |
| PUT | `/api/schedules/:id/shifts/:shiftId` | Employer |
| POST | `/api/schedules/:id/publish` | Employer (+ Clearview CSV) |
| GET | `/api/schedules/:id/export/clearview` | Employer |
| POST | `/api/admin/sync-sales` | Cron (`x-cron-secret`) |

## LLM scheduling

Schedule generation calls Anthropic when `ANTHROPIC_API_KEY` is set. Defaults use **Claude Sonnet 4.6** for both primary and fallback (`LLM_PRIMARY_MODEL` / `LLM_FALLBACK_MODEL`). Without a key, the pipeline falls back to ML + constraint solver only.

For local UI testing: set `LLM_SYNC_MODE=true`, leave `REDIS_URL` empty, and restart the API after changing LLM env vars. Large rosters (10+ employees, `LLM_BATCH_MIN_EMPLOYEES`) are scheduled **one LLM call per day** to avoid truncated JSON. Default `LLM_MAX_TOKENS=16384`.

**Historical LSL schedules:** Train from all Clearview PDFs (OCR + statistical prior, not copy-paste): `npm run db:train-lsl-prior -w @shiftagent/api` (needs `pip3 install pymupdf pypdf pytesseract pillow`). Writes `apps/ml-engine/models/lsl_scheduling_prior.json` and refreshes `fixtures/lsl-historical-schedules.json`. The ML engine blends sales caps with learned day/hour shape; the LLM gets template + DOW hints.

## Clearview sales data (Drop Charts + Cash Sheets)

Place files in `apps/ml-engine/hourly sales data/`:

- **Drop Chart Worksheet*.pdf** — contain dates + hourly sales (authoritative for Apr 20–26, 2026)
- **Cash Sheet - Hourly Sales (N).xls** — UTF-16 HTML-as-XLS (no dates in file)
- **Cash Sheet CSV** — UTF-8 with Eat In column (27 cols; total sales at `ncols-3`)

Import Drop Charts and auto-match Cash Sheets by daily total:

```bash
npm run db:migrate -w @shiftagent/api
npm run db:import-clearview-sales -w @shiftagent/api
```

Upload a single cash sheet via API: `POST /api/workplace/:id/sales-data?saleDate=YYYY-MM-DD` (multipart `file` field).

Monday **2026-04-20** (Victoria Day, ~$8,566) is flagged `is_anomaly=true` and excluded from schedule generation.

## Testing

```bash
npm run test:api
```

Requires Postgres (`DATABASE_URL` in `.env`).

### Manual checklist (mock mode)

See `tests/http/shiftagent.http` and tick items 1–15 in Plan 1 (7b/14b deferred until live Clearview).

**Seed credentials:** `employer@demo.com` / `password123`

## Scripts

- `npm run db:migrate` — apply SQL migrations
- `npm run db:seed` — demo workplace, employees, sales
- `npm run test` — Vitest suite
