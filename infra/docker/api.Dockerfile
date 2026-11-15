# API + worker image (same image, different command). Build context: repository root.
#   docker build -f infra/docker/api.Dockerfile -t vsf-api .
FROM node:24.22.3-alpine AS build
WORKDIR /app
COPY package.json package-lock.json .nvmrc tsconfig.base.json ./
COPY libs/contracts/package.json libs/contracts/
COPY apps/api/package.json apps/api/
RUN npm ci --no-audit --no-fund -w @vsf/contracts -w @vsf/api --include-workspace-root
COPY libs/contracts libs/contracts
COPY apps/api apps/api
RUN npm run build -w @vsf/contracts && npm run build -w @vsf/api \
 && npm prune --omit=dev -w @vsf/contracts -w @vsf/api --include-workspace-root

FROM node:24.22.3-alpine AS runtime
ENV NODE_ENV=production
# Video production (Phase 04): FFmpeg for composition/QC, eSpeak NG for the local draft voice.
RUN apk add --no-cache ffmpeg espeak-ng
WORKDIR /app
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/libs/contracts/package.json ./libs/contracts/package.json
COPY --from=build --chown=node:node /app/libs/contracts/dist ./libs/contracts/dist
COPY --from=build --chown=node:node /app/apps/api/package.json ./apps/api/package.json
COPY --from=build --chown=node:node /app/apps/api/dist ./apps/api/dist
# Bundled, licensed fonts used by the frame renderer (SIL OFL 1.1; see assets/fonts/OFL.txt).
COPY --from=build --chown=node:node /app/apps/api/assets ./apps/api/assets
USER node
WORKDIR /app/apps/api
EXPOSE 3100
HEALTHCHECK --interval=15s --timeout=3s --retries=5 CMD wget -q -O /dev/null http://127.0.0.1:${PORT:-3100}/api/health/live || exit 1
# Worker: override with `node dist/worker.js` (no HTTP; the healthcheck is disabled in compose).
CMD ["node", "dist/main.js"]
