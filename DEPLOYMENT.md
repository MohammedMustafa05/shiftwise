# ShiftAgent Deployment Guide

## Architecture

| Service | Platform | Domain |
|---|---|---|
| Web (Vite/React) | Vercel | `shiftagent.ca` / `www.shiftagent.ca` |
| API (Express/Node) | Railway | `api.shiftagent.ca` |
| ML Engine (FastAPI) | Railway | Internal (Railway private networking) |
| Database (Postgres) | Supabase | Managed |
| Cache (Redis) | Railway | Internal |

## DNS Records

Add these at your domain registrar:

| Type | Name | Value |
|---|---|---|
| A | `shiftagent.ca` | `76.76.21.21` (Vercel) |
| CNAME | `www` | `cname.vercel-dns.com` |
| CNAME | `api` | *(Railway custom domain CNAME target)* |

## Environment Variables

### Vercel — Web App

| Variable | Description |
|---|---|
| `VITE_API_URL` | `https://api.shiftagent.ca` |
| `VITE_SUPABASE_URL` | Supabase project URL (`https://xxxxx.supabase.co`) |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Supabase anon/public key |

### Railway — API Service

| Variable | Description |
|---|---|
| `NODE_ENV` | `production` |
| `PORT` | Set automatically by Railway |
| `DATABASE_URL` | Supabase pooler connection string (port 6543) |
| `REDIS_URL` | Railway Redis internal URL |
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_PROJECT_REF` | Supabase project reference ID |
| `SUPABASE_PUBLISHABLE_KEY` | Supabase anon/public key |
| `JWT_SECRET` | Random string, min 32 chars |
| `TOKEN_ENCRYPTION_KEY` | 64-hex-char key (`openssl rand -hex 32`) |
| `CRON_SECRET` | Random string, min 32 chars |
| `ML_ENGINE_URL` | Railway internal URL (e.g. `http://ml-engine.railway.internal:8000`) |
| `ANTHROPIC_API_KEY` | Anthropic API key |
| `LLM_PROVIDER` | `anthropic` |
| `LLM_PRIMARY_MODEL` | `claude-sonnet-4-20250514` |
| `LLM_SYNC_MODE` | `true` |
| `CLEARVIEW_MODE` | `mock` (until real POS integration) |
| `CORS_ORIGINS` | `https://shiftagent.ca,https://www.shiftagent.ca` |

### Railway — ML Engine Service

| Variable | Description |
|---|---|
| `DATABASE_URL` | Same Supabase pooler connection string |
| `ML_ENGINE_API_KEY` | Optional shared secret for API→ML auth |

### Mobile (Expo) — Build-time

| Variable | Description |
|---|---|
| `EXPO_PUBLIC_API_URL` | `https://api.shiftagent.ca/api` |
| `EXPO_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Supabase anon/public key |

## Supabase Dashboard Setup

Go to **Authentication → URL Configuration**:

- **Site URL:** `https://shiftagent.ca`
- **Redirect URLs:**
  - `https://shiftagent.ca/**`
  - `https://www.shiftagent.ca/**`

This is required for email confirmations, password resets, and OAuth callbacks to work in production.

## Deployment Commands

### Web (Vercel)

```bash
# Link to Vercel (first time)
cd apps/web && npx vercel link

# Deploy
npx vercel --prod
```

Set root directory to `apps/web`, framework to Vite, build command `npm run build`, output `dist`.

### API (Railway)

Railway deploys from the repo root using `apps/api/Dockerfile`. Push to `main` triggers auto-deploy if connected.

### ML Engine (Railway)

Separate Railway service using `apps/ml-engine/Dockerfile`.

## Generate Secrets

```bash
# JWT_SECRET
openssl rand -base64 48

# TOKEN_ENCRYPTION_KEY (must be exactly 64 hex chars)
openssl rand -hex 32

# CRON_SECRET
openssl rand -base64 48
```
