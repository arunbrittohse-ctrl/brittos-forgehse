# BRITTO'S FORGEHSE — single image serving the API and the built web app.
# Build:  docker build -t forgehse:0.1.0 .
# Run:    see docker-compose.yml and docs/DEPLOYMENT.md

FROM node:22-alpine AS build
WORKDIR /src
COPY package.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm install --no-audit --no-fund
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/api apps/api
COPY apps/web apps/web
RUN npm run typecheck -w @forgehse/shared \
 && npm run typecheck -w @forgehse/api \
 && npm run build -w @forgehse/api \
 && npm run build -w @forgehse/web

FROM node:22-alpine AS runtime
ENV NODE_ENV=production \
    PORT=4000 \
    MIGRATIONS_DIR=/app/migrations \
    WEB_DIST_DIR=/app/web \
    STORAGE_DIR=/data/storage
WORKDIR /app
# The API bundle is self-contained (dependencies are bundled by esbuild).
COPY --from=build /src/apps/api/dist ./dist
COPY --from=build /src/apps/api/migrations ./migrations
COPY --from=build /src/apps/web/dist ./web
RUN echo '{"type":"module"}' > package.json \
 && addgroup -S forge && adduser -S forge -G forge \
 && mkdir -p /data/storage && chown -R forge:forge /data
USER forge
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD wget -qO- http://127.0.0.1:4000/api/ready || exit 1
CMD ["node", "dist/server.js"]
