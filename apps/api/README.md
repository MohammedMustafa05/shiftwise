# ShiftWise API (Plan 1)

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

Or use local Docker: `docker compose up -d` and `DATABASE_URL=postgresql://postgres:postgres@localhost:5432/shiftwise`.

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

## Testing

```bash
npm run test:api
```

Requires Postgres (`DATABASE_URL` in `.env`).

### Manual checklist (mock mode)

See `tests/http/shiftwise.http` and tick items 1–15 in Plan 1 (7b/14b deferred until live Clearview).

**Seed credentials:** `employer@demo.com` / `password123`

## Scripts

- `npm run db:migrate` — apply SQL migrations
- `npm run db:seed` — demo workplace, employees, sales
- `npm run test` — Vitest suite
