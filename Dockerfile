##
# SendSmith — multi-stage production image (Node 22 LTS).
# Builder compiles the frontend; the final image carries production
# dependencies only.
##

FROM node:25-bookworm-slim AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build

FROM node:25-bookworm-slim
RUN set -x \
    && addgroup --gid 10001 app \
    && adduser --disabled-password \
        --gecos '' \
        --gid 10001 \
        --home /app \
        --uid 10001 \
        app
WORKDIR /app
COPY --chown=app:app package*.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force
COPY --chown=app:app app app
COPY --chown=app:app common common
COPY --chown=app:app public/locales public/locales
COPY --chown=app:app server server
COPY --chown=app:app --from=builder /app/dist dist
RUN ln -s dist/version.json version.json && mkdir -p /app/data
USER app

ENV NODE_ENV=production \
    PORT=1443 \
    FILE_DIR=/app/data

EXPOSE 1443
VOLUME ["/app/data"]

CMD ["node", "server/bin/prod.js"]
