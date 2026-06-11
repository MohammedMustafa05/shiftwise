FROM node:20-alpine AS builder
WORKDIR /app

COPY package.json package-lock.json ./
COPY packages/shared/package.json ./packages/shared/
COPY apps/api/package.json ./apps/api/

RUN npm ci --workspace=@shiftagent/api --include-workspace-root

COPY packages/shared ./packages/shared
COPY apps/api ./apps/api
COPY supabase/migrations ./supabase/migrations

RUN npm run build -w @shiftagent/shared 2>/dev/null || true
RUN npm run build -w @shiftagent/api

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
COPY packages/shared/package.json ./packages/shared/
COPY apps/api/package.json ./apps/api/

RUN npm ci --workspace=@shiftagent/api --include-workspace-root --omit=dev

COPY --from=builder /app/packages/shared ./packages/shared
COPY --from=builder /app/apps/api/dist ./apps/api/dist
COPY --from=builder /app/supabase/migrations ./supabase/migrations

EXPOSE 3001
CMD ["node", "apps/api/dist/index.js"]
