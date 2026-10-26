# Imagem única do Help Desk (T17): a API (NestJS) serve também o build do front (React).
# Build: make image (deploy/prod/app.sh). As variáveis VITE_* são embutidas no front no build.

# ── build ────────────────────────────────────────────────────────────────────────
FROM node:24-alpine AS build
RUN npm install -g pnpm@11.8.0
WORKDIR /app

# Dependências primeiro (cache de camada). O postinstall da API roda `prisma generate`: precisa do schema.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/prisma.config.ts apps/api/
COPY apps/api/prisma apps/api/prisma
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile

COPY . .

ARG VITE_ZITADEL_AUTHORITY
ARG VITE_ZITADEL_CLIENT_ID
ARG VITE_ZITADEL_PROJECT_ID
RUN test -n "$VITE_ZITADEL_AUTHORITY" && test -n "$VITE_ZITADEL_CLIENT_ID" && test -n "$VITE_ZITADEL_PROJECT_ID" \
  || (echo "VITE_ZITADEL_* são obrigatórios no build" && exit 1)
RUN pnpm build

# ── runtime ──────────────────────────────────────────────────────────────────────
# Mantém as dependências de desenvolvimento: o Job de migração usa a CLI do Prisma e o seed usa tsx.
FROM node:24-alpine
ENV NODE_ENV=production \
    PORT=3000 \
    WEB_DIST_PATH=/app/apps/web/dist \
    PATH=/app/apps/api/node_modules/.bin:$PATH
WORKDIR /app
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/package.json /app/pnpm-workspace.yaml ./
COPY --from=build --chown=node:node /app/packages/shared ./packages/shared
COPY --from=build --chown=node:node /app/apps/web/dist ./apps/web/dist
COPY --from=build --chown=node:node /app/apps/api ./apps/api
WORKDIR /app/apps/api
USER node
EXPOSE 3000
CMD ["node", "dist/main.js"]
