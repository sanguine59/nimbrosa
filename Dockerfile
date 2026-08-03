# Builds the single-port server: compiled backend plus the built SPA, served
# together from PORT (4040 by default) by dist/src/serve.js.
#
# The runtime layout must mirror the source tree — serve.ts locates the frontend
# at ../../src/web/dist relative to itself, so dist/ and src/web/dist/ have to
# keep their relative positions.

FROM node:22-alpine AS backend-build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
COPY scripts ./scripts
# tsconfig excludes src/web, so this compiles the backend only.
RUN npm run build

FROM node:22-alpine AS web-build
WORKDIR /app/src/web
COPY src/web/package.json src/web/package-lock.json ./
RUN npm ci
COPY src/web/ ./
RUN npm run build

FROM node:22-alpine AS runtime
# The deploy job prunes on this label, so only this project's superseded images
# are collected on a box whose Docker daemon is shared.
LABEL org.opencontainers.image.title="nimbrosa"
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=backend-build /app/dist ./dist
COPY --from=web-build /app/src/web/dist ./src/web/dist
USER node
EXPOSE 4040
# Configuration comes from the environment (compose env_file), not a bundled
# .env — the image must not carry credentials.
CMD ["node", "dist/src/serve.js"]
