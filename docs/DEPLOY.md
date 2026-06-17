# Production Deployment

This guide covers deploying ShiftAgent API, web, ML engine, and mobile builds.

## Prerequisites

- Supabase project with database password
- Railway/Render account (API + ML)
- Vercel account (web)
- Apple Developer + Google Play accounts (mobile stores)
- Expo account + EAS CLI for mobile builds

## 1. Database migrations

Run once against production Postgres (Supabase):

```bash
DATABASE_URL="postgresql://..." npm run db:migrate
```

**Do not run `db:seed` in production.**

## 2. Deploy API (Railway or Render)

Build from `apps/api/Dockerfile` (context: repo root).

Required env vars:

| Variable | Required |
|----------|----------|
| `NODE_ENV` | `production` |
| `DATABASE_URL` | Supabase pooler URI |
| `JWT_SECRET` | 32+ chars, unique |
| `CRON_SECRET` | 32+ chars, unique |
| `TOKEN_ENCRYPTION_KEY` | 32+ chars |
| `CORS_ORIGINS` | `https://your-web.vercel.app` |
| `REDIS_URL` | Managed Redis URL (recommended) |
| `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` | For LLM scheduling |
| `LLM_PROVIDER` | `anthropic` or `openai` |
| `LLM_PRIMARY_MODEL` | `claude-sonnet-4-6` (default) |
| `LLM_FALLBACK_MODEL` | `claude-sonnet-4-6` (retry on validation failure) |
| `LLM_SYNC_MODE` | `true` unless web polls async jobs (`REDIS_URL` set) |
| `ML_ENGINE_URL` | ML service URL |
| `ML_ENGINE_API_KEY` | Shared secret with ML engine |

Verify: `curl https://YOUR_API/health`

## 3. Deploy ML engine

Build from `apps/ml-engine/Dockerfile`. Set `ML_ENGINE_API_KEY` on both API and ML service.

## 4. Deploy web (Vercel)

Root: `apps/web`

Env: `VITE_API_URL=https://YOUR_API`

## 5. Create production accounts

```bash
curl -X POST https://YOUR_API/api/auth/signup \
  -H "Content-Type: application/json" \
  -d '{"email":"manager@restaurant.com","password":"...","name":"Manager","workplaceName":"Main St"}'
```

Add employees via web with real passwords (min 8 chars).

## 6. Mobile (EAS)

```bash
npm install -g eas-cli
cd apps/mobile
eas login
eas init

# Set secrets before production build
eas secret:create --name EXPO_PUBLIC_API_URL --value https://YOUR_API/api
eas secret:create --name EXPO_PUBLIC_SUPABASE_URL --value https://YOUR_PROJECT.supabase.co
eas secret:create --name EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY --value sb_publishable_...

eas build --platform ios --profile production
eas build --platform android --profile production
eas submit --platform ios --profile production
eas submit --platform android --profile production
```

## 7. Async schedule generation (optional)

When `REDIS_URL` is set and `LLM_SYNC_MODE` is not `true`, schedule generation can be queued via BullMQ. The sync path remains default for dev/tests.

## Checklist

- [ ] API `/health` returns OK
- [ ] Web loads and employer can log in
- [ ] Schedule generates (with or without LLM key)
- [ ] Manager publishes schedule; employees see it on mobile
- [ ] TestFlight + Play internal builds install against prod API
