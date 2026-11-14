# Angular dashboard served by nginx, proxying /api to the API container. Build context: repository root.
#   docker build -f infra/docker/web.Dockerfile -t vsf-web .
FROM node:24.22.3-alpine AS build
WORKDIR /app
COPY package.json package-lock.json .nvmrc tsconfig.base.json ./
COPY libs/contracts/package.json libs/contracts/
COPY apps/web/package.json apps/web/
RUN npm ci --no-audit --no-fund -w @vsf/contracts -w web --include-workspace-root
COPY libs/contracts libs/contracts
COPY apps/web apps/web
RUN npm run build -w @vsf/contracts && npm run build -w web

FROM nginx:1.29-alpine AS runtime
COPY infra/docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist/web/browser /usr/share/nginx/html
EXPOSE 8080
